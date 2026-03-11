/**
 * Lease acquisition service — enforces the one-active-lease-per-task invariant.
 *
 * Orchestrates the atomic acquisition of a task lease:
 * 1. Validates the task is in a lease-eligible state (READY, CHANGES_REQUESTED, ESCALATED)
 * 2. Checks no active lease exists for the task (exclusivity)
 * 3. Validates the state transition via the domain state machine
 * 4. Creates a new lease with LEASED status and computed expiry
 * 5. Transitions the task to ASSIGNED with the new lease ID
 * 6. Records an audit event
 * 7. Emits domain events after the transaction commits
 *
 * All steps 1–6 execute inside a single database transaction. If any step
 * fails, the entire operation is rolled back and no domain events are emitted.
 *
 * @see docs/prd/002-data-model.md §2.1 — "only one active development lease per task"
 * @see docs/prd/002-data-model.md §2.8 — Worker Lease Protocol
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.8 — Lease and Heartbeat Policy
 * @module @factory/application/services/lease.service
 */

import {
  TaskStatus,
  WorkerLeaseStatus,
  validateTransition,
  type TransitionContext,
} from "@factory/domain";

import {
  EntityNotFoundError,
  InvalidTransitionError,
  ExclusivityViolationError,
  TaskNotReadyForLeaseError,
} from "../errors.js";

import type { AuditEventRecord } from "../ports/repository.ports.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type { ActorInfo } from "../events/domain-events.js";
import type { LeaseUnitOfWork, LeaseAcquisitionTask, CreatedLease } from "../ports/lease.ports.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Task states from which a lease can be acquired.
 * These correspond to the PRD transitions: READY → ASSIGNED,
 * CHANGES_REQUESTED → ASSIGNED, ESCALATED → ASSIGNED.
 */
const LEASE_ELIGIBLE_STATUSES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.READY,
  TaskStatus.CHANGES_REQUESTED,
  TaskStatus.ESCALATED,
]);

// ─── Service Input/Output Types ─────────────────────────────────────────────

/**
 * Parameters for acquiring a lease on a task.
 */
