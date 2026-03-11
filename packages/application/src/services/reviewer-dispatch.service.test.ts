/**
 * Tests for the specialist reviewer dispatch service.
 *
 * These tests validate the complete reviewer dispatch workflow:
 * routing → cycle creation → job fan-out → task transition.
 *
 * Each test documents WHY it exists — future loops will not have the
 * reasoning context that led to these test cases.
 *
 * @module @factory/application/services/reviewer-dispatch.service.test
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TaskStatus, ReviewCycleStatus, JobType, JobStatus, RiskLevel } from "@factory/domain";

import { EntityNotFoundError, InvalidTransitionError } from "../errors.js";
import { createReviewerDispatchService } from "./reviewer-dispatch.service.js";
import type {
  DispatchReviewersParams,
  ReviewerDispatchDependencies,
} from "./reviewer-dispatch.service.js";
import type {
  ReviewDispatchTask,
  ReviewDispatchCycle,
  ReviewDispatchJob,
  ReviewDispatchAuditEvent,
  ReviewDispatchTransactionRepositories,
  ReviewerDispatchUnitOfWork,
} from "../ports/reviewer-dispatch.ports.js";
import type { ReviewRouterService, RoutingDecision } from "./review-router.service.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type { ActorInfo } from "../events/domain-events.js";

// ---------------------------------------------------------------------------
// Test helpers — fake implementations
// ---------------------------------------------------------------------------

const TEST_ACTOR: ActorInfo = { type: "system", id: "review-module" };
const FIXED_TIME = new Date("2025-01-15T12:00:00.000Z");

let idCounter = 0;
function testIdGenerator(): string {
  idCounter++;
  return `test-id-${String(idCounter).padStart(3, "0")}`;
}

function testClock(): Date {
  return FIXED_TIME;
}

/**
 * Creates a fake task record in DEV_COMPLETE state.
 */
function createFakeTask(overrides: Partial<ReviewDispatchTask> = {}): ReviewDispatchTask {
  return {
    id: "task-001",
    status: TaskStatus.DEV_COMPLETE,
    version: 3,
    currentReviewCycleId: null,
    ...overrides,
  };
}

/**
 * Creates a minimal routing decision.
 */
function createRoutingDecision(
  required: string[] = ["general"],
  optional: string[] = [],
): RoutingDecision {
  return {
    requiredReviewers: required,
    optionalReviewers: optional,
    routingRationale: required.map((r) => ({
      reviewerType: r,
      requirement: "required" as const,
      reason: `Required by test`,
    })),
  };
}

/**
 * Creates default dispatch params.
 */
function createDefaultParams(
  overrides: Partial<DispatchReviewersParams> = {},
): DispatchReviewersParams {
  return {
    taskId: "task-001",
    changedFilePaths: ["src/auth/login.ts"],
    taskTags: ["auth"],
    riskLevel: RiskLevel.MEDIUM,
    repositoryRequiredReviewers: [],
    routingConfig: { rules: [] },
    actor: TEST_ACTOR,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fake repository implementations
// ---------------------------------------------------------------------------

interface FakeState {
  tasks: Map<string, ReviewDispatchTask>;
  cycles: Map<string, ReviewDispatchCycle>;
  jobs: Map<string, ReviewDispatchJob>;
  auditEvents: ReviewDispatchAuditEvent[];
}

function createFakeRepos(state: FakeState): ReviewDispatchTransactionRepositories {
  let auditIdCounter = 0;

  return {
    task: {
      findById(id: string) {
        return state.tasks.get(id);
      },
      updateForReviewDispatch(id, expectedVersion, newStatus, currentReviewCycleId) {
        const task = state.tasks.get(id);
        if (!task) throw new EntityNotFoundError("Task", id);
        if (task.version !== expectedVersion) {
          throw new Error(`Version conflict for Task ${id}`);
        }
        const updated: ReviewDispatchTask = {
          ...task,
          status: newStatus,
          version: task.version + 1,
          currentReviewCycleId,
        };
        state.tasks.set(id, updated);
        return updated;
      },
    },
    reviewCycle: {
      create(data) {
        const cycle: ReviewDispatchCycle = {
          reviewCycleId: data.reviewCycleId,
          taskId: data.taskId,
          status: data.status,
          requiredReviewers: [...data.requiredReviewers],
          optionalReviewers: [...data.optionalReviewers],
          startedAt: FIXED_TIME,
          completedAt: null,
        };
        state.cycles.set(data.reviewCycleId, cycle);
        return cycle;
      },
      updateStatus(id, expectedStatus, newStatus) {
        const cycle = state.cycles.get(id);
        if (!cycle || cycle.status !== expectedStatus) return undefined;
        const updated: ReviewDispatchCycle = { ...cycle, status: newStatus };
        state.cycles.set(id, updated);
        return updated;
      },
    },
    job: {
      create(data) {
        const job: ReviewDispatchJob = {
          jobId: data.jobId,
          jobType: data.jobType,
          entityType: data.entityType,
          entityId: data.entityId,
          payloadJson: data.payloadJson,
          status: data.status,
          jobGroupId: data.jobGroupId,
          dependsOnJobIds: data.dependsOnJobIds,
          createdAt: FIXED_TIME,
          updatedAt: FIXED_TIME,
        };
        state.jobs.set(data.jobId, job);
        return job;
      },
    },
    auditEvent: {
      create(event) {
        auditIdCounter++;
        const record: ReviewDispatchAuditEvent = {
          id: `audit-${String(auditIdCounter).padStart(3, "0")}`,
          ...event,
          createdAt: FIXED_TIME,
        };
        state.auditEvents.push(record);
        return record;
      },
    },
  };
}

function createFakeUnitOfWork(state: FakeState): ReviewerDispatchUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: ReviewDispatchTransactionRepositories) => T): T {
      return fn(createFakeRepos(state));
    },
  };
}

