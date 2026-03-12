/**
 * DTOs and Zod schemas for operator action endpoints.
 *
 * Each operator action has a dedicated DTO with validation. All actions
 * require an `actorId` identifying the operator, and most require a
 * `reason` explaining why the override was performed (for audit trail).
 *
 * Validated by the global {@link ZodValidationPipe} using the static
 * `schema` property on each class.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/prd/006-additional-refinements.md} §6.2
 */
import { z } from "zod";

/** Valid task priorities matching the domain enum. */
const priorityValues = ["critical", "high", "medium", "low"] as const;

/** Base schema fields shared by all operator actions. */
const baseActionFields = {
  /** Identifier of the operator performing the action. */
  actorId: z.string().min(1, "actorId is required"),
};

/** Base schema with reason field, shared by most operator actions. */
const baseActionWithReasonFields = {
  ...baseActionFields,
  /** Human-readable explanation for the action (audit trail). */
  reason: z.string().min(1, "reason is required"),
};

// ─── Pause ──────────────────────────────────────────────────────────────────

const pauseActionSchema = z.object({
  ...baseActionWithReasonFields,
});

/**
 * DTO for the pause action.
 *
 * Moves a task from any non-terminal state to ESCALATED with
 * an operator pause reason. Requires a human-readable reason
 * for the audit trail.
 */
export class PauseActionDto {
  static schema = pauseActionSchema;
  actorId!: string;
  reason!: string;
}

// ─── Resume ─────────────────────────────────────────────────────────────────

const resumeActionSchema = z.object({
  ...baseActionWithReasonFields,
});

/**
 * DTO for the resume action.
 *
 * Moves a task from ESCALATED to ASSIGNED, allowing it to be
 * picked up by a worker again. The original escalation reason
 * is preserved in history; the resume reason explains why the
 * operator decided to unblock.
 */
export class ResumeActionDto {
  static schema = resumeActionSchema;
  actorId!: string;
  reason!: string;
}

// ─── Requeue ────────────────────────────────────────────────────────────────

const requeueActionSchema = z.object({
  ...baseActionWithReasonFields,
});

/**
 * DTO for the requeue action.
 *
 * Moves a task from ASSIGNED or IN_DEVELOPMENT back to READY,
 * effectively cancelling the current work assignment and making
 * the task available for a new worker to pick up.
 */
export class RequeueActionDto {
  static schema = requeueActionSchema;
  actorId!: string;
  reason!: string;
}

// ─── Force Unblock ──────────────────────────────────────────────────────────

const forceUnblockActionSchema = z.object({
  ...baseActionWithReasonFields,
});

/**
 * DTO for the force-unblock action.
 *
 * Moves a task from BLOCKED to READY, overriding the dependency
 * check. The operator must provide a reason explaining why the
 * dependency can be safely bypassed.
 */
export class ForceUnblockActionDto {
  static schema = forceUnblockActionSchema;
  actorId!: string;
  reason!: string;
}

// ─── Change Priority ────────────────────────────────────────────────────────

const changePriorityActionSchema = z.object({
  ...baseActionFields,
  /** The new priority value. */
  priority: z.enum(priorityValues),
  /** Optional reason for the priority change. */
  reason: z.string().optional(),
});

/**
 * DTO for the change-priority action.
 *
 * Updates the task's scheduling priority without changing its state.
 * This affects which tasks the scheduler picks up first.
 */
export class ChangePriorityActionDto {
  static schema = changePriorityActionSchema;
  actorId!: string;
  priority!: string;
  reason?: string;
}

// ─── Reassign Pool ──────────────────────────────────────────────────────────

const reassignPoolActionSchema = z.object({
  ...baseActionWithReasonFields,
  /** Target pool identifier to assign the task to. */
  poolId: z.string().min(1, "poolId is required"),
});

/**
 * DTO for the reassign-pool action.
 *
 * Records a pool assignment hint on the task via metadata.
 * The scheduler uses this hint when selecting which pool should
 * pick up the task next. Stored as a JSON metadata annotation
 * on the task's required capabilities field.
 */
export class ReassignPoolActionDto {
  static schema = reassignPoolActionSchema;
  actorId!: string;
  poolId!: string;
  reason!: string;
}

// ─── Rerun Review ───────────────────────────────────────────────────────────

const rerunReviewActionSchema = z.object({
  ...baseActionWithReasonFields,
});

/**
 * DTO for the rerun-review action.
 *
 * Moves a task from APPROVED or IN_REVIEW back to DEV_COMPLETE,
 * triggering a fresh review cycle. The operator must explain why
 * the existing review is being invalidated.
 */
export class RerunReviewActionDto {
  static schema = rerunReviewActionSchema;
  actorId!: string;
  reason!: string;
}

