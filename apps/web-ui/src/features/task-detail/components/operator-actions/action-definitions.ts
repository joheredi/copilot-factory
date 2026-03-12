/**
 * Maps each task status to the set of valid operator actions.
 *
 * This mapping mirrors the backend operator action guards and state
 * machine transitions. Each status maps to an array of action
 * identifiers that are valid for a task in that state.
 *
 * @see apps/control-plane/src/operator-actions/operator-actions.service.ts
 * @see apps/control-plane/src/operator-actions/operator-action-guards.ts
 * @see docs/prd/006-additional-refinements.md §6.2 — Operator actions
 */

/** Identifier for each operator action available in the UI. */
export type OperatorActionId =
  | "pause"
  | "resume"
  | "requeue"
  | "force-unblock"
  | "cancel"
  | "change-priority"
  | "rerun-review"
  | "override-merge-order"
  | "reopen"
  | "resolve-escalation";

/** Metadata for rendering an operator action button. */
export interface OperatorActionDef {
  /** Unique action identifier matching the API endpoint suffix. */
  readonly id: OperatorActionId;
  /** Human-readable label for the button. */
  readonly label: string;
  /** Whether a confirmation dialog with reason input is required. */
  readonly requiresConfirmation: boolean;
  /** Visual variant for the button (destructive actions use "destructive"). */
  readonly variant: "default" | "destructive" | "outline" | "secondary" | "ghost";
  /** Short description shown in the confirmation dialog. */
  readonly description: string;
}

/** Complete definition for each operator action. */
const ACTION_DEFS: Record<OperatorActionId, OperatorActionDef> = {
  pause: {
    id: "pause",
    label: "Pause",
    requiresConfirmation: true,
    variant: "secondary",
    description: "Pause this task and escalate it for manual review.",
  },
  resume: {
    id: "resume",
    label: "Resume",
    requiresConfirmation: true,
    variant: "default",
    description: "Resume this escalated task and reassign it to a worker.",
  },
  requeue: {
    id: "requeue",
    label: "Requeue",
    requiresConfirmation: true,
    variant: "secondary",
    description: "Cancel the current assignment and re-add to the ready queue.",
  },
  "force-unblock": {
    id: "force-unblock",
    label: "Force Unblock",
    requiresConfirmation: true,
    variant: "destructive",
    description:
      "Override dependency checks and move this task to the ready queue. This is a sensitive action that bypasses safety checks.",
  },
  cancel: {
    id: "cancel",
    label: "Cancel",
    requiresConfirmation: true,
    variant: "destructive",
    description: "Permanently cancel this task. This action cannot be easily undone.",
  },
  "change-priority": {
    id: "change-priority",
    label: "Change Priority",
    requiresConfirmation: false,
    variant: "outline",
    description: "Update the scheduling priority for this task.",
  },
  "rerun-review": {
    id: "rerun-review",
    label: "Rerun Review",
    requiresConfirmation: true,
    variant: "secondary",
    description: "Invalidate the current review and start a fresh review cycle.",
  },
  "override-merge-order": {
    id: "override-merge-order",
    label: "Override Merge Order",
    requiresConfirmation: true,
    variant: "secondary",
    description: "Change this task's position in the merge queue.",
  },
  reopen: {
    id: "reopen",
    label: "Reopen",
    requiresConfirmation: true,
    variant: "default",
    description: "Move this task back to the backlog for re-processing.",
  },
  "resolve-escalation": {
    id: "resolve-escalation",
    label: "Resolve Escalation",
    requiresConfirmation: false,
    variant: "default",
    description: "Resolve this escalated task via retry, cancel, or mark as done.",
  },
};

/**
 * Maps task status to the ordered list of valid operator actions.
 *
 * The order determines button rendering order in the action bar.
 * Actions that require confirmation (destructive or state-changing)
 * are placed after non-destructive actions.
 */
const STATUS_ACTIONS: Record<string, OperatorActionId[]> = {
  BACKLOG: ["change-priority", "cancel"],
  READY: ["change-priority", "cancel"],
  BLOCKED: ["force-unblock", "change-priority", "cancel"],
  ASSIGNED: ["change-priority", "pause", "requeue", "cancel"],
  IN_DEVELOPMENT: ["change-priority", "pause", "requeue", "cancel"],
  DEV_COMPLETE: ["change-priority", "pause", "cancel"],
  IN_REVIEW: ["change-priority", "rerun-review", "pause", "cancel"],
  CHANGES_REQUESTED: ["change-priority", "pause", "cancel"],
  APPROVED: ["change-priority", "rerun-review", "pause", "cancel"],
  QUEUED_FOR_MERGE: ["change-priority", "override-merge-order", "pause", "cancel"],
  MERGING: ["change-priority"],
  POST_MERGE_VALIDATION: ["change-priority", "pause", "cancel"],
  DONE: ["reopen"],
  FAILED: ["reopen"],
  CANCELLED: ["reopen"],
  ESCALATED: ["resolve-escalation"],
};

/**
 * Returns the ordered list of valid operator action definitions for a task status.
 *
 * @param status - Current task status string.
 * @returns Array of action definitions, empty if status has no valid actions.
 */
export function getActionsForStatus(status: string): OperatorActionDef[] {
  const actionIds = STATUS_ACTIONS[status] ?? [];
  return actionIds.map((id) => ACTION_DEFS[id]);
}

/**
 * Returns a single action definition by ID.
 *
 * @param id - The action identifier.
 * @returns The action definition.
 */
export function getActionDef(id: OperatorActionId): OperatorActionDef {
  return ACTION_DEFS[id];
}