function createFakeReviewRouter(decision: RoutingDecision): ReviewRouterService {
  return {
    routeReview: vi.fn().mockReturnValue(decision),
  };
}

function createFakeEventEmitter(): DomainEventEmitter & { emitted: unknown[] } {
  const emitted: unknown[] = [];
  return {
    emitted,
    emit(event) {
      emitted.push(event);
    },
  };
}

function createService(
  state: FakeState,
  routingDecision: RoutingDecision = createRoutingDecision(),
  overrides: Partial<ReviewerDispatchDependencies> = {},
): {
  service: ReturnType<typeof createReviewerDispatchService>;
  eventEmitter: ReturnType<typeof createFakeEventEmitter>;
  reviewRouter: ReviewRouterService;
} {
  const eventEmitter = createFakeEventEmitter();
  const reviewRouter = createFakeReviewRouter(routingDecision);

  const service = createReviewerDispatchService({
    unitOfWork: createFakeUnitOfWork(state),
    reviewRouter,
    eventEmitter,
    idGenerator: testIdGenerator,
    clock: testClock,
    ...overrides,
  });

  return { service, eventEmitter, reviewRouter };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reviewer-dispatch service", () => {
  let state: FakeState;

  beforeEach(() => {
    idCounter = 0;
    state = {
      tasks: new Map(),
      cycles: new Map(),
      jobs: new Map(),
      auditEvents: [],
    };
    state.tasks.set("task-001", createFakeTask());
  });

  // ─── Happy Path ─────────────────────────────────────────────────────────

  describe("happy path — single required reviewer", () => {
    /**
     * Validates the core workflow: a task in DEV_COMPLETE gets one required
     * reviewer ("general"), which creates a ReviewCycle, one specialist job,
     * one lead review job, and transitions the task to IN_REVIEW.
     *
     * This is the minimum viable review dispatch and ensures all entities
     * are created correctly with proper IDs, statuses, and relationships.
     */
    it("should create review cycle, specialist job, and lead review job", () => {
      const { service } = createService(state);
      const result = service.dispatchReviewers(createDefaultParams());

      // ReviewCycle created and routed
      expect(result.reviewCycle.reviewCycleId).toBe("test-id-001");
      expect(result.reviewCycle.taskId).toBe("task-001");
      expect(result.reviewCycle.status).toBe(ReviewCycleStatus.ROUTED);
      expect(result.reviewCycle.requiredReviewers).toEqual(["general"]);
      expect(result.reviewCycle.optionalReviewers).toEqual([]);

      // One specialist job created
      expect(result.specialistJobIds).toHaveLength(1);
      expect(result.specialistJobIds[0]).toBe("test-id-003");

      // Lead review job created with dependency on specialist
      expect(result.leadReviewJobId).toBe("test-id-002");

      // Task transitioned to IN_REVIEW
      expect(result.task.status).toBe(TaskStatus.IN_REVIEW);
      expect(result.task.currentReviewCycleId).toBe("test-id-001");
      expect(result.task.version).toBe(4); // incremented from 3
    });
  });

  describe("happy path — multiple specialist reviewers", () => {
    /**
     * Validates fan-out to multiple specialist reviewers. The review routing
     * may assign multiple required reviewers (e.g., security, architecture)
     * and optional reviewers. Each gets their own job, all sharing the same
     * jobGroupId so the lead review consolidation can wait for all of them.
     *
     * This test ensures the coordinator pattern (jobGroupId + dependsOnJobIds)
     * is correctly implemented per PRD §2.3 Job coordination rules.
     */
    it("should create one job per specialist with shared group ID", () => {
      const decision = createRoutingDecision(
        ["general", "security", "architecture"],
        ["performance"],
      );
      const { service } = createService(state, decision);
      const result = service.dispatchReviewers(createDefaultParams());

      // 4 specialist jobs (3 required + 1 optional)
      expect(result.specialistJobIds).toHaveLength(4);

      // All jobs in the state should share the same jobGroupId
      const jobs = [...state.jobs.values()];
      const specialistJobs = jobs.filter((j) => j.jobType === JobType.REVIEWER_DISPATCH);
      expect(specialistJobs).toHaveLength(4);

      for (const job of specialistJobs) {
        expect(job.jobGroupId).toBe(result.reviewCycle.reviewCycleId);
        expect(job.entityType).toBe("review-cycle");
        expect(job.entityId).toBe(result.reviewCycle.reviewCycleId);
        expect(job.status).toBe(JobStatus.PENDING);
        expect(job.dependsOnJobIds).toBeNull();
      }

      // Lead review job depends on all specialist jobs
      const leadJob = jobs.find((j) => j.jobType === JobType.LEAD_REVIEW_CONSOLIDATION);
      expect(leadJob).toBeDefined();
      expect(leadJob!.jobGroupId).toBe(result.reviewCycle.reviewCycleId);
      expect(leadJob!.dependsOnJobIds).toEqual(result.specialistJobIds);
    });

    /**
     * Validates that job payloads contain the correct reviewer type and
     * whether the reviewer is required or optional. This metadata is
     * critical for the worker runtime to assemble the correct TaskPacket
     * with role=reviewer and the appropriate reviewer_type.
     */
    it("should include reviewer type and requirement status in job payloads", () => {
      const decision = createRoutingDecision(["general", "security"], ["performance"]);
      const { service } = createService(state, decision);
      service.dispatchReviewers(createDefaultParams());

      const jobs = [...state.jobs.values()].filter((j) => j.jobType === JobType.REVIEWER_DISPATCH);

      // Required reviewers
      const generalJob = jobs.find(
        (j) => (j.payloadJson as Record<string, unknown>).reviewerType === "general",
      );
      expect(generalJob).toBeDefined();
      expect((generalJob!.payloadJson as Record<string, unknown>).isRequired).toBe(true);
      expect((generalJob!.payloadJson as Record<string, unknown>).role).toBe("reviewer");

      const securityJob = jobs.find(
        (j) => (j.payloadJson as Record<string, unknown>).reviewerType === "security",
      );
      expect(securityJob).toBeDefined();
      expect((securityJob!.payloadJson as Record<string, unknown>).isRequired).toBe(true);

      // Optional reviewer
      const perfJob = jobs.find(
        (j) => (j.payloadJson as Record<string, unknown>).reviewerType === "performance",
      );
      expect(perfJob).toBeDefined();
      expect((perfJob!.payloadJson as Record<string, unknown>).isRequired).toBe(false);
    });
  });

  // ─── State Machine Validation ───────────────────────────────────────────

  describe("state machine validation", () => {
    /**
     * Validates that the service rejects dispatch for tasks not in
     * DEV_COMPLETE state. The DEV_COMPLETE → IN_REVIEW transition is the
     * only valid entry point for reviewer dispatch. Attempting to dispatch
     * from any other state (e.g., IN_DEVELOPMENT, BACKLOG) must fail to
     * preserve the task lifecycle integrity.
     */
    it("should throw InvalidTransitionError when task is not in DEV_COMPLETE", () => {
      state.tasks.set("task-001", createFakeTask({ status: TaskStatus.IN_DEVELOPMENT }));
      const { service } = createService(state);

      expect(() => service.dispatchReviewers(createDefaultParams())).toThrow(
        InvalidTransitionError,
      );
    });

    /**
     * Validates that a missing task throws EntityNotFoundError.
     * This catches stale references where the caller has a task ID
     * that doesn't exist in the database.
     */
    it("should throw EntityNotFoundError when task does not exist", () => {
      state.tasks.clear();
      const { service } = createService(state);

      expect(() => service.dispatchReviewers(createDefaultParams())).toThrow(EntityNotFoundError);
    });

    /**
     * Validates rejection for tasks already in IN_REVIEW state.
     * Prevents duplicate dispatch — each task should only be dispatched
     * for review once per development cycle.
     */
    it("should throw InvalidTransitionError when task is already IN_REVIEW", () => {
      state.tasks.set("task-001", createFakeTask({ status: TaskStatus.IN_REVIEW }));
      const { service } = createService(state);

      expect(() => service.dispatchReviewers(createDefaultParams())).toThrow(
        InvalidTransitionError,
      );
    });
  });

  // ─── Review Cycle Creation ──────────────────────────────────────────────

  describe("review cycle creation", () => {
    /**
     * Validates that the ReviewCycle is created with the correct reviewer
     * lists from the routing decision. Required vs optional reviewer
     * classification drives the review cycle lifecycle — required reviews
     * must complete before lead consolidation, optional ones are informational.
     */
    it("should store required and optional reviewers from routing decision", () => {
      const decision = createRoutingDecision(["general", "security"], ["performance"]);
      const { service } = createService(state, decision);
      const result = service.dispatchReviewers(createDefaultParams());

      expect(result.reviewCycle.requiredReviewers).toEqual(["general", "security"]);
      expect(result.reviewCycle.optionalReviewers).toEqual(["performance"]);
    });

    /**
     * Validates that the ReviewCycle transitions from NOT_STARTED to ROUTED.
     * The cycle must pass through NOT_STARTED first (for audit trail) and
     * then to ROUTED after routing decision is emitted, per the review
     * cycle state machine in PRD §2.2.
     */
    it("should transition review cycle to ROUTED status", () => {
      const { service } = createService(state);
      const result = service.dispatchReviewers(createDefaultParams());

      expect(result.reviewCycle.status).toBe(ReviewCycleStatus.ROUTED);
    });
  });

  // ─── Task Update ────────────────────────────────────────────────────────

  describe("task update", () => {
    /**
     * Validates that the task's currentReviewCycleId is updated to point
     * to the newly created ReviewCycle. This link is essential for the
     * control plane to know which review cycle is active for a task.
     */
    it("should update task currentReviewCycleId", () => {
      const { service } = createService(state);
      const result = service.dispatchReviewers(createDefaultParams());

      expect(result.task.currentReviewCycleId).toBe(result.reviewCycle.reviewCycleId);
    });

    /**
     * Validates optimistic concurrency — the task version is incremented
     * after the transition. This prevents concurrent modifications from
     * silently overwriting each other.
     */
    it("should increment task version", () => {
      const { service } = createService(state);
      const result = service.dispatchReviewers(createDefaultParams());

      expect(result.task.version).toBe(4); // was 3, now 4
    });
  });

  // ─── Audit Events ──────────────────────────────────────────────────────

  describe("audit events", () => {
    /**
     * Validates that audit events are created for both the review cycle
     * creation and the task transition. Per §10.3, audit events must be
     * persisted atomically within the same transaction as the state changes.
     * This ensures a complete audit trail even if the process crashes
     * after commit.
     */
    it("should create audit events for review cycle and task transition", () => {
      const { service } = createService(state);
      const result = service.dispatchReviewers(createDefaultParams());

      expect(result.auditEvents).toHaveLength(2);

      // Review cycle audit
      const cycleAudit = result.auditEvents.find((e) => e.entityType === "review-cycle");
      expect(cycleAudit).toBeDefined();
      expect(cycleAudit!.eventType).toBe("review-cycle.created-and-routed");
      expect(cycleAudit!.newState).toBe(ReviewCycleStatus.ROUTED);
      expect(cycleAudit!.actorType).toBe("system");
      expect(cycleAudit!.actorId).toBe("review-module");

      // Task audit
      const taskAudit = result.auditEvents.find((e) => e.entityType === "task");
      expect(taskAudit).toBeDefined();
      expect(taskAudit!.eventType).toBe("task.transitioned");
      expect(taskAudit!.oldState).toBe(TaskStatus.DEV_COMPLETE);
      expect(taskAudit!.newState).toBe(TaskStatus.IN_REVIEW);
    });

    /**
     * Validates that audit event metadata contains structured information
     * about the review dispatch: job IDs, routing rationale, and reviewer
     * assignments. This metadata is essential for debugging and auditing
     * the review pipeline.
     */
    it("should include structured metadata in audit events", () => {
      const { service } = createService(state);
      const result = service.dispatchReviewers(createDefaultParams());

      const cycleAudit = result.auditEvents.find((e) => e.entityType === "review-cycle");
      const metadata = JSON.parse(cycleAudit!.metadata!);
      expect(metadata.taskId).toBe("task-001");
      expect(metadata.requiredReviewers).toEqual(["general"]);
      expect(metadata.specialistJobCount).toBe(1);
      expect(metadata.routingRationale).toBeDefined();

      const taskAudit = result.auditEvents.find((e) => e.entityType === "task");
      const taskMetadata = JSON.parse(taskAudit!.metadata!);
      expect(taskMetadata.reviewCycleId).toBeDefined();
      expect(taskMetadata.specialistJobIds).toBeDefined();
      expect(taskMetadata.leadReviewJobId).toBeDefined();
    });
  });

  // ─── Domain Events ─────────────────────────────────────────────────────

  describe("domain events", () => {
    /**
     * Validates that domain events are emitted AFTER the transaction
     * commits. Two events should be emitted: one for the task transition
     * (DEV_COMPLETE → IN_REVIEW) and one for the review cycle transition
     * (NOT_STARTED → ROUTED). These events drive downstream subscribers
     * like the scheduler, notification service, and metrics.
     */
    it("should emit task and review cycle domain events", () => {
      const { service, eventEmitter } = createService(state);
      service.dispatchReviewers(createDefaultParams());

      expect(eventEmitter.emitted).toHaveLength(2);

      const taskEvent = eventEmitter.emitted.find(
        (e) => (e as Record<string, unknown>).type === "task.transitioned",
      ) as Record<string, unknown>;
      expect(taskEvent).toBeDefined();
      expect(taskEvent.entityType).toBe("task");
      expect(taskEvent.entityId).toBe("task-001");
      expect(taskEvent.fromStatus).toBe(TaskStatus.DEV_COMPLETE);
      expect(taskEvent.toStatus).toBe(TaskStatus.IN_REVIEW);
      expect(taskEvent.actor).toEqual(TEST_ACTOR);

      const cycleEvent = eventEmitter.emitted.find(
        (e) => (e as Record<string, unknown>).type === "review-cycle.transitioned",
      ) as Record<string, unknown>;
      expect(cycleEvent).toBeDefined();
      expect(cycleEvent.entityType).toBe("review-cycle");
      expect(cycleEvent.fromStatus).toBe(ReviewCycleStatus.NOT_STARTED);
      expect(cycleEvent.toStatus).toBe(ReviewCycleStatus.ROUTED);
    });
  });

  // ─── Review Router Integration ─────────────────────────────────────────

  describe("review router integration", () => {
    /**
     * Validates that the service correctly passes all routing input
     * parameters to the Review Router. The routing decision depends on
     * changed files, tags, risk level, and repository config — all must
     * be forwarded faithfully.
     */
    it("should pass correct input to review router", () => {
      const decision = createRoutingDecision();
      const { service, reviewRouter } = createService(state, decision);

      const params = createDefaultParams({
        changedFilePaths: ["src/auth/login.ts", "src/auth/logout.ts"],
        taskTags: ["auth", "security"],
        taskDomain: "authentication",
        riskLevel: RiskLevel.HIGH,
        repositoryRequiredReviewers: ["security"],
        routingConfig: {
          rules: [
            {
              name: "auth-security",
              when: { changed_path_matches: ["src/auth/**"] },
              require_reviewers: ["security"],
            },
          ],
        },
      });

      service.dispatchReviewers(params);

      expect(reviewRouter.routeReview).toHaveBeenCalledWith({
        changedFilePaths: ["src/auth/login.ts", "src/auth/logout.ts"],
        taskTags: ["auth", "security"],
        taskDomain: "authentication",
        riskLevel: RiskLevel.HIGH,
        repositoryRequiredReviewers: ["security"],
        routingConfig: params.routingConfig,
      });
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────────────────

  describe("edge cases", () => {
    /**
     * Validates that dispatch still works correctly when the routing
     * decision returns only the mandatory "general" reviewer with no
     * optional reviewers. This is the minimal routing scenario and
     * should still produce a valid review cycle and lead review job.
     */
    it("should handle routing with only general reviewer", () => {
      const decision = createRoutingDecision(["general"], []);
      const { service } = createService(state, decision);
      const result = service.dispatchReviewers(createDefaultParams());

      expect(result.specialistJobIds).toHaveLength(1);
      expect(result.reviewCycle.requiredReviewers).toEqual(["general"]);
      expect(result.reviewCycle.optionalReviewers).toEqual([]);

      // Lead job should still depend on the single specialist
      const leadJob = state.jobs.get(result.leadReviewJobId);
      expect(leadJob!.dependsOnJobIds).toEqual(result.specialistJobIds);
    });

    /**
     * Validates that the lead review consolidation job's dependsOnJobIds
     * is set to null when there are no specialist reviewers. This is a
     * defensive edge case — in practice, the "general" reviewer is always
     * required, but the code handles the empty case gracefully rather
     * than creating an empty dependency array.
     */
    it("should handle empty reviewer list defensively", () => {
      const decision = createRoutingDecision([], []);
      const { service } = createService(state, decision);
      const result = service.dispatchReviewers(createDefaultParams());

      expect(result.specialistJobIds).toHaveLength(0);

      const leadJob = state.jobs.get(result.leadReviewJobId);
      expect(leadJob!.dependsOnJobIds).toBeNull();
    });

    /**
     * Validates that the service uses the injected ID generator and clock
     * for all generated values. This ensures test determinism and allows
     * the infrastructure layer to provide real UUID/timestamp implementations.
     */
    it("should use injected idGenerator and clock for all IDs and timestamps", () => {
      const { service, eventEmitter } = createService(state);
      const result = service.dispatchReviewers(createDefaultParams());

      // All IDs follow the test-id-XXX pattern
      expect(result.reviewCycle.reviewCycleId).toMatch(/^test-id-\d{3}$/);
      expect(result.leadReviewJobId).toMatch(/^test-id-\d{3}$/);
      for (const id of result.specialistJobIds) {
        expect(id).toMatch(/^test-id-\d{3}$/);
      }

      // Events use the fixed clock
      for (const event of eventEmitter.emitted) {
        expect((event as Record<string, unknown>).timestamp).toEqual(FIXED_TIME);
      }
    });
  });

  // ─── Atomicity ──────────────────────────────────────────────────────────

  describe("atomicity", () => {
    /**
     * Validates that if the task update fails (e.g., due to version conflict),
     * the entire transaction is rolled back. No ReviewCycle or jobs should be
     * persisted, and no domain events should be emitted. This test uses a
     * UnitOfWork that simulates rollback behavior.
     *
     * Atomicity is critical per §10.3: all state changes, audit events, and
     * entity creation must occur in a single transaction.
     */
    it("should not emit events if transaction fails", () => {
      const eventEmitter = createFakeEventEmitter();
      const failingUnitOfWork: ReviewerDispatchUnitOfWork = {
        runInTransaction() {
          throw new Error("Simulated transaction failure");
        },
      };

      const service = createReviewerDispatchService({
        unitOfWork: failingUnitOfWork,
        reviewRouter: createFakeReviewRouter(createRoutingDecision()),
        eventEmitter,
        idGenerator: testIdGenerator,
        clock: testClock,
      });

      expect(() => service.dispatchReviewers(createDefaultParams())).toThrow(
        "Simulated transaction failure",
      );
      expect(eventEmitter.emitted).toHaveLength(0);
    });
  });
});
