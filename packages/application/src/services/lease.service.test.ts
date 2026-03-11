/**
 * Tests for the lease acquisition service.
 *
 * These tests validate the one-active-lease-per-task invariant, which is the
 * most critical correctness property of the lease management subsystem.
 * Every test uses in-memory mock implementations of the ports, following the
 * same patterns established by the transition service tests.
 *
 * @see docs/prd/002-data-model.md §2.1 — "only one active development lease per task"
 * @see docs/prd/002-data-model.md §2.8 — Worker Lease Protocol
 * @module @factory/application/services/lease.service.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TaskStatus, WorkerLeaseStatus } from "@factory/domain";

import { createLeaseService, type LeaseService, type AcquireLeaseParams } from "./lease.service.js";

import type {
  LeaseAcquisitionTask,
  ActiveLeaseInfo,
  NewLeaseData,
  CreatedLease,
  LeaseTaskRepositoryPort,
  LeaseRepositoryPort,
  LeaseTransactionRepositories,
  LeaseUnitOfWork,
} from "../ports/lease.ports.js";

import type { AuditEventRecord, NewAuditEvent } from "../ports/repository.ports.js";
import type { AuditEventRepositoryPort } from "../ports/repository.ports.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type { DomainEvent, ActorInfo } from "../events/domain-events.js";

import {
  EntityNotFoundError,
  ExclusivityViolationError,
  TaskNotReadyForLeaseError,
  InvalidTransitionError,
  VersionConflictError,
} from "../errors.js";

// ─── Mock Factories ─────────────────────────────────────────────────────────

/**
 * Creates an in-memory mock task repository for lease operations.
 * Exposes the tasks array for assertions.
 */
function createMockTaskRepo(
  initialTasks: LeaseAcquisitionTask[],
): LeaseTaskRepositoryPort & { tasks: LeaseAcquisitionTask[] } {
  const tasks = [...initialTasks];

  return {
    tasks,

    findById(id: string): LeaseAcquisitionTask | undefined {
      return tasks.find((t) => t.id === id);
    },

    updateStatusAndLeaseId(
      id: string,
      expectedVersion: number,
      newStatus: TaskStatus,
      leaseId: string,
    ): LeaseAcquisitionTask {
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx === -1) {
        throw new EntityNotFoundError("Task", id);
      }

      const current = tasks[idx]!;
      if (current.version !== expectedVersion) {
        throw new VersionConflictError("Task", id, expectedVersion);
      }

      const updated: LeaseAcquisitionTask = {
        ...current,
        status: newStatus,
        version: current.version + 1,
        currentLeaseId: leaseId,
      };
      tasks[idx] = updated;
      return updated;
    },
  };
}

/**
 * Creates an in-memory mock lease repository.
 * Exposes the leases array for assertions.
 */
function createMockLeaseRepo(
  initialLeases: ActiveLeaseInfo[] = [],
): LeaseRepositoryPort & { leases: CreatedLease[] } {
  const activeLeases = [...initialLeases];
  const leases: CreatedLease[] = [];

  return {
    leases,

    findActiveByTaskId(taskId: string): ActiveLeaseInfo | undefined {
      return activeLeases.find((l) => l.taskId === taskId);
    },

    create(data: NewLeaseData): CreatedLease {
      const created: CreatedLease = {
        leaseId: data.leaseId,
        taskId: data.taskId,
        workerId: data.workerId,
        poolId: data.poolId,
        status: data.status,
        leasedAt: new Date(),
        expiresAt: data.expiresAt,
      };
      leases.push(created);

      // Also register as an active lease for subsequent exclusivity checks
      // within the same transaction
      activeLeases.push({
        leaseId: data.leaseId,
        taskId: data.taskId,
        status: data.status,
      });

      return created;
    },
  };
}

/**
 * Creates an in-memory mock audit event repository.
 * Returns sequential IDs and captures created events.
 */
function createMockAuditRepo(): AuditEventRepositoryPort & {
  events: AuditEventRecord[];
} {
  let counter = 0;
  const events: AuditEventRecord[] = [];

  return {
    events,

    create(event: NewAuditEvent): AuditEventRecord {
      counter++;
      const record: AuditEventRecord = {
        id: `audit-${String(counter)}`,
        ...event,
        createdAt: new Date(),
      };
      events.push(record);
      return record;
    },
  };
}

// ─── Test Setup ─────────────────────────────────────────────────────────────

