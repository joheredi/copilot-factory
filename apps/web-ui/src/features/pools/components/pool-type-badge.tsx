/**
 * Badge component for displaying a pool's worker type.
 *
 * Renders a color-coded pill that distinguishes pool roles:
 * developer, reviewer, lead-reviewer, merge-assist, and planner.
 *
 * @see T096 — Build worker pool monitoring panel
 */

import { Badge } from "../../../components/ui/badge.js";
import { cn } from "../../../lib/utils.js";
import type { PoolType } from "../../../api/types.js";

/** Display labels for pool types. */
const POOL_TYPE_LABELS: Record<PoolType, string> = {
  developer: "Developer",
  reviewer: "Reviewer",
  "lead-reviewer": "Lead Reviewer",
  "merge-assist": "Merge Assist",
  planner: "Planner",
};

/** Tailwind color classes per pool type for visual differentiation. */
const POOL_TYPE_COLORS: Record<PoolType, string> = {
  developer:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400",
  reviewer:
    "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-400",
  "lead-reviewer":
    "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-400",
  "merge-assist":
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400",
  planner:
    "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-400",
};

export interface PoolTypeBadgeProps {
  /** The pool type to display. */
  readonly poolType: PoolType;
}

/**
 * Renders a semantic badge for the pool's worker role.
 *
 * Each pool type has a distinct color for quick visual scanning
 * in the pool list view.
 */
export function PoolTypeBadge({ poolType }: PoolTypeBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(POOL_TYPE_COLORS[poolType] ?? "")}
      data-testid={`pool-type-${poolType}`}
    >
      {POOL_TYPE_LABELS[poolType] ?? poolType}
    </Badge>
  );
}
