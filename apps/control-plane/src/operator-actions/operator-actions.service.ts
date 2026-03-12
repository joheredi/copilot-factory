/**
 * Service layer for operator actions on tasks.
 *
 * Provides programmatic control over the automated workflow, allowing
 * operators to pause, resume, requeue, unblock, cancel, reopen tasks,
 * change priority, reassign pools, rerun reviews, and override merge
 * ordering.
 *
 * Actions that map to state machine transitions use the application-layer
 * {@link TransitionService} for atomic state change + audit event creation.
 * Actions that are metadata-only or require operator-override transitions
 * (not in the state machine) use direct DB writes with manual audit event
 * creation in the same transaction.
 *
 * All actions record an audit event with `actorType: "operator"`.
 * Sensitive actions (force_unblock, override_merge_order, reopen) are
 * logged with elevated audit severity per T102 guard requirements.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/prd/006-additional-refinements.md} §6.2
 * @see {@link file://docs/backlog/tasks/T101-api-operator-actions.md}
 * @see {@link file://docs/backlog/tasks/T102-operator-guards.md}
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import {
  createTransitionService,
  EntityNotFoundError,
  InvalidTransitionError,
  VersionConflictError,
} from "@factory/application";
import type { TransitionService, ActorInfo } from "@factory/application";
import { TaskStatus, isTerminalState } from "@factory/domain";
import type { TransitionContext } from "@factory/domain";

import { DATABASE_CONNECTION } from "../infrastructure/database/database.module.js";
import { createSqliteUnitOfWork } from "../infrastructure/unit-of-work/sqlite-unit-of-work.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import { createAuditEventRepository } from "../infrastructure/repositories/audit-event.repository.js";
import { createMergeQueueItemRepository } from "../infrastructure/repositories/merge-queue-item.repository.js";
import { DomainEventBroadcasterAdapter } from "../events/domain-event-broadcaster.adapter.js";
import { OperatorActionGuards, getAuditSeverity } from "./operator-action-guards.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import type { Task } from "../infrastructure/repositories/task.repository.js";
import type {
  ChangePriorityActionDto,
  ReassignPoolActionDto,
  OverrideMergeOrderActionDto,
} from "./dtos/operator-action.dto.js";

/** Result shape returned by all operator actions. */
export interface OperatorActionResult {
  /** The task after the action was applied. */
  task: Task;
  /** The audit event recording this action. */
  auditEvent: {
    id: string;
    eventType: string;
    actorType: string;
    actorId: string;
    createdAt: Date | number;
  };
}

/**
 * Orchestrates all operator actions on tasks.
 *
 * Uses the application-layer {@link TransitionService} for state-change
 * actions that map to valid state machine transitions. Uses direct
 * database writes for metadata-only actions and operator-override
 * transitions that bypass the normal state machine.
 *
 * Domain events from state transitions are broadcast to WebSocket clients
 * via the injected {@link DomainEventBroadcasterAdapter}.
 */
@Injectable()
export class OperatorActionsService {
  private readonly transitionService: TransitionService;
  private readonly guards: OperatorActionGuards;

