/**
 * Worker table component for the pool detail view.
 *
 * Displays a table of workers registered in a pool with their
 * status, current task assignment, and last heartbeat time.
 *
 * @see T096 — Build worker pool monitoring panel
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.js";
import { Badge } from "../../../components/ui/badge.js";
import { cn } from "../../../lib/utils.js";

/** Worker record as returned by `GET /pools/:id/workers`. */
export interface WorkerRecord {
  readonly workerId: string;
  readonly name: string;
  readonly status: string;
  readonly host: string | null;
  readonly runtimeVersion: string | null;
  readonly lastHeartbeatAt: string | null;
  readonly currentTaskId: string | null;
  readonly currentRunId: string | null;
}

export interface WorkerTableProps {
  /** Workers to display. */
  readonly workers: readonly WorkerRecord[];
  /** Whether data is still loading. */
  readonly isLoading: boolean;
}

/** Status color mapping for worker status badges. */
const STATUS_COLORS: Record<string, string> = {
  online:
    "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400",
  busy: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400",
  draining:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400",
  offline:
    "border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400",
};

/**
 * Formats a timestamp into a relative or short absolute string.
 *
 * Shows relative time for recent heartbeats (< 24h) and absolute
 * date for older ones. Returns "—" for null timestamps.
 */
function formatHeartbeat(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1_000);
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Renders a table of workers for a pool detail view.
 *
 * Displays worker ID (truncated), status badge, current task assignment,
 * last heartbeat, and host information. Loading state shows skeleton rows.
 * Empty state shows an informative message.
 */
export function WorkerTable({ workers, isLoading }: WorkerTableProps) {
  if (isLoading) {
    return (
      <div data-testid="worker-table-skeleton">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Worker</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Current Task</TableHead>
              <TableHead className="text-right">Last Heartbeat</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 3 }, (_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                </TableCell>
                <TableCell>
                  <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
                </TableCell>
                <TableCell>
                  <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                </TableCell>
                <TableCell className="text-right">
                  <div className="ml-auto h-4 w-16 animate-pulse rounded bg-muted" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (workers.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-md border border-dashed p-8 text-center"
        data-testid="worker-table-empty"
      >
        <p className="text-sm font-medium text-muted-foreground">No workers registered</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Workers will appear here when they connect to this pool.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="worker-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Worker</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Current Task</TableHead>
            <TableHead className="text-right">Last Heartbeat</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workers.map((worker) => (
            <TableRow key={worker.workerId} data-testid={`worker-row-${worker.workerId}`}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium text-sm">{worker.name}</span>
                  {worker.host && (
                    <span className="text-xs text-muted-foreground">{worker.host}</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={cn(STATUS_COLORS[worker.status] ?? "")}
                  data-testid={`worker-status-${worker.workerId}`}
                >
                  {worker.status}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {worker.currentTaskId ? (
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">
                    {worker.currentTaskId.slice(0, 8)}…
                  </code>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right text-sm text-muted-foreground">
                {formatHeartbeat(worker.lastHeartbeatAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
