/**
 * TanStack Query hooks for the merge queue list endpoint.
 *
 * Provides a paginated, filterable query for merge queue items
 * enriched with task metadata. Used by the merge queue view to
 * display queue position, status, and task context.
 *
 * @module @factory/web-ui/api/hooks/use-merge-queue
 * @see {@link file://docs/backlog/tasks/T098-build-merge-queue-view.md}
 */

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { queryKeys } from "../query-keys";
import type { MergeQueueItem, MergeQueueListParams, PaginatedResponse } from "../types";

/**
 * Fetches a paginated list of merge queue items with optional filters.
 *
 * Items are returned ordered by queue position. Each item includes
 * the associated task title and status for UI display.
 *
 * @param params - Pagination and filter parameters.
 */
export function useMergeQueue(params?: MergeQueueListParams) {
  return useQuery({
    queryKey: queryKeys.mergeQueue.lists(params),
    queryFn: () => apiGet<PaginatedResponse<MergeQueueItem>>("/merge-queue", params),
  });
}
