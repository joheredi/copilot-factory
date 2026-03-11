/**
 * Tests for the lease reclaim service.
 *
 * These tests validate the lease reclaim protocol — the recovery path when a
 * worker becomes stale or crashes. The reclaim service must correctly:
 *
 * 1. Transition the lease from an active state to TIMED_OUT or CRASHED
 * 2. Evaluate retry eligibility and transition the task accordingly
 * 3. Apply escalation policy when retries are exhausted
 * 4. Record audit events with full decision context
 * 5. Emit domain events after commit
 * 6. Handle race conditions gracefully
 *
 * Each test documents WHY it is important for correctness or safety.
 *
 * @see docs/prd/002-data-model.md §2.8 — Worker Lease Protocol (Crash Recovery)
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.6 — Retry Policy
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.7 — Escalation Policy
 * @module @factory/application/services/lease-reclaim.service.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  TaskStatus,
  WorkerLeaseStatus,
  type RetryPolicy,
  type EscalationPolicy,
  DEFAULT_ESCALATION_POLICY,
  BackoffStrategy,
} from "@factory/domain";

import {
  createLeaseReclaimService,
  type LeaseReclaimService,
  type ReclaimLeaseParams,
} from "./lease-reclaim.service.js";

import type {
  ReclaimableLease,
  ReclaimableTask,
  ReclaimLeaseRepositoryPort,
  ReclaimTaskRepositoryPort,
  ReclaimTransactionRepositories,
  ReclaimUnitOfWork,
} from "../ports/lease-reclaim.ports.js";

import type { AuditEventRecord, NewAuditEvent } from "../ports/repository.ports.js";
import type { AuditEventRepositoryPort } from "../ports/repository.ports.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type { DomainEvent, ActorInfo } from "../events/domain-events.js";

import { EntityNotFoundError, LeaseNotReclaimableError, VersionConflictError } from "../errors.js";

// ─── Mock Factories ─────────────────────────────────────────────────────────

/**
 * Creates an in-memory mock lease repository for reclaim operations.
 * Exposes the leases array for assertions.
 */
function createMockLeaseRepo(
  initialLeases: ReclaimableLease[],
): ReclaimLeaseRepositoryPort & { leases: ReclaimableLease[] } {
  const leases = [...initialLeases];

  return {
    leases,

    findById(leaseId: string): ReclaimableLease | undefined {
      return leases.find((l) => l.leaseId === leaseId);
    },

    updateStatusWithReason(
      leaseId: string,
      expectedStatus: WorkerLeaseStatus,
      newStatus: WorkerLeaseStatus,
      reclaimReason: string,
    ): ReclaimableLease {
      const idx = leases.findIndex((l) => l.leaseId === leaseId);
      if (idx === -1) {
        throw new EntityNotFoundError("TaskLease", leaseId);
      }

      const current = leases[idx]!;
      if (current.status !== expectedStatus) {
        throw new VersionConflictError("TaskLease", leaseId, expectedStatus);
      }

      const updated: ReclaimableLease = {
        ...current,
        status: newStatus,
        reclaimReason,
      };
      leases[idx] = updated;
      return updated;
    },
  };
}

/**
 * Creates an in-memory mock task repository for reclaim operations.
 * Exposes the tasks array for assertions.
 */
function createMockTaskRepo(
  initialTasks: ReclaimableTask[],
): ReclaimTaskRepositoryPort & { tasks: ReclaimableTask[] } {
  const tasks = [...initialTasks];

  return {
    tasks,

    findById(id: string): ReclaimableTask | undefined {
      return tasks.find((t) => t.id === id);
    },

    updateStatusAndRetryCount(
      id: string,
      expectedVersion: number,
      newStatus: TaskStatus,
      retryCount: number,
    ): ReclaimableTask {
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx === -1) {
        throw new EntityNotFoundError("Task", id);
      }

      const current = tasks[idx]!;
      if (current.version !== expectedVersion) {
        throw new VersionConflictError("Task", id, expectedVersion);
      }

      const updated: ReclaimableTask = {
        ...current,
        status: newStatus,
        version: current.version + 1,
        retryCount,
        currentLeaseId: null,
      };
      tasks[idx] = updated;
      return updated;
    },
  };
}

/**
 * Creates an in-memory mock audit event repository.
 * Exposes the events array for assertions.
 */
