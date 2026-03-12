/**
 * Filter controls for the task board.
 *
 * Renders toggle buttons for status, priority, and task type filters.
 * Active filters are highlighted visually. Since no Select component
 * exists in the UI library, we use inline toggle buttons which are
 * more scannable and require fewer clicks for common filter operations.
 *
 * Filter state is managed by the parent via the `useTaskFilters` hook
 * which syncs to URL search params for shareable links.
 *
 * @see T094 — Build task board with status filtering and pagination
 */

import { X } from "lucide-react";
import { Button } from "../../../components/ui/button.js";
import { Badge } from "../../../components/ui/badge.js";
import { getStatusLabel, getStatusGroups } from "./task-status-badge.js";
import { PRIORITY_OPTIONS } from "./task-priority-badge.js";
import type { TaskFilterActions, TaskFilterState } from "../hooks/use-task-filters.js";

/** All valid task type options. */
const TASK_TYPE_OPTIONS = [
  { value: "feature", label: "Feature" },
  { value: "bug_fix", label: "Bug Fix" },
  { value: "refactor", label: "Refactor" },
  { value: "chore", label: "Chore" },
  { value: "documentation", label: "Docs" },
  { value: "test", label: "Test" },
  { value: "spike", label: "Spike" },
] as const;

export interface TaskFiltersProps {
  readonly state: TaskFilterState;
  readonly actions: TaskFilterActions;
}

/**
 * Renders the task board filter bar with status, priority, and type toggles.
 *
 * Each filter section shows toggle buttons. Active filters are visually
 * distinguished with a filled variant. A clear-all button appears when
 * any filter is active.
 */
export function TaskFilters({ state, actions }: TaskFiltersProps) {
  const statusGroups = getStatusGroups();
  const hasActiveFilters =
    state.statusFilters.length > 0 || state.priorityFilter !== "" || state.taskTypeFilter !== "";

  return (
    <div className="space-y-3" data-testid="task-filters">
      {/* Status filters */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Status</span>
          {state.statusFilters.length > 0 && (
            <Badge variant="secondary" className="text-xs" data-testid="status-filter-count">
              {state.statusFilters.length}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(statusGroups).map(([, statuses]) =>
            statuses.map((status) => {
              const isActive = state.statusFilters.includes(status);
              return (
                <Button
                  key={status}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => actions.toggleStatus(status)}
                  data-testid={`filter-status-${status}`}
                >
                  {getStatusLabel(status)}
                </Button>
              );
            }),
          )}
        </div>
      </div>

      {/* Priority & Type filters */}
      <div className="flex flex-wrap gap-6">
        <div className="space-y-2">
          <span className="text-sm font-medium text-muted-foreground">Priority</span>
          <div className="flex flex-wrap gap-1.5">
            {PRIORITY_OPTIONS.map((priority) => {
              const isActive = state.priorityFilter === priority;
              return (
                <Button
                  key={priority}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs capitalize"
                  onClick={() => actions.setPriority(isActive ? "" : priority)}
                  data-testid={`filter-priority-${priority}`}
                >
                  {priority}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium text-muted-foreground">Type</span>
          <div className="flex flex-wrap gap-1.5">
            {TASK_TYPE_OPTIONS.map(({ value, label }) => {
              const isActive = state.taskTypeFilter === value;
              return (
                <Button
                  key={value}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => actions.setTaskType(isActive ? "" : value)}
                  data-testid={`filter-type-${value}`}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Clear all */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-muted-foreground"
          onClick={actions.clearAll}
          data-testid="clear-all-filters"
        >
          <X className="h-3 w-3" />
          Clear all filters
        </Button>
      )}
    </div>
  );
}
