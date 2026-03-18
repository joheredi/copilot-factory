/**
 * Worker detail page.
 *
 * Displays individual worker information and a terminal-style output
 * panel for viewing live or historical stdout/stderr from the worker's
 * current (or most recent) run.
 *
 * Accessed via `/workers/:poolId/worker/:workerId` from the pool detail
 * worker table.
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — UI screen list
 */

import { ArrowLeft } from "lucide-react";
import { useParams, Link } from "react-router-dom";
import { usePoolWorkers } from "../../api/hooks/use-pools.js";
import { Button } from "../../components/ui/button.js";
import { Badge } from "../../components/ui/badge.js";
import { cn } from "../../lib/utils.js";
import { WorkerOutputPanel } from "../task-detail/WorkerOutputPanel.js";
import type { WorkerRecord } from "./components/worker-table.js";

/** Status color mapping matching the worker table. */
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
 * Worker detail page component.
 *
 * Fetches the worker list for the pool and finds the matching worker by ID.
 * Renders worker metadata and a full-height output panel.
 */
export default function WorkerDetailPage() {
  const { poolId, workerId } = useParams<{ poolId: string; workerId: string }>();
  const { data: workers, isLoading, isError } = usePoolWorkers(poolId);

  const worker = (workers as WorkerRecord[] | undefined)?.find((w) => w.workerId === workerId);

  if (isLoading) {
    return (
      <div className="space-y-6" data-testid="worker-detail-loading">
        <div className="flex items-center gap-4">
          <div className="h-8 w-8 animate-pulse rounded bg-muted" />
          <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  if (isError || !worker) {
    return (
      <div className="space-y-4" data-testid="worker-detail-error">
        <Link to={poolId ? `/workers/${poolId}` : "/workers"}>
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Pool
          </Button>
        </Link>
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          <strong>Unable to load worker.</strong>{" "}
          {workerId
            ? `Worker "${workerId}" was not found or is no longer active.`
            : "No worker ID provided."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="worker-detail-page">
      {/* Back navigation + header */}
      <div>
        <Link to={`/workers/${poolId}`}>
          <Button variant="ghost" size="sm" className="mb-2 gap-2" data-testid="back-to-pool">
            <ArrowLeft className="h-4 w-4" />
            Back to Pool
          </Button>
        </Link>

        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight" data-testid="worker-name">
              {worker.name}
            </h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <code data-testid="worker-id">{worker.workerId}</code>
              <span>·</span>
              <Badge
                variant="outline"
                className={cn(STATUS_COLORS[worker.status] ?? "")}
                data-testid="worker-status"
              >
                {worker.status}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Worker metadata */}
      <div
        className="grid grid-cols-2 gap-4 rounded-md border p-4 md:grid-cols-4"
        data-testid="worker-metadata"
      >
        <div>
          <p className="text-xs font-medium text-muted-foreground">Host</p>
          <p className="text-sm">{worker.host ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Runtime</p>
          <p className="text-sm">{worker.runtimeVersion ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Current Task</p>
          <p className="text-sm">
            {worker.currentTaskId ? (
              <Link to={`/tasks/${worker.currentTaskId}`} className="text-primary hover:underline">
                <code>{worker.currentTaskId.slice(0, 12)}…</code>
              </Link>
            ) : (
              "—"
            )}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Current Run</p>
          <p className="text-sm">
            {worker.currentRunId ? (
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {worker.currentRunId.slice(0, 12)}…
              </code>
            ) : (
              "—"
            )}
          </p>
        </div>
      </div>

      {/* Worker output panel */}
      <WorkerOutputPanel
        workerId={
          worker.status === "running" || worker.status === "starting" ? worker.workerId : null
        }
        taskId={worker.currentTaskId ?? ""}
      />
    </div>
  );
}
