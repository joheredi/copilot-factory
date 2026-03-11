/**
 * Centralized State Transition Service.
 *
 * This is the **single authority** for committing state changes across all
 * entity types (Task, TaskLease, ReviewCycle, MergeQueueItem). No module
 * should update entity state directly — all state mutations flow through
 * this service to enforce invariants, optimistic concurrency, audit logging,
 * and domain event publication.
 *
 * ## Transaction pattern (per transition method)
 *
 * 1. **Fetch** the entity via its repository port
 * 2. **Validate** the transition via the domain-layer state machine
 * 3. **Update** the entity status with optimistic concurrency
 * 4. **Create** an audit event — atomically in the same transaction
 * 5. **Emit** a domain event after the transaction commits
 *
 * ## Optimistic concurrency
 *
 * - **Tasks** use an explicit `version` column (incremented on every update).
 * - **Other entities** use status-based checks — the update verifies the
 *   current status matches expectations before writing.
 *
 * @see docs/prd/002-data-model.md — State machines and invariants
 * @see docs/prd/005-ai-vs-deterministic.md — Deterministic transition ownership
 * @see docs/prd/007-technical-architecture.md §7.13 — State Transition Engine
 * @see docs/prd/010-integration-contracts.md §10.2 — Module ownership map
 *
 * @module @factory/application/services/transition.service
 */

import type {
  TaskStatus,
  TransitionContext,
  WorkerLeaseStatus,
  WorkerLeaseTransitionContext,
  ReviewCycleStatus,
  ReviewCycleTransitionContext,
  MergeQueueItemStatus,
  MergeQueueItemTransitionContext,
} from "@factory/domain";

import {
  validateTransition,
  validateWorkerLeaseTransition,
  validateReviewCycleTransition,
  validateMergeQueueItemTransition,
} from "@factory/domain";

import type { UnitOfWork } from "../ports/unit-of-work.port.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type {
  TransitionableTask,
  TransitionableTaskLease,
  TransitionableReviewCycle,
  TransitionableMergeQueueItem,
  AuditEventRecord,
} from "../ports/repository.ports.js";
import type { ActorInfo } from "../events/domain-events.js";
import { EntityNotFoundError, InvalidTransitionError } from "../errors.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * Result of a successful state transition.
 *
 * Contains the updated entity and the audit event that was persisted
 * atomically within the same transaction.
 */
export interface TransitionResult<T> {
  /** The entity after the status update (with new version for tasks). */
  readonly entity: T;
  /** The audit event persisted alongside the state change. */
  readonly auditEvent: AuditEventRecord;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * The centralized transition service interface.
 *
 * Each method transitions a specific entity type through its domain
 * state machine, persists the change with an audit trail, and emits
 * a domain event for downstream consumers.
 */
export interface TransitionService {
  /**
   * Transition a task to a new status.
   *
   * Uses the task state machine from `@factory/domain` for validation
   * and the task's `version` column for optimistic concurrency.
   *
   * @throws {EntityNotFoundError} If the task does not exist.
   * @throws {InvalidTransitionError} If the state machine rejects the transition.
   * @throws {VersionConflictError} If the task was modified concurrently.
   */
  transitionTask(
    taskId: string,
    targetStatus: TaskStatus,
    context: TransitionContext,
    actor: ActorInfo,
    metadata?: Record<string, unknown>,
  ): TransitionResult<TransitionableTask>;

  /**
   * Transition a task lease to a new status.
   *
   * Uses the worker lease state machine from `@factory/domain` for
   * validation and status-based optimistic concurrency.
   *
   * @throws {EntityNotFoundError} If the lease does not exist.
   * @throws {InvalidTransitionError} If the state machine rejects the transition.
   * @throws {VersionConflictError} If the lease was modified concurrently.
   */
  transitionLease(
    leaseId: string,
    targetStatus: WorkerLeaseStatus,
    context: WorkerLeaseTransitionContext,
    actor: ActorInfo,
    metadata?: Record<string, unknown>,
  ): TransitionResult<TransitionableTaskLease>;

  /**
   * Transition a review cycle to a new status.
   *
   * Uses the review cycle state machine from `@factory/domain` for
   * validation and status-based optimistic concurrency.
   *
   * @throws {EntityNotFoundError} If the review cycle does not exist.
   * @throws {InvalidTransitionError} If the state machine rejects the transition.
   * @throws {VersionConflictError} If the review cycle was modified concurrently.
   */
  transitionReviewCycle(
    reviewCycleId: string,
    targetStatus: ReviewCycleStatus,
    context: ReviewCycleTransitionContext,
    actor: ActorInfo,
    metadata?: Record<string, unknown>,
  ): TransitionResult<TransitionableReviewCycle>;

