/**
 * Tests for the review decision application service.
 *
 * These tests verify that the lead reviewer's decision is correctly
 * applied to the task and review cycle state. The review decision
 * service is the final step in the review pipeline — it translates
 * the lead reviewer's judgment into deterministic state transitions.
 *
 * Test categories:
 * - Packet validation: schema enforcement for LeadReviewDecisionPacket
 * - Approved decision: ReviewCycle→APPROVED, Task→APPROVED
 * - Approved with follow-up: same + follow-up task creation
 * - Changes requested: ReviewCycle→REJECTED, Task→CHANGES_REQUESTED,
 *   reviewRoundCount increment
 * - Escalated decision: ReviewCycle→ESCALATED, Task→ESCALATED
 * - Escalation from review limit: changes_requested with exceeded
 *   max_review_rounds triggers escalation instead
 * - Cross-reference validation: packet IDs must match params
 * - Error handling: missing entities, wrong states, concurrent mods
 * - Audit and event emission: correct records created and events emitted
 *
 * @module @factory/application/services/review-decision.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TaskStatus, ReviewCycleStatus, DEFAULT_ESCALATION_POLICY } from "@factory/domain";

import { createReviewDecisionService } from "./review-decision.service.js";
import type {
  ApplyReviewDecisionParams,
  ReviewDecisionDependencies,
  ReviewDecisionService,
} from "./review-decision.service.js";
import { SchemaValidationError } from "./review-decision.service.js";
import type {
  ReviewDecisionTask,
  ReviewDecisionCycle,
  ReviewDecisionTransactionRepositories,
  ReviewDecisionUnitOfWork,
} from "../ports/review-decision.ports.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type { ActorInfo } from "../events/domain-events.js";
import { EntityNotFoundError, InvalidTransitionError } from "../errors.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const FIXED_DATE = new Date("2025-06-15T10:00:00.000Z");
const SYSTEM_ACTOR: ActorInfo = { type: "system", id: "review-module" };

let auditIdCounter = 0;
let idCounter = 0;

function createMockTask(overrides: Partial<ReviewDecisionTask> = {}): ReviewDecisionTask {
  return {
    id: "task-001",
    projectId: "project-001",
    status: TaskStatus.IN_REVIEW,
    version: 1,
    reviewRoundCount: 0,
    currentReviewCycleId: "cycle-001",
    ...overrides,
  };
}

function createMockCycle(overrides: Partial<ReviewDecisionCycle> = {}): ReviewDecisionCycle {
  return {
    reviewCycleId: "cycle-001",
    taskId: "task-001",
    status: ReviewCycleStatus.CONSOLIDATING,
    ...overrides,
  };
}

/**
 * Creates a valid LeadReviewDecisionPacket for testing.
 *
 * The default packet represents an "approved" decision with no blocking issues.
 */
function createValidPacket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    packet_type: "lead_review_decision_packet",
    schema_version: "1.0",
    created_at: "2025-06-15T10:00:00.000Z",
    task_id: "task-001",
    repository_id: "repo-001",
    review_cycle_id: "cycle-001",
    decision: "approved",
    summary: "All issues resolved, code is ready for merge.",
    blocking_issues: [],
    non_blocking_suggestions: ["Consider adding more comments"],
    deduplication_notes: [],
    follow_up_task_refs: [],
    risks: [],
    open_questions: [],
    ...overrides,
  };
}

interface MockRepoState {
  task: ReviewDecisionTask | undefined;
  cycle: ReviewDecisionCycle | undefined;
}

