/**
 * Safety guards for operator actions on tasks.
 *
 * Each guard validates preconditions that must hold before an operator
 * action can execute. Guards enforce state machine invariants and system
 * safety constraints beyond what the domain-layer state machine checks.
 *
 * Guards are invoked by the {@link OperatorActionsService} before executing
 * the action. A failed guard throws a {@link BadRequestException} with a
 * descriptive message explaining why the action was rejected.
 *
 * Design decision: Guards are a separate class (not inline in the service)
 * for independent testability and separation of concerns.
 * @see {@link file://docs/backlog/tasks/T102-operator-guards.md}
 *
 * @module @factory/control-plane
 * @see {@link file://docs/prd/006-additional-refinements.md} §6.2
 * @see {@link file://docs/prd/002-data-model.md} §2.1
 */
import { BadRequestException } from "@nestjs/common";

import { TaskStatus } from "@factory/domain";

import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import { createTaskLeaseRepository } from "../infrastructure/repositories/task-lease.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import type { EscalationResolutionType } from "./dtos/operator-action.dto.js";

/**
 * Actions classified as sensitive that require elevated audit logging.
 *
 * Sensitive actions are those that bypass normal workflow safeguards
 * or have higher risk of putting the system in an unintended state.
 */
export const SENSITIVE_ACTIONS: ReadonlySet<string> = new Set([
  "force_unblock",
  "override_merge_order",
  "reopen",
  "resolve_escalation_mark_done",
]);

/**
 * Audit severity levels for operator action events.
 *
 * - `normal`: Standard operator action (pause, resume, requeue, etc.)
 * - `elevated`: Sensitive action that bypasses safeguards (force_unblock, reopen, etc.)
 */
export type AuditSeverity = "normal" | "elevated";

/**
 * Determine the audit severity for an operator action.
 *
 * @param action The action name (e.g., "force_unblock", "cancel").
 * @returns `"elevated"` for sensitive actions, `"normal"` otherwise.
 */
export function getAuditSeverity(action: string): AuditSeverity {
  return SENSITIVE_ACTIONS.has(action) ? "elevated" : "normal";
}

/**
 * Task states where active work is in progress and cancellation
 * could result in lost work.
 */
const IN_PROGRESS_STATES: ReadonlySet<string> = new Set([
  TaskStatus.IN_DEVELOPMENT,
  TaskStatus.MERGING,
]);

/**
 * Safety guards for operator actions.
 *
 * Each guard method validates preconditions for a specific operator
 * action. Guards throw {@link BadRequestException} when preconditions
 * are not met. Passing guards are silent (no return value).
 *
 * Guards are designed to be called from the {@link OperatorActionsService}
 * before executing the corresponding action. They supplement (not replace)
 * the domain-layer state machine validation.
 */
export class OperatorActionGuards {
  /**
   * @param conn Database connection for repository access.
   */
  constructor(private readonly conn: DatabaseConnection) {}

  /**
   * Guard for the force_unblock action.
   *
   * Validates that:
   * 1. The reason is non-empty (defense-in-depth beyond DTO validation).
   * 2. The task is actually in BLOCKED state (provides a clear error message
   *    before the state machine rejects the transition).
   *
   * @param taskId Task UUID.
   * @param reason Operator-provided reason for the override.
   * @throws BadRequestException if reason is empty or task is not BLOCKED.
   */
  guardForceUnblock(taskId: string, reason: string): void {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException(
        `force_unblock requires a non-empty reason explaining why the ` +
          `dependency is being bypassed. This is a sensitive action that ` +
          `will be logged with elevated audit severity.`,
      );
    }