  /**
   * Transition a merge queue item to a new status.
   *
   * Uses the merge queue item state machine from `@factory/domain` for
   * validation and status-based optimistic concurrency.
   *
   * @throws {EntityNotFoundError} If the merge queue item does not exist.
   * @throws {InvalidTransitionError} If the state machine rejects the transition.
   * @throws {VersionConflictError} If the merge queue item was modified concurrently.
   */
  transitionMergeQueueItem(
    itemId: string,
    targetStatus: MergeQueueItemStatus,
    context: MergeQueueItemTransitionContext,
    actor: ActorInfo,
    metadata?: Record<string, unknown>,
  ): TransitionResult<TransitionableMergeQueueItem>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new TransitionService instance.
 *
 * Dependencies are injected via ports so the service remains decoupled
 * from infrastructure concerns (database driver, event transport, etc.).
 *
 * @param unitOfWork - Provides transaction-scoped repository access.
 * @param eventEmitter - Publishes domain events after successful commits.
 */
export function createTransitionService(
  unitOfWork: UnitOfWork,
  eventEmitter: DomainEventEmitter,
): TransitionService {
  return {
    transitionTask(
      taskId: string,
      targetStatus: TaskStatus,
      context: TransitionContext,
      actor: ActorInfo,
      metadata?: Record<string, unknown>,
    ): TransitionResult<TransitionableTask> {
      const transactionResult = unitOfWork.runInTransaction((repos) => {
        // 1. Fetch
        const task = repos.task.findById(taskId);
        if (!task) {
          throw new EntityNotFoundError("Task", taskId);
        }

        // 2. Validate via domain state machine
        const validation = validateTransition(task.status, targetStatus, context);
        if (!validation.valid) {
          throw new InvalidTransitionError(
            "Task",
            taskId,
            task.status,
            targetStatus,
            validation.reason,
          );
        }

        // 3. Update with optimistic concurrency (version-based)
        const updated = repos.task.updateStatus(taskId, task.version, targetStatus);

        // 4. Create audit event atomically
        const auditEvent = repos.auditEvent.create({
          entityType: "task",
          entityId: taskId,
          eventType: `task.transition.${task.status}.to.${targetStatus}`,
          actorType: actor.type,
          actorId: actor.id,
          oldState: JSON.stringify({
            status: task.status,
            version: task.version,
          }),
          newState: JSON.stringify({
            status: targetStatus,
            version: task.version + 1,
          }),
          metadata: metadata ? JSON.stringify(metadata) : null,
        });

        return {
          entity: updated,
          auditEvent,
          previousStatus: task.status,
          previousVersion: task.version,
        };
      });

      // 5. Emit domain event AFTER commit
      eventEmitter.emit({
        type: "task.transitioned",
        entityType: "task",
        entityId: taskId,
        fromStatus: transactionResult.previousStatus,
        toStatus: targetStatus,
        newVersion: transactionResult.previousVersion + 1,
        actor,
        timestamp: new Date(),
      });

      return {
        entity: transactionResult.entity,
        auditEvent: transactionResult.auditEvent,
      };
    },

    transitionLease(
      leaseId: string,
      targetStatus: WorkerLeaseStatus,
      context: WorkerLeaseTransitionContext,
      actor: ActorInfo,
      metadata?: Record<string, unknown>,
    ): TransitionResult<TransitionableTaskLease> {
      const transactionResult = unitOfWork.runInTransaction((repos) => {
        // 1. Fetch
        const lease = repos.taskLease.findById(leaseId);
        if (!lease) {
          throw new EntityNotFoundError("TaskLease", leaseId);
        }

        // 2. Validate via domain state machine
        const validation = validateWorkerLeaseTransition(lease.status, targetStatus, context);
        if (!validation.valid) {
          throw new InvalidTransitionError(
            "TaskLease",
            leaseId,
            lease.status,
            targetStatus,
            validation.reason,
          );
        }

        // 3. Update with status-based optimistic concurrency
        const updated = repos.taskLease.updateStatus(leaseId, lease.status, targetStatus);

        // 4. Create audit event atomically
        const auditEvent = repos.auditEvent.create({
          entityType: "task-lease",
          entityId: leaseId,
          eventType: `task-lease.transition.${lease.status}.to.${targetStatus}`,
          actorType: actor.type,
          actorId: actor.id,
          oldState: JSON.stringify({ status: lease.status }),
          newState: JSON.stringify({ status: targetStatus }),
          metadata: metadata ? JSON.stringify(metadata) : null,
        });

        return {
          entity: updated,
          auditEvent,
          previousStatus: lease.status,
        };
      });

      // 5. Emit domain event AFTER commit
      eventEmitter.emit({
        type: "task-lease.transitioned",
        entityType: "task-lease",
        entityId: leaseId,
        fromStatus: transactionResult.previousStatus,
        toStatus: targetStatus,
        actor,
        timestamp: new Date(),
      });

      return {
        entity: transactionResult.entity,
        auditEvent: transactionResult.auditEvent,
      };
    },

    transitionReviewCycle(
      reviewCycleId: string,
      targetStatus: ReviewCycleStatus,
      context: ReviewCycleTransitionContext,
      actor: ActorInfo,
      metadata?: Record<string, unknown>,
    ): TransitionResult<TransitionableReviewCycle> {
      const transactionResult = unitOfWork.runInTransaction((repos) => {
        // 1. Fetch
        const cycle = repos.reviewCycle.findById(reviewCycleId);
        if (!cycle) {
          throw new EntityNotFoundError("ReviewCycle", reviewCycleId);
        }

        // 2. Validate via domain state machine
        const validation = validateReviewCycleTransition(cycle.status, targetStatus, context);
        if (!validation.valid) {
          throw new InvalidTransitionError(
            "ReviewCycle",
            reviewCycleId,
            cycle.status,
            targetStatus,
            validation.reason,
          );
        }

        // 3. Update with status-based optimistic concurrency
        const updated = repos.reviewCycle.updateStatus(reviewCycleId, cycle.status, targetStatus);

        // 4. Create audit event atomically
        const auditEvent = repos.auditEvent.create({
          entityType: "review-cycle",
          entityId: reviewCycleId,
          eventType: `review-cycle.transition.${cycle.status}.to.${targetStatus}`,
          actorType: actor.type,
          actorId: actor.id,
          oldState: JSON.stringify({ status: cycle.status }),
          newState: JSON.stringify({ status: targetStatus }),
          metadata: metadata ? JSON.stringify(metadata) : null,
        });

        return {
          entity: updated,
          auditEvent,
          previousStatus: cycle.status,
        };
      });

      // 5. Emit domain event AFTER commit
      eventEmitter.emit({
        type: "review-cycle.transitioned",
        entityType: "review-cycle",
        entityId: reviewCycleId,
        fromStatus: transactionResult.previousStatus,
        toStatus: targetStatus,
        actor,
        timestamp: new Date(),
      });

      return {
        entity: transactionResult.entity,
        auditEvent: transactionResult.auditEvent,
      };
    },

    transitionMergeQueueItem(
      itemId: string,
      targetStatus: MergeQueueItemStatus,
      context: MergeQueueItemTransitionContext,
      actor: ActorInfo,
      metadata?: Record<string, unknown>,
    ): TransitionResult<TransitionableMergeQueueItem> {
      const transactionResult = unitOfWork.runInTransaction((repos) => {
        // 1. Fetch
        const item = repos.mergeQueueItem.findById(itemId);
        if (!item) {
          throw new EntityNotFoundError("MergeQueueItem", itemId);
        }

        // 2. Validate via domain state machine
        const validation = validateMergeQueueItemTransition(item.status, targetStatus, context);
        if (!validation.valid) {
          throw new InvalidTransitionError(
            "MergeQueueItem",
            itemId,
            item.status,
            targetStatus,
            validation.reason,
          );
        }

        // 3. Update with status-based optimistic concurrency
        const updated = repos.mergeQueueItem.updateStatus(itemId, item.status, targetStatus);

        // 4. Create audit event atomically
        const auditEvent = repos.auditEvent.create({
          entityType: "merge-queue-item",
          entityId: itemId,
          eventType: `merge-queue-item.transition.${item.status}.to.${targetStatus}`,
          actorType: actor.type,
          actorId: actor.id,
          oldState: JSON.stringify({ status: item.status }),
          newState: JSON.stringify({ status: targetStatus }),
          metadata: metadata ? JSON.stringify(metadata) : null,
        });

        return {
          entity: updated,
          auditEvent,
          previousStatus: item.status,
        };
      });

      // 5. Emit domain event AFTER commit
      eventEmitter.emit({
        type: "merge-queue-item.transitioned",
        entityType: "merge-queue-item",
        entityId: itemId,
        fromStatus: transactionResult.previousStatus,
        toStatus: targetStatus,
        actor,
        timestamp: new Date(),
      });

      return {
        entity: transactionResult.entity,
        auditEvent: transactionResult.auditEvent,
      };
    },
  };
}