// ─── Override Merge Order ───────────────────────────────────────────────────

const overrideMergeOrderActionSchema = z.object({
  ...baseActionFields,
  /** New 1-based position in the merge queue. */
  position: z.number().int().min(1, "position must be at least 1"),
  /** Optional reason for the reorder. */
  reason: z.string().optional(),
});

/**
 * DTO for the override-merge-order action.
 *
 * Changes the position of a task's merge queue item. Only valid
 * when the task is in QUEUED_FOR_MERGE state with an active
 * merge queue item.
 */
export class OverrideMergeOrderActionDto {
  static schema = overrideMergeOrderActionSchema;
  actorId!: string;
  position!: number;
  reason?: string;
}

// ─── Reopen ─────────────────────────────────────────────────────────────────

const reopenActionSchema = z.object({
  ...baseActionWithReasonFields,
});

/**
 * DTO for the reopen action.
 *
 * Moves a task from a terminal state (DONE, FAILED, CANCELLED)
 * back to BACKLOG so it can re-enter the development pipeline.
 * This is an operator override that bypasses the normal state machine.
 */
export class ReopenActionDto {
  static schema = reopenActionSchema;
  actorId!: string;
  reason!: string;
}

// ─── Cancel ─────────────────────────────────────────────────────────────────

const cancelActionSchema = z.object({
  ...baseActionWithReasonFields,
  /**
   * Explicit acknowledgment that in-progress work will be lost.
   * Required when cancelling a task in IN_DEVELOPMENT state.
   * Tasks in MERGING state cannot be cancelled regardless of this flag.
   */
  acknowledgeInProgressWork: z.boolean().optional(),
});

/**
 * DTO for the cancel action.
 *
 * Moves a task from any non-terminal state to CANCELLED.
 * This is a terminal transition — the task cannot re-enter the
 * pipeline unless explicitly reopened by an operator.
 *
 * If the task has active work in progress (IN_DEVELOPMENT), the
 * operator must set `acknowledgeInProgressWork: true` to confirm
 * that in-progress work will be discarded. Tasks in MERGING state
 * cannot be cancelled at all — wait for the merge to complete.
 *
 * @see {@link file://docs/backlog/tasks/T102-operator-guards.md}
 */
export class CancelActionDto {
  static schema = cancelActionSchema;
  actorId!: string;
  reason!: string;
  acknowledgeInProgressWork?: boolean;
}

// ─── Resolve Escalation ─────────────────────────────────────────────────────

/** Valid escalation resolution types. */
const escalationResolutionTypes = ["retry", "cancel", "mark_done"] as const;

/** Zod type for escalation resolution types. */
export type EscalationResolutionType = (typeof escalationResolutionTypes)[number];

const resolveEscalationActionSchema = z
  .object({
    ...baseActionWithReasonFields,
    /**
     * Resolution type:
     * - `retry`: Move task back to ASSIGNED for a new development attempt.
     * - `cancel`: Abandon the task (move to CANCELLED).
     * - `mark_done`: Mark the task as externally completed (move to DONE).
     */
    resolutionType: z.enum(escalationResolutionTypes),
    /**
     * Optional pool ID to reassign the task to on retry.
     * Only used when resolutionType is "retry".
     */
    poolId: z.string().min(1).optional(),
    /**
     * Evidence or description of external completion.
     * Required when resolutionType is "mark_done".
     */
    evidence: z.string().min(1).optional(),
  })
  .refine(
    (data) => data.resolutionType !== "mark_done" || (data.evidence && data.evidence.length > 0),
    {
      message:
        'evidence is required when resolutionType is "mark_done". ' +
        "Provide a description of how the task was completed externally.",
      path: ["evidence"],
    },
  );

/**
 * DTO for the resolve_escalation action.
 *
 * Provides a unified endpoint for resolving escalated tasks with one of
 * three resolution types: retry (→ ASSIGNED), cancel (→ CANCELLED),
 * or mark_done (→ DONE). Only valid when the task is in ESCALATED state.
 *
 * - **retry**: Clears the escalation context and optionally reassigns
 *   the task to a different worker pool. A new lease will be acquired.
 * - **cancel**: Preserves the escalation context in the audit trail
 *   and moves the task to CANCELLED terminal state.
 * - **mark_done**: Requires evidence of external completion. This is
 *   a sensitive action that bypasses normal quality checks and is
 *   logged with elevated audit severity.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.7 Escalation
 * @see {@link file://docs/backlog/tasks/T103-escalation-resolution.md}
 */
export class ResolveEscalationDto {
  static schema = resolveEscalationActionSchema;
  actorId!: string;
  reason!: string;
  resolutionType!: EscalationResolutionType;
  poolId?: string;
  evidence?: string;
}
