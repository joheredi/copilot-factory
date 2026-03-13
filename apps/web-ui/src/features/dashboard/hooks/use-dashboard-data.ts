/**
 * Custom hook that aggregates data from multiple API endpoints
 * to produce a dashboard summary view.
 *
 * Uses parallel TanStack Query requests with minimal page sizes
 * (limit=1) to efficiently obtain total counts per task status
 * category without fetching full entity payloads. Pool and audit
 * data are fetched at small page sizes suitable for the dashboard.
 *
 * Live updates are handled automatically via WebSocket-driven
 * cache invalidation (see {@link ../../../lib/websocket/invalidation.ts}).
 *
 * @module
 * @see docs/prd/001-architecture.md §1.9 — Dashboard view spec
 */

import { useQueries, useQuery } from "@tanstack/react-query";
import { apiGet } from "../../../api/client.js";
import { queryKeys } from "../../../api/query-keys.js";
import type { AuditEvent, PaginatedResponse, Task, WorkerPool } from "../../../api/types.js";

// ---------------------------------------------------------------------------
// Task state categories — grouped for operator-facing summary cards
// ---------------------------------------------------------------------------

/** States where a worker is actively processing the task. */
const ACTIVE_STATES = [
  "ASSIGNED",
  "IN_DEVELOPMENT",
  "DEV_COMPLETE",
  "IN_REVIEW",
  "MERGING",
  "POST_MERGE_VALIDATION",
] as const;

/** States where the task is waiting to be picked up. */
const QUEUED_STATES = ["BACKLOG", "READY", "QUEUED_FOR_MERGE"] as const;

/** Terminal success state. */
const COMPLETED_STATES = ["DONE"] as const;

/** States requiring operator attention. */
const ATTENTION_STATES = [
  "FAILED",
  "CANCELLED",
  "ESCALATED",
  "CHANGES_REQUESTED",
  "BLOCKED",
] as const;

export type TaskStateCategory = "active" | "queued" | "completed" | "attention";

export interface TaskCategoryCounts {
  readonly active: number;
  readonly queued: number;
  readonly completed: number;
  readonly attention: number;
  readonly total: number;
}

export interface PoolSummary {
  readonly totalPools: number;
  readonly enabledPools: number;
  readonly totalMaxConcurrency: number;
}

export interface DashboardData {
  /** Task counts grouped by operator-facing category. */
  readonly taskCounts: TaskCategoryCounts;
  /** Worker pool summary. */
  readonly poolSummary: PoolSummary;
  /** Most recent audit events for the activity feed. */
  readonly recentActivity: readonly AuditEvent[];
  /** Whether any query is still loading initial data. */
  readonly isLoading: boolean;
  /** Whether any query encountered an error. */
  readonly isError: boolean;
}

/**
 * Fetches a task list with limit=1 for a single status value,
 * extracting only the total count from the paginated response.
 *
 * When `repositoryId` is provided, scopes the count to tasks in
 * that repository (used for per-project filtering).
 *
 * @param status - Task status string to filter by.
 * @param repositoryId - Optional repository ID to filter by.
 * @returns Query options that resolve to the total count.
 */
function taskCountQuery(status: string, repositoryId?: string) {
  const params: Record<string, unknown> = { status, limit: 1, page: 1 };
  if (repositoryId) {
    params["repositoryId"] = repositoryId;
  }
  return {
    queryKey: [...queryKeys.tasks.all, "dashboard-count", status, repositoryId ?? "all"] as const,
    queryFn: async () => {
      const response = await apiGet<PaginatedResponse<Task>>("/tasks", params);
      return response.meta.total;
    },
    staleTime: 15_000,
  };
}

/**
 * Options for the dashboard data hook.
 *
 * @see T150 — Add multi-project filter to dashboard
 */
export interface DashboardDataOptions {
  /**
   * When provided, task counts and activity are scoped to these repositories.
   * Pass an empty array or omit to show aggregate data across all projects.
   */
  readonly repositoryIds?: readonly string[];
}

/**
 * Aggregates dashboard data from multiple concurrent API queries.
 *
 * Queries are structured to minimise payload size:
 * - Task counts use limit=1 per status with only `total` extracted
 * - Pool list uses a small page size
 * - Audit feed fetches only the 10 most recent events
 *
 * When `repositoryIds` are provided, task counts are scoped to those
 * repositories by making a separate count query per repository per
 * status and summing the results.
 *
 * @param options - Optional filtering options (e.g. repositoryIds for project scoping).
 * @returns Aggregated dashboard data with loading/error states.
 */