function createMockRepos(state: MockRepoState): ReviewDecisionTransactionRepositories {
  // Track the version-incrementing task
  let currentTask = state.task ? { ...state.task } : undefined;

  return {
    task: {
      findById: (id: string) => (currentTask?.id === id ? currentTask : undefined),
      updateStatus: (id: string, expectedVersion: number, newStatus: TaskStatus) => {
        if (!currentTask || currentTask.id !== id) return undefined;
        if (currentTask.version !== expectedVersion) return undefined;
        currentTask = { ...currentTask, status: newStatus, version: currentTask.version + 1 };
        return currentTask;
      },
      incrementReviewRoundCount: (id: string, expectedVersion: number) => {
        if (!currentTask || currentTask.id !== id) return undefined;
        if (currentTask.version !== expectedVersion) return undefined;
        currentTask = {
          ...currentTask,
          reviewRoundCount: currentTask.reviewRoundCount + 1,
          version: currentTask.version + 1,
        };
        return currentTask;
      },
    },
    reviewCycle: {
      findById: (id: string) => (state.cycle?.reviewCycleId === id ? state.cycle : undefined),
      updateStatus: (
        reviewCycleId: string,
        expectedStatus: ReviewCycleStatus,
        newStatus: ReviewCycleStatus,
      ) => {
        if (!state.cycle || state.cycle.reviewCycleId !== reviewCycleId) return undefined;
        if (state.cycle.status !== expectedStatus) return undefined;
        const updated = { ...state.cycle, status: newStatus };
        state.cycle = updated;
        return updated;
      },
    },
    leadReviewDecision: {
      create: (data) => ({
        ...data,
        createdAt: FIXED_DATE,
      }),
    },
    followUpTask: {
      create: (data) => ({
        id: data.id,
        projectId: data.projectId,
        title: data.title,
        parentTaskId: data.parentTaskId,
        status: TaskStatus.BACKLOG,
      }),
    },
    auditEvent: {
      create: (event) => ({
        auditEventId: `audit-${++auditIdCounter}`,
        ...event,
        createdAt: FIXED_DATE,
      }),
    },
  };
}

function createMockUnitOfWork(state: MockRepoState): ReviewDecisionUnitOfWork {
  return {
    runInTransaction: <T>(fn: (repos: ReviewDecisionTransactionRepositories) => T): T => {
      const repos = createMockRepos(state);
      return fn(repos);
    },
  };
}

function createMockEventEmitter(): DomainEventEmitter & { emittedEvents: unknown[] } {
  const emittedEvents: unknown[] = [];
  return {
    emit: (event: unknown) => {
      emittedEvents.push(event);
    },
    emittedEvents,
  };
}

function createService(
  state: MockRepoState,
  overrides: Partial<ReviewDecisionDependencies> = {},
): {
  service: ReviewDecisionService;
  eventEmitter: ReturnType<typeof createMockEventEmitter>;
} {
  const eventEmitter = createMockEventEmitter();
  const unitOfWork = createMockUnitOfWork(state);

  const service = createReviewDecisionService({
    unitOfWork,
    eventEmitter,
    idGenerator: () => `gen-${++idCounter}`,
    clock: () => FIXED_DATE,
    ...overrides,
  });

  return { service, eventEmitter };
}