const TS = TaskStatus;
const WLS = WorkerLeaseStatus;

const DEFAULT_ACTOR: ActorInfo = { type: "system", id: "scheduler-1" };
const OPERATOR_ACTOR: ActorInfo = { type: "operator", id: "admin-1" };

let taskRepo: ReturnType<typeof createMockTaskRepo>;
let leaseRepo: ReturnType<typeof createMockLeaseRepo>;
let auditRepo: ReturnType<typeof createMockAuditRepo>;
let emittedEvents: DomainEvent[];
let eventEmitter: DomainEventEmitter;
let idCounter: number;
let service: LeaseService;

function setup(
  opts: {
    tasks?: LeaseAcquisitionTask[];
    activeLeases?: ActiveLeaseInfo[];
  } = {},
): void {
  taskRepo = createMockTaskRepo(opts.tasks ?? []);
  leaseRepo = createMockLeaseRepo(opts.activeLeases ?? []);
  auditRepo = createMockAuditRepo();

  const unitOfWork: LeaseUnitOfWork = {
    runInTransaction<T>(fn: (repos: LeaseTransactionRepositories) => T): T {
      return fn({
        task: taskRepo,
        lease: leaseRepo,
        auditEvent: auditRepo,
      });
    },
  };

  service = createLeaseService(unitOfWork, eventEmitter, () => {
    idCounter++;
    return `lease-${String(idCounter)}`;
  });
}

function defaultParams(overrides?: Partial<AcquireLeaseParams>): AcquireLeaseParams {
  return {
    taskId: "task-1",
    workerId: "worker-1",
    poolId: "pool-1",
    ttlSeconds: 1800,
    actor: DEFAULT_ACTOR,
    ...overrides,
  };
}