function createMockAuditRepo(): AuditEventRepositoryPort & { events: AuditEventRecord[] } {
  const events: AuditEventRecord[] = [];
  let nextId = 1;

  return {
    events,

    create(event: NewAuditEvent): AuditEventRecord {
      const record: AuditEventRecord = {
        id: `audit-${nextId++}`,
        ...event,
        createdAt: new Date(),
      };
      events.push(record);
      return record;
    },
  };
}

/**
 * Creates a mock unit of work that runs the function synchronously.
 */
function createMockUnitOfWork(
  leaseRepo: ReclaimLeaseRepositoryPort,
  taskRepo: ReclaimTaskRepositoryPort,
  auditRepo: AuditEventRepositoryPort,
): ReclaimUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: ReclaimTransactionRepositories) => T): T {
      return fn({
        lease: leaseRepo,
        task: taskRepo,
        auditEvent: auditRepo,
      });
    },
  };
}

/**
 * Creates a mock event emitter that captures emitted events.
 */
function createMockEventEmitter(): DomainEventEmitter & { events: DomainEvent[] } {
  const events: DomainEvent[] = [];
  return {
    events,
    emit(event: DomainEvent): void {
      events.push(event);
    },
  };
}

// ─── Test Fixtures ──────────────────────────────────────────────────────────

const DEFAULT_ACTOR: ActorInfo = { type: "system", id: "reclaim-loop" };

function createDefaultLease(overrides?: Partial<ReclaimableLease>): ReclaimableLease {
  return {
    leaseId: "lease-1",
    taskId: "task-1",
    workerId: "worker-1",
    poolId: "pool-1",
    status: WorkerLeaseStatus.HEARTBEATING,
    reclaimReason: null,
    ...overrides,
  };
}

function createDefaultTask(overrides?: Partial<ReclaimableTask>): ReclaimableTask {
  return {
    id: "task-1",
    status: TaskStatus.IN_DEVELOPMENT,
    version: 3,
    retryCount: 0,
    currentLeaseId: "lease-1",
    ...overrides,
  };
}

function createRetryablePolicy(): RetryPolicy {
  return {
    max_attempts: 2,
    backoff_strategy: BackoffStrategy.EXPONENTIAL,
    initial_backoff_seconds: 60,
    max_backoff_seconds: 900,
    reuse_same_pool: true,
    allow_pool_change_after_failure: true,
    require_failure_summary_packet: false,
  };
}

function createExhaustedRetryPolicy(): RetryPolicy {
  return {
    max_attempts: 0,
    backoff_strategy: BackoffStrategy.EXPONENTIAL,
    initial_backoff_seconds: 60,
    max_backoff_seconds: 900,
    reuse_same_pool: true,
    allow_pool_change_after_failure: true,
    require_failure_summary_packet: false,
  };
}