function createDefaultParams(
  overrides: Partial<ApplyReviewDecisionParams> = {},
): ApplyReviewDecisionParams {
  return {
    packet: createValidPacket(),
    taskId: "task-001",
    reviewCycleId: "cycle-001",
    escalationPolicy: DEFAULT_ESCALATION_POLICY,
    maxReviewRounds: 3,
    actor: SYSTEM_ACTOR,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReviewDecisionService", () => {
  beforeEach(() => {
    auditIdCounter = 0;
    idCounter = 0;
  });

  // ─── Packet Validation ────────────────────────────────────────────────────

  describe("packet validation", () => {
    /**
     * Verifies that invalid packets are rejected before any database
     * operations occur. This is the first line of defense — the Zod
     * schema enforces structural correctness and cross-field invariants.
     */
    it("should reject packets that fail Zod schema validation", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      expect(() =>
        service.applyDecision(createDefaultParams({ packet: { invalid: true } })),
      ).toThrow(SchemaValidationError);
    });

    /**
     * Verifies the cross-field invariant: changes_requested requires
     * at least one blocking issue. Without blocking issues, the developer
     * has no actionable feedback for rework.
     */
    it("should reject changes_requested with no blocking issues", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const packet = createValidPacket({
        decision: "changes_requested",
        blocking_issues: [],
      });

      expect(() => service.applyDecision(createDefaultParams({ packet }))).toThrow(
        SchemaValidationError,
      );
    });

    /**
     * Verifies the cross-field invariant: approved_with_follow_up requires
     * non-empty follow_up_task_refs. Without them, it's semantically
     * identical to a plain approval.
     */
    it("should reject approved_with_follow_up with no follow_up_task_refs", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const packet = createValidPacket({
        decision: "approved_with_follow_up",
        follow_up_task_refs: [],
      });

      expect(() => service.applyDecision(createDefaultParams({ packet }))).toThrow(
        SchemaValidationError,
      );
    });
  });

  // ─── Approved Decision ────────────────────────────────────────────────────

  describe("approved decision", () => {
    /**
     * Verifies the happy-path approval flow: the task moves to APPROVED
     * and the review cycle moves to APPROVED. This is the primary success
     * path — the task is ready for the merge queue.
     */
    it("should transition task to APPROVED and cycle to APPROVED", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const result = service.applyDecision(createDefaultParams());

      expect(result.outcome).toBe("approved");
      expect(result.task.status).toBe(TaskStatus.APPROVED);
      expect(result.reviewCycle.status).toBe(ReviewCycleStatus.APPROVED);
    });

    /**
     * Verifies that the decision record is persisted with correct fields.
     * This record provides the audit trail for the review decision.
     */
    it("should persist a LeadReviewDecision record", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const result = service.applyDecision(createDefaultParams());

      expect(result.decisionRecord.decision).toBe("approved");
      expect(result.decisionRecord.taskId).toBe("task-001");
      expect(result.decisionRecord.reviewCycleId).toBe("cycle-001");
      expect(result.decisionRecord.blockingIssueCount).toBe(0);
    });

    /**
     * Verifies that domain events are emitted for both the review cycle
     * and task transitions. Downstream consumers (scheduler, notifications)
     * depend on these events.
     */
    it("should emit domain events for both cycle and task transitions", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };
      const { service, eventEmitter } = createService(state);

      service.applyDecision(createDefaultParams());

      expect(eventEmitter.emittedEvents).toHaveLength(2);
      const [cycleEvent, taskEvent] = eventEmitter.emittedEvents as [
        { type: string; fromStatus: string; toStatus: string },
        { type: string; fromStatus: string; toStatus: string },
      ];
      expect(cycleEvent.type).toBe("review-cycle.transitioned");
      expect(cycleEvent.toStatus).toBe(ReviewCycleStatus.APPROVED);
      expect(taskEvent.type).toBe("task.transitioned");
      expect(taskEvent.toStatus).toBe(TaskStatus.APPROVED);
    });

    /**
     * Verifies that audit events are recorded for both transitions.
     * Audit events are the primary mechanism for traceability.
     */
    it("should create audit events for both transitions", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const result = service.applyDecision(createDefaultParams());

      expect(result.auditEvents).toHaveLength(2);
      expect(result.auditEvents[0]!.entityType).toBe("review-cycle");
      expect(result.auditEvents[0]!.eventType).toBe("review-cycle.decision-applied.approved");
      expect(result.auditEvents[1]!.entityType).toBe("task");
      expect(result.auditEvents[1]!.eventType).toBe("task.review-decision.approved");
    });

    /**
     * Verifies that no follow-up tasks are created for plain approvals.
     * Follow-up tasks only apply to approved_with_follow_up.
     */
    it("should not create follow-up tasks for plain approved", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const result = service.applyDecision(createDefaultParams());

      expect(result.followUpTasks).toHaveLength(0);
    });
  });

  // ─── Approved with Follow-up ──────────────────────────────────────────────

  describe("approved_with_follow_up decision", () => {
    /**
     * Verifies that approved_with_follow_up still transitions the task
     * to APPROVED (same as plain approval) — the task proceeds to merge.
     */
    it("should transition task to APPROVED and cycle to APPROVED", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const packet = createValidPacket({
        decision: "approved_with_follow_up",
        follow_up_task_refs: ["Fix typo in README", "Add unit test for edge case"],
      });

      const result = service.applyDecision(createDefaultParams({ packet }));

      expect(result.outcome).toBe("approved_with_follow_up");
      expect(result.task.status).toBe(TaskStatus.APPROVED);
      expect(result.reviewCycle.status).toBe(ReviewCycleStatus.APPROVED);
    });

    /**
     * Verifies that skeleton follow-up tasks are created from the
     * follow_up_task_refs array. These are new tasks that track the
     * non-blocking improvements identified by the lead reviewer.
     */
    it("should create follow-up tasks from follow_up_task_refs", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const packet = createValidPacket({
        decision: "approved_with_follow_up",
        follow_up_task_refs: ["Fix typo in README", "Add unit test for edge case"],
      });

      const result = service.applyDecision(createDefaultParams({ packet }));

      expect(result.followUpTasks).toHaveLength(2);
      expect(result.followUpTasks[0]!.title).toBe("Fix typo in README");
      expect(result.followUpTasks[0]!.parentTaskId).toBe("task-001");
      expect(result.followUpTasks[0]!.projectId).toBe("project-001");
      expect(result.followUpTasks[0]!.status).toBe(TaskStatus.BACKLOG);
      expect(result.followUpTasks[1]!.title).toBe("Add unit test for edge case");
    });
  });

  // ─── Changes Requested ────────────────────────────────────────────────────

  describe("changes_requested decision", () => {
    function createChangesRequestedPacket(overrides: Record<string, unknown> = {}) {
      return createValidPacket({
        decision: "changes_requested",
        blocking_issues: [
          {
            severity: "high",
            code: "NULL_CHECK",
            title: "Missing null check",
            description: "Null check missing in handler",
            file_path: "src/main.ts",
            line: 10,
            blocking: true,
          },
        ],
        ...overrides,
      });
    }

    /**
     * Verifies the rejection flow: review cycle moves to REJECTED and
     * task moves to CHANGES_REQUESTED. This triggers the rework loop
     * (T062) — the task will be rescheduled for a new development attempt.
     */
    it("should transition task to CHANGES_REQUESTED and cycle to REJECTED", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const result = service.applyDecision(
        createDefaultParams({ packet: createChangesRequestedPacket() }),
      );

      expect(result.outcome).toBe("changes_requested");
      expect(result.task.status).toBe(TaskStatus.CHANGES_REQUESTED);
      expect(result.reviewCycle.status).toBe(ReviewCycleStatus.REJECTED);
    });

    /**
     * Verifies that reviewRoundCount is incremented on rejection.
     * This counter tracks how many review cycles the task has been through,
     * and is compared against max_review_rounds to trigger escalation.
     */
    it("should increment the task reviewRoundCount", () => {
      const state: MockRepoState = {
        task: createMockTask({ reviewRoundCount: 1 }),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const result = service.applyDecision(
        createDefaultParams({ packet: createChangesRequestedPacket() }),
      );

      expect(result.task.reviewRoundCount).toBe(2);
    });

    /**
     * Verifies that the task version is incremented for both the
     * reviewRoundCount update and the status transition. This is essential
     * for optimistic concurrency — two separate writes must each bump the version.
     */
    it("should increment task version twice (once for count, once for status)", () => {
      const state: MockRepoState = {
        task: createMockTask({ version: 1 }),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const result = service.applyDecision(
        createDefaultParams({ packet: createChangesRequestedPacket() }),
      );

      // version 1 → 2 (increment reviewRoundCount) → 3 (status change)
      expect(result.task.version).toBe(3);
    });

    /**
     * Verifies that no follow-up tasks are created for changes_requested.
     * Follow-up tasks only apply to approved_with_follow_up.
     */
    it("should not create follow-up tasks", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const result = service.applyDecision(
        createDefaultParams({ packet: createChangesRequestedPacket() }),
      );

      expect(result.followUpTasks).toHaveLength(0);
    });
  });

  // ─── Escalated Decision ───────────────────────────────────────────────────

  describe("escalated decision", () => {
    /**
     * Verifies the escalation flow: both the review cycle and task move
     * to ESCALATED. This requires human operator intervention to resolve.
     */
    it("should transition task to ESCALATED and cycle to ESCALATED", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const packet = createValidPacket({ decision: "escalated" });

      const result = service.applyDecision(createDefaultParams({ packet }));

      expect(result.outcome).toBe("escalated");
      expect(result.task.status).toBe(TaskStatus.ESCALATED);
      expect(result.reviewCycle.status).toBe(ReviewCycleStatus.ESCALATED);
    });

    /**
     * Verifies that reviewRoundCount is NOT incremented for escalated decisions.
     * The count only increments on changes_requested (rejection rework flow).
     */
    it("should not increment reviewRoundCount", () => {
      const state: MockRepoState = {
        task: createMockTask({ reviewRoundCount: 1 }),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const packet = createValidPacket({ decision: "escalated" });

      const result = service.applyDecision(createDefaultParams({ packet }));

      // reviewRoundCount stays at 1 — no increment for escalated
      expect(result.task.reviewRoundCount).toBe(1);
    });
  });

  // ─── Escalation from Review Round Limit ───────────────────────────────────

  describe("escalation from review round limit exceeded", () => {
    function createChangesRequestedPacket() {
      return createValidPacket({
        decision: "changes_requested",
        blocking_issues: [
          {
            severity: "high",
            code: "LOGIC_ERROR",
            title: "Logic error in handler",
            description: "Logic error in handler needs fixing",
            file_path: "src/main.ts",
            line: 10,
            blocking: true,
          },
        ],
      });
    }

    /**
     * Verifies the most critical escalation path: when a lead reviewer
     * requests changes but the review round limit has been reached,
     * the orchestrator must escalate instead of allowing another rework.
     *
     * This prevents endless rejection loops — after max_review_rounds,
     * the task is sent to a human operator instead of cycling indefinitely.
     *
     * The escalation check uses (reviewRoundCount + 1) because the count
     * represents the *next* round that would start after rejection.
     */
    it("should escalate when next review round would exceed max_review_rounds", () => {
      const state: MockRepoState = {
        // reviewRoundCount=2, maxReviewRounds=3 → next round (3) >= limit
        task: createMockTask({ reviewRoundCount: 2 }),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const result = service.applyDecision(
        createDefaultParams({
          packet: createChangesRequestedPacket(),
          maxReviewRounds: 3,
        }),
      );

      expect(result.outcome).toBe("escalated_from_review_limit");
      expect(result.task.status).toBe(TaskStatus.ESCALATED);
      expect(result.reviewCycle.status).toBe(ReviewCycleStatus.ESCALATED);
    });

    /**
     * Verifies that changes_requested with room for more rounds does
     * NOT trigger escalation — only when the limit is reached.
     */
    it("should not escalate when under the review round limit", () => {
      const state: MockRepoState = {
        // reviewRoundCount=0, maxReviewRounds=3 → next round (1) < limit
        task: createMockTask({ reviewRoundCount: 0 }),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const result = service.applyDecision(
        createDefaultParams({
          packet: createChangesRequestedPacket(),
          maxReviewRounds: 3,
        }),
      );

      expect(result.outcome).toBe("changes_requested");
      expect(result.task.status).toBe(TaskStatus.CHANGES_REQUESTED);
      expect(result.reviewCycle.status).toBe(ReviewCycleStatus.REJECTED);
    });

    /**
     * Verifies that reviewRoundCount is NOT incremented when the decision
     * is escalated due to review round limit. The count stays as-is because
     * the task is moving to ESCALATED, not CHANGES_REQUESTED.
     */
    it("should not increment reviewRoundCount when escalated", () => {
      const state: MockRepoState = {
        task: createMockTask({ reviewRoundCount: 2 }),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const result = service.applyDecision(
        createDefaultParams({
          packet: createChangesRequestedPacket(),
          maxReviewRounds: 3,
        }),
      );

      // reviewRoundCount stays at 2 — no increment when escalated
      expect(result.task.reviewRoundCount).toBe(2);
    });

    /**
     * Verifies boundary case: when reviewRoundCount equals max_review_rounds,
     * escalation fires (the domain policy uses >= comparison).
     */
    it("should escalate at exact boundary (reviewRoundCount + 1 == maxReviewRounds)", () => {
      const state: MockRepoState = {
        task: createMockTask({ reviewRoundCount: 2 }),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const result = service.applyDecision(
        createDefaultParams({
          packet: createChangesRequestedPacket(),
          maxReviewRounds: 3,
        }),
      );

      expect(result.outcome).toBe("escalated_from_review_limit");
    });
  });

  // ─── Cross-Reference Validation ───────────────────────────────────────────

  describe("cross-reference validation", () => {
    /**
     * Verifies that the packet's task_id must match the params taskId.
     * This prevents accidentally applying a decision to the wrong task.
     */
    it("should reject when packet task_id does not match params", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const packet = createValidPacket({ task_id: "task-999" });

      expect(() => service.applyDecision(createDefaultParams({ packet }))).toThrow(
        InvalidTransitionError,
      );
    });

    /**
     * Verifies that the packet's review_cycle_id must match the params.
     */
    it("should reject when packet review_cycle_id does not match params", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const packet = createValidPacket({ review_cycle_id: "cycle-999" });

      expect(() => service.applyDecision(createDefaultParams({ packet }))).toThrow(
        InvalidTransitionError,
      );
    });

    /**
     * Verifies that the review cycle must be the task's current active cycle.
     * This prevents applying a decision to a stale/old cycle.
     */
    it("should reject when review cycle is not the current active cycle", () => {
      const state: MockRepoState = {
        task: createMockTask({ currentReviewCycleId: "cycle-old" }),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      expect(() => service.applyDecision(createDefaultParams())).toThrow(InvalidTransitionError);
    });

    /**
     * Verifies that the review cycle must belong to the specified task.
     */
    it("should reject when review cycle belongs to a different task", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle({ taskId: "task-999" }),
      };
      const { service } = createService(state);

      expect(() => service.applyDecision(createDefaultParams())).toThrow(EntityNotFoundError);
    });
  });

  // ─── Entity State Validation ──────────────────────────────────────────────

  describe("entity state validation", () => {
    /**
     * Verifies that the task must be in IN_REVIEW state. A task in any
     * other state cannot receive a review decision.
     */
    it("should reject when task is not IN_REVIEW", () => {
      const state: MockRepoState = {
        task: createMockTask({ status: TaskStatus.IN_DEVELOPMENT }),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      expect(() => service.applyDecision(createDefaultParams())).toThrow(InvalidTransitionError);
    });

    /**
     * Verifies that the review cycle must be in CONSOLIDATING state.
     * Only after lead reviewer context assembly can a decision be applied.
     */
    it("should reject when review cycle is not CONSOLIDATING", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle({ status: ReviewCycleStatus.IN_PROGRESS }),
      };
      const { service } = createService(state);

      expect(() => service.applyDecision(createDefaultParams())).toThrow(InvalidTransitionError);
    });

    /**
     * Verifies that a missing task throws EntityNotFoundError.
     */
    it("should throw EntityNotFoundError for missing task", () => {
      const state: MockRepoState = {
        task: undefined,
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      expect(() => service.applyDecision(createDefaultParams())).toThrow(EntityNotFoundError);
    });

    /**
     * Verifies that a missing review cycle throws EntityNotFoundError.
     */
    it("should throw EntityNotFoundError for missing review cycle", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: undefined,
      };
      const { service } = createService(state);

      expect(() => service.applyDecision(createDefaultParams())).toThrow(EntityNotFoundError);
    });
  });

  // ─── Concurrent Modification Detection ────────────────────────────────────

  describe("concurrent modification detection", () => {
    /**
     * Verifies that review cycle updates that fail the status guard
     * (concurrent modification) are detected and reported.
     */
    it("should throw on review cycle concurrent modification", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };

      // Override cycle updateStatus to always fail (simulate concurrent mod)
      const eventEmitter = createMockEventEmitter();
      const unitOfWork: ReviewDecisionUnitOfWork = {
        runInTransaction: <T>(fn: (repos: ReviewDecisionTransactionRepositories) => T): T => {
          const repos = createMockRepos(state);
          // Override updateStatus to simulate failure
          repos.reviewCycle.updateStatus = () => undefined;
          return fn(repos);
        },
      };

      const service = createReviewDecisionService({
        unitOfWork,
        eventEmitter,
        idGenerator: () => `gen-${++idCounter}`,
        clock: () => FIXED_DATE,
      });

      expect(() => service.applyDecision(createDefaultParams())).toThrow(InvalidTransitionError);
    });

    /**
     * Verifies that task status updates that fail the version guard
     * (concurrent modification) are detected and reported.
     */
    it("should throw on task concurrent modification", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };

      const eventEmitter = createMockEventEmitter();
      const unitOfWork: ReviewDecisionUnitOfWork = {
        runInTransaction: <T>(fn: (repos: ReviewDecisionTransactionRepositories) => T): T => {
          const repos = createMockRepos(state);
          // Override task updateStatus to simulate failure
          repos.task.updateStatus = () => undefined;
          return fn(repos);
        },
      };

      const service = createReviewDecisionService({
        unitOfWork,
        eventEmitter,
        idGenerator: () => `gen-${++idCounter}`,
        clock: () => FIXED_DATE,
      });

      expect(() => service.applyDecision(createDefaultParams())).toThrow(InvalidTransitionError);
    });
  });

  // ─── Domain Event Details ─────────────────────────────────────────────────

  describe("domain event details", () => {
    /**
     * Verifies that the review cycle domain event has correct from/to
     * statuses for a changes_requested (non-escalated) decision.
     */
    it("should emit correct statuses for changes_requested", () => {
      const state: MockRepoState = {
        task: createMockTask(),
        cycle: createMockCycle(),
      };
      const { service, eventEmitter } = createService(state);

      const packet = createValidPacket({
        decision: "changes_requested",
        blocking_issues: [
          {
            severity: "high",
            code: "BUG_FOUND",
            title: "Bug found in handler",
            description: "Bug found",
            file_path: "src/main.ts",
            line: 1,
            blocking: true,
          },
        ],
      });

      service.applyDecision(createDefaultParams({ packet }));

      const [cycleEvent, taskEvent] = eventEmitter.emittedEvents as [
        { type: string; fromStatus: string; toStatus: string },
        { type: string; fromStatus: string; toStatus: string },
      ];
      expect(cycleEvent.fromStatus).toBe(ReviewCycleStatus.CONSOLIDATING);
      expect(cycleEvent.toStatus).toBe(ReviewCycleStatus.REJECTED);
      expect(taskEvent.fromStatus).toBe(TaskStatus.IN_REVIEW);
      expect(taskEvent.toStatus).toBe(TaskStatus.CHANGES_REQUESTED);
    });

    /**
     * Verifies that the task domain event includes the new version number.
     * This is important for downstream consumers that track task versions.
     */
    it("should include newVersion in task transition event", () => {
      const state: MockRepoState = {
        task: createMockTask({ version: 5 }),
        cycle: createMockCycle(),
      };
      const { service, eventEmitter } = createService(state);

      service.applyDecision(createDefaultParams());

      const taskEvent = eventEmitter.emittedEvents[1] as {
        type: string;
        newVersion: number;
      };
      expect(taskEvent.newVersion).toBe(6);
    });
  });

  // ─── Audit Event Metadata ─────────────────────────────────────────────────

  describe("audit event metadata", () => {
    /**
     * Verifies that the review cycle audit event includes escalation
     * policy information when a changes_requested decision is escalated.
     */
    it("should record policyEscalation=true in audit when escalated from limit", () => {
      const state: MockRepoState = {
        task: createMockTask({ reviewRoundCount: 2 }),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const packet = createValidPacket({
        decision: "changes_requested",
        blocking_issues: [
          {
            severity: "high",
            code: "ISSUE",
            title: "Blocking issue",
            description: "Issue needs fixing",
            file_path: "src/main.ts",
            line: 1,
            blocking: true,
          },
        ],
      });

      const result = service.applyDecision(createDefaultParams({ packet, maxReviewRounds: 3 }));

      const cycleAuditMeta = JSON.parse(result.auditEvents[0]!.metadata);
      expect(cycleAuditMeta.policyEscalation).toBe(true);
    });

    /**
     * Verifies that the task audit event records the correct outcome
     * and the updated reviewRoundCount.
     */
    it("should record correct outcome in task audit for changes_requested", () => {
      const state: MockRepoState = {
        task: createMockTask({ reviewRoundCount: 0 }),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const packet = createValidPacket({
        decision: "changes_requested",
        blocking_issues: [
          {
            severity: "medium",
            code: "CODE_SMELL",
            title: "Code smell detected",
            description: "Code smell needs refactoring",
            file_path: "src/utils.ts",
            line: 1,
            blocking: true,
          },
        ],
      });

      const result = service.applyDecision(createDefaultParams({ packet }));

      const taskAuditMeta = JSON.parse(result.auditEvents[1]!.metadata);
      expect(taskAuditMeta.outcome).toBe("changes_requested");
      expect(taskAuditMeta.reviewRoundCount).toBe(1);
    });
  });

  // ─── Current Review Cycle ID null handling ────────────────────────────────

  describe("currentReviewCycleId null handling", () => {
    /**
     * Verifies that when currentReviewCycleId is null (e.g. legacy tasks
     * or edge cases), the cycle validation is skipped and the decision
     * can still be applied. The cycle is still verified via the reviewCycleId
     * param and the cycle.taskId cross-reference.
     */
    it("should allow decision when currentReviewCycleId is null", () => {
      const state: MockRepoState = {
        task: createMockTask({ currentReviewCycleId: null }),
        cycle: createMockCycle(),
      };
      const { service } = createService(state);

      const result = service.applyDecision(createDefaultParams());

      expect(result.outcome).toBe("approved");
      expect(result.task.status).toBe(TaskStatus.APPROVED);
    });
  });
});
