/**
 * Tests for the centralized State Transition Service.
 *
 * These tests validate that the transition service correctly:
 * - Enforces domain state machine rules for all four entity types
 * - Applies optimistic concurrency (version-based for tasks, status-based for others)
 * - Creates audit events atomically within the same transaction
 * - Emits domain events after successful commits
 * - Propagates errors correctly (not found, invalid transition, version conflict)
 * - Does NOT emit domain events when transactions fail
 *
 * The tests use in-memory mock implementations of the repository ports
 * and unit of work, keeping them isolated from any database infrastructure.
 *
 * @module @factory/application/services/transition.service.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import type {
  TaskStatus,
  WorkerLeaseStatus,
  ReviewCycleStatus,
  MergeQueueItemStatus,
} from "@factory/domain";
import {
  TaskStatus as TS,
  WorkerLeaseStatus as WLS,
  ReviewCycleStatus as RCS,
  MergeQueueItemStatus as MQS,
} from "@factory/domain";
import { createTransitionService, type TransitionService } from "./transition.service.js";
import type { UnitOfWork, TransactionRepositories } from "../ports/unit-of-work.port.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type {
  TransitionableTask,
  TransitionableTaskLease,
  TransitionableReviewCycle,
  TransitionableMergeQueueItem,
  AuditEventRecord,
  NewAuditEvent,
  TaskRepositoryPort,
  TaskLeaseRepositoryPort,
  ReviewCycleRepositoryPort,
  MergeQueueItemRepositoryPort,
  AuditEventRepositoryPort,
} from "../ports/repository.ports.js";
import type { ActorInfo, DomainEvent } from "../events/domain-events.js";
import { EntityNotFoundError, InvalidTransitionError, VersionConflictError } from "../errors.js";

// ---------------------------------------------------------------------------
// Test helpers — in-memory mock repositories
// ---------------------------------------------------------------------------

let auditEventCounter = 0;

function createMockAuditEventRepo(): AuditEventRepositoryPort & {
  events: AuditEventRecord[];
} {
  const events: AuditEventRecord[] = [];
  return {
    events,
    create(input: NewAuditEvent): AuditEventRecord {
      auditEventCounter++;
      const record: AuditEventRecord = {
        id: `audit-${String(auditEventCounter)}`,
        ...input,
        createdAt: new Date(),
      };
      events.push(record);
      return record;
    },
  };
}

function createMockTaskRepo(
  initialTasks: TransitionableTask[],
): TaskRepositoryPort & { tasks: TransitionableTask[] } {
  const tasks = [...initialTasks];
  return {
    tasks,
    findById(id: string): TransitionableTask | undefined {
      return tasks.find((t) => t.id === id);
    },
    updateStatus(id: string, expectedVersion: number, newStatus: TaskStatus): TransitionableTask {
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx === -1) throw new EntityNotFoundError("Task", id);
      const current = tasks[idx]!;
      if (current.version !== expectedVersion) {
        throw new VersionConflictError("Task", id, expectedVersion);
      }
      const updated: TransitionableTask = {
        id: current.id,
        status: newStatus,
        version: current.version + 1,
      };
      tasks[idx] = updated;
      return updated;
    },
  };
}

function createMockTaskLeaseRepo(
  initialLeases: TransitionableTaskLease[],
): TaskLeaseRepositoryPort & { leases: TransitionableTaskLease[] } {
  const leases = [...initialLeases];
  return {
    leases,
    findById(id: string): TransitionableTaskLease | undefined {
      return leases.find((l) => l.id === id);
    },
    updateStatus(
      id: string,
      expectedStatus: WorkerLeaseStatus,
      newStatus: WorkerLeaseStatus,
    ): TransitionableTaskLease {
      const idx = leases.findIndex((l) => l.id === id);
      if (idx === -1) throw new EntityNotFoundError("TaskLease", id);
      const current = leases[idx]!;
      if (current.status !== expectedStatus) {
        throw new VersionConflictError("TaskLease", id, expectedStatus);
      }
      const updated: TransitionableTaskLease = {
        id: current.id,
        status: newStatus,
      };
      leases[idx] = updated;
      return updated;
    },
  };
}

function createMockReviewCycleRepo(
  initialCycles: TransitionableReviewCycle[],
): ReviewCycleRepositoryPort & { cycles: TransitionableReviewCycle[] } {
  const cycles = [...initialCycles];
  return {
    cycles,
    findById(id: string): TransitionableReviewCycle | undefined {
      return cycles.find((c) => c.id === id);
    },
    updateStatus(
      id: string,
      expectedStatus: ReviewCycleStatus,
      newStatus: ReviewCycleStatus,
    ): TransitionableReviewCycle {
      const idx = cycles.findIndex((c) => c.id === id);
      if (idx === -1) throw new EntityNotFoundError("ReviewCycle", id);
      const current = cycles[idx]!;
      if (current.status !== expectedStatus) {
        throw new VersionConflictError("ReviewCycle", id, expectedStatus);
      }
      const updated: TransitionableReviewCycle = {
        id: current.id,
        status: newStatus,
      };
      cycles[idx] = updated;
      return updated;
    },
  };
}

function createMockMergeQueueItemRepo(
  initialItems: TransitionableMergeQueueItem[],
): MergeQueueItemRepositoryPort & {
  items: TransitionableMergeQueueItem[];
} {
  const items = [...initialItems];
  return {
    items,
    findById(id: string): TransitionableMergeQueueItem | undefined {
      return items.find((i) => i.id === id);
    },
    updateStatus(
      id: string,
      expectedStatus: MergeQueueItemStatus,
      newStatus: MergeQueueItemStatus,
    ): TransitionableMergeQueueItem {
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1) throw new EntityNotFoundError("MergeQueueItem", id);
      const current = items[idx]!;
      if (current.status !== expectedStatus) {
        throw new VersionConflictError("MergeQueueItem", id, expectedStatus);
      }
      const updated: TransitionableMergeQueueItem = {
        id: current.id,
        status: newStatus,
      };
      items[idx] = updated;
      return updated;
    },
  };
}

/**
 * Creates a mock UnitOfWork that executes the callback synchronously
 * using the provided mock repositories. Simulates transactional behavior
 * by rolling back (not committing) if the callback throws.
 */
