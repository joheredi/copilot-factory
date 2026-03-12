/**
 * Color-coded status badge for task states.
 *
 * Groups task statuses into visual categories so operators can quickly
 * scan the task board and identify task lifecycle phases at a glance.
 *
 * Color mapping:
 * - **Blue** (default): Active states where work is happening
 * - **Purple** (secondary): Review states
 * - **Green** (outline with green text): Terminal success
 * - **Red** (destructive): Failed/escalated/cancelled
 * - **Yellow/amber** (outline): Waiting/queued states
 *
 * @see docs/prd/002-data-model.md — Task state machine
 * @see T094 — Build task board with status filtering and pagination
 */

import { Badge, type BadgeProps } from "../../../components/ui/badge.js";
import { cn } from "../../../lib/utils.js";

/** Maps task status values to human-readable display labels. */
const STATUS_LABELS: Record<string, string> = {
  BACKLOG: "Backlog",
  READY: "Ready",
  BLOCKED: "Blocked",
  ASSIGNED: "Assigned",
  IN_DEVELOPMENT: "In Development",
  DEV_COMPLETE: "Dev Complete",
  IN_REVIEW: "In Review",
  CHANGES_REQUESTED: "Changes Requested",
  APPROVED: "Approved",
  QUEUED_FOR_MERGE: "Queued for Merge",
  MERGING: "Merging",
  POST_MERGE_VALIDATION: "Post-Merge Validation",
  DONE: "Done",
  FAILED: "Failed",
  ESCALATED: "Escalated",
  CANCELLED: "Cancelled",
};

/** Status category used to determine badge styling. */
type StatusCategory = "active" | "review" | "queued" | "success" | "error" | "blocked";

/** Maps each task status to its visual category. */
function getStatusCategory(status: string): StatusCategory {
  switch (status) {
    case "ASSIGNED":
    case "IN_DEVELOPMENT":
    case "DEV_COMPLETE":
    case "MERGING":
    case "POST_MERGE_VALIDATION":
      return "active";
    case "IN_REVIEW":
    case "CHANGES_REQUESTED":
    case "APPROVED":
      return "review";
    case "BACKLOG":
    case "READY":
    case "QUEUED_FOR_MERGE":
      return "queued";
    case "DONE":
      return "success";
    case "FAILED":
    case "ESCALATED":
    case "CANCELLED":
      return "error";
    case "BLOCKED":
      return "blocked";
    default:
      return "queued";
  }
}

/** Tailwind classes for each status category. */
const CATEGORY_STYLES: Record<StatusCategory, string> = {
  active:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300",
  review:
    "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300",
  queued:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  success:
    "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300",
  error:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
  blocked:
    "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300",
};

export interface TaskStatusBadgeProps extends Omit<BadgeProps, "variant"> {
  /** The task status value (e.g. "IN_DEVELOPMENT"). */
  readonly status: string;
}

/**
 * Renders a color-coded badge for a task status.
 *
 * Uses the status category mapping to apply semantic colors,
 * making it easy for operators to distinguish lifecycle phases
 * in the task board table.
 */
export function TaskStatusBadge({ status, className, ...props }: TaskStatusBadgeProps) {
  const category = getStatusCategory(status);
  const label = STATUS_LABELS[status] ?? status;

  return (
    <Badge
      variant="outline"
      className={cn(CATEGORY_STYLES[category], className)}
      data-testid={`status-badge-${status}`}
      {...props}
    >
      {label}
    </Badge>
  );
}

/**
 * Returns all valid task statuses grouped by category.
 * Used by filter components to build the status filter options.
 */
export function getStatusGroups(): Record<StatusCategory, readonly string[]> {
  return {
    active: ["ASSIGNED", "IN_DEVELOPMENT", "DEV_COMPLETE", "MERGING", "POST_MERGE_VALIDATION"],
    review: ["IN_REVIEW", "CHANGES_REQUESTED", "APPROVED"],
    queued: ["BACKLOG", "READY", "QUEUED_FOR_MERGE"],
    success: ["DONE"],
    error: ["FAILED", "ESCALATED", "CANCELLED"],
    blocked: ["BLOCKED"],
  };
}

/** Returns the human-readable label for a task status. */
export function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
