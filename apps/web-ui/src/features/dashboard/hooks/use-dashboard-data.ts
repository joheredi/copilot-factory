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
 * @param status - Task status string to filter by.
 * @returns Query options that resolve to the total count.
 */
function taskCountQuery(status: string) {
  const params = { status, limit: 1, page: 1 };
  return {
    queryKey: [...queryKeys.tasks.all, "dashboard-count", status] as const,
    queryFn: async () => {
      const response = await apiGet<PaginatedResponse<Task>>("/tasks", params);
      return response.meta.total;
    },
    staleTime: 15_000,
  };
}

/**
 * Aggregates dashboard data from multiple concurrent API queries.
 *
 * Queries are structured to minimise payload size:
 * - Task counts use limit=1 per status with only `total` extracted
 * - Pool list uses a small page size
 * - Audit feed fetches only the 10 most recent events
 *
 * @returns Aggregated dashboard data with loading/error states.
 */
export function useDashboardData(): DashboardData {
  // --- Task counts (one query per status, in parallel) -----------------------
  const allStatuses = [
    ...ACTIVE_STATES,
    ...QUEUED_STATES,
    ...COMPLETED_STATES,
    ...ATTENTION_STATES,
  ];

  const taskCountQueries = useQueries({
    queries: allStatuses.map((status) => taskCountQuery(status)),
  });

  const taskCountsByStatus = new Map<string, number>();
  allStatuses.forEach((status, idx) => {
    const query = taskCountQueries[idx];
    if (query && query.isSuccess) {
      taskCountsByStatus.set(status, query.data);
    }
  });

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
  const auditQuery = useQuery({
    queryKey: queryKeys.audit.lists({ limit: 10 }),
    queryFn: () => apiGet<PaginatedResponse<AuditEvent>>("/audit", { limit: 10 }),
    staleTime: 10_000,
  });

  const recentActivity = auditQuery.data?.data ?? [];

  // --- Aggregate loading/error state -----------------------------------------
  const isLoading =
    taskCountQueries.some((q) => q.isLoading) || poolsQuery.isLoading || auditQuery.isLoading;

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
