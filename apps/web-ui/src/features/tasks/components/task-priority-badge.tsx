/**
 * Color-coded priority badge for task priorities.
 *
 * Provides visual differentiation of task priority levels so operators
 * can quickly identify critical and high-priority items in the task board.
 *
 * @see T094 — Build task board with status filtering and pagination
 */

import { Badge, type BadgeProps } from "../../../components/ui/badge.js";
import { cn } from "../../../lib/utils.js";
import type { TaskPriority } from "../../../api/types.js";

/** Display configuration for each priority level. */
const PRIORITY_CONFIG: Record<TaskPriority, { label: string; className: string }> = {
  critical: {
    label: "Critical",
    className:
      "border-red-300 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-900 dark:text-red-200",
  },
  high: {
    label: "High",
    className:
      "border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-700 dark:bg-orange-900 dark:text-orange-200",
  },
  medium: {
    label: "Medium",
    className:
      "border-yellow-300 bg-yellow-100 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900 dark:text-yellow-200",
  },
  low: {
    label: "Low",
    className:
      "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
  },
};

/** All valid priority values in display order (highest first). */
export const PRIORITY_OPTIONS: readonly TaskPriority[] = ["critical", "high", "medium", "low"];

export interface TaskPriorityBadgeProps extends Omit<BadgeProps, "variant"> {
  /** The task priority value. */
  readonly priority: TaskPriority;
}

/**
 * Renders a color-coded badge for a task priority.
 *
 * Critical priorities use a vivid red to demand attention, while
 * lower priorities fade to neutral tones.
 */
export function TaskPriorityBadge({ priority, className, ...props }: TaskPriorityBadgeProps) {
  const config = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.medium;

  return (
    <Badge
      variant="outline"
      className={cn(config.className, className)}
      data-testid={`priority-badge-${priority}`}
      {...props}
    >
      {config.label}
    </Badge>
  );
}