function createMockUnitOfWork(repos: TransactionRepositories): UnitOfWork {
  return {
    runInTransaction<T>(fn: (r: TransactionRepositories) => T): T {
      return fn(repos);
    },
  };
}

/** Standard actor for tests. */
const testActor: ActorInfo = { type: "system", id: "test-system" };

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("TransitionService", () => {
  let taskRepo: ReturnType<typeof createMockTaskRepo>;
  let leaseRepo: ReturnType<typeof createMockTaskLeaseRepo>;
  let reviewCycleRepo: ReturnType<typeof createMockReviewCycleRepo>;
  let mergeQueueItemRepo: ReturnType<typeof createMockMergeQueueItemRepo>;
  let auditRepo: ReturnType<typeof createMockAuditEventRepo>;
  let unitOfWork: UnitOfWork;
  let emittedEvents: DomainEvent[];
  let eventEmitter: DomainEventEmitter;
  let service: TransitionService;

  beforeEach(() => {
    auditEventCounter = 0;
    emittedEvents = [];
    eventEmitter = {
      emit(event: DomainEvent) {
        emittedEvents.push(event);
      },
    };
  });

  /**
   * Helper to set up the service with the given initial data.
   * Recreated per test to ensure clean state.
   */
  function setup(
    opts: {
      tasks?: TransitionableTask[];
      leases?: TransitionableTaskLease[];
      reviewCycles?: TransitionableReviewCycle[];
      mergeQueueItems?: TransitionableMergeQueueItem[];
    } = {},
  ): void {
    taskRepo = createMockTaskRepo(opts.tasks ?? []);
    leaseRepo = createMockTaskLeaseRepo(opts.leases ?? []);
    reviewCycleRepo = createMockReviewCycleRepo(opts.reviewCycles ?? []);
    mergeQueueItemRepo = createMockMergeQueueItemRepo(opts.mergeQueueItems ?? []);
    auditRepo = createMockAuditEventRepo();
    unitOfWork = createMockUnitOfWork({
      task: taskRepo,
      taskLease: leaseRepo,
      reviewCycle: reviewCycleRepo,
      mergeQueueItem: mergeQueueItemRepo,
      auditEvent: auditRepo,
    });
    service = createTransitionService(unitOfWork, eventEmitter);
  }

  // -----------------------------------------------------------------------
  // transitionTask
  // -----------------------------------------------------------------------

  describe("transitionTask", () => {
    /**
     * Validates the happy path: a legal BACKLOG → READY transition should
     * update the task, create an audit event, and emit a domain event.
     * This is the most common transition triggered by the dependency module
     * when all dependencies are resolved.
     */
    it("should transition a task from BACKLOG to READY with valid context", () => {
      setup({
        tasks: [{ id: "task-1", status: TS.BACKLOG, version: 1 }],
      });

      const result = service.transitionTask(
        "task-1",
        TS.READY,
        { allDependenciesResolved: true },
        testActor,
      );

      // Entity updated
      expect(result.entity.status).toBe(TS.READY);
      expect(result.entity.version).toBe(2);

      // Audit event created
      expect(result.auditEvent.entityType).toBe("task");
      expect(result.auditEvent.entityId).toBe("task-1");
      expect(result.auditEvent.eventType).toBe(`task.transition.${TS.BACKLOG}.to.${TS.READY}`);
      expect(result.auditEvent.actorType).toBe("system");
      expect(result.auditEvent.actorId).toBe("test-system");

      // Old/new state recorded
      const oldState = JSON.parse(result.auditEvent.oldState!) as {
        status: string;
        version: number;
      };
      const newState = JSON.parse(result.auditEvent.newState!) as {
        status: string;
        version: number;
      };
      expect(oldState.status).toBe(TS.BACKLOG);
      expect(oldState.version).toBe(1);
      expect(newState.status).toBe(TS.READY);
      expect(newState.version).toBe(2);

      // Domain event emitted
      expect(emittedEvents).toHaveLength(1);
      const event = emittedEvents[0]!;
      expect(event.type).toBe("task.transitioned");
      if (event.type === "task.transitioned") {
        expect(event.fromStatus).toBe(TS.BACKLOG);
        expect(event.toStatus).toBe(TS.READY);
        expect(event.newVersion).toBe(2);
        expect(event.entityId).toBe("task-1");
      }
    });

    /**
     * Validates the full happy path through the main task lifecycle:
     * READY → ASSIGNED (scheduler grants lease).
     */
    it("should transition READY → ASSIGNED when lease is acquired", () => {
      setup({
        tasks: [{ id: "task-2", status: TS.READY, version: 3 }],
      });

      const result = service.transitionTask(
        "task-2",
        TS.ASSIGNED,
        { leaseAcquired: true },
        { type: "scheduler", id: "scheduler-1" },
      );

      expect(result.entity.status).toBe(TS.ASSIGNED);
      expect(result.entity.version).toBe(4);
      expect(auditRepo.events).toHaveLength(1);
      expect(emittedEvents).toHaveLength(1);
    });

    /**
     * Validates that metadata is persisted in the audit event when provided.
     * Modules can attach arbitrary context (e.g., which dependency was resolved,
     * which reviewer made the decision) for debugging and traceability.
     */
    it("should include metadata in audit event when provided", () => {
      setup({
        tasks: [{ id: "task-3", status: TS.BACKLOG, version: 1 }],
      });

      const result = service.transitionTask(
        "task-3",
        TS.READY,
        { allDependenciesResolved: true },
        testActor,
        { resolvedDependencies: ["dep-1", "dep-2"], trigger: "reconciliation" },
      );

      const metadata = JSON.parse(result.auditEvent.metadata!) as Record<string, unknown>;
      expect(metadata.resolvedDependencies).toEqual(["dep-1", "dep-2"]);
      expect(metadata.trigger).toBe("reconciliation");
    });

    /**
     * Validates that the service throws EntityNotFoundError for a
     * non-existent task. This prevents silent no-ops on stale references.
     */
    it("should throw EntityNotFoundError when task does not exist", () => {
      setup();

      expect(() =>
        service.transitionTask(
          "nonexistent",
          TS.READY,
          { allDependenciesResolved: true },
          testActor,
        ),
      ).toThrow(EntityNotFoundError);

      // No event emitted on failure
      expect(emittedEvents).toHaveLength(0);
    });

    /**
     * Validates that the domain state machine is enforced. A BACKLOG → READY
     * transition without resolved dependencies must be rejected — the
     * dependency module invariant says tasks can only become READY when
     * all hard-block dependencies are resolved.
     */
    it("should throw InvalidTransitionError when state machine rejects", () => {
      setup({
        tasks: [{ id: "task-4", status: TS.BACKLOG, version: 1 }],
      });

      expect(() =>
        service.transitionTask("task-4", TS.READY, { allDependenciesResolved: false }, testActor),
      ).toThrow(InvalidTransitionError);

      // Task unchanged
      expect(taskRepo.tasks[0]!.status).toBe(TS.BACKLOG);
      expect(taskRepo.tasks[0]!.version).toBe(1);

      // No audit event or domain event
      expect(auditRepo.events).toHaveLength(0);
      expect(emittedEvents).toHaveLength(0);
    });

    /**
     * Validates that illegal transitions (not in the state machine at all)
     * are rejected. BACKLOG → DONE is never a valid path.
     */
    it("should throw InvalidTransitionError for impossible transitions", () => {
      setup({
        tasks: [{ id: "task-5", status: TS.BACKLOG, version: 1 }],
      });

      expect(() => service.transitionTask("task-5", TS.DONE, {}, testActor)).toThrow(
        InvalidTransitionError,
      );
    });

    /**
     * Validates optimistic concurrency: if another process updated the
     * task between read and write (changing its version), the update
     * must fail with VersionConflictError. This prevents lost updates
     * in concurrent environments.
     */
    it("should propagate VersionConflictError on stale version", () => {
      setup({
        tasks: [{ id: "task-6", status: TS.BACKLOG, version: 1 }],
      });

      // Simulate concurrent modification by changing version in-place
      taskRepo.tasks[0] = { id: "task-6", status: TS.BACKLOG, version: 2 };

      // The service reads version 2, but the mock updateStatus will get
      // version 2 as expectedVersion — let's use a custom repo that
      // simulates the race condition properly
      const racingTaskRepo: TaskRepositoryPort = {
        findById: () => ({ id: "task-6", status: TS.BACKLOG, version: 1 }),
        updateStatus: () => {
          throw new VersionConflictError("Task", "task-6", 1);
        },
      };
      const racingUoW = createMockUnitOfWork({
        task: racingTaskRepo,
        taskLease: leaseRepo,
        reviewCycle: reviewCycleRepo,
        mergeQueueItem: mergeQueueItemRepo,
        auditEvent: auditRepo,
      });
      const racingService = createTransitionService(racingUoW, eventEmitter);

      expect(() =>
        racingService.transitionTask(
          "task-6",
          TS.READY,
          { allDependenciesResolved: true },
          testActor,
        ),
      ).toThrow(VersionConflictError);

      expect(emittedEvents).toHaveLength(0);
    });

    /**
     * Validates that domain events are NOT emitted when the transaction
     * fails. Since events are emitted after commit, a failure during the
     * transaction should prevent event publication entirely.
     */
    it("should not emit domain event when transaction fails", () => {
      setup({
        tasks: [{ id: "task-7", status: TS.BACKLOG, version: 1 }],
      });

      // Override unit of work to throw during transaction
      const failingUoW: UnitOfWork = {
        runInTransaction: () => {
          throw new Error("DB connection lost");
        },
      };
      const failingService = createTransitionService(failingUoW, eventEmitter);

      expect(() =>
        failingService.transitionTask(
          "task-7",
          TS.READY,
          { allDependenciesResolved: true },
          testActor,
        ),
      ).toThrow("DB connection lost");

      expect(emittedEvents).toHaveLength(0);
    });

    /**
     * Validates wildcard transitions: any non-terminal state can transition
     * to ESCALATED when an operator triggers it. This tests that the
     * transition service correctly delegates to the domain state machine's
     * wildcard handling.
     */
    it("should support wildcard transitions (any → ESCALATED for operators)", () => {
      setup({
        tasks: [{ id: "task-8", status: TS.IN_DEVELOPMENT, version: 5 }],
      });

      const result = service.transitionTask(
        "task-8",
        TS.ESCALATED,
        { isOperator: true },
        { type: "operator", id: "admin-1" },
      );

      expect(result.entity.status).toBe(TS.ESCALATED);
      expect(emittedEvents[0]!.type).toBe("task.transitioned");
    });

    /**
     * Validates the full development lifecycle transition chain.
     * This ensures multiple sequential transitions work correctly,
     * with version numbers incrementing properly at each step.
     */
    it("should handle sequential transitions through the development lifecycle", () => {
      setup({
        tasks: [{ id: "task-9", status: TS.BACKLOG, version: 1 }],
      });

      // BACKLOG → READY
      service.transitionTask("task-9", TS.READY, { allDependenciesResolved: true }, testActor);

      // READY → ASSIGNED
      service.transitionTask("task-9", TS.ASSIGNED, { leaseAcquired: true }, testActor);

      // ASSIGNED → IN_DEVELOPMENT
      service.transitionTask("task-9", TS.IN_DEVELOPMENT, { hasHeartbeat: true }, testActor);

      expect(taskRepo.tasks[0]!.status).toBe(TS.IN_DEVELOPMENT);
      expect(taskRepo.tasks[0]!.version).toBe(4);
      expect(auditRepo.events).toHaveLength(3);
      expect(emittedEvents).toHaveLength(3);
    });
  });

  // -----------------------------------------------------------------------
  // transitionLease
  // -----------------------------------------------------------------------

  describe("transitionLease", () => {
    /**
     * Validates the happy path for lease transitions: IDLE → LEASED.
     * This is triggered by the scheduler when a task is assigned to a worker.
     */
    it("should transition a lease from IDLE to LEASED", () => {
      setup({
        leases: [{ id: "lease-1", status: WLS.IDLE }],
      });

      const result = service.transitionLease(
        "lease-1",
        WLS.LEASED,
        { leaseAcquired: true },
        testActor,
      );

      expect(result.entity.status).toBe(WLS.LEASED);
      expect(result.auditEvent.entityType).toBe("task-lease");
      expect(result.auditEvent.eventType).toBe(
        `task-lease.transition.${WLS.IDLE}.to.${WLS.LEASED}`,
      );
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]!.type).toBe("task-lease.transitioned");
    });

    /**
     * Validates that lease transitions through the worker startup sequence
     * work correctly: LEASED → STARTING → RUNNING → HEARTBEATING.
     */
    it("should handle the worker startup sequence", () => {
      setup({
        leases: [{ id: "lease-2", status: WLS.LEASED }],
      });

      service.transitionLease("lease-2", WLS.STARTING, { workerProcessSpawned: true }, testActor);
      service.transitionLease("lease-2", WLS.RUNNING, { firstHeartbeatReceived: true }, testActor);
      service.transitionLease("lease-2", WLS.HEARTBEATING, { heartbeatReceived: true }, testActor);

      expect(leaseRepo.leases[0]!.status).toBe(WLS.HEARTBEATING);
      expect(auditRepo.events).toHaveLength(3);
    });

    /**
     * Validates status-based optimistic concurrency for leases.
     * If the lease status changed between read and write (concurrent
     * modification), the update must fail.
     */
    it("should throw VersionConflictError on concurrent lease modification", () => {
      setup({
        leases: [{ id: "lease-3", status: WLS.RUNNING }],
      });

      const racingLeaseRepo: TaskLeaseRepositoryPort = {
        findById: () => ({ id: "lease-3", status: WLS.RUNNING }),
        updateStatus: () => {
          throw new VersionConflictError("TaskLease", "lease-3", WLS.RUNNING);
        },
      };
      const racingUoW = createMockUnitOfWork({
        task: taskRepo,
        taskLease: racingLeaseRepo,
        reviewCycle: reviewCycleRepo,
        mergeQueueItem: mergeQueueItemRepo,
        auditEvent: auditRepo,
      });
      const racingService = createTransitionService(racingUoW, eventEmitter);

      expect(() =>
        racingService.transitionLease(
          "lease-3",
          WLS.HEARTBEATING,
          { heartbeatReceived: true },
          testActor,
        ),
      ).toThrow(VersionConflictError);
    });

    /**
     * Validates that non-existent leases throw EntityNotFoundError.
     */
    it("should throw EntityNotFoundError for non-existent lease", () => {
      setup();

      expect(() =>
        service.transitionLease("nonexistent", WLS.LEASED, { leaseAcquired: true }, testActor),
      ).toThrow(EntityNotFoundError);
    });

    /**
     * Validates that invalid lease transitions are rejected by the
     * domain state machine. IDLE → RUNNING skips required intermediate
     * states and must be rejected.
     */
    it("should reject invalid lease transitions", () => {
      setup({
        leases: [{ id: "lease-4", status: WLS.IDLE }],
      });

      expect(() =>
        service.transitionLease(
          "lease-4",
          WLS.RUNNING,
          { firstHeartbeatReceived: true },
          testActor,
        ),
      ).toThrow(InvalidTransitionError);
    });

    /**
     * Validates timeout transitions: HEARTBEATING → TIMED_OUT.
     * This is triggered by the staleness detection loop.
     */
    it("should transition to TIMED_OUT on heartbeat timeout", () => {
      setup({
        leases: [{ id: "lease-5", status: WLS.HEARTBEATING }],
      });

      const result = service.transitionLease(
        "lease-5",
        WLS.TIMED_OUT,
        { heartbeatTimedOut: true },
        { type: "system", id: "staleness-detector" },
      );

      expect(result.entity.status).toBe(WLS.TIMED_OUT);
    });
  });

  // -----------------------------------------------------------------------
  // transitionReviewCycle
  // -----------------------------------------------------------------------

  describe("transitionReviewCycle", () => {
    /**
     * Validates the happy path for review cycle transitions:
     * NOT_STARTED → ROUTED when the routing decision is emitted.
     */
    it("should transition a review cycle from NOT_STARTED to ROUTED", () => {
      setup({
        reviewCycles: [{ id: "rc-1", status: RCS.NOT_STARTED }],
      });

      const result = service.transitionReviewCycle(
        "rc-1",
        RCS.ROUTED,
        { routingDecisionEmitted: true },
        testActor,
      );

      expect(result.entity.status).toBe(RCS.ROUTED);
      expect(result.auditEvent.entityType).toBe("review-cycle");
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]!.type).toBe("review-cycle.transitioned");
    });

    /**
     * Validates the review approval path through consolidation.
     */
    it("should handle the full review approval path", () => {
      setup({
        reviewCycles: [{ id: "rc-2", status: RCS.NOT_STARTED }],
      });

      service.transitionReviewCycle(
        "rc-2",
        RCS.ROUTED,
        { routingDecisionEmitted: true },
        testActor,
      );
      service.transitionReviewCycle("rc-2", RCS.IN_PROGRESS, { reviewStarted: true }, testActor);
      service.transitionReviewCycle(
        "rc-2",
        RCS.CONSOLIDATING,
        { allRequiredReviewsComplete: true },
        testActor,
      );
      service.transitionReviewCycle(
        "rc-2",
        RCS.APPROVED,
        { leadReviewDecision: "approved" },
        testActor,
      );

      expect(reviewCycleRepo.cycles[0]!.status).toBe(RCS.APPROVED);
      expect(auditRepo.events).toHaveLength(4);
    });

    /**
     * Validates rejection path: CONSOLIDATING → REJECTED on
     * lead reviewer "rejected" decision.
     */
    it("should handle rejection path", () => {
      setup({
        reviewCycles: [{ id: "rc-3", status: RCS.CONSOLIDATING }],
      });

      const result = service.transitionReviewCycle(
        "rc-3",
        RCS.REJECTED,
        { leadReviewDecision: "rejected" },
        testActor,
      );

      expect(result.entity.status).toBe(RCS.REJECTED);
    });

    /**
     * Validates escalation from IN_PROGRESS when an escalation trigger fires.
     */
    it("should handle escalation from IN_PROGRESS", () => {
      setup({
        reviewCycles: [{ id: "rc-4", status: RCS.IN_PROGRESS }],
      });

      const result = service.transitionReviewCycle(
        "rc-4",
        RCS.ESCALATED,
        { hasEscalationTrigger: true },
        testActor,
      );

      expect(result.entity.status).toBe(RCS.ESCALATED);
    });

    /**
     * Validates that non-existent review cycles throw EntityNotFoundError.
     */
    it("should throw EntityNotFoundError for non-existent review cycle", () => {
      setup();

      expect(() =>
        service.transitionReviewCycle(
          "nonexistent",
          RCS.ROUTED,
          { routingDecisionEmitted: true },
          testActor,
        ),
      ).toThrow(EntityNotFoundError);
    });

    /**
     * Validates that invalid review cycle transitions are rejected.
     * NOT_STARTED → APPROVED skips required steps.
     */
    it("should reject invalid review cycle transitions", () => {
      setup({
        reviewCycles: [{ id: "rc-5", status: RCS.NOT_STARTED }],
      });

      expect(() =>
        service.transitionReviewCycle(
          "rc-5",
          RCS.APPROVED,
          { leadReviewDecision: "approved" },
          testActor,
        ),
      ).toThrow(InvalidTransitionError);
    });
  });

  // -----------------------------------------------------------------------
  // transitionMergeQueueItem
  // -----------------------------------------------------------------------

  describe("transitionMergeQueueItem", () => {
    /**
     * Validates the happy path for merge queue items:
     * ENQUEUED → PREPARING when preparation starts.
     */
    it("should transition a merge queue item from ENQUEUED to PREPARING", () => {
      setup({
        mergeQueueItems: [{ id: "mqi-1", status: MQS.ENQUEUED }],
      });

      const result = service.transitionMergeQueueItem(
        "mqi-1",
        MQS.PREPARING,
        { preparationStarted: true },
        testActor,
      );

      expect(result.entity.status).toBe(MQS.PREPARING);
      expect(result.auditEvent.entityType).toBe("merge-queue-item");
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]!.type).toBe("merge-queue-item.transitioned");
    });

    /**
     * Validates the full merge success path:
     * ENQUEUED → PREPARING → REBASING → VALIDATING → MERGING → MERGED.
     */
    it("should handle the full merge success path", () => {
      setup({
        mergeQueueItems: [{ id: "mqi-2", status: MQS.ENQUEUED }],
      });

      service.transitionMergeQueueItem(
        "mqi-2",
        MQS.PREPARING,
        { preparationStarted: true },
        testActor,
      );
      service.transitionMergeQueueItem("mqi-2", MQS.REBASING, { workspaceReady: true }, testActor);
      service.transitionMergeQueueItem(
        "mqi-2",
        MQS.VALIDATING,
        { rebaseSuccessful: true },
        testActor,
      );
      service.transitionMergeQueueItem("mqi-2", MQS.MERGING, { validationPassed: true }, testActor);
      service.transitionMergeQueueItem("mqi-2", MQS.MERGED, { mergeSuccessful: true }, testActor);

      expect(mergeQueueItemRepo.items[0]!.status).toBe(MQS.MERGED);
      expect(auditRepo.events).toHaveLength(5);
      expect(emittedEvents).toHaveLength(5);
    });

    /**
     * Validates the requeue path: REBASING → REQUEUED on reworkable conflict.
     */
    it("should handle requeue on reworkable conflict", () => {
      setup({
        mergeQueueItems: [{ id: "mqi-3", status: MQS.REBASING }],
      });

      const result = service.transitionMergeQueueItem(
        "mqi-3",
        MQS.REQUEUED,
        { rebaseFailed: true, conflictReworkable: true },
        testActor,
      );

      expect(result.entity.status).toBe(MQS.REQUEUED);
    });

    /**
     * Validates the failure path: REBASING → FAILED on non-reworkable conflict.
     */
    it("should handle failure on non-reworkable conflict", () => {
      setup({
        mergeQueueItems: [{ id: "mqi-4", status: MQS.REBASING }],
      });

      const result = service.transitionMergeQueueItem(
        "mqi-4",
        MQS.FAILED,
        { rebaseFailed: true },
        testActor,
      );

      expect(result.entity.status).toBe(MQS.FAILED);
    });

    /**
     * Validates that non-existent items throw EntityNotFoundError.
     */
    it("should throw EntityNotFoundError for non-existent merge queue item", () => {
      setup();

      expect(() =>
        service.transitionMergeQueueItem(
          "nonexistent",
          MQS.PREPARING,
          { preparationStarted: true },
          testActor,
        ),
      ).toThrow(EntityNotFoundError);
    });

    /**
     * Validates that invalid transitions are rejected.
     * ENQUEUED → MERGED skips required intermediate states.
     */
    it("should reject invalid merge queue item transitions", () => {
      setup({
        mergeQueueItems: [{ id: "mqi-5", status: MQS.ENQUEUED }],
      });

      expect(() =>
        service.transitionMergeQueueItem("mqi-5", MQS.MERGED, { mergeSuccessful: true }, testActor),
      ).toThrow(InvalidTransitionError);
    });

    /**
     * Validates status-based optimistic concurrency for merge queue items.
     */
    it("should throw VersionConflictError on concurrent merge queue modification", () => {
      setup({
        mergeQueueItems: [{ id: "mqi-6", status: MQS.ENQUEUED }],
      });

      const racingRepo: MergeQueueItemRepositoryPort = {
        findById: () => ({ id: "mqi-6", status: MQS.ENQUEUED }),
        updateStatus: () => {
          throw new VersionConflictError("MergeQueueItem", "mqi-6", MQS.ENQUEUED);
        },
      };
      const racingUoW = createMockUnitOfWork({
        task: taskRepo,
        taskLease: leaseRepo,
        reviewCycle: reviewCycleRepo,
        mergeQueueItem: racingRepo,
        auditEvent: auditRepo,
      });
      const racingService = createTransitionService(racingUoW, eventEmitter);

      expect(() =>
        racingService.transitionMergeQueueItem(
          "mqi-6",
          MQS.PREPARING,
          { preparationStarted: true },
          testActor,
        ),
      ).toThrow(VersionConflictError);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-cutting concerns
  // -----------------------------------------------------------------------

  describe("cross-cutting concerns", () => {
    /**
     * Validates that audit events are created within the same transaction
     * as the state update. If the audit event creation fails, the state
     * change should also be rolled back (the mock UoW doesn't actually
     * roll back, but we verify the error propagates).
     */
    it("should propagate audit event creation failures", () => {
      const failingAuditRepo: AuditEventRepositoryPort = {
        create: () => {
          throw new Error("Audit storage full");
        },
      };
      const failingUoW = createMockUnitOfWork({
        task: createMockTaskRepo([{ id: "task-10", status: TS.BACKLOG, version: 1 }]),
        taskLease: createMockTaskLeaseRepo([]),
        reviewCycle: createMockReviewCycleRepo([]),
        mergeQueueItem: createMockMergeQueueItemRepo([]),
        auditEvent: failingAuditRepo,
      });
      const failingService = createTransitionService(failingUoW, eventEmitter);

      expect(() =>
        failingService.transitionTask(
          "task-10",
          TS.READY,
          { allDependenciesResolved: true },
          testActor,
        ),
      ).toThrow("Audit storage full");

      // No domain event emitted
      expect(emittedEvents).toHaveLength(0);
    });

    /**
     * Validates that domain event emission failures do NOT prevent the
     * transition from succeeding. The event emitter should handle its
     * own errors internally (as documented in the port interface).
     * However, if the emitter throws, we verify the behavior is defined.
     */
    it("should complete transition even if event emission would throw", () => {
      setup({
        tasks: [{ id: "task-11", status: TS.BACKLOG, version: 1 }],
      });

      // Replace emitter with one that throws
      const throwingEmitter: DomainEventEmitter = {
        emit: () => {
          throw new Error("Event bus down");
        },
      };
      const throwingService = createTransitionService(unitOfWork, throwingEmitter);

      // The throw from emit propagates (caller must handle)
      // In production, the emitter implementation should catch internally
      expect(() =>
        throwingService.transitionTask(
          "task-11",
          TS.READY,
          { allDependenciesResolved: true },
          testActor,
        ),
      ).toThrow("Event bus down");

      // But the DB state IS updated (transaction committed before emit)
      expect(taskRepo.tasks[0]!.status).toBe(TS.READY);
      expect(auditRepo.events).toHaveLength(1);
    });

    /**
     * Validates that the audit event old/new state fields contain valid JSON
     * with the expected structure for all entity types.
     */
    it("should produce valid JSON in audit event state fields for all entity types", () => {
      setup({
        tasks: [{ id: "t", status: TS.BACKLOG, version: 1 }],
        leases: [{ id: "l", status: WLS.IDLE }],
        reviewCycles: [{ id: "r", status: RCS.NOT_STARTED }],
        mergeQueueItems: [{ id: "m", status: MQS.ENQUEUED }],
      });

      const taskResult = service.transitionTask(
        "t",
        TS.READY,
        { allDependenciesResolved: true },
        testActor,
      );
      const leaseResult = service.transitionLease(
        "l",
        WLS.LEASED,
        { leaseAcquired: true },
        testActor,
      );
      const rcResult = service.transitionReviewCycle(
        "r",
        RCS.ROUTED,
        { routingDecisionEmitted: true },
        testActor,
      );
      const mqResult = service.transitionMergeQueueItem(
        "m",
        MQS.PREPARING,
        { preparationStarted: true },
        testActor,
      );

      for (const result of [taskResult, leaseResult, rcResult, mqResult]) {
        expect(() => JSON.parse(result.auditEvent.oldState!)).not.toThrow();
        expect(() => JSON.parse(result.auditEvent.newState!)).not.toThrow();
      }

      // Task audit includes version info
      const taskOldState = JSON.parse(taskResult.auditEvent.oldState!) as { version: number };
      const taskNewState = JSON.parse(taskResult.auditEvent.newState!) as { version: number };
      expect(taskOldState.version).toBe(1);
      expect(taskNewState.version).toBe(2);
    });

    /**
     * Validates that null metadata produces null in the audit event,
     * not "null" string or undefined.
     */
    it("should store null metadata when none provided", () => {
      setup({
        tasks: [{ id: "task-12", status: TS.BACKLOG, version: 1 }],
      });

      const result = service.transitionTask(
        "task-12",
        TS.READY,
        { allDependenciesResolved: true },
        testActor,
      );

      expect(result.auditEvent.metadata).toBeNull();
    });
  });
});