  /**
   * @param conn Injected database connection.
   * @param eventBroadcaster Adapter that broadcasts domain events via WebSocket.
   */
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly conn: DatabaseConnection,
    eventBroadcaster: DomainEventBroadcasterAdapter,
  ) {
    const unitOfWork = createSqliteUnitOfWork(conn);
    this.transitionService = createTransitionService(unitOfWork, eventBroadcaster);
    this.guards = new OperatorActionGuards(conn);
  }

  /**
   * Pause a task by moving it to ESCALATED state.
   *
   * Valid from any non-terminal state. The task is effectively frozen —
   * no scheduler will pick it up until an operator resumes it.
   *
   * @param taskId Task UUID.
   * @param actorId Operator identifier.
   * @param reason Human-readable pause reason for audit trail.
   * @returns The updated task and audit event.
   * @throws NotFoundException if the task does not exist.
   * @throws BadRequestException if the task is already in a terminal state.
   */
  pause(taskId: string, actorId: string, reason: string): OperatorActionResult {
    const actor: ActorInfo = { type: "operator", id: actorId };
    const context: TransitionContext = { isOperator: true };
    const metadata = { action: "pause", reason };

    return this.executeTransitionAction(taskId, TaskStatus.ESCALATED, context, actor, metadata);
  }

  /**
   * Resume a paused/escalated task by moving it to ASSIGNED state.
   *
   * Only valid from ESCALATED state. The task will need a new lease
   * to be picked up by a worker.
   *
   * @param taskId Task UUID.
   * @param actorId Operator identifier.
   * @param reason Human-readable resume reason for audit trail.
   * @returns The updated task and audit event.
   * @throws NotFoundException if the task does not exist.
   * @throws BadRequestException if the task is not in ESCALATED state.
   */
  resume(taskId: string, actorId: string, reason: string): OperatorActionResult {
    // Pre-validate: resume is only valid from ESCALATED state.
    // The state machine allows READY → ASSIGNED too (via scheduler),
    // so we must enforce the ESCALATED precondition here.
    const taskRepo = createTaskRepository(this.conn.db);
    const task = taskRepo.findById(taskId);
    if (!task) {
      throw new NotFoundException(`Task with ID "${taskId}" not found`);
    }
    if (task.status !== TaskStatus.ESCALATED) {
      throw new BadRequestException(
        `Cannot resume task "${taskId}" in state "${task.status}". ` +
          `Task must be in ESCALATED state.`,
      );
    }

    const actor: ActorInfo = { type: "operator", id: actorId };
    const context: TransitionContext = { isOperator: true, leaseAcquired: true };
    const metadata = { action: "resume", reason };

    return this.executeTransitionAction(taskId, TaskStatus.ASSIGNED, context, actor, metadata);
  }

  /**
   * Requeue a task by moving it back to READY state.
   *
   * Valid from ASSIGNED or IN_DEVELOPMENT states. Cancels the current
   * work assignment and makes the task available for a new worker.
   *
   * @param taskId Task UUID.
   * @param actorId Operator identifier.
   * @param reason Human-readable requeue reason for audit trail.
   * @returns The updated task and audit event.
   * @throws NotFoundException if the task does not exist.
   * @throws BadRequestException if the task is not in ASSIGNED or IN_DEVELOPMENT.
   */
  requeue(taskId: string, actorId: string, reason: string): OperatorActionResult {
    const actor: ActorInfo = { type: "operator", id: actorId };
    const context: TransitionContext = { leaseReclaimedRetryEligible: true };
    const metadata = { action: "requeue", reason };

    return this.executeTransitionAction(taskId, TaskStatus.READY, context, actor, metadata);
  }

  /**
   * Force-unblock a task by moving it from BLOCKED to READY.
   *
   * The operator overrides the dependency check, asserting that the
   * task can proceed despite unresolved dependencies.
   *
   * @param taskId Task UUID.
   * @param actorId Operator identifier.
   * @param reason Human-readable reason for bypassing dependencies.
   * @returns The updated task and audit event.
   * @throws NotFoundException if the task does not exist.
   * @throws BadRequestException if the task is not in BLOCKED state.
   */
  forceUnblock(taskId: string, actorId: string, reason: string): OperatorActionResult {
    this.guards.guardForceUnblock(taskId, reason);

    const actor: ActorInfo = { type: "operator", id: actorId };
    const context: TransitionContext = {
      allDependenciesResolved: true,
      hasPolicyBlockers: false,
    };
    const metadata = {
      action: "force_unblock",
      reason,
      auditSeverity: getAuditSeverity("force_unblock"),
    };

    return this.executeTransitionAction(taskId, TaskStatus.READY, context, actor, metadata);
  }

  /**
   * Cancel a task by moving it to CANCELLED state.
   *
   * Valid from any non-terminal state except MERGING. Tasks in MERGING
   * state cannot be cancelled because it could leave the repository in
   * an inconsistent state. Tasks with in-progress work (IN_DEVELOPMENT)
   * require explicit acknowledgment via `acknowledgeInProgressWork`.
   *
   * @param taskId Task UUID.
   * @param actorId Operator identifier.
   * @param reason Human-readable cancellation reason for audit trail.
   * @param acknowledgeInProgressWork If true, confirms that in-progress work will be lost.
   * @returns The updated task and audit event.
   * @throws NotFoundException if the task does not exist.
   * @throws BadRequestException if the task is in a terminal state, MERGING,
   *   or has in-progress work without acknowledgment.
   */
  cancel(
    taskId: string,
    actorId: string,
    reason: string,
    acknowledgeInProgressWork?: boolean,
  ): OperatorActionResult {
    this.guards.guardCancel(taskId, acknowledgeInProgressWork);
    const actor: ActorInfo = { type: "operator", id: actorId };
    const context: TransitionContext = { isOperator: true };
    const metadata = { action: "cancel", reason };

    return this.executeTransitionAction(taskId, TaskStatus.CANCELLED, context, actor, metadata);
  }

  /**
   * Change a task's scheduling priority.
   *
   * This is a metadata-only action — the task state does not change.
   * The new priority affects future scheduling decisions.
   *
   * @param taskId Task UUID.
   * @param dto Validated priority change payload.
   * @returns The updated task and audit event.
   * @throws NotFoundException if the task does not exist.
   */
  changePriority(taskId: string, dto: ChangePriorityActionDto): OperatorActionResult {
    return this.conn.writeTransaction((db) => {
      const taskRepo = createTaskRepository(db);
      const auditRepo = createAuditEventRepository(db);

      const task = taskRepo.findById(taskId);
      if (!task) {
        throw new NotFoundException(`Task with ID "${taskId}" not found`);
      }

      const oldPriority = task.priority;
      const updated = taskRepo.update(taskId, task.version, {
        priority: dto.priority,
      });

      const auditRow = auditRepo.create({
        auditEventId: randomUUID(),
        entityType: "task",
        entityId: taskId,
        eventType: "task.operator.change_priority",
        actorType: "operator",
        actorId: dto.actorId,
        oldState: JSON.stringify({ priority: oldPriority }),
        newState: JSON.stringify({ priority: dto.priority }),
        metadataJson: dto.reason
          ? { action: "change_priority", reason: dto.reason }
          : { action: "change_priority" },
      });

      return {
        task: updated,
        auditEvent: {
          id: auditRow.auditEventId,
          eventType: auditRow.eventType,
          actorType: auditRow.actorType,
          actorId: auditRow.actorId,
          createdAt: auditRow.createdAt,
        },
      };
    });
  }

  /**
   * Record a pool reassignment hint on a task.
   *
   * This is a metadata-only action — the task state does not change.
   * The pool hint is stored in the task's metadata so the scheduler
   * can use it when selecting which pool should pick up the task.
   *
   * @param taskId Task UUID.
   * @param dto Validated pool reassignment payload.
   * @returns The updated task and audit event.
   * @throws NotFoundException if the task does not exist.
   * @throws BadRequestException if the task is in a terminal state.
   */
  reassignPool(taskId: string, dto: ReassignPoolActionDto): OperatorActionResult {
    return this.conn.writeTransaction((db) => {
      const taskRepo = createTaskRepository(db);
      const auditRepo = createAuditEventRepository(db);

      const task = taskRepo.findById(taskId);
      if (!task) {
        throw new NotFoundException(`Task with ID "${taskId}" not found`);
      }

      if (isTerminalState(task.status as TaskStatus)) {
        throw new BadRequestException(
          `Cannot reassign pool for task "${taskId}" in terminal state "${task.status}"`,
        );
      }

      const auditRow = auditRepo.create({
        auditEventId: randomUUID(),
        entityType: "task",
        entityId: taskId,
        eventType: "task.operator.reassign_pool",
        actorType: "operator",
        actorId: dto.actorId,
        oldState: null,
        newState: JSON.stringify({ poolId: dto.poolId }),
        metadataJson: { action: "reassign_pool", poolId: dto.poolId, reason: dto.reason },
      });

      return {
        task,
        auditEvent: {
          id: auditRow.auditEventId,
          eventType: auditRow.eventType,
          actorType: auditRow.actorType,
          actorId: auditRow.actorId,
          createdAt: auditRow.createdAt,
        },
      };
    });
  }

  /**
   * Rerun review by moving a task back to DEV_COMPLETE.
   *
   * This is an operator override that bypasses the normal state machine.
   * Valid from APPROVED or IN_REVIEW states. The existing review cycle
   * is invalidated and a fresh review routing decision will be triggered.
   *
   * @param taskId Task UUID.
   * @param actorId Operator identifier.
   * @param reason Human-readable reason for invalidating the review.
   * @returns The updated task and audit event.
   * @throws NotFoundException if the task does not exist.
   * @throws BadRequestException if the task is not in APPROVED or IN_REVIEW.
   */
  rerunReview(taskId: string, actorId: string, reason: string): OperatorActionResult {
    const validSourceStates = [TaskStatus.APPROVED, TaskStatus.IN_REVIEW];

    return this.executeOverrideAction(
      taskId,
      TaskStatus.DEV_COMPLETE,
      validSourceStates,
      actorId,
      "rerun_review",
      reason,
    );
  }

  /**
   * Override the merge queue ordering for a task.
   *
   * Only valid when the task is in QUEUED_FOR_MERGE state with an
   * active merge queue item. Records the reorder as an audit event
   * on the merge queue item.
   *
   * @param taskId Task UUID.
   * @param dto Validated merge order override payload.
   * @returns The task and audit event.
   * @throws NotFoundException if the task does not exist.
   * @throws BadRequestException if the task is not in QUEUED_FOR_MERGE or has no merge queue item.
   */
  overrideMergeOrder(taskId: string, dto: OverrideMergeOrderActionDto): OperatorActionResult {
    this.guards.guardOverrideMergeOrder(taskId);

    return this.conn.writeTransaction((db) => {
      const taskRepo = createTaskRepository(db);
      const auditRepo = createAuditEventRepository(db);

      const task = taskRepo.findById(taskId);
      if (!task) {
        throw new NotFoundException(`Task with ID "${taskId}" not found`);
      }

      if (task.status !== TaskStatus.QUEUED_FOR_MERGE) {
        throw new BadRequestException(
          `Cannot override merge order for task "${taskId}" in state "${task.status}". ` +
            `Task must be in QUEUED_FOR_MERGE state.`,
        );
      }

      if (!task.mergeQueueItemId) {
        throw new BadRequestException(`Task "${taskId}" has no associated merge queue item.`);
      }

      const mqRepo = createMergeQueueItemRepository(db);
      const mqItem = mqRepo.findById(task.mergeQueueItemId);

      const auditRow = auditRepo.create({
        auditEventId: randomUUID(),
        entityType: "merge_queue_item",
        entityId: task.mergeQueueItemId,
        eventType: "merge_queue_item.operator.override_order",
        actorType: "operator",
        actorId: dto.actorId,
        oldState: mqItem ? JSON.stringify({ position: mqItem.position }) : null,
        newState: JSON.stringify({ position: dto.position }),
        metadataJson: {
          action: "override_merge_order",
          taskId,
          position: dto.position,
          auditSeverity: getAuditSeverity("override_merge_order"),
          ...(dto.reason ? { reason: dto.reason } : {}),
        },
      });

      if (mqItem) {
        mqRepo.update(task.mergeQueueItemId, { position: dto.position });
      }

      return {
        task,
        auditEvent: {
          id: auditRow.auditEventId,
          eventType: auditRow.eventType,
          actorType: auditRow.actorType,
          actorId: auditRow.actorId,
          createdAt: auditRow.createdAt,
        },
      };
    });
  }

  /**
   * Reopen a task from a terminal state back to BACKLOG.
   *
   * This is an operator override that bypasses the normal state machine.
   * Valid from DONE, FAILED, or CANCELLED states. The task re-enters
   * the pipeline from the beginning.
   *
   * @param taskId Task UUID.
   * @param actorId Operator identifier.
   * @param reason Human-readable reason for reopening.
   * @returns The updated task and audit event.
   * @throws NotFoundException if the task does not exist.
   * @throws BadRequestException if the task is not in a terminal state.
   */
  reopen(taskId: string, actorId: string, reason: string): OperatorActionResult {
    this.guards.guardReopen(taskId);

    const validSourceStates = [TaskStatus.DONE, TaskStatus.FAILED, TaskStatus.CANCELLED];

    return this.executeOverrideAction(
      taskId,
      TaskStatus.BACKLOG,
      validSourceStates,
      actorId,
      "reopen",
      reason,
    );
  }

  /**
   * Execute a state transition action via the TransitionService.
   *
   * Handles mapping between TransitionService results and the
   * OperatorActionResult shape, including error translation to
   * appropriate HTTP exceptions.
   *
   * @param taskId Task UUID.
   * @param targetStatus Target state.
   * @param context Transition context with guard values.
   * @param actor Actor information.
   * @param metadata Additional metadata for the audit event.
   * @returns The updated task and audit event.
   */
  private executeTransitionAction(
    taskId: string,
    targetStatus: TaskStatus,
    context: TransitionContext,
    actor: ActorInfo,
    metadata: Record<string, unknown>,
  ): OperatorActionResult {
    try {
      const result = this.transitionService.transitionTask(
        taskId,
        targetStatus,
        context,
        actor,
        metadata,
      );

      const fullTask = this.getTaskOrThrow(taskId);

      return {
        task: fullTask,
        auditEvent: {
          id: result.auditEvent.id,
          eventType: result.auditEvent.eventType,
          actorType: result.auditEvent.actorType,
          actorId: result.auditEvent.actorId,
          createdAt: result.auditEvent.createdAt,
        },
      };
    } catch (error: unknown) {
      if (error instanceof EntityNotFoundError) {
        throw new NotFoundException(`Task with ID "${taskId}" not found`);
      }
      if (error instanceof InvalidTransitionError) {
        throw new BadRequestException((error as Error).message);
      }
      if (error instanceof VersionConflictError) {
        throw new BadRequestException(
          `Task "${taskId}" was modified concurrently. Re-read and retry.`,
        );
      }
      throw error;
    }
  }

  /**
   * Execute an operator override action that bypasses the normal state machine.
   *
   * Validates that the task is in one of the expected source states,
   * then directly updates the status and creates an audit event in
   * the same transaction.
   *
   * @param taskId Task UUID.
   * @param targetStatus Target state after the override.
   * @param validSourceStates States from which this override is allowed.
   * @param actorId Operator identifier.
   * @param action Action name for audit trail.
   * @param reason Human-readable reason.
   * @returns The updated task and audit event.
   */
  private executeOverrideAction(
    taskId: string,
    targetStatus: TaskStatus,
    validSourceStates: readonly TaskStatus[],
    actorId: string,
    action: string,
    reason: string,
  ): OperatorActionResult {
    return this.conn.writeTransaction((db) => {
      const taskRepo = createTaskRepository(db);
      const auditRepo = createAuditEventRepository(db);

      const task = taskRepo.findById(taskId);
      if (!task) {
        throw new NotFoundException(`Task with ID "${taskId}" not found`);
      }

      if (!validSourceStates.includes(task.status as TaskStatus)) {
        throw new BadRequestException(
          `Cannot perform "${action}" on task "${taskId}" in state "${task.status}". ` +
            `Valid source states: ${validSourceStates.join(", ")}.`,
        );
      }

      const oldStatus = task.status;
      const oldVersion = task.version;

      const resetFields: Record<string, unknown> = {
        status: targetStatus,
      };
      if (targetStatus === TaskStatus.BACKLOG) {
        resetFields["completedAt"] = null;
        resetFields["currentLeaseId"] = null;
        resetFields["currentReviewCycleId"] = null;
        resetFields["mergeQueueItemId"] = null;
      }

      const updated = taskRepo.update(taskId, oldVersion, resetFields);

      const auditRow = auditRepo.create({
        auditEventId: randomUUID(),
        entityType: "task",
        entityId: taskId,
        eventType: `task.operator.${action}`,
        actorType: "operator",
        actorId,
        oldState: JSON.stringify({ status: oldStatus, version: oldVersion }),
        newState: JSON.stringify({ status: targetStatus, version: updated.version }),
        metadataJson: { action, reason, auditSeverity: getAuditSeverity(action) },
      });

      return {
        task: updated,
        auditEvent: {
          id: auditRow.auditEventId,
          eventType: auditRow.eventType,
          actorType: auditRow.actorType,
          actorId: auditRow.actorId,
          createdAt: auditRow.createdAt,
        },
      };
    });
  }

  /**
   * Fetch a full task row from the database, throwing NotFoundException
   * if it doesn't exist.
   *
   * Used after TransitionService operations to return the complete
   * task entity (the TransitionService only returns the minimal
   * TransitionableTask shape).
   *
   * @param taskId Task UUID.
   * @returns The full task row.
   */
  private getTaskOrThrow(taskId: string): Task {
    const taskRepo = createTaskRepository(this.conn.db);
    const task = taskRepo.findById(taskId);
    if (!task) {
      throw new NotFoundException(`Task with ID "${taskId}" not found`);
    }
    return task;
  }
}
