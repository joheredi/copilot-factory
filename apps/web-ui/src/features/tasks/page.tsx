/**
 * Task Board page.
 *
 * Displays a filterable, paginated table of tasks with color-coded status
 * and priority badges, sortable columns, and URL-synced filter state for
 * shareable links.
 *
 * Architecture:
 * - Filter state is stored in URL search params via `useTaskFilters` hook
 * - Data fetching via `useTasks` TanStack Query hook with WebSocket
 *   cache invalidation for real-time updates
 * - Client-side sorting on the current page (API does not support sort params)
 * - Server-side filtering and pagination via query params
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — Task Board screen
 * @see T094 — Build task board with status filtering and pagination
 */

import { Filter } from "lucide-react";
import { useState } from "react";
import { useTasks } from "../../api/hooks/use-tasks.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { PaginationControls } from "./components/pagination-controls.js";
import { TaskFilters } from "./components/task-filters.js";
import { TaskTable } from "./components/task-table.js";
import { useTaskFilters } from "./hooks/use-task-filters.js";

export default function TasksPage() {
  const [filterState, filterActions] = useTaskFilters();
  const [showFilters, setShowFilters] = useState(true);

  const { data, isLoading, isError } = useTasks(filterState.params);

  const tasks = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Task Board</h1>
          <p className="text-muted-foreground">View and manage tasks across all projects</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setShowFilters((v) => !v)}
          data-testid="toggle-filters"
        >
          <Filter className="h-4 w-4" />
          {showFilters ? "Hide Filters" : "Show Filters"}
        </Button>
      </div>

      {/* Error state */}
      {isError && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
          data-testid="task-board-error"
        >
          <strong>Unable to load tasks.</strong> Check that the control-plane API is running.
        </div>
      )}

      {/* Filters */}
      {showFilters && (
        <Card>
          <CardContent className="pt-6">
            <TaskFilters state={filterState} actions={filterActions} />
          </CardContent>
        </Card>
      )}

      {/* Task table */}
      <TaskTable
        tasks={tasks}
        isLoading={isLoading}
        sortField={filterState.sortField}
        sortDirection={filterState.sortDirection}
        onSort={filterActions.setSort}
      />

      {/* Pagination */}
      {!isLoading && (
        <PaginationControls
          page={filterState.page}
          limit={filterState.limit}
          total={total}
          onPageChange={filterActions.setPage}
          onLimitChange={filterActions.setLimit}
        />
      )}
    </div>
  );
}