    const taskRepo = createTaskRepository(this.conn.db);
    const task = taskRepo.findById(taskId);
    if (task && task.status !== TaskStatus.BLOCKED) {
      throw new BadRequestException(
        `Cannot force-unblock task "${taskId}" in state "${task.status}". ` +
          `Task must be in BLOCKED state. Current state: ${task.status}.`,
      );
    }
  }

  /**
   * Guard for the reopen action.
   *
   * Validates that:
   * 1. The task is in a terminal state (DONE, FAILED, CANCELLED).
   * 2. No active (non-terminal) lease exists for the task. An active
   *    lease would indicate work is still tracked against this task,
   *    which would create an inconsistent state if the task is reopened.
   *
   * The active lease check is critical because a lease in LEASED, STARTING,
   * RUNNING, HEARTBEATING, or COMPLETING state means a worker may still be
   * referencing this task. Reopening it would move it to BACKLOG while
   * the lease still points to it, violating the one-active-lease invariant.
   *
   * @param taskId Task UUID.
   * @throws BadRequestException if the task has an active lease or is not terminal.
   */
  guardReopen(taskId: string): void {
    const taskRepo = createTaskRepository(this.conn.db);
    const task = taskRepo.findById(taskId);

    if (!task) {
      // Let the service handle the not-found case with NotFoundException.
      return;
    }

    const terminalStates: ReadonlySet<string> = new Set([
      TaskStatus.DONE,
      TaskStatus.FAILED,
      TaskStatus.CANCELLED,
    ]);
    if (!terminalStates.has(task.status)) {
      throw new BadRequestException(
        `Cannot reopen task "${taskId}" in state "${task.status}". ` +
          `Task must be in a terminal state (DONE, FAILED, CANCELLED).`,
      );
    }

    const leaseRepo = createTaskLeaseRepository(this.conn.db);
    const activeLease = leaseRepo.findActiveByTaskId(taskId);
    if (activeLease) {
      throw new BadRequestException(
        `Cannot reopen task "${taskId}" because it has an active lease ` +
          `(lease ID: "${activeLease.leaseId}", status: "${activeLease.status}"). ` +
          `The lease must reach a terminal state (COMPLETED, TIMED_OUT, CRASHED, ` +
          `or RECLAIMED) before the task can be reopened. This prevents ` +
          `inconsistent state where a worker holds a lease on a BACKLOG task.`,
      );
    }
  }

  /**
   * Guard for the cancel action.
   *
   * Validates that:
   * 1. No active merge is in progress for this task. Cancelling a task
   *    during MERGING could leave the repository in an inconsistent state
   *    with a partial merge.
   *
   * If the task has in-progress work (IN_DEVELOPMENT or MERGING),
   * the operator must acknowledge this via the `acknowledgeInProgressWork`
   * flag. This prevents accidental cancellation of tasks where work
   * would be lost.
   *
   * @param taskId Task UUID.
   * @param acknowledgeInProgressWork If true, the operator explicitly
   *   acknowledges that in-progress work will be lost.
   * @throws BadRequestException if an active merge is in progress, or
   *   if in-progress work exists and acknowledgment is missing.
   */
  guardCancel(taskId: string, acknowledgeInProgressWork?: boolean): void {
    const taskRepo = createTaskRepository(this.conn.db);
    const task = taskRepo.findById(taskId);

    if (!task) {
      return;
    }

    if (task.status === TaskStatus.MERGING) {
      throw new BadRequestException(
        `Cannot cancel task "${taskId}" while it is in MERGING state. ` +
          `A merge operation is actively in progress. Wait for the merge ` +
          `to complete or fail before cancelling. Cancelling during a merge ` +
          `could leave the repository in an inconsistent state.`,
      );
    }

    if (IN_PROGRESS_STATES.has(task.status) && !acknowledgeInProgressWork) {
      throw new BadRequestException(
        `Task "${taskId}" is in "${task.status}" state with active work ` +
          `in progress. Set "acknowledgeInProgressWork: true" in the request ` +
          `body to confirm you want to cancel this task and discard the ` +
          `in-progress work.`,
      );
    }
  }

  /**
   * Guard for the override_merge_order action.
   *
   * Validates that:
   * 1. The task is in QUEUED_FOR_MERGE state (already checked by service).
   * 2. The task has a merge queue item (already checked by service).
   *
   * This guard currently serves as a hook for future validation
   * (e.g., verifying that all required review approvals are present)
   * and ensures that merge order overrides are logged with elevated
   * audit severity.
   *
   * @param taskId Task UUID.
   */
  guardOverrideMergeOrder(taskId: string): void {
    const taskRepo = createTaskRepository(this.conn.db);
    const task = taskRepo.findById(taskId);

    if (!task) {
      return;
    }

    if (task.status !== TaskStatus.QUEUED_FOR_MERGE) {
      throw new BadRequestException(
        `Cannot override merge order for task "${taskId}" in state ` +
          `"${task.status}". Task must be in QUEUED_FOR_MERGE state.`,
      );
    }
  }

  /**
   * Guard for the resolve_escalation action.
   *
   * Validates that:
   * 1. The task is in ESCALATED state.
   * 2. For mark_done resolution, evidence is provided (defense-in-depth
   *    beyond DTO validation). This is a sensitive action that bypasses
   *    normal quality checks and requires justification.
   *
   * @param taskId Task UUID.
   * @param resolutionType The type of escalation resolution being performed.
   * @param evidence Evidence of external completion (required for mark_done).
   * @throws BadRequestException if the task is not in ESCALATED state,
   *   or if mark_done is requested without evidence.
   */
  guardResolveEscalation(
    taskId: string,
    resolutionType: EscalationResolutionType,
    evidence?: string,
  ): void {
    const taskRepo = createTaskRepository(this.conn.db);
    const task = taskRepo.findById(taskId);

    if (!task) {
      // Let the service handle the not-found case with NotFoundException.
      return;
    }

    if (task.status !== TaskStatus.ESCALATED) {
      throw new BadRequestException(
        `Cannot resolve escalation for task "${taskId}" in state "${task.status}". ` +
          `Task must be in ESCALATED state.`,
      );
    }

    if (resolutionType === "mark_done" && (!evidence || evidence.trim().length === 0)) {
      throw new BadRequestException(
        `resolve_escalation with "mark_done" requires non-empty evidence ` +
          `explaining how the task was completed externally. This is a sensitive ` +
          `action that bypasses normal quality checks and will be logged with ` +
          `elevated audit severity.`,
      );
    }
  }
}
