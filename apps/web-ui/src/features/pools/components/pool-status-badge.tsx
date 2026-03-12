/**
 * Badge component for pool enabled/disabled status.
 *
 * Renders a color-coded pill indicating whether a worker pool is
 * currently enabled (accepting work) or disabled (paused).
 *
 * @see T096 — Build worker pool monitoring panel
 */

import { Badge } from "../../../components/ui/badge.js";
import { cn } from "../../../lib/utils.js";

export interface PoolStatusBadgeProps {
  /** Whether the pool is enabled. */
  readonly enabled: boolean;
}

/**
 * Displays a visual indicator of pool availability.
 *
 * Green for enabled pools (actively processing tasks),
 * muted gray for disabled pools (paused by operator).
 */
export function PoolStatusBadge({ enabled }: PoolStatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5",
        enabled
          ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
          : "border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400",
      )}
      data-testid={enabled ? "pool-status-enabled" : "pool-status-disabled"}
    >
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          enabled ? "bg-green-500" : "bg-gray-400",
        )}
      />
      {enabled ? "Enabled" : "Disabled"}
    </Badge>
  );
}
