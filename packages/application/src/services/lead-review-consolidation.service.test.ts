/**
 * Tests for the lead review consolidation service.
 *
 * These tests verify that the lead reviewer's context is correctly
 * assembled when all specialist reviewer jobs have completed. The
 * consolidation service is the bridge between specialist review fan-out
 * (T059) and the lead reviewer's decision (T061).
 *
 * Test categories:
 * - Happy path: single and multiple specialist packets
 * - Review history: prior cycle inclusion and ordering
 * - State machine validation: only valid source states allowed
 * - Job completion verification: blocks on incomplete specialists
 * - Error handling: missing entities, concurrent modifications
 * - Audit and event emission: correct records created
 *
 * @module @factory/application/services/lead-review-consolidation.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReviewCycleStatus, JobType, JobStatus } from "@factory/domain";

import { createLeadReviewConsolidationService } from "./lead-review-consolidation.service.js";
import type { LeadReviewConsolidationDependencies } from "./lead-review-consolidation.service.js";
import type {
  LeadReviewTask,
  LeadReviewCycle,
  SpecialistReviewPacket,
  LeadReviewJob,
  LeadReviewAuditEvent,
  LeadReviewTransactionRepositories,
  LeadReviewConsolidationUnitOfWork,
} from "../ports/lead-review-consolidation.ports.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type { ActorInfo } from "../events/domain-events.js";
import { EntityNotFoundError, InvalidTransitionError } from "../errors.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const FIXED_DATE = new Date("2025-06-15T10:00:00.000Z");
const SYSTEM_ACTOR: ActorInfo = { type: "system", id: "scheduler" };

let auditIdCounter = 0;

function createMockTask(overrides: Partial<LeadReviewTask> = {}): LeadReviewTask {
  return {
    id: "task-001",
    status: "IN_REVIEW",
    repositoryId: "repo-001",
    ...overrides,
  };
}

function createMockCycle(overrides: Partial<LeadReviewCycle> = {}): LeadReviewCycle {
  return {
    reviewCycleId: "cycle-001",
    taskId: "task-001",
    status: ReviewCycleStatus.IN_PROGRESS,
    requiredReviewers: ["security", "correctness"],
    optionalReviewers: ["performance"],
    startedAt: new Date("2025-06-15T09:00:00.000Z"),
    completedAt: null,
    ...overrides,
  };
}

function createMockSpecialistPacket(
  overrides: Partial<SpecialistReviewPacket> = {},
): SpecialistReviewPacket {
  return {
    reviewPacketId: `packet-${Math.random().toString(36).slice(2, 8)}`,
    taskId: "task-001",
    reviewCycleId: "cycle-001",
    reviewerType: "security",
    verdict: "approved",
    packetJson: {
      packet_type: "review_packet",
      schema_version: "1.0",
      summary: "Looks good",
    },
    createdAt: new Date("2025-06-15T09:30:00.000Z"),
    ...overrides,
  };
}

function createMockJob(overrides: Partial<LeadReviewJob> = {}): LeadReviewJob {
  return {
    jobId: `job-${Math.random().toString(36).slice(2, 8)}`,
    jobType: JobType.REVIEWER_DISPATCH,
    status: JobStatus.COMPLETED,
    jobGroupId: "cycle-001",
    dependsOnJobIds: null,
    payloadJson: { reviewCycleId: "cycle-001", taskId: "task-001", role: "reviewer" },
    ...overrides,
  };
}

interface MockRepoState {
  task: LeadReviewTask | undefined;
  cycles: LeadReviewCycle[];
  packets: SpecialistReviewPacket[];
  jobs: LeadReviewJob[];
}

function createMockRepos(state: MockRepoState): LeadReviewTransactionRepositories {
  return {
    task: {
      findById: (id: string) => (state.task?.id === id ? state.task : undefined),
    },
    reviewCycle: {
      findById: (id: string) => state.cycles.find((c) => c.reviewCycleId === id),
      findByTaskId: (taskId: string) => state.cycles.filter((c) => c.taskId === taskId),
      updateStatus: (
        reviewCycleId: string,
        expectedStatus: ReviewCycleStatus,
        newStatus: ReviewCycleStatus,
      ) => {
        const cycle = state.cycles.find(
          (c) => c.reviewCycleId === reviewCycleId && c.status === expectedStatus,
        );
        if (!cycle) return undefined;
        const updated = { ...cycle, status: newStatus };
        const idx = state.cycles.indexOf(cycle);
        state.cycles[idx] = updated;
        return updated;
      },
    },
    reviewPacket: {
      findByReviewCycleId: (reviewCycleId: string) =>
        state.packets.filter((p) => p.reviewCycleId === reviewCycleId),
    },
    job: {
      findByGroupId: (groupId: string) => state.jobs.filter((j) => j.jobGroupId === groupId),
    },
    auditEvent: {
      create: (event) => {
        auditIdCounter++;
        return {
          auditEventId: `audit-${auditIdCounter}`,
          ...event,
          createdAt: FIXED_DATE,
        } as LeadReviewAuditEvent;
      },
    },
  };
}

function createMockUnitOfWork(state: MockRepoState): LeadReviewConsolidationUnitOfWork {
  return {
    runInTransaction: <T>(fn: (repos: LeadReviewTransactionRepositories) => T): T => {
      const repos = createMockRepos(state);
      return fn(repos);
    },
  };
}

function createMockEventEmitter(): DomainEventEmitter & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    emit: (event: unknown) => {
      events.push(event);
    },
  };
}

function createServiceWithState(state: MockRepoState) {
  const eventEmitter = createMockEventEmitter();
  const deps: LeadReviewConsolidationDependencies = {
    unitOfWork: createMockUnitOfWork(state),
    eventEmitter,
    clock: () => FIXED_DATE,
  };
  const service = createLeadReviewConsolidationService(deps);
  return { service, eventEmitter };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LeadReviewConsolidationService", () => {
  beforeEach(() => {
    auditIdCounter = 0;
  });

  // ── Happy path — single specialist ──────────────────────────────────

  describe("happy path — single specialist reviewer", () => {
    /**
     * Validates the core consolidation flow with one specialist.
     * This is the simplest case: one required reviewer has completed,
     * the cycle transitions to CONSOLIDATING, and the packet is returned.
     *
     * Important because it exercises the full pipeline with minimum data.
     */
    it("assembles lead context with one completed specialist", () => {
      const securityPacket = createMockSpecialistPacket({
        reviewerType: "security",
        verdict: "approved",
      });
      const specialistJob = createMockJob({
        jobId: "job-security",
        status: JobStatus.COMPLETED,
      });

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [createMockCycle({ requiredReviewers: ["security"], optionalReviewers: [] })],
        packets: [securityPacket],
        jobs: [specialistJob],
      };

      const { service, eventEmitter } = createServiceWithState(state);

      const result = service.assembleLeadReviewContext({
        reviewCycleId: "cycle-001",
        taskId: "task-001",
        actor: SYSTEM_ACTOR,
      });

      expect(result.reviewCycle.status).toBe(ReviewCycleStatus.CONSOLIDATING);
      expect(result.specialistPackets).toHaveLength(1);
      expect(result.specialistPackets[0]!.reviewerType).toBe("security");
      expect(result.reviewHistory).toHaveLength(0);
      expect(result.auditEvents).toHaveLength(1);
      expect(eventEmitter.events).toHaveLength(1);
    });
  });

  // ── Happy path — multiple specialists ───────────────────────────────

  describe("happy path — multiple specialist reviewers", () => {
    /**
     * Validates consolidation with multiple specialists (required + optional).
     * The lead reviewer must receive ALL specialist packets, not just required.
     *
     * Important because the review fan-out pattern creates parallel jobs,
     * and the lead needs complete information from all perspectives.
     */
    it("assembles lead context with all specialist packets", () => {
      const packets = [
        createMockSpecialistPacket({
          reviewPacketId: "pkt-security",
          reviewerType: "security",
          verdict: "approved",
        }),
        createMockSpecialistPacket({
          reviewPacketId: "pkt-correctness",
          reviewerType: "correctness",
          verdict: "changes_requested",
        }),
        createMockSpecialistPacket({
          reviewPacketId: "pkt-performance",
          reviewerType: "performance",
          verdict: "approved",
        }),
      ];

      const jobs = [
        createMockJob({ jobId: "job-security", status: JobStatus.COMPLETED }),
        createMockJob({ jobId: "job-correctness", status: JobStatus.COMPLETED }),
        createMockJob({ jobId: "job-performance", status: JobStatus.COMPLETED }),
      ];

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [createMockCycle()],
        packets,
        jobs,
      };

      const { service } = createServiceWithState(state);

      const result = service.assembleLeadReviewContext({
        reviewCycleId: "cycle-001",
        taskId: "task-001",
        actor: SYSTEM_ACTOR,
      });

      expect(result.specialistPackets).toHaveLength(3);
      const types = result.specialistPackets.map((p) => p.reviewerType);
      expect(types).toContain("security");
      expect(types).toContain("correctness");
      expect(types).toContain("performance");
    });

    /**
     * Validates that failed specialist jobs are still considered terminal
     * and their (possibly empty) packets are included. The lead reviewer
     * must be informed about failures, not blocked by them.
     *
     * Important because PRD §2.3 states: "If a specialist job fails,
     * lead review still triggers (reviews partial results)."
     */
    it("includes context from failed specialist jobs", () => {
      const securityPacket = createMockSpecialistPacket({
        reviewerType: "security",
        verdict: "approved",
      });

      const jobs = [
        createMockJob({ jobId: "job-security", status: JobStatus.COMPLETED }),
        createMockJob({ jobId: "job-correctness", status: JobStatus.FAILED }),
      ];

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [
          createMockCycle({
            requiredReviewers: ["security", "correctness"],
            optionalReviewers: [],
          }),
        ],
        packets: [securityPacket],
        jobs,
      };

      const { service } = createServiceWithState(state);

      const result = service.assembleLeadReviewContext({
        reviewCycleId: "cycle-001",
        taskId: "task-001",
        actor: SYSTEM_ACTOR,
      });

      // Should still succeed — failed jobs are terminal
      expect(result.reviewCycle.status).toBe(ReviewCycleStatus.CONSOLIDATING);
      // Only the completed job's packet is stored; failed job has no packet
      expect(result.specialistPackets).toHaveLength(1);
      // Both specialist jobs returned
      expect(result.specialistJobs).toHaveLength(2);
    });
  });

  // ── Review history ──────────────────────────────────────────────────

  describe("review history from prior cycles", () => {
    /**
     * Validates that the lead reviewer receives review history from
     * prior cycles. This enables the lead to understand what changed
     * between rework iterations.
     *
     * Important because the PRD requires review history to be included
     * in the lead reviewer's context (T060 acceptance criterion).
     */
    it("includes specialist packets from prior review cycles", () => {
      const priorCycle = createMockCycle({
        reviewCycleId: "cycle-prior",
        taskId: "task-001",
        status: ReviewCycleStatus.REJECTED,
        startedAt: new Date("2025-06-14T09:00:00.000Z"),
        completedAt: new Date("2025-06-14T12:00:00.000Z"),
      });

      const priorPacket = createMockSpecialistPacket({
        reviewPacketId: "pkt-prior-security",
        reviewCycleId: "cycle-prior",
        reviewerType: "security",
        verdict: "changes_requested",
      });

      const currentPacket = createMockSpecialistPacket({
        reviewPacketId: "pkt-current-security",
        reviewCycleId: "cycle-001",
        reviewerType: "security",
        verdict: "approved",
      });

      const currentJob = createMockJob({
        jobId: "job-security",
        status: JobStatus.COMPLETED,
      });

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [priorCycle, createMockCycle()],
        packets: [priorPacket, currentPacket],
        jobs: [currentJob],
      };

      const { service } = createServiceWithState(state);

      const result = service.assembleLeadReviewContext({
        reviewCycleId: "cycle-001",
        taskId: "task-001",
        actor: SYSTEM_ACTOR,
      });

      expect(result.reviewHistory).toHaveLength(1);
      expect(result.reviewHistory[0]!.reviewCycleId).toBe("cycle-prior");
      expect(result.reviewHistory[0]!.status).toBe(ReviewCycleStatus.REJECTED);
      expect(result.reviewHistory[0]!.specialistPackets).toHaveLength(1);
      expect(result.reviewHistory[0]!.specialistPackets[0]!.verdict).toBe("changes_requested");

      // Current cycle packets are separate
      expect(result.specialistPackets).toHaveLength(1);
      expect(result.specialistPackets[0]!.reviewCycleId).toBe("cycle-001");
    });

    /**
     * Validates that multiple prior cycles are returned in chronological
     * order (oldest first) so the lead reviewer can follow the rework
     * progression.
     *
     * Important for multi-rework scenarios where the lead needs to
     * understand the evolution of the review feedback.
     */
    it("orders review history chronologically (oldest first)", () => {
      const cycle1 = createMockCycle({
        reviewCycleId: "cycle-1st",
        status: ReviewCycleStatus.REJECTED,
        startedAt: new Date("2025-06-13T09:00:00.000Z"),
        completedAt: new Date("2025-06-13T12:00:00.000Z"),
      });
      const cycle2 = createMockCycle({
        reviewCycleId: "cycle-2nd",
        status: ReviewCycleStatus.REJECTED,
        startedAt: new Date("2025-06-14T09:00:00.000Z"),
        completedAt: new Date("2025-06-14T12:00:00.000Z"),
      });
      const currentCycle = createMockCycle({
        reviewCycleId: "cycle-001",
        startedAt: new Date("2025-06-15T09:00:00.000Z"),
      });

      const currentJob = createMockJob({ status: JobStatus.COMPLETED });

      const state: MockRepoState = {
        task: createMockTask(),
        // Intentionally out of order to verify sorting
        cycles: [cycle2, currentCycle, cycle1],
        packets: [],
        jobs: [currentJob],
      };

      const { service } = createServiceWithState(state);

      const result = service.assembleLeadReviewContext({
        reviewCycleId: "cycle-001",
        taskId: "task-001",
        actor: SYSTEM_ACTOR,
      });

      expect(result.reviewHistory).toHaveLength(2);
      expect(result.reviewHistory[0]!.reviewCycleId).toBe("cycle-1st");
      expect(result.reviewHistory[1]!.reviewCycleId).toBe("cycle-2nd");
    });

    /**
     * Validates empty review history on the first review cycle.
     * The lead reviewer should receive an empty array, not undefined.
     *
     * Important for the base case where there is no prior feedback.
     */
    it("returns empty history for first review cycle", () => {
      const currentJob = createMockJob({ status: JobStatus.COMPLETED });
      const currentPacket = createMockSpecialistPacket();

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [createMockCycle()],
        packets: [currentPacket],
        jobs: [currentJob],
      };

      const { service } = createServiceWithState(state);

      const result = service.assembleLeadReviewContext({
        reviewCycleId: "cycle-001",
        taskId: "task-001",
        actor: SYSTEM_ACTOR,
      });

      expect(result.reviewHistory).toHaveLength(0);
      expect(Array.isArray(result.reviewHistory)).toBe(true);
    });
  });

  // ── State machine validation ────────────────────────────────────────

  describe("state machine validation", () => {
    /**
     * Validates that consolidation works from AWAITING_REQUIRED_REVIEWS.
     * This is the alternative path where some reviews completed before
     * all required reviews were in.
     *
     * Important because the state machine allows two source states for
     * CONSOLIDATING: IN_PROGRESS and AWAITING_REQUIRED_REVIEWS.
     */
    it("transitions from AWAITING_REQUIRED_REVIEWS to CONSOLIDATING", () => {
      const cycle = createMockCycle({
        status: ReviewCycleStatus.AWAITING_REQUIRED_REVIEWS,
      });
      const job = createMockJob({ status: JobStatus.COMPLETED });
      const packet = createMockSpecialistPacket();

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [cycle],
        packets: [packet],
        jobs: [job],
      };

      const { service } = createServiceWithState(state);

      const result = service.assembleLeadReviewContext({
        reviewCycleId: "cycle-001",
        taskId: "task-001",
        actor: SYSTEM_ACTOR,
      });

      expect(result.reviewCycle.status).toBe(ReviewCycleStatus.CONSOLIDATING);
    });

    /**
     * Validates that consolidation is rejected from NOT_STARTED state.
     * A cycle that hasn't even been routed cannot be consolidated.
     *
     * Important for preventing premature consolidation.
     */
    it("rejects consolidation from NOT_STARTED state", () => {
      const cycle = createMockCycle({
        status: ReviewCycleStatus.NOT_STARTED,
      });

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [cycle],
        packets: [],
        jobs: [],
      };

      const { service } = createServiceWithState(state);

      expect(() =>
        service.assembleLeadReviewContext({
          reviewCycleId: "cycle-001",
          taskId: "task-001",
          actor: SYSTEM_ACTOR,
        }),
      ).toThrow(InvalidTransitionError);
    });

    /**
     * Validates that consolidation is rejected from ROUTED state.
     * Reviews haven't started yet — no specialist feedback to consolidate.
     *
     * Important because ROUTED → CONSOLIDATING is not a valid transition.
     */
    it("rejects consolidation from ROUTED state", () => {
      const cycle = createMockCycle({
        status: ReviewCycleStatus.ROUTED,
      });

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [cycle],
        packets: [],
        jobs: [],
      };

      const { service } = createServiceWithState(state);

      expect(() =>
        service.assembleLeadReviewContext({
          reviewCycleId: "cycle-001",
          taskId: "task-001",
          actor: SYSTEM_ACTOR,
        }),
      ).toThrow(InvalidTransitionError);
    });

    /**
     * Validates that consolidation is rejected from APPROVED (terminal) state.
     * A cycle that already completed cannot be re-consolidated.
     *
     * Important for idempotency safety — prevents duplicate consolidation.
     */
    it("rejects consolidation from terminal APPROVED state", () => {
      const cycle = createMockCycle({
        status: ReviewCycleStatus.APPROVED,
      });

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [cycle],
        packets: [],
        jobs: [],
      };

      const { service } = createServiceWithState(state);

      expect(() =>
        service.assembleLeadReviewContext({
          reviewCycleId: "cycle-001",
          taskId: "task-001",
          actor: SYSTEM_ACTOR,
        }),
      ).toThrow(InvalidTransitionError);
    });

    /**
     * Validates that CONSOLIDATING → CONSOLIDATING (self-transition)
     * is rejected. A cycle already being consolidated cannot be
     * re-entered.
     *
     * Important for preventing double-dispatch of the lead reviewer.
     */
    it("rejects consolidation from already-CONSOLIDATING state", () => {
      const cycle = createMockCycle({
        status: ReviewCycleStatus.CONSOLIDATING,
      });

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [cycle],
        packets: [],
        jobs: [],
      };

      const { service } = createServiceWithState(state);

      expect(() =>
        service.assembleLeadReviewContext({
          reviewCycleId: "cycle-001",
          taskId: "task-001",
          actor: SYSTEM_ACTOR,
        }),
      ).toThrow(InvalidTransitionError);
    });
  });

  // ── Job completion verification ─────────────────────────────────────

  describe("specialist job completion verification", () => {
    /**
     * Validates that consolidation is blocked when specialist jobs are
     * still in PENDING status. The lead cannot review incomplete work.
     *
     * Important because the job dependency system (T026) should prevent
     * claiming the lead job, but this is a defense-in-depth check.
     */
    it("rejects when specialist jobs are still pending", () => {
      const jobs = [
        createMockJob({ jobId: "job-security", status: JobStatus.COMPLETED }),
        createMockJob({ jobId: "job-correctness", status: JobStatus.PENDING }),
      ];

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [createMockCycle()],
        packets: [],
        jobs,
      };

      const { service } = createServiceWithState(state);

      expect(() =>
        service.assembleLeadReviewContext({
          reviewCycleId: "cycle-001",
          taskId: "task-001",
          actor: SYSTEM_ACTOR,
        }),
      ).toThrow(InvalidTransitionError);
    });

    /**
     * Validates that RUNNING specialist jobs also block consolidation.
     * A job still actively executing has not produced final output.
     *
     * Important for ensuring the lead reviewer gets complete information.
     */
    it("rejects when specialist jobs are still running", () => {
      const jobs = [createMockJob({ jobId: "job-security", status: JobStatus.RUNNING })];

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [createMockCycle({ requiredReviewers: ["security"], optionalReviewers: [] })],
        packets: [],
        jobs,
      };

      const { service } = createServiceWithState(state);

      expect(() =>
        service.assembleLeadReviewContext({
          reviewCycleId: "cycle-001",
          taskId: "task-001",
          actor: SYSTEM_ACTOR,
        }),
      ).toThrow(InvalidTransitionError);
    });

    /**
     * Validates that the error message includes pending job IDs
     * for diagnostic clarity.
     *
     * Important for operators debugging why consolidation was rejected.
     */
    it("includes pending job IDs in error message", () => {
      const jobs = [
        createMockJob({ jobId: "job-security", status: JobStatus.COMPLETED }),
        createMockJob({ jobId: "job-correctness", status: JobStatus.CLAIMED }),
        createMockJob({ jobId: "job-perf", status: JobStatus.PENDING }),
      ];

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [createMockCycle()],
        packets: [],
        jobs,
      };

      const { service } = createServiceWithState(state);

      try {
        service.assembleLeadReviewContext({
          reviewCycleId: "cycle-001",
          taskId: "task-001",
          actor: SYSTEM_ACTOR,
        });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidTransitionError);
        const ite = err as InvalidTransitionError;
        expect(ite.message).toContain("job-correctness");
        expect(ite.message).toContain("job-perf");
      }
    });

    /**
     * Validates that the lead_review_consolidation job itself is
     * NOT counted as a specialist job. Only REVIEWER_DISPATCH jobs
     * are checked.
     *
     * Important because the lead job shares the same jobGroupId
     * and would otherwise block itself.
     */
    it("excludes lead consolidation job from specialist check", () => {
      const leadJob = createMockJob({
        jobId: "job-lead",
        jobType: JobType.LEAD_REVIEW_CONSOLIDATION,
        status: JobStatus.CLAIMED, // Not terminal, but should be excluded
      });
      const specialistJob = createMockJob({
        jobId: "job-security",
        jobType: JobType.REVIEWER_DISPATCH,
        status: JobStatus.COMPLETED,
      });

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [createMockCycle({ requiredReviewers: ["security"], optionalReviewers: [] })],
        packets: [createMockSpecialistPacket()],
        jobs: [leadJob, specialistJob],
      };

      const { service } = createServiceWithState(state);

      // Should NOT throw — lead job is excluded from specialist check
      const result = service.assembleLeadReviewContext({
        reviewCycleId: "cycle-001",
        taskId: "task-001",
        actor: SYSTEM_ACTOR,
      });

      expect(result.reviewCycle.status).toBe(ReviewCycleStatus.CONSOLIDATING);
    });

    /**
     * Validates that cancelled specialist jobs are treated as terminal.
     * Cancellation is a valid way for a specialist job to end.
     *
     * Important because the PRD allows the lead to review partial results.
     */
    it("treats cancelled specialist jobs as terminal", () => {
      const jobs = [
        createMockJob({ jobId: "job-security", status: JobStatus.COMPLETED }),
        createMockJob({ jobId: "job-correctness", status: JobStatus.CANCELLED }),
      ];

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [createMockCycle()],
        packets: [createMockSpecialistPacket()],
        jobs,
      };

      const { service } = createServiceWithState(state);

      const result = service.assembleLeadReviewContext({
        reviewCycleId: "cycle-001",
        taskId: "task-001",
        actor: SYSTEM_ACTOR,
      });

      expect(result.reviewCycle.status).toBe(ReviewCycleStatus.CONSOLIDATING);
    });
  });

  // ── Error handling — missing entities ───────────────────────────────

  describe("error handling — missing entities", () => {
    /**
     * Validates that a missing task throws EntityNotFoundError.
     * The task might have been deleted between scheduling and execution.
     *
     * Important for graceful error handling in asynchronous workflows.
     */
    it("throws EntityNotFoundError for missing task", () => {
      const state: MockRepoState = {
        task: undefined,
        cycles: [createMockCycle()],
        packets: [],
        jobs: [],
      };

      const { service } = createServiceWithState(state);

      expect(() =>
        service.assembleLeadReviewContext({
          reviewCycleId: "cycle-001",
          taskId: "task-001",
          actor: SYSTEM_ACTOR,
        }),
      ).toThrow(EntityNotFoundError);
    });

    /**
     * Validates that a missing review cycle throws EntityNotFoundError.
     *
     * Important for detecting stale references from the job payload.
     */
    it("throws EntityNotFoundError for missing review cycle", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [],
        packets: [],
        jobs: [],
      };

      const { service } = createServiceWithState(state);

      expect(() =>
        service.assembleLeadReviewContext({
          reviewCycleId: "cycle-001",
          taskId: "task-001",
          actor: SYSTEM_ACTOR,
        }),
      ).toThrow(EntityNotFoundError);
    });

    /**
     * Validates that a review cycle belonging to a different task
     * is treated as not found. Prevents cross-task contamination.
     *
     * Important for data integrity — the cycle must match the task.
     */
    it("throws EntityNotFoundError when cycle belongs to different task", () => {
      const cycle = createMockCycle({ taskId: "task-other" });

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [cycle],
        packets: [],
        jobs: [],
      };

      const { service } = createServiceWithState(state);

      expect(() =>
        service.assembleLeadReviewContext({
          reviewCycleId: "cycle-001",
          taskId: "task-001",
          actor: SYSTEM_ACTOR,
        }),
      ).toThrow(EntityNotFoundError);
    });
  });

  // ── Concurrent modification ─────────────────────────────────────────

  describe("concurrent modification detection", () => {
    /**
     * Validates that a concurrent status change is detected and
     * reported as InvalidTransitionError. Two processes might both
     * try to consolidate the same cycle.
     *
     * Important for preventing double-dispatch of the lead reviewer.
     */
    it("throws InvalidTransitionError on concurrent status change", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [createMockCycle()],
        packets: [createMockSpecialistPacket()],
        jobs: [createMockJob({ status: JobStatus.COMPLETED })],
      };

      // Override updateStatus to simulate concurrent modification
      const unitOfWork: LeadReviewConsolidationUnitOfWork = {
        runInTransaction: <T>(fn: (repos: LeadReviewTransactionRepositories) => T): T => {
          const repos = createMockRepos(state);
          // Replace updateStatus to always return undefined (simulating conflict)
          repos.reviewCycle.updateStatus = () => undefined;
          return fn(repos);
        },
      };

      const eventEmitter = createMockEventEmitter();
      const service = createLeadReviewConsolidationService({
        unitOfWork,
        eventEmitter,
        clock: () => FIXED_DATE,
      });

      expect(() =>
        service.assembleLeadReviewContext({
          reviewCycleId: "cycle-001",
          taskId: "task-001",
          actor: SYSTEM_ACTOR,
        }),
      ).toThrow(InvalidTransitionError);

      // No events should be emitted on failure
      expect(eventEmitter.events).toHaveLength(0);
    });
  });

  // ── Audit event recording ──────────────────────────────────────────

  describe("audit event recording", () => {
    /**
     * Validates that the audit event records the correct transition
     * details including old/new state and metadata.
     *
     * Important for the audit trail required by PRD §2.3 and T073.
     */
    it("records audit event with correct fields", () => {
      const packets = [
        createMockSpecialistPacket({ reviewerType: "security" }),
        createMockSpecialistPacket({ reviewerType: "correctness" }),
      ];
      const jobs = [
        createMockJob({ jobId: "job-sec", status: JobStatus.COMPLETED }),
        createMockJob({ jobId: "job-cor", status: JobStatus.COMPLETED }),
      ];

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [createMockCycle()],
        packets,
        jobs,
      };

      const { service } = createServiceWithState(state);

      const result = service.assembleLeadReviewContext({
        reviewCycleId: "cycle-001",
        taskId: "task-001",
        actor: SYSTEM_ACTOR,
      });

      expect(result.auditEvents).toHaveLength(1);
      const audit = result.auditEvents[0]!;
      expect(audit.entityType).toBe("review-cycle");
      expect(audit.entityId).toBe("cycle-001");
      expect(audit.eventType).toBe("review-cycle.consolidation-started");
      expect(audit.actorType).toBe("system");
      expect(audit.actorId).toBe("scheduler");
      expect(audit.oldState).toBe(ReviewCycleStatus.IN_PROGRESS);
      expect(audit.newState).toBe(ReviewCycleStatus.CONSOLIDATING);

      const metadata = JSON.parse(audit.metadata);
      expect(metadata.taskId).toBe("task-001");
      expect(metadata.specialistPacketCount).toBe(2);
      expect(metadata.priorCycleCount).toBe(0);
      expect(metadata.specialistJobIds).toEqual(["job-sec", "job-cor"]);
    });
  });

  // ── Domain event emission ──────────────────────────────────────────

  describe("domain event emission", () => {
    /**
     * Validates that a review-cycle.transitioned domain event is emitted
     * after the transaction commits successfully.
     *
     * Important because downstream systems (scheduler, notifications)
     * rely on domain events to trigger the lead review dispatch.
     */
    it("emits review-cycle.transitioned event after commit", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [createMockCycle()],
        packets: [createMockSpecialistPacket()],
        jobs: [createMockJob({ status: JobStatus.COMPLETED })],
      };

      const { service, eventEmitter } = createServiceWithState(state);

      service.assembleLeadReviewContext({
        reviewCycleId: "cycle-001",
        taskId: "task-001",
        actor: SYSTEM_ACTOR,
      });

      expect(eventEmitter.events).toHaveLength(1);
      const event = eventEmitter.events[0] as {
        type: string;
        entityType: string;
        entityId: string;
        fromStatus: string;
        toStatus: string;
        actor: ActorInfo;
        timestamp: Date;
      };
      expect(event.type).toBe("review-cycle.transitioned");
      expect(event.entityType).toBe("review-cycle");
      expect(event.entityId).toBe("cycle-001");
      expect(event.fromStatus).toBe(ReviewCycleStatus.IN_PROGRESS);
      expect(event.toStatus).toBe(ReviewCycleStatus.CONSOLIDATING);
      expect(event.actor).toEqual(SYSTEM_ACTOR);
      expect(event.timestamp).toEqual(FIXED_DATE);
    });

    /**
     * Validates that the event uses the correct source status
     * when transitioning from AWAITING_REQUIRED_REVIEWS.
     *
     * Important because the fromStatus must accurately reflect
     * the actual transition for downstream consumers.
     */
    it("emits correct fromStatus for AWAITING_REQUIRED_REVIEWS source", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [
          createMockCycle({
            status: ReviewCycleStatus.AWAITING_REQUIRED_REVIEWS,
          }),
        ],
        packets: [createMockSpecialistPacket()],
        jobs: [createMockJob({ status: JobStatus.COMPLETED })],
      };

      const { service, eventEmitter } = createServiceWithState(state);

      service.assembleLeadReviewContext({
        reviewCycleId: "cycle-001",
        taskId: "task-001",
        actor: SYSTEM_ACTOR,
      });

      const event = eventEmitter.events[0] as { fromStatus: string };
      expect(event.fromStatus).toBe(ReviewCycleStatus.AWAITING_REQUIRED_REVIEWS);
    });

    /**
     * Validates that no domain events are emitted when the transaction
     * fails. Events must only be emitted after successful commit.
     *
     * Important for preventing downstream systems from acting on
     * transitions that were rolled back.
     */
    it("does not emit events on transaction failure", () => {
      const state: MockRepoState = {
        task: undefined, // Will cause EntityNotFoundError
        cycles: [],
        packets: [],
        jobs: [],
      };

      const { service, eventEmitter } = createServiceWithState(state);

      expect(() =>
        service.assembleLeadReviewContext({
          reviewCycleId: "cycle-001",
          taskId: "task-001",
          actor: SYSTEM_ACTOR,
        }),
      ).toThrow();

      expect(eventEmitter.events).toHaveLength(0);
    });
  });

  // ── Atomicity verification ─────────────────────────────────────────

  describe("atomicity verification", () => {
    /**
     * Validates that all operations happen within a single transaction.
     * The unit of work's runInTransaction must be called exactly once.
     *
     * Important for guaranteeing that the cycle transition, audit event,
     * and data reads are all consistent within the same snapshot.
     */
    it("executes all operations within a single transaction", () => {
      const transactionSpy = vi.fn();

      const state: MockRepoState = {
        task: createMockTask(),
        cycles: [createMockCycle()],
        packets: [createMockSpecialistPacket()],
        jobs: [createMockJob({ status: JobStatus.COMPLETED })],
      };

      const unitOfWork: LeadReviewConsolidationUnitOfWork = {
        runInTransaction: <T>(fn: (repos: LeadReviewTransactionRepositories) => T): T => {
          transactionSpy();
          const repos = createMockRepos(state);
          return fn(repos);
        },
      };

      const service = createLeadReviewConsolidationService({
        unitOfWork,
        eventEmitter: createMockEventEmitter(),
        clock: () => FIXED_DATE,
      });

      service.assembleLeadReviewContext({
        reviewCycleId: "cycle-001",
        taskId: "task-001",
        actor: SYSTEM_ACTOR,
      });

      expect(transactionSpy).toHaveBeenCalledTimes(1);
    });
  });
});