function defaultParams(overrides?: Partial<ReclaimLeaseParams>): ReclaimLeaseParams {
  return {
    leaseId: "lease-1",
    reason: "missed_heartbeats",
    retryPolicy: createRetryablePolicy(),
    escalationPolicy: {
      ...DEFAULT_ESCALATION_POLICY,
      triggers: { ...DEFAULT_ESCALATION_POLICY.triggers },
    },
    actor: DEFAULT_ACTOR,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("LeaseReclaimService", () => {
  let leaseRepo: ReturnType<typeof createMockLeaseRepo>;
  let taskRepo: ReturnType<typeof createMockTaskRepo>;
  let auditRepo: ReturnType<typeof createMockAuditRepo>;
  let eventEmitter: ReturnType<typeof createMockEventEmitter>;
  let service: LeaseReclaimService;

  beforeEach(() => {
    leaseRepo = createMockLeaseRepo([createDefaultLease()]);
    taskRepo = createMockTaskRepo([createDefaultTask()]);
    auditRepo = createMockAuditRepo();
    eventEmitter = createMockEventEmitter();

    const uow = createMockUnitOfWork(leaseRepo, taskRepo, auditRepo);
    service = createLeaseReclaimService(uow, eventEmitter);
  });

  // ─── Happy Path: Retry Eligible ─────────────────────────────────────────

  describe("retry-eligible reclaim (task returns to READY)", () => {
    /**
     * This is the most common reclaim scenario: a worker missed heartbeats
     * but the task has retries remaining. The task should return to READY
     * for rescheduling, preserving the retry_count increment.
     *
     * Why important: This is the primary recovery mechanism for transient
     * worker failures. Without it, every timeout would be permanent.
     */
    it("should transition lease to TIMED_OUT and task to READY on heartbeat miss with retries available", () => {
      const result = service.reclaimLease(defaultParams());

      expect(result.outcome).toBe("retried");
      expect(result.lease.status).toBe(WorkerLeaseStatus.TIMED_OUT);
      expect(result.task.status).toBe(TaskStatus.READY);
      expect(result.task.retryCount).toBe(1);
      expect(result.retryEvaluation.eligible).toBe(true);
      expect(result.escalationEvaluation).toBeNull();
    });

    /**
     * When a worker crashes (non-zero exit), the lease should go to CRASHED
     * rather than TIMED_OUT. The retry logic should still work the same way.
     *
     * Why important: CRASHED vs TIMED_OUT distinction affects downstream
     * diagnostics and may inform different retry strategies in the future.
     */
    it("should transition lease to CRASHED on worker crash with retries available", () => {
      const result = service.reclaimLease(defaultParams({ reason: "worker_crashed" }));

      expect(result.outcome).toBe("retried");
      expect(result.lease.status).toBe(WorkerLeaseStatus.CRASHED);
      expect(result.task.status).toBe(TaskStatus.READY);
      expect(result.task.retryCount).toBe(1);
    });

    /**
     * TTL expiry is a distinct reason from heartbeat miss — it means the
     * lease's absolute time limit was exceeded. The lease should go to
     * TIMED_OUT (not CRASHED).
     *
     * Why important: TTL is a hard upper bound that fires even if heartbeats
     * continue, preventing any single task from running forever.
     */
    it("should handle TTL expiry with retry", () => {
      const result = service.reclaimLease(defaultParams({ reason: "ttl_expired" }));

      expect(result.outcome).toBe("retried");
      expect(result.lease.status).toBe(WorkerLeaseStatus.TIMED_OUT);
      expect(result.lease.reclaimReason).toBe("ttl_expired");
    });

    /**
     * When the task is still in ASSIGNED state (worker never sent first
     * heartbeat), the reclaim should still work. This happens when a worker
     * is spawned but fails to start up.
     *
     * Why important: Workers can fail during startup before ever reaching
     * IN_DEVELOPMENT. The reclaim must handle this gracefully.
     */
    it("should handle reclaim when task is in ASSIGNED state", () => {
      taskRepo = createMockTaskRepo([createDefaultTask({ status: TaskStatus.ASSIGNED })]);
      const uow = createMockUnitOfWork(leaseRepo, taskRepo, auditRepo);
      service = createLeaseReclaimService(uow, eventEmitter);

      const result = service.reclaimLease(defaultParams());

      expect(result.outcome).toBe("retried");
      expect(result.task.status).toBe(TaskStatus.READY);
      expect(result.task.retryCount).toBe(1);
    });

    /**
     * When retry_count is 1 and max_attempts is 2, one more retry should
     * be allowed. This validates the boundary condition correctly.
     *
     * Why important: Off-by-one errors in retry counting could cause
     * premature escalation or infinite retries.
     */
    it("should allow retry when retry_count < max_attempts", () => {
      taskRepo = createMockTaskRepo([createDefaultTask({ retryCount: 1 })]);
      const uow = createMockUnitOfWork(leaseRepo, taskRepo, auditRepo);
      service = createLeaseReclaimService(uow, eventEmitter);

      const result = service.reclaimLease(defaultParams());

      expect(result.outcome).toBe("retried");
      expect(result.task.retryCount).toBe(2);
      expect(result.retryEvaluation.eligible).toBe(true);
    });

    /**
     * Reclaim should work from all active lease states, not just HEARTBEATING.
     * STARTING and RUNNING are also valid reclaim sources.
     *
     * Why important: A worker can timeout during any active phase — startup,
     * initial work, or ongoing heartbeat phase.
     */
    it("should reclaim from STARTING state", () => {
      leaseRepo = createMockLeaseRepo([createDefaultLease({ status: WorkerLeaseStatus.STARTING })]);
      const uow = createMockUnitOfWork(leaseRepo, taskRepo, auditRepo);
      service = createLeaseReclaimService(uow, eventEmitter);

      const result = service.reclaimLease(defaultParams());

      expect(result.outcome).toBe("retried");
      expect(result.lease.status).toBe(WorkerLeaseStatus.TIMED_OUT);
    });

    it("should reclaim from RUNNING state", () => {
      leaseRepo = createMockLeaseRepo([createDefaultLease({ status: WorkerLeaseStatus.RUNNING })]);
      const uow = createMockUnitOfWork(leaseRepo, taskRepo, auditRepo);
      service = createLeaseReclaimService(uow, eventEmitter);

      const result = service.reclaimLease(defaultParams());

      expect(result.outcome).toBe("retried");
      expect(result.lease.status).toBe(WorkerLeaseStatus.TIMED_OUT);
    });
  });

  // ─── Retry Exhausted: Escalation ──────────────────────────────────────

  describe("retry-exhausted reclaim (escalation policy applies)", () => {
    /**
     * When max_attempts is 0 and retry_count is 0, the first failure should
     * escalate immediately. The default escalation policy has heartbeat_timeout
     * mapped to "retry_or_escalate" — since retry failed, it should escalate.
     *
     * Why important: Tasks with no retry budget should never silently fail.
     * Escalation ensures an operator reviews the failure.
     */
    it("should escalate task when retries are exhausted and policy says escalate", () => {
      const result = service.reclaimLease(
        defaultParams({ retryPolicy: createExhaustedRetryPolicy() }),
      );

      expect(result.outcome).toBe("escalated");
      expect(result.lease.status).toBe(WorkerLeaseStatus.TIMED_OUT);
      expect(result.task.status).toBe(TaskStatus.ESCALATED);
      expect(result.retryEvaluation.eligible).toBe(false);
      expect(result.escalationEvaluation).not.toBeNull();
      expect(result.escalationEvaluation!.should_escalate).toBe(true);
    });

    /**
     * When escalation policy says "fail_and_escalate", the task should
     * move to FAILED (not ESCALATED). This is a two-step process where
     * the task fails first and escalation is a follow-up action.
     *
     * Why important: Some policies prefer to mark the task as FAILED first
     * for accurate status reporting, then handle escalation separately.
     */
    it("should fail task when escalation policy says fail_then_escalate", () => {
      const escalationPolicy: EscalationPolicy = {
        ...DEFAULT_ESCALATION_POLICY,
        triggers: {
          ...DEFAULT_ESCALATION_POLICY.triggers,
          heartbeat_timeout:
            "fail_then_escalate" as EscalationPolicy["triggers"]["heartbeat_timeout"],
        },
      };

      const result = service.reclaimLease(
        defaultParams({
          retryPolicy: createExhaustedRetryPolicy(),
          escalationPolicy,
        }),
      );

      expect(result.outcome).toBe("failed");
      expect(result.task.status).toBe(TaskStatus.FAILED);
      expect(result.escalationEvaluation!.action).toBe("fail_then_escalate");
    });

    /**
     * When retries are exhausted and retry_count has been incremented by
     * previous attempts, the retry count should NOT be further incremented
     * (only retries increment it).
     *
     * Why important: Correct retry_count tracking is essential for accurate
     * retry budget accounting and audit trail.
     */
    it("should not increment retry_count when task is escalated", () => {
      taskRepo = createMockTaskRepo([createDefaultTask({ retryCount: 2 })]);
      const uow = createMockUnitOfWork(leaseRepo, taskRepo, auditRepo);
      service = createLeaseReclaimService(uow, eventEmitter);

      const result = service.reclaimLease(
        defaultParams({ retryPolicy: createExhaustedRetryPolicy() }),
      );

      expect(result.task.retryCount).toBe(2); // unchanged
    });

    /**
     * When the retry policy requires a failure summary packet but none exists,
     * the retry should be denied even if retry_count < max_attempts.
     *
     * Why important: Failure summary provides context for the next attempt.
     * Without it, the retry may repeat the same failure.
     */
    it("should deny retry when failure summary is required but missing", () => {
      const retryPolicy: RetryPolicy = {
        ...createRetryablePolicy(),
        require_failure_summary_packet: true,
      };

      const result = service.reclaimLease(
        defaultParams({
          retryPolicy,
          hasFailureSummary: false,
        }),
      );

      // Retry denied, so escalation applies
      expect(result.outcome).toBe("escalated");
      expect(result.retryEvaluation.eligible).toBe(false);
      expect(result.retryEvaluation.reason).toContain("Failure summary packet");
    });

    /**
     * When the retry policy requires a failure summary and one exists,
     * the retry should proceed normally.
     *
     * Why important: Validates that the failure summary check doesn't
     * accidentally block retries when the summary IS present.
     */
    it("should allow retry when failure summary is required and present", () => {
      const retryPolicy: RetryPolicy = {
        ...createRetryablePolicy(),
        require_failure_summary_packet: true,
      };

      const result = service.reclaimLease(
        defaultParams({
          retryPolicy,
          hasFailureSummary: true,
        }),
      );

      expect(result.outcome).toBe("retried");
      expect(result.task.status).toBe(TaskStatus.READY);
    });
  });

  // ─── Audit Trail ──────────────────────────────────────────────────────

  describe("audit event recording", () => {
    /**
     * Every reclaim must produce an audit event capturing the full decision
     * context: what was reclaimed, why, and what happened to the task.
     *
     * Why important: The audit trail is the only reliable record of why a
     * task was retried or escalated. Operators need this for debugging.
     */
    it("should record audit event with full reclaim context", () => {
      service.reclaimLease(defaultParams({ metadata: { source: "staleness-sweep" } }));

      expect(auditRepo.events).toHaveLength(1);
      const audit = auditRepo.events[0]!;
      expect(audit.entityType).toBe("task-lease");
      expect(audit.entityId).toBe("lease-1");
      expect(audit.eventType).toBe("lease.reclaimed");
      expect(audit.actorType).toBe("system");
      expect(audit.actorId).toBe("reclaim-loop");

      const oldState = JSON.parse(audit.oldState!);
      expect(oldState.leaseStatus).toBe(WorkerLeaseStatus.HEARTBEATING);
      expect(oldState.taskStatus).toBe(TaskStatus.IN_DEVELOPMENT);

      const newState = JSON.parse(audit.newState!);
      expect(newState.leaseStatus).toBe(WorkerLeaseStatus.TIMED_OUT);
      expect(newState.taskStatus).toBe(TaskStatus.READY);
      expect(newState.outcome).toBe("retried");
      expect(newState.retryEligible).toBe(true);

      expect(audit.metadata).toBe(JSON.stringify({ source: "staleness-sweep" }));
    });

    /**
     * Escalation decisions should also be captured in the audit event's
     * newState, including the escalation action taken.
     *
     * Why important: When an operator reviews an escalated task, they need
     * to see why it was escalated (which trigger, what action).
     */
    it("should record escalation action in audit event", () => {
      service.reclaimLease(defaultParams({ retryPolicy: createExhaustedRetryPolicy() }));

      const newState = JSON.parse(auditRepo.events[0]!.newState!);
      expect(newState.outcome).toBe("escalated");
      expect(newState.retryEligible).toBe(false);
      expect(newState.escalationAction).toBe("retry_or_escalate");
    });
  });

  // ─── Domain Events ────────────────────────────────────────────────────

  describe("domain event emission", () => {
    /**
     * Two domain events should be emitted after a successful reclaim:
     * one for the lease transition and one for the task transition.
     * These drive downstream reactions (scheduler, notifications, metrics).
     *
     * Why important: The scheduler needs the task.transitioned event to
     * know a task is back in READY for rescheduling.
     */
    it("should emit lease and task transition events after commit", () => {
      service.reclaimLease(defaultParams());

      expect(eventEmitter.events).toHaveLength(2);

      const leaseEvent = eventEmitter.events[0]!;
      expect(leaseEvent.type).toBe("task-lease.transitioned");
      expect(leaseEvent.entityId).toBe("lease-1");

      const taskEvent = eventEmitter.events[1]!;
      expect(taskEvent.type).toBe("task.transitioned");
      expect(taskEvent.entityId).toBe("task-1");
    });

    /**
     * Domain events must contain correct from/to statuses for downstream
     * consumers to make routing decisions.
     *
     * Why important: Event consumers filter on status transitions. Wrong
     * values would cause incorrect downstream behavior.
     */
    it("should emit events with correct status transitions", () => {
      service.reclaimLease(defaultParams());

      const leaseEvent = eventEmitter.events[0]! as { fromStatus: string; toStatus: string };
      expect(leaseEvent.fromStatus).toBe(WorkerLeaseStatus.HEARTBEATING);
      expect(leaseEvent.toStatus).toBe(WorkerLeaseStatus.TIMED_OUT);

      const taskEvent = eventEmitter.events[1]! as { fromStatus: string; toStatus: string };
      expect(taskEvent.fromStatus).toBe(TaskStatus.IN_DEVELOPMENT);
      expect(taskEvent.toStatus).toBe(TaskStatus.READY);
    });
  });

  // ─── Error Cases ──────────────────────────────────────────────────────

  describe("error handling", () => {
    /**
     * Attempting to reclaim a non-existent lease should throw a clear error.
     *
     * Why important: Prevents silent failures when operating on stale lease IDs.
     */
    it("should throw EntityNotFoundError for non-existent lease", () => {
      expect(() => service.reclaimLease(defaultParams({ leaseId: "nonexistent" }))).toThrow(
        EntityNotFoundError,
      );
    });

    /**
     * Only active leases (STARTING, RUNNING, HEARTBEATING) can be reclaimed.
     * Attempting to reclaim a terminal or idle lease should be rejected.
     *
     * Why important: Prevents double-reclaim of already-processed leases
     * and ensures idempotency of the reclaim loop.
     */
    it("should throw LeaseNotReclaimableError for TIMED_OUT lease", () => {
      leaseRepo = createMockLeaseRepo([
        createDefaultLease({ status: WorkerLeaseStatus.TIMED_OUT }),
      ]);
      const uow = createMockUnitOfWork(leaseRepo, taskRepo, auditRepo);
      service = createLeaseReclaimService(uow, eventEmitter);

      expect(() => service.reclaimLease(defaultParams())).toThrow(LeaseNotReclaimableError);
    });

    it("should throw LeaseNotReclaimableError for IDLE lease", () => {
      leaseRepo = createMockLeaseRepo([createDefaultLease({ status: WorkerLeaseStatus.IDLE })]);
      const uow = createMockUnitOfWork(leaseRepo, taskRepo, auditRepo);
      service = createLeaseReclaimService(uow, eventEmitter);

      expect(() => service.reclaimLease(defaultParams())).toThrow(LeaseNotReclaimableError);
    });

    it("should throw LeaseNotReclaimableError for COMPLETING lease", () => {
      leaseRepo = createMockLeaseRepo([
        createDefaultLease({ status: WorkerLeaseStatus.COMPLETING }),
      ]);
      const uow = createMockUnitOfWork(leaseRepo, taskRepo, auditRepo);
      service = createLeaseReclaimService(uow, eventEmitter);

      expect(() => service.reclaimLease(defaultParams())).toThrow(LeaseNotReclaimableError);
    });

    it("should throw LeaseNotReclaimableError for RECLAIMED lease", () => {
      leaseRepo = createMockLeaseRepo([
        createDefaultLease({ status: WorkerLeaseStatus.RECLAIMED }),
      ]);
      const uow = createMockUnitOfWork(leaseRepo, taskRepo, auditRepo);
      service = createLeaseReclaimService(uow, eventEmitter);

      expect(() => service.reclaimLease(defaultParams())).toThrow(LeaseNotReclaimableError);
    });

    /**
     * If the task has already been transitioned by another process (race
     * condition with graceful completion), the reclaim should still succeed
     * for the lease but not re-transition the task.
     *
     * Why important: In a concurrent system, a result may arrive and be
     * accepted (transitioning the task) just before the reclaim fires.
     * The reclaim must handle this gracefully without throwing.
     */
    it("should handle task already transitioned by another process", () => {
      taskRepo = createMockTaskRepo([createDefaultTask({ status: TaskStatus.DEV_COMPLETE })]);
      const uow = createMockUnitOfWork(leaseRepo, taskRepo, auditRepo);
      service = createLeaseReclaimService(uow, eventEmitter);

      const result = service.reclaimLease(defaultParams());

      // Lease should still be reclaimed
      expect(result.lease.status).toBe(WorkerLeaseStatus.TIMED_OUT);
      // Task should not be modified
      expect(result.task.status).toBe(TaskStatus.DEV_COMPLETE);
      // Audit event should record the noop
      const newState = JSON.parse(result.auditEvent.newState!);
      expect(newState.outcome).toBe("noop_task_already_transitioned");
    });

    /**
     * If the task entity doesn't exist (data integrity issue), the reclaim
     * should throw EntityNotFoundError.
     *
     * Why important: Prevents silent data corruption when lease references
     * a deleted task.
     */
    it("should throw EntityNotFoundError when task does not exist", () => {
      taskRepo = createMockTaskRepo([]);
      const uow = createMockUnitOfWork(leaseRepo, taskRepo, auditRepo);
      service = createLeaseReclaimService(uow, eventEmitter);

      expect(() => service.reclaimLease(defaultParams())).toThrow(EntityNotFoundError);
    });

    /**
     * When no events should be emitted because the transaction rolled back,
     * the event emitter should have no events.
     *
     * Why important: Domain events must never be emitted for failed
     * transactions — they represent committed state changes.
     */
    it("should not emit events when lease not found", () => {
      expect(() => service.reclaimLease(defaultParams({ leaseId: "nonexistent" }))).toThrow(
        EntityNotFoundError,
      );

      expect(eventEmitter.events).toHaveLength(0);
    });
  });

  // ─── Concurrency Safety ───────────────────────────────────────────────

  describe("concurrency safety", () => {
    /**
     * If two reclaim processes try to reclaim the same lease simultaneously,
     * the second should fail with a VersionConflictError (status-based
     * optimistic concurrency).
     *
     * Why important: Prevents double-processing of a single lease reclaim,
     * which could incorrectly increment retry_count twice.
     */
    it("should prevent duplicate reclaim via status-based concurrency check", () => {
      // First reclaim succeeds
      service.reclaimLease(defaultParams());

      // Second reclaim should fail because lease is now TIMED_OUT
      leaseRepo = createMockLeaseRepo([
        createDefaultLease({ status: WorkerLeaseStatus.TIMED_OUT }),
      ]);
      const uow = createMockUnitOfWork(leaseRepo, taskRepo, auditRepo);
      service = createLeaseReclaimService(uow, eventEmitter);

      expect(() => service.reclaimLease(defaultParams())).toThrow(LeaseNotReclaimableError);
    });

    /**
     * If the task's version has been modified by another process between
     * the read and write, the reclaim should fail. This simulates a race
     * condition where another operation modifies the task concurrently.
     *
     * Why important: Prevents lost updates when concurrent operations
     * (e.g., graceful completion and reclaim) modify the same task.
     */
    it("should fail on task version conflict", () => {
      // Create a task repo that throws VersionConflictError on update
      // to simulate a concurrent modification between read and write
      const concurrentTaskRepo: ReclaimTaskRepositoryPort & { tasks: ReclaimableTask[] } = {
        tasks: [createDefaultTask()],
        findById(id: string): ReclaimableTask | undefined {
          return this.tasks.find((t) => t.id === id);
        },
        updateStatusAndRetryCount(
          id: string,
          _expectedVersion: number,
          _newStatus: TaskStatus,
          _retryCount: number,
        ): ReclaimableTask {
          // Simulate: another process incremented the version between our read and write
          throw new VersionConflictError("Task", id, _expectedVersion);
        },
      };

      const uow = createMockUnitOfWork(leaseRepo, concurrentTaskRepo, auditRepo);
      service = createLeaseReclaimService(uow, eventEmitter);

      expect(() => service.reclaimLease(defaultParams())).toThrow(VersionConflictError);
    });
  });

  // ─── Retry Count Boundary Conditions ──────────────────────────────────

  describe("retry count boundary conditions", () => {
    /**
     * When retry_count equals max_attempts, no more retries should be
     * allowed. This is the boundary condition.
     *
     * Why important: Validates the >= comparison in shouldRetry, ensuring
     * we don't allow one extra retry beyond the configured limit.
     */
    it("should escalate when retry_count equals max_attempts", () => {
      taskRepo = createMockTaskRepo([createDefaultTask({ retryCount: 2 })]);
      const uow = createMockUnitOfWork(leaseRepo, taskRepo, auditRepo);
      service = createLeaseReclaimService(uow, eventEmitter);

      const result = service.reclaimLease(defaultParams());

      expect(result.outcome).toBe("escalated");
      expect(result.retryEvaluation.eligible).toBe(false);
    });

    /**
     * When retry_count is one less than max_attempts, the last retry
     * should be permitted.
     *
     * Why important: Validates that the last available retry is not
     * accidentally skipped.
     */
    it("should allow the last available retry", () => {
      taskRepo = createMockTaskRepo([createDefaultTask({ retryCount: 1 })]);
      const uow = createMockUnitOfWork(leaseRepo, taskRepo, auditRepo);
      service = createLeaseReclaimService(uow, eventEmitter);

      const result = service.reclaimLease(defaultParams());

      expect(result.outcome).toBe("retried");
      expect(result.task.retryCount).toBe(2);
    });
  });
});
