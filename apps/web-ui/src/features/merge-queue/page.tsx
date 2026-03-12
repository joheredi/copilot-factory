import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Filter, GitMerge, Loader2, PauseCircle } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { useMergeQueue } from "../../api/hooks";
import { MergeQueueStatusBadge } from "./MergeQueueStatusBadge";
import type { MergeQueueListParams } from "../../api/types";

/** All valid merge queue item statuses for the filter bar. */
const MERGE_STATUSES = [
  "ENQUEUED",
  "PREPARING",
  "REBASING",
  "VALIDATING",
  "MERGING",
  "MERGED",
  "REQUEUED",
  "FAILED",
] as const;

/** Active merge statuses that indicate processing is underway. */
const ACTIVE_STATUSES = new Set(["PREPARING", "REBASING", "VALIDATING", "MERGING"]);

/**
 * Format an ISO timestamp or Date string to a human-readable relative or absolute time.
 *
 * @param dateStr - ISO date string or null.
 * @returns Formatted date string or "—" for null values.
 */
function formatTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

/**
 * Merge Queue page.
 *
 * Displays the merge queue as an ordered table showing each item's
 * position, associated task, status, enqueued time, and merge timing.
 * Supports status filtering and highlights the actively merging item.
 * Shows a prominent pause indicator when any item has failed.
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — Merge Queue screen
 * @see {@link file://docs/backlog/tasks/T098-build-merge-queue-view.md}
 */
export default function MergeQueuePage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [showFilters, setShowFilters] = useState(false);

  const params: MergeQueueListParams = {
    page: 1,
    limit: 100,
    ...(statusFilter ? { status: statusFilter } : {}),
  };

  const { data, isLoading, isError } = useMergeQueue(params);
  const items = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  const hasFailedItems = items.some((item) => item.status === "FAILED");
  const activeItem = items.find((item) => ACTIVE_STATUSES.has(item.status));
  const activeFilterCount = statusFilter ? 1 : 0;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Merge Queue</h1>
        <p className="text-muted-foreground">Monitor merge operations and conflict resolution</p>
      </div>

      {/* Queue pause warning when failures exist */}
      {hasFailedItems && (
        <Card className="border-red-300 bg-red-50" data-testid="queue-pause-warning">
          <CardContent className="flex items-center gap-3 py-4">
            <PauseCircle className="h-5 w-5 text-red-600" />
            <div>
              <p className="font-medium text-red-800">Queue processing may be paused</p>
              <p className="text-sm text-red-700">
                One or more items have failed. Review failed items below.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active merge progress */}
      {activeItem && (
        <Card className="border-purple-300 bg-purple-50" data-testid="active-merge-indicator">
          <CardContent className="flex items-center gap-3 py-4">
            <Loader2 className="h-5 w-5 animate-spin text-purple-600" />
            <div>
              <p className="font-medium text-purple-800">Active merge: {activeItem.taskTitle}</p>
              <p className="text-sm text-purple-700">
                Status: {activeItem.status} — Position #{activeItem.position}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter controls */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters((prev) => !prev)}
          data-testid="toggle-filters"
        >
          <Filter className="mr-1 h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
        <span className="text-sm text-muted-foreground" data-testid="queue-count">
          {total} item{total !== 1 ? "s" : ""} in queue
        </span>
      </div>

      {showFilters && (
        <Card data-testid="filter-bar">
          <CardContent className="flex flex-wrap items-center gap-2 py-3">
            <span className="text-sm font-medium">Status:</span>
            {MERGE_STATUSES.map((status) => (
              <Button
                key={status}
                variant={statusFilter === status ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(statusFilter === status ? undefined : status)}
                data-testid={`filter-status-${status.toLowerCase()}`}
              >
                {status}
              </Button>
            ))}
            {statusFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStatusFilter(undefined)}
                data-testid="clear-filters"
              >
                Clear
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {isError && (
        <div
          role="alert"
          className="rounded-md bg-destructive/10 p-4 text-destructive"
          data-testid="merge-queue-error"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <p>Failed to load merge queue. Please try again.</p>
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <Card data-testid="merge-queue-loading">
          <CardContent className="py-6">
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-muted" />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Queue table */}
      {!isLoading && !isError && items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitMerge className="h-5 w-5" />
              Queue Items
            </CardTitle>
            <CardDescription>
              Items ordered by merge position — lower positions merge first
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="merge-queue-table">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">#</th>
                    <th className="pb-2 pr-4 font-medium">Task</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Enqueued</th>
                    <th className="pb-2 pr-4 font-medium">Started</th>
                    <th className="pb-2 font-medium">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const isActive = ACTIVE_STATUSES.has(item.status);
                    return (
                      <tr
                        key={item.mergeQueueItemId}
                        className={`border-b last:border-0 ${
                          isActive ? "bg-purple-50" : item.status === "FAILED" ? "bg-red-50" : ""
                        }`}
                        data-testid={`merge-item-${item.mergeQueueItemId}`}
                      >
                        <td className="py-3 pr-4 font-mono text-muted-foreground">
                          {item.position}
                        </td>
                        <td className="py-3 pr-4">
                          <Link
                            to={`/tasks/${item.taskId}`}
                            className="font-medium text-primary hover:underline"
                            data-testid={`task-link-${item.taskId}`}
                          >
                            {item.taskTitle}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {item.taskId.slice(0, 8)}…
                          </p>
                        </td>
                        <td className="py-3 pr-4">
                          <MergeQueueStatusBadge status={item.status} />
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {formatTime(item.enqueuedAt)}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {formatTime(item.startedAt)}
                        </td>
                        <td className="py-3 text-muted-foreground">
                          {formatTime(item.completedAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !isError && items.length === 0 && (
        <Card data-testid="merge-queue-empty">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <GitMerge className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-lg font-medium">No items in the merge queue</p>
            <p className="text-sm text-muted-foreground">
              {statusFilter
                ? `No items match the "${statusFilter}" filter.`
                : "Tasks will appear here when they are queued for merge."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
