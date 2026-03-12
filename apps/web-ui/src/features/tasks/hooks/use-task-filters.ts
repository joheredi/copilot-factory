/**
 * Custom hook that syncs task board filter/pagination state with URL search params.
 *
 * Storing filter state in the URL enables shareable links — operators can
 * bookmark or share a filtered task view with a colleague. The hook reads
 * initial values from the current URL and writes changes back via
 * React Router's `useSearchParams`.
 *
 * Supports: status, priority, taskType filters + page and limit pagination.
 *
 * @module
 * @see T094 — Build task board with status filtering and pagination
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { TaskListParams } from "../../../api/types.js";

/** All possible sort fields for the task table. */
export type TaskSortField = "priority" | "updatedAt" | "status" | "title";

/** Sort direction. */
export type SortDirection = "asc" | "desc";

/** Full filter + pagination state exposed by the hook. */
export interface TaskFilterState {
  /** Current filter/pagination params ready for the API query. */
  readonly params: TaskListParams;
  /** Currently active status filters (empty = all). */
  readonly statusFilters: readonly string[];
  /** Currently active priority filter (empty string = all). */
  readonly priorityFilter: string;
  /** Currently active task type filter (empty string = all). */
  readonly taskTypeFilter: string;
  /** Current page (1-based). */
  readonly page: number;
  /** Items per page. */
  readonly limit: number;
  /** Current sort field. */
  readonly sortField: TaskSortField;
  /** Current sort direction. */
  readonly sortDirection: SortDirection;
}

/** Actions to update the filter state. */
export interface TaskFilterActions {
  /** Toggle a status filter on/off. */
  readonly toggleStatus: (status: string) => void;
  /** Set status filter to a single value (or clear with empty string). */
  readonly setStatus: (status: string) => void;
  /** Set the priority filter (empty string = all). */
  readonly setPriority: (priority: string) => void;
  /** Set the task type filter (empty string = all). */
  readonly setTaskType: (taskType: string) => void;
  /** Navigate to a specific page. */
  readonly setPage: (page: number) => void;
  /** Change the items-per-page limit. */
  readonly setLimit: (limit: number) => void;
  /** Set sorting. */
  readonly setSort: (field: TaskSortField, direction: SortDirection) => void;
  /** Clear all filters and reset to page 1. */
  readonly clearAll: () => void;
}

const DEFAULT_LIMIT = 20;

/**
 * Hook that manages task board filter and pagination state via URL search params.
 *
 * @returns Tuple of [state, actions] for reading and modifying filters.
 */
export function useTaskFilters(): [TaskFilterState, TaskFilterActions] {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo<TaskFilterState>(() => {
    const status = searchParams.get("status") ?? "";
    const priority = searchParams.get("priority") ?? "";
    const taskType = searchParams.get("taskType") ?? "";
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || DEFAULT_LIMIT));
    const sortField = (searchParams.get("sortField") as TaskSortField) || "updatedAt";
    const sortDirection = (searchParams.get("sortDirection") as SortDirection) || "desc";

    const statusFilters = status ? status.split(",").filter(Boolean) : [];

    const params: TaskListParams = {
      page,
      limit,
      ...(statusFilters.length === 1 ? { status: statusFilters[0] } : {}),
      ...(priority ? { priority } : {}),
      ...(taskType ? { taskType } : {}),
    };

    return {
      params,
      statusFilters,
      priorityFilter: priority,
      taskTypeFilter: taskType,
      page,
      limit,
      sortField,
      sortDirection,
    };
  }, [searchParams]);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value) {
              next.set(key, value);
            } else {
              next.delete(key);
            }
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const actions = useMemo<TaskFilterActions>(
    () => ({
      toggleStatus: (status: string) => {
        const current = new Set(state.statusFilters);
        if (current.has(status)) {
          current.delete(status);
        } else {
          current.add(status);
        }
        updateParams({
          status: [...current].join(","),
          page: "1",
        });
      },

      setStatus: (status: string) => {
        updateParams({ status, page: "1" });
      },

      setPriority: (priority: string) => {
        updateParams({ priority, page: "1" });
      },

      setTaskType: (taskType: string) => {
        updateParams({ taskType, page: "1" });
      },

      setPage: (page: number) => {
        updateParams({ page: String(page) });
      },

      setLimit: (limit: number) => {
        updateParams({ limit: String(limit), page: "1" });
      },

      setSort: (field: TaskSortField, direction: SortDirection) => {
        updateParams({ sortField: field, sortDirection: direction });
      },

      clearAll: () => {
        setSearchParams({}, { replace: true });
      },
    }),
    [state.statusFilters, updateParams, setSearchParams],
  );

  return [state, actions];
}