beforeEach(() => {
  emittedEvents = [];
  eventEmitter = { emit: (e: DomainEvent) => emittedEvents.push(e) };
  idCounter = 0;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("LeaseService.acquireLease", () => {
  // ── Happy Path ──────────────────────────────────────────────────────────

  describe("happy path — lease acquisition from READY", () => {
    /**
     * Validates the primary happy path: a task in READY state can have a
     * lease acquired, transitioning it to ASSIGNED. This is the most common
     * lease acquisition scenario in the scheduler flow.
     */
    it("should create a lease and transition task from READY to ASSIGNED", () => {
      setup({
        tasks: [{ id: "task-1", status: TS.READY, version: 1, currentLeaseId: null }],
      });

      const result = service.acquireLease(defaultParams());

      // Lease created with correct fields
      expect(result.lease.leaseId).toBe("lease-1");
      expect(result.lease.taskId).toBe("task-1");
      expect(result.lease.workerId).toBe("worker-1");
      expect(result.lease.poolId).toBe("pool-1");
      expect(result.lease.status).toBe(WLS.LEASED);
      expect(result.lease.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Task transitioned to ASSIGNED with lease linked
      expect(result.task.status).toBe(TS.ASSIGNED);
      expect(result.task.version).toBe(2);
      expect(result.task.currentLeaseId).toBe("lease-1");

      // Audit event recorded
      expect(result.auditEvent.entityType).toBe("task");
      expect(result.auditEvent.entityId).toBe("task-1");
      expect(result.auditEvent.eventType).toBe("lease.acquired");
    });

    /**
     * Validates that the lease expiry is correctly computed from the TTL.
     * The PRD specifies that expires_at = now + lease_ttl_seconds.
     */
    it("should set lease expiry based on TTL seconds", () => {
      setup({
        tasks: [{ id: "task-1", status: TS.READY, version: 1, currentLeaseId: null }],
      });

      const before = Date.now();
      const result = service.acquireLease(defaultParams({ ttlSeconds: 600 }));
      const after = Date.now();

      const expectedMin = before + 600 * 1000;
      const expectedMax = after + 600 * 1000;

      expect(result.lease.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(result.lease.expiresAt.getTime()).toBeLessThanOrEqual(expectedMax);
    });

    /**
     * Validates that lease IDs are generated using the injected ID generator.
     * This ensures the service is properly decoupled from ID generation strategy.
     */
    it("should use the injected ID generator for lease IDs", () => {
      setup({
        tasks: [{ id: "task-1", status: TS.READY, version: 1, currentLeaseId: null }],
      });

      const result = service.acquireLease(defaultParams());
      expect(result.lease.leaseId).toBe("lease-1");
    });
  });

  // ── Lease from CHANGES_REQUESTED ────────────────────────────────────────

  describe("happy path — lease acquisition from CHANGES_REQUESTED", () => {
    /**
     * Validates the rework scenario: after a review rejection, the scheduler
     * re-assigns the task by acquiring a new lease from CHANGES_REQUESTED.
     * This is the second most common lease acquisition path.
     *
     * @see docs/prd/002-data-model.md §2.1 — CHANGES_REQUESTED → ASSIGNED
     */
    it("should create a lease and transition task from CHANGES_REQUESTED to ASSIGNED", () => {
      setup({
        tasks: [
          {
            id: "task-1",
            status: TS.CHANGES_REQUESTED,
            version: 3,
            currentLeaseId: null,
          },
        ],
      });

      const result = service.acquireLease(defaultParams());

      expect(result.lease.status).toBe(WLS.LEASED);
      expect(result.task.status).toBe(TS.ASSIGNED);
      expect(result.task.version).toBe(4);
    });
  });

  // ── Lease from ESCALATED ────────────────────────────────────────────────

  describe("happy path — lease acquisition from ESCALATED", () => {
    /**
     * Validates the operator-driven retry: an operator resolves an escalation
     * by assigning a new worker. The ESCALATED → ASSIGNED guard requires
     * both isOperator=true and leaseAcquired=true.
     *
     * @see docs/prd/002-data-model.md §2.1 — ESCALATED → ASSIGNED
     */
    it("should create a lease and transition task from ESCALATED to ASSIGNED with operator actor", () => {
      setup({
        tasks: [{ id: "task-1", status: TS.ESCALATED, version: 5, currentLeaseId: null }],
      });

      const result = service.acquireLease(defaultParams({ actor: OPERATOR_ACTOR }));

      expect(result.lease.status).toBe(WLS.LEASED);
      expect(result.task.status).toBe(TS.ASSIGNED);
      expect(result.task.version).toBe(6);
    });

    /**
     * Validates that ESCALATED → ASSIGNED requires operator authority.
     * A system/scheduler actor cannot resolve escalations — only operators can.
     * This enforces the human-in-the-loop requirement for escalation resolution.
     */
    it("should reject ESCALATED → ASSIGNED when actor is not an operator", () => {
      setup({
        tasks: [{ id: "task-1", status: TS.ESCALATED, version: 5, currentLeaseId: null }],
      });

      expect(() => service.acquireLease(defaultParams({ actor: DEFAULT_ACTOR }))).toThrow(
        InvalidTransitionError,
      );
    });
  });

  // ── Audit Events ────────────────────────────────────────────────────────

  describe("audit trail", () => {
    /**
     * Validates that the audit event captures both old and new state as valid
     * JSON. This is critical for the audit log's ability to reconstruct the
     * history of state changes.
     */
    it("should produce valid JSON in audit event state fields", () => {
      setup({
        tasks: [{ id: "task-1", status: TS.READY, version: 1, currentLeaseId: null }],
      });

      const result = service.acquireLease(defaultParams());

      const oldState = JSON.parse(result.auditEvent.oldState!) as Record<string, unknown>;
      const newState = JSON.parse(result.auditEvent.newState!) as Record<string, unknown>;

      expect(oldState).toEqual({
        status: TS.READY,
        version: 1,
        currentLeaseId: null,
      });
      expect(newState).toEqual({
        status: TS.ASSIGNED,
        version: 2,
        currentLeaseId: "lease-1",
      });
    });

    /**
     * Validates that caller-provided metadata is persisted in the audit event.
     * This supports operator traceability (e.g., "reason for re-assignment").
     */
    it("should include metadata in the audit event when provided", () => {
      setup({
        tasks: [{ id: "task-1", status: TS.READY, version: 1, currentLeaseId: null }],
      });

      const result = service.acquireLease(
        defaultParams({ metadata: { reason: "high priority rework" } }),
      );

      const meta = JSON.parse(result.auditEvent.metadata!) as Record<string, unknown>;
      expect(meta).toEqual({ reason: "high priority rework" });
    });

    /**
     * Validates that metadata is null when not provided, keeping the audit
     * event compact for the common case.
     */
    it("should set metadata to null when not provided", () => {
      setup({
        tasks: [{ id: "task-1", status: TS.READY, version: 1, currentLeaseId: null }],
      });

      const result = service.acquireLease(defaultParams());
      expect(result.auditEvent.metadata).toBeNull();
    });
  });

  // ── Domain Events ─────────────────────────────────────────────────────

  describe("domain events", () => {
    /**
     * Validates that two domain events are emitted after a successful lease
     * acquisition: one for the task transition and one for the lease creation.
     * Downstream subscribers (scheduler, notifications) rely on these events.
     */
    it("should emit task.transitioned and task-lease.transitioned events", () => {
      setup({
        tasks: [{ id: "task-1", status: TS.READY, version: 1, currentLeaseId: null }],
      });

      service.acquireLease(defaultParams());

      expect(emittedEvents).toHaveLength(2);

      const taskEvent = emittedEvents[0]!;
      expect(taskEvent.type).toBe("task.transitioned");
      expect(taskEvent.entityType).toBe("task");
      expect(taskEvent.entityId).toBe("task-1");
      if (taskEvent.type === "task.transitioned") {
        expect(taskEvent.fromStatus).toBe(TS.READY);
        expect(taskEvent.toStatus).toBe(TS.ASSIGNED);
        expect(taskEvent.newVersion).toBe(2);
      }

      const leaseEvent = emittedEvents[1]!;
      expect(leaseEvent.type).toBe("task-lease.transitioned");
      expect(leaseEvent.entityType).toBe("task-lease");
      expect(leaseEvent.entityId).toBe("lease-1");
      if (leaseEvent.type === "task-lease.transitioned") {
        expect(leaseEvent.fromStatus).toBe(WLS.IDLE);
        expect(leaseEvent.toStatus).toBe(WLS.LEASED);
      }
    });

    /**
     * Validates that the actor information is correctly propagated to domain
     * events, ensuring audit traceability through the event system.
     */
    it("should include actor information in emitted events", () => {
      setup({
        tasks: [{ id: "task-1", status: TS.READY, version: 1, currentLeaseId: null }],
      });

      service.acquireLease(defaultParams());

      for (const event of emittedEvents) {
        expect(event.actor).toEqual(DEFAULT_ACTOR);
      }
    });

    /**
     * Validates that domain events are emitted AFTER the transaction commits.
     * If event emission throws, the state is already persisted in the DB.
     * This prevents the scenario where an event signals a change that was
     * rolled back.
     */
    it("should complete lease acquisition even if event emission throws", () => {
      const throwingEmitter: DomainEventEmitter = {
        emit: () => {
          throw new Error("Event bus down");
        },
      };

      taskRepo = createMockTaskRepo([
        { id: "task-1", status: TS.READY, version: 1, currentLeaseId: null },
      ]);
      leaseRepo = createMockLeaseRepo();
      auditRepo = createMockAuditRepo();

      const unitOfWork: LeaseUnitOfWork = {
        runInTransaction<T>(fn: (repos: LeaseTransactionRepositories) => T): T {
          return fn({ task: taskRepo, lease: leaseRepo, auditEvent: auditRepo });
        },
      };

      let counter = 0;
      const svc = createLeaseService(unitOfWork, throwingEmitter, () => {
        counter++;
        return `lease-${String(counter)}`;
      });

      // The service will throw because the emitter throws, but state IS persisted
      expect(() => svc.acquireLease(defaultParams())).toThrow("Event bus down");

      // Verify: the task WAS updated in the repository (transaction committed)
      expect(taskRepo.tasks[0]!.status).toBe(TS.ASSIGNED);
      expect(taskRepo.tasks[0]!.currentLeaseId).toBe("lease-1");
      expect(leaseRepo.leases).toHaveLength(1);
      expect(auditRepo.events).toHaveLength(1);
    });
  });

  // ── Error Cases ───────────────────────────────────────────────────────

  describe("error — task not found", () => {
    /**
     * Validates that referencing a non-existent task throws EntityNotFoundError.
     * This catches stale references and race conditions where a task was
     * deleted between scheduling and lease acquisition.
     */
    it("should throw EntityNotFoundError when task does not exist", () => {
      setup({ tasks: [] });

      expect(() => service.acquireLease(defaultParams())).toThrow(EntityNotFoundError);
      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe("error — task not in lease-eligible state", () => {
    /**
     * Validates that tasks in non-eligible states are rejected. Each state
     * is tested to ensure comprehensive coverage of the guard logic.
     * Only READY, CHANGES_REQUESTED, and ESCALATED are lease-eligible.
     */
    const nonEligibleStatuses: TaskStatus[] = [
      TS.BACKLOG,
      TS.BLOCKED,
      TS.ASSIGNED,
      TS.IN_DEVELOPMENT,
      TS.DEV_COMPLETE,
      TS.IN_REVIEW,
      TS.APPROVED,
      TS.QUEUED_FOR_MERGE,
      TS.MERGING,
      TS.POST_MERGE_VALIDATION,
      TS.DONE,
      TS.FAILED,
      TS.CANCELLED,
    ];

    for (const status of nonEligibleStatuses) {
      it(`should throw TaskNotReadyForLeaseError when task is in ${status}`, () => {
        setup({
          tasks: [{ id: "task-1", status, version: 1, currentLeaseId: null }],
        });

        expect(() => service.acquireLease(defaultParams())).toThrow(TaskNotReadyForLeaseError);
        expect(emittedEvents).toHaveLength(0);
      });
    }

    /**
     * Validates that the error includes the task ID and current status for
     * diagnostic purposes. Operators need this info to understand why
     * scheduling failed.
     */
    it("should include task ID and status in TaskNotReadyForLeaseError", () => {
      setup({
        tasks: [{ id: "task-1", status: TS.IN_DEVELOPMENT, version: 1, currentLeaseId: null }],
      });

      try {
        service.acquireLease(defaultParams());
        expect.fail("Expected TaskNotReadyForLeaseError");
      } catch (error) {
        expect(error).toBeInstanceOf(TaskNotReadyForLeaseError);
        const e = error as TaskNotReadyForLeaseError;
        expect(e.taskId).toBe("task-1");
        expect(e.currentStatus).toBe(TS.IN_DEVELOPMENT);
      }
    });
  });

  describe("error — exclusivity violation", () => {
    /**
     * Validates the critical one-active-lease-per-task invariant.
     * If an active lease exists (in any non-terminal status), a new lease
     * cannot be acquired. This prevents double-assignment of workers.
     *
     * @see docs/prd/002-data-model.md §2.1 — "only one active development lease per task"
     */
    it("should throw ExclusivityViolationError when an active lease exists", () => {
      setup({
        tasks: [{ id: "task-1", status: TS.READY, version: 1, currentLeaseId: null }],
        activeLeases: [{ leaseId: "existing-lease", taskId: "task-1", status: WLS.RUNNING }],
      });

      expect(() => service.acquireLease(defaultParams())).toThrow(ExclusivityViolationError);
      expect(emittedEvents).toHaveLength(0);
    });

    /**
     * Validates that the error includes both the task ID and the conflicting
     * lease ID for diagnostic purposes.
     */
    it("should include task ID and existing lease ID in ExclusivityViolationError", () => {
      setup({
        tasks: [{ id: "task-1", status: TS.READY, version: 1, currentLeaseId: null }],
        activeLeases: [{ leaseId: "existing-lease", taskId: "task-1", status: WLS.LEASED }],
      });

      try {
        service.acquireLease(defaultParams());
        expect.fail("Expected ExclusivityViolationError");
      } catch (error) {
        expect(error).toBeInstanceOf(ExclusivityViolationError);
        const e = error as ExclusivityViolationError;
        expect(e.taskId).toBe("task-1");
        expect(e.existingLeaseId).toBe("existing-lease");
      }
    });

    /**
     * Validates exclusivity enforcement across all active lease statuses.
     * Per the task spec: active lease = LEASED, STARTING, RUNNING,
     * HEARTBEATING, COMPLETING.
     */
    const activeStatuses: WorkerLeaseStatus[] = [
      WLS.LEASED,
      WLS.STARTING,
      WLS.RUNNING,
      WLS.HEARTBEATING,
      WLS.COMPLETING,
    ];

    for (const leaseStatus of activeStatuses) {
      it(`should reject when existing lease is in ${leaseStatus} status`, () => {
        setup({
          tasks: [{ id: "task-1", status: TS.READY, version: 1, currentLeaseId: null }],
          activeLeases: [{ leaseId: "existing-lease", taskId: "task-1", status: leaseStatus }],
        });

        expect(() => service.acquireLease(defaultParams())).toThrow(ExclusivityViolationError);
      });
    }
  });

  describe("error — version conflict", () => {
    /**
     * Validates that optimistic concurrency is enforced. If another process
     * modified the task between our read and write, the update must fail
     * with VersionConflictError. The caller should retry with fresh data.
     */
    it("should propagate VersionConflictError on stale version", () => {
      const tasks: LeaseAcquisitionTask[] = [
        { id: "task-1", status: TS.READY, version: 1, currentLeaseId: null },
      ];

      const tRepo = createMockTaskRepo(tasks);
      const lRepo = createMockLeaseRepo();
      const aRepo = createMockAuditRepo();

      // Custom UnitOfWork that bumps the task version after findById
      // but before updateStatusAndLeaseId, simulating a concurrent writer
      let intercepted = false;
      const racyUnitOfWork: LeaseUnitOfWork = {
        runInTransaction<T>(fn: (repos: LeaseTransactionRepositories) => T): T {
          const interceptedTaskRepo: LeaseTaskRepositoryPort = {
            findById(id: string) {
              const result = tRepo.findById(id);
              if (!intercepted && result) {
                intercepted = true;
                tRepo.tasks[0] = { ...tRepo.tasks[0]!, version: 99 };
              }
              return result;
            },
            updateStatusAndLeaseId: tRepo.updateStatusAndLeaseId.bind(tRepo),
          };

          return fn({
            task: interceptedTaskRepo,
            lease: lRepo,
            auditEvent: aRepo,
          });
        },
      };

      let counter = 0;
      const svc = createLeaseService(racyUnitOfWork, eventEmitter, () => {
        counter++;
        return `lease-${String(counter)}`;
      });

      expect(() => svc.acquireLease(defaultParams())).toThrow(VersionConflictError);
      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe("error — no side effects on failure", () => {
    /**
     * Validates that failed lease acquisitions leave no side effects:
     * no leases created, no audit events, no domain events emitted.
     * This is critical for maintaining consistency.
     */
    it("should not create a lease when task is not found", () => {
      setup({ tasks: [] });

      try {
        service.acquireLease(defaultParams());
      } catch {
        // expected
      }

      expect(leaseRepo.leases).toHaveLength(0);
      expect(auditRepo.events).toHaveLength(0);
      expect(emittedEvents).toHaveLength(0);
    });

    /**
     * Validates that exclusivity check happens BEFORE lease creation.
     * No lease row should be written if exclusivity fails.
     */
    it("should not create a lease when exclusivity check fails", () => {
      setup({
        tasks: [{ id: "task-1", status: TS.READY, version: 1, currentLeaseId: null }],
        activeLeases: [{ leaseId: "existing-lease", taskId: "task-1", status: WLS.RUNNING }],
      });

      try {
        service.acquireLease(defaultParams());
      } catch {
        // expected
      }

      expect(leaseRepo.leases).toHaveLength(0);
      expect(auditRepo.events).toHaveLength(0);
    });
  });

  // ── Concurrent Acquisition ────────────────────────────────────────────

  describe("concurrent lease acquisition", () => {
    /**
     * Validates that when two workers attempt to acquire a lease on the same
     * task simultaneously, exactly one succeeds and the other gets a
     * VersionConflictError. This is the primary safety property of the lease
     * system — it prevents double-assignment.
     *
     * In production, this is enforced by the DB transaction (BEGIN IMMEDIATE).
     * In this test, we simulate it by sharing a mock repo and expecting the
     * version check to reject the second acquisition.
     */
    it("should allow exactly one of two concurrent acquisitions to succeed", () => {
      setup({
        tasks: [{ id: "task-1", status: TS.READY, version: 1, currentLeaseId: null }],
      });

      // First acquisition succeeds
      const result1 = service.acquireLease(defaultParams({ workerId: "worker-1" }));
      expect(result1.lease.workerId).toBe("worker-1");
      expect(result1.task.status).toBe(TS.ASSIGNED);

      // Second acquisition fails — task is now ASSIGNED (not READY)
      expect(() => service.acquireLease(defaultParams({ workerId: "worker-2" }))).toThrow(
        TaskNotReadyForLeaseError,
      );
    });

    /**
     * Validates the scenario where the version changes between read and write
     * due to a concurrent modification. The mock simulates this by mutating
     * the version inside a custom UnitOfWork that intercepts the transaction.
     */
    it("should fail with VersionConflictError when a concurrent update changes the version", () => {
      const tasks: LeaseAcquisitionTask[] = [
        { id: "task-1", status: TS.READY, version: 1, currentLeaseId: null },
      ];

      const tRepo = createMockTaskRepo(tasks);
      const lRepo = createMockLeaseRepo();
      const aRepo = createMockAuditRepo();

      // Custom UnitOfWork that simulates a concurrent version bump
      // between findById and updateStatusAndLeaseId
      let intercepted = false;
      const racyUnitOfWork: LeaseUnitOfWork = {
        runInTransaction<T>(fn: (repos: LeaseTransactionRepositories) => T): T {
          const interceptedTaskRepo: LeaseTaskRepositoryPort = {
            findById(id: string) {
              const result = tRepo.findById(id);
              // After the read, simulate a concurrent writer bumping the version
              if (!intercepted && result) {
                intercepted = true;
                tRepo.tasks[0] = { ...tRepo.tasks[0]!, version: 99 };
              }
              return result;
            },
            updateStatusAndLeaseId: tRepo.updateStatusAndLeaseId.bind(tRepo),
          };

          return fn({
            task: interceptedTaskRepo,
            lease: lRepo,
            auditEvent: aRepo,
          });
        },
      };

      let counter = 0;
      const svc = createLeaseService(racyUnitOfWork, eventEmitter, () => {
        counter++;
        return `lease-${String(counter)}`;
      });

      expect(() => svc.acquireLease(defaultParams())).toThrow(VersionConflictError);
      expect(emittedEvents).toHaveLength(0);
    });
  });

  // ── Transaction Atomicity ─────────────────────────────────────────────

  describe("transaction atomicity", () => {
    /**
     * Validates that if audit event creation fails, the entire transaction
     * is rolled back. This tests the "all or nothing" property — we should
     * never have a lease created without an audit event.
     */
    it("should rollback everything if audit event creation fails", () => {
      const tasks: LeaseAcquisitionTask[] = [
        { id: "task-1", status: TS.READY, version: 1, currentLeaseId: null },
      ];

      const tRepo = createMockTaskRepo(tasks);
      const lRepo = createMockLeaseRepo();

      // Audit repo that always fails
      const failingAuditRepo: AuditEventRepositoryPort = {
        create(): AuditEventRecord {
          throw new Error("Audit storage unavailable");
        },
      };

      // UnitOfWork that actually rolls back on failure
      const rollbackUnitOfWork: LeaseUnitOfWork = {
        runInTransaction<T>(fn: (repos: LeaseTransactionRepositories) => T): T {
          // Snapshot state for rollback
          const taskSnapshot = [...tRepo.tasks];

          try {
            return fn({
              task: tRepo,
              lease: lRepo,
              auditEvent: failingAuditRepo,
            });
          } catch (error) {
            // Rollback: restore task state
            tRepo.tasks.length = 0;
            tRepo.tasks.push(...taskSnapshot);
            throw error;
          }
        },
      };

      let counter = 0;
      const svc = createLeaseService(rollbackUnitOfWork, eventEmitter, () => {
        counter++;
        return `lease-${String(counter)}`;
      });

      expect(() => svc.acquireLease(defaultParams())).toThrow("Audit storage unavailable");

      // Verify: task state was rolled back
      expect(tRepo.tasks[0]!.status).toBe(TS.READY);
      expect(tRepo.tasks[0]!.version).toBe(1);
      expect(emittedEvents).toHaveLength(0);
    });
  });

  // ── Multiple Tasks Independence ───────────────────────────────────────

  describe("multiple tasks", () => {
    /**
     * Validates that leases on different tasks are independent. Acquiring
     * a lease on task-1 should not affect the ability to acquire a lease
     * on task-2. This confirms the exclusivity check is scoped to the task.
     */
    it("should allow leases on different tasks independently", () => {
      setup({
        tasks: [
          { id: "task-1", status: TS.READY, version: 1, currentLeaseId: null },
          { id: "task-2", status: TS.READY, version: 1, currentLeaseId: null },
        ],
      });

      const result1 = service.acquireLease(
        defaultParams({ taskId: "task-1", workerId: "worker-1" }),
      );
      const result2 = service.acquireLease(
        defaultParams({ taskId: "task-2", workerId: "worker-2" }),
      );

      expect(result1.lease.taskId).toBe("task-1");
      expect(result2.lease.taskId).toBe("task-2");
      expect(result1.task.status).toBe(TS.ASSIGNED);
      expect(result2.task.status).toBe(TS.ASSIGNED);
    });
  });
});
