/**
 * Status badge for merge queue items.
 *
 * Color-codes merge queue item statuses to provide at-a-glance
 * visual feedback. Active states use warm/action colors, terminal
 * states use green (success) or red (failure), and transitional
 * states use blue/amber.
 *
 * @module @factory/web-ui/features/merge-queue
 * @see {@link file://docs/backlog/tasks/T098-build-merge-queue-view.md}
 */

import { Badge } from "../../components/ui/badge";

/** Mapping from merge queue item status to badge style classes. */
const STATUS_STYLES: Record<string, string> = {
  ENQUEUED: "bg-slate-100 text-slate-800 border-slate-300",
  PREPARING: "bg-blue-100 text-blue-800 border-blue-300",
  REBASING: "bg-indigo-100 text-indigo-800 border-indigo-300",
  VALIDATING: "bg-amber-100 text-amber-800 border-amber-300",
  MERGING: "bg-purple-100 text-purple-800 border-purple-300",
  MERGED: "bg-green-100 text-green-800 border-green-300",
  REQUEUED: "bg-orange-100 text-orange-800 border-orange-300",
  FAILED: "bg-red-100 text-red-800 border-red-300",
};

const DEFAULT_STYLE = "bg-gray-100 text-gray-800 border-gray-300";

/**
 * Renders a color-coded badge for a merge queue item status.
 *
 * @param props.status - The merge queue item status string.
 */
export function MergeQueueStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? DEFAULT_STYLE;
  return (
    <Badge variant="outline" className={style} data-testid={`merge-status-${status.toLowerCase()}`}>
      {status}
    </Badge>
  );
}