export interface AcquireLeaseParams {
  /** ID of the task to acquire a lease on. */
  readonly taskId: string;
  /** ID of the worker that will execute the task. */
  readonly workerId: string;
  /** ID of the worker pool dispatching this lease. */
  readonly poolId: string;
  /** Lease time-to-live in seconds. Controls expires_at. */
  readonly ttlSeconds: number;
  /** Who is requesting the lease acquisition. */
  readonly actor: ActorInfo;
  /** Optional metadata to include in the audit event. */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Result of a successful lease acquisition.
 *
 * Contains the created lease, the updated task (now in ASSIGNED state),
 * and the audit event recording the acquisition.
 */
export interface LeaseAcquisitionResult {
  /** The newly created lease in LEASED status. */
  readonly lease: CreatedLease;
  /** The task after transitioning to ASSIGNED with currentLeaseId set. */
  readonly task: LeaseAcquisitionTask;
  /** The audit event recording this acquisition. */
  readonly auditEvent: AuditEventRecord;
}

/**
 * Lease acquisition service interface.
 *
 * Provides the `acquireLease` operation that atomically assigns a worker
 * to a task by creating a lease and transitioning the task to ASSIGNED.
 */
export interface LeaseService {
  /**
   * Acquire an exclusive lease on a task for a worker.
   *
   * Atomically checks eligibility, creates the lease, transitions the task
   * to ASSIGNED, and records an audit event. Emits domain events after commit.
   *
   * @throws EntityNotFoundError if the task does not exist
   * @throws TaskNotReadyForLeaseError if the task is not in a lease-eligible state
   * @throws ExclusivityViolationError if an active lease already exists for the task
   * @throws InvalidTransitionError if the domain state machine rejects the transition
   * @throws VersionConflictError if another process modified the task concurrently
   */
  acquireLease(params: AcquireLeaseParams): LeaseAcquisitionResult;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a lease service with injected dependencies.
 *
 * @param unitOfWork - Transaction boundary for atomic operations
 * @param eventEmitter - Publishes domain events after transaction commit
 * @param idGenerator - Produces unique IDs for new lease records (e.g., UUID v4)
 */
export function createLeaseService(
  unitOfWork: LeaseUnitOfWork,
  eventEmitter: DomainEventEmitter,
  idGenerator: () => string,
): LeaseService {
  return {
    acquireLease(params: AcquireLeaseParams): LeaseAcquisitionResult {
      const { taskId, workerId, poolId, ttlSeconds, actor, metadata } = params;

      // ── All DB operations inside a single atomic transaction ──────────
      const transactionResult = unitOfWork.runInTransaction((repos) => {
        // Step 1: Fetch the task
        const task = repos.task.findById(taskId);
        if (!task) {
          throw new EntityNotFoundError("Task", taskId);
        }

        // Step 2: Verify the task is in a lease-eligible state
        if (!LEASE_ELIGIBLE_STATUSES.has(task.status)) {
          throw new TaskNotReadyForLeaseError(taskId, task.status);
        }

        // Step 3: Enforce exclusivity — no active lease may exist
        const activeLease = repos.lease.findActiveByTaskId(taskId);
        if (activeLease) {
          throw new ExclusivityViolationError(taskId, activeLease.leaseId);
        }

        // Step 4: Validate via the domain state machine
        const transitionCtx: TransitionContext = {
          leaseAcquired: true,
          isOperator: actor.type === "operator",
        };
        const validation = validateTransition(task.status, TaskStatus.ASSIGNED, transitionCtx);
        if (!validation.valid) {
          throw new InvalidTransitionError(
            "Task",
            taskId,
            task.status,
            TaskStatus.ASSIGNED,
            validation.reason,
          );
        }

        // Step 5: Create the lease
        const leaseId = idGenerator();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

        const lease = repos.lease.create({
          leaseId,
          taskId,
          workerId,
          poolId,
          status: WorkerLeaseStatus.LEASED,
          expiresAt,
        });

        // Step 6: Transition task to ASSIGNED and link the lease
        const updatedTask = repos.task.updateStatusAndLeaseId(
          taskId,
          task.version,
          TaskStatus.ASSIGNED,
          leaseId,
        );

        // Step 7: Record audit event atomically with the transition
        const auditEvent = repos.auditEvent.create({
          entityType: "task",
          entityId: taskId,
          eventType: "lease.acquired",
          actorType: actor.type,
          actorId: actor.id,
          oldState: JSON.stringify({
            status: task.status,
            version: task.version,
            currentLeaseId: task.currentLeaseId,
          }),
          newState: JSON.stringify({
            status: updatedTask.status,
            version: updatedTask.version,
            currentLeaseId: leaseId,
          }),
          metadata: metadata ? JSON.stringify(metadata) : null,
        });

        return {
          lease,
          task: updatedTask,
          auditEvent,
          previousStatus: task.status,
        };
      });

      // ── Domain events emitted AFTER successful commit ─────────────────
      // If event emission fails, the state is already persisted.
      // Infrastructure should catch and log emission errors.

      eventEmitter.emit({
        type: "task.transitioned",
        entityType: "task",
        entityId: taskId,
        actor,
        timestamp: new Date(),
        fromStatus: transactionResult.previousStatus,
        toStatus: TaskStatus.ASSIGNED,
        newVersion: transactionResult.task.version,
      });

      eventEmitter.emit({
        type: "task-lease.transitioned",
        entityType: "task-lease",
        entityId: transactionResult.lease.leaseId,
        actor,
        timestamp: new Date(),
        fromStatus: WorkerLeaseStatus.IDLE,
        toStatus: WorkerLeaseStatus.LEASED,
      });

      return {
        lease: transactionResult.lease,
        task: transactionResult.task,
        auditEvent: transactionResult.auditEvent,
      };
    },
  };
}
