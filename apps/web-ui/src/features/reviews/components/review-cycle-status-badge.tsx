/**
 * Color-coded badge for review cycle statuses.
 *
 * Maps the 8 review cycle lifecycle statuses to semantic colors so
 * operators can quickly identify where each review stands:
 * - **Slate**: Not started / initial states
 * - **Blue/Indigo**: Active processing (routed, in progress, consolidating)
 * - **Amber**: Waiting states (awaiting required reviews)
 * - **Green**: Terminal success (approved)
 * - **Red**: Terminal failure or escalation (rejected, escalated)
 *
 * @see packages/domain/src/enums.ts — ReviewCycleStatus enum
 * @see T097 — Build review center view
 */

import { Badge } from "../../../components/ui/badge";
import { cn } from "../../../lib/utils";

/** Tailwind classes for each review cycle status. */
const CYCLE_STATUS_STYLES: Record<string, string> = {
  NOT_STARTED:
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300",
  ROUTED:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300",
  IN_PROGRESS:
    "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  AWAITING_REQUIRED_REVIEWS:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  CONSOLIDATING:
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300",
  APPROVED:
    "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300",
  REJECTED:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
  ESCALATED:
    "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300",
};

/** Human-readable labels for review cycle statuses. */
const CYCLE_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not Started",
  ROUTED: "Routed",
  IN_PROGRESS: "In Progress",
  AWAITING_REQUIRED_REVIEWS: "Awaiting Reviews",
  CONSOLIDATING: "Consolidating",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ESCALATED: "Escalated",
};

const DEFAULT_STYLE =
  "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300";

export interface ReviewCycleStatusBadgeProps {
  /** The review cycle status value (e.g. "IN_PROGRESS"). */
  readonly status: string;
  /** Optional additional CSS classes. */
  readonly className?: string;
}

/**
 * Renders a color-coded badge for a review cycle status.
 *
 * Uses semantic coloring to communicate review lifecycle phase,
 * helping operators distinguish active reviews from completed or
 * escalated ones at a glance.
 */
export function ReviewCycleStatusBadge({ status, className }: ReviewCycleStatusBadgeProps) {
  const style = CYCLE_STATUS_STYLES[status] ?? DEFAULT_STYLE;
  const label = CYCLE_STATUS_LABELS[status] ?? status;

  return (
    <Badge
      variant="outline"
      className={cn(style, className)}
      data-testid={`review-cycle-status-${status.toLowerCase()}`}
    >
      {label}
    </Badge>
  );
}