export function useDashboardData(options?: DashboardDataOptions): DashboardData {
  const repositoryIds = options?.repositoryIds;
  const hasRepoFilter = repositoryIds && repositoryIds.length > 0;

  // --- Task counts (one query per status × repository, in parallel) ----------
  const allStatuses = [
    ...ACTIVE_STATES,
    ...QUEUED_STATES,
    ...COMPLETED_STATES,
    ...ATTENTION_STATES,
  ];

  // Build query list: when filtering by repos, make one query per status per repo.
  // When not filtering, make one query per status (existing behavior).
  const taskCountQueryList = hasRepoFilter
    ? allStatuses.flatMap((status) => repositoryIds.map((repoId) => taskCountQuery(status, repoId)))
    : allStatuses.map((status) => taskCountQuery(status));

  const taskCountQueries = useQueries({ queries: taskCountQueryList });

  const taskCountsByStatus = new Map<string, number>();

  if (hasRepoFilter) {
    // Results are [status0-repo0, status0-repo1, ..., status1-repo0, status1-repo1, ...]
    const repoCount = repositoryIds.length;
    allStatuses.forEach((status, statusIdx) => {
      let sum = 0;
      for (let repoIdx = 0; repoIdx < repoCount; repoIdx++) {
        const queryIdx = statusIdx * repoCount + repoIdx;
        const query = taskCountQueries[queryIdx];
        if (query && query.isSuccess) {
          sum += query.data;
        }
      }
      taskCountsByStatus.set(status, sum);
    });
  } else {
    allStatuses.forEach((status, idx) => {
      const query = taskCountQueries[idx];
      if (query && query.isSuccess) {
        taskCountsByStatus.set(status, query.data);
      }
    });
  }

  const sumCategory = (states: readonly string[]): number =>
    states.reduce((sum, s) => sum + (taskCountsByStatus.get(s) ?? 0), 0);

  const active = sumCategory(ACTIVE_STATES);
  const queued = sumCategory(QUEUED_STATES);
  const completed = sumCategory(COMPLETED_STATES);
  const attention = sumCategory(ATTENTION_STATES);

  const taskCounts: TaskCategoryCounts = {
    active,
    queued,
    completed,
    attention,
    total: active + queued + completed + attention,
  };

  // --- Pool summary ----------------------------------------------------------
  const poolsQuery = useQuery({
    queryKey: queryKeys.pools.lists({ limit: 100 }),
    queryFn: () => apiGet<PaginatedResponse<WorkerPool>>("/pools", { limit: 100 }),
    staleTime: 30_000,
  });

  const pools = poolsQuery.data?.data ?? [];
  const poolSummary: PoolSummary = {
    totalPools: pools.length,
    enabledPools: pools.filter((p) => p.enabled).length,
    totalMaxConcurrency: pools.reduce((sum, p) => sum + p.maxConcurrency, 0),
  };

  // --- Recent activity -------------------------------------------------------
  // When filtering by project, fetch more audit events so we can filter
  // client-side to those related to the project's repositories.
  const auditFetchLimit = hasRepoFilter ? 50 : 10;
  const auditQuery = useQuery({
    queryKey: [
      ...queryKeys.audit.all,
      "dashboard",
      auditFetchLimit,
      ...(repositoryIds ?? []),
    ] as const,
    queryFn: () => apiGet<PaginatedResponse<AuditEvent>>("/audit", { limit: auditFetchLimit }),
    staleTime: 10_000,
  });

  // When filtering by project, also fetch tasks for those repos so we can
  // match audit event entityIds to task repositoryIds. We fetch a page of
  // tasks for each repo and collect their IDs into a Set.
  const repoTaskQueries = useQueries({
    queries: hasRepoFilter
      ? repositoryIds.map((repoId) => ({
          queryKey: [...queryKeys.tasks.all, "dashboard-repo-tasks", repoId] as const,
          queryFn: async () => {
            const resp = await apiGet<PaginatedResponse<Task>>("/tasks", {
              repositoryId: repoId,
              limit: 100,
              page: 1,
            });
            return resp.data.map((t) => t.id);
          },
          staleTime: 15_000,
        }))
      : [],
  });

  const projectTaskIds = hasRepoFilter
    ? new Set(repoTaskQueries.flatMap((q) => (q.isSuccess ? q.data : [])))
    : null;

  const allAuditEvents = auditQuery.data?.data ?? [];
  const recentActivity = projectTaskIds
    ? allAuditEvents
        .filter(
          (evt) =>
            // Include events directly on the project's repos or tasks
            (evt.entityType === "repository" && repositoryIds!.includes(evt.entityId)) ||
            (evt.entityType === "task" && projectTaskIds.has(evt.entityId)),
        )
        .slice(0, 10)
    : allAuditEvents;

  // --- Aggregate loading/error state -----------------------------------------
  const isLoading =
    taskCountQueries.some((q) => q.isLoading) ||
    poolsQuery.isLoading ||
    auditQuery.isLoading ||
    repoTaskQueries.some((q) => q.isLoading);

  const isError =
    taskCountQueries.some((q) => q.isError) || poolsQuery.isError || auditQuery.isError;

  return {
    taskCounts,
    poolSummary,
    recentActivity,
    isLoading,
    isError,
  };
}
