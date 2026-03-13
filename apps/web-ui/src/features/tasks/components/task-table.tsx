/**
 * Task data table component.
 *
 * Renders a table of tasks with columns: Title, Status, Priority, Type,
 * Project, and Updated. Supports click-through to task detail, loading
 * skeleton, empty state, and optional project name badges.
 *
 * The table supports client-side sorting for the current page. Server-side
 * sorting is not available in the API, so we sort locally after fetching.
 *
 * @see T094 — Build task board with status filtering and pagination
 * @see T150 — Add project name badges to task rows
 */

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.js";
import { Button } from "../../../components/ui/button.js";
import { Badge } from "../../../components/ui/badge.js";
import type { Task } from "../../../api/types.js";
import { TaskStatusBadge } from "./task-status-badge.js";
import { TaskPriorityBadge } from "./task-priority-badge.js";
import type { SortDirection, TaskSortField } from "../hooks/use-task-filters.js";

/** Priority sort order (highest first). */
const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Lookup map from repositoryId to a display label.
 * Built by the parent component from project and repository data.
 *
 * @see T150
 */
export type RepositoryNameMap = ReadonlyMap<string, string>;

export interface TaskTableProps {
  /** The tasks to display. */
  readonly tasks: readonly Task[];
  /** Whether data is still loading. */
  readonly isLoading: boolean;
  /** Current sort field. */
  readonly sortField: TaskSortField;
  /** Current sort direction. */
  readonly sortDirection: SortDirection;
  /** Callback when the user clicks a column header to sort. */
  readonly onSort: (field: TaskSortField, direction: SortDirection) => void;
  /**
   * Optional map from repositoryId → display name (e.g. "ProjectName / RepoName").
   * When provided, a Project column with badges is shown in the table.
   */
  readonly repositoryNames?: RepositoryNameMap;
}

/**
 * Sorts tasks client-side by the specified field and direction.
 *
 * Since the backend API does not support sort parameters, we apply
 * sorting on the fetched page of results. This gives a good UX for
 * the current page while keeping the implementation simple.
 */
function sortTasks(
  tasks: readonly Task[],
  field: TaskSortField,
  direction: SortDirection,
): readonly Task[] {
  const sorted = [...tasks].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case "priority":
        cmp = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
        break;
      case "updatedAt":
        cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        break;
      case "status":
        cmp = a.status.localeCompare(b.status);
        break;
      case "title":
        cmp = a.title.localeCompare(b.title);
        break;
    }
    return direction === "asc" ? cmp : -cmp;
  });
  return sorted;
}

/**
 * Formats a date string to a human-readable relative or absolute format.
 * Shows relative time for recent dates and absolute for older ones.
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

/** Display labels for task types. */
const TYPE_LABELS: Record<string, string> = {
  feature: "Feature",
  bug_fix: "Bug Fix",
  refactor: "Refactor",
  chore: "Chore",
  documentation: "Docs",
  test: "Test",
  spike: "Spike",
};

/**
 * Renders the task board data table.
 *
 * Shows a sortable table with task data. Click on column headers
 * to toggle sort direction. Loading state shows skeleton rows.
 * Empty state shows an informative message.
 */
export function TaskTable({
  tasks,
  isLoading,
  sortField,
  sortDirection,
  onSort,
  repositoryNames,
}: TaskTableProps) {
  const sortedTasks = sortTasks(tasks, sortField, sortDirection);
  const showProjectColumn = !!repositoryNames && repositoryNames.size > 0;

  const handleSort = (field: TaskSortField) => {
    if (field === sortField) {
      onSort(field, sortDirection === "asc" ? "desc" : "asc");
    } else {
      onSort(field, field === "priority" ? "asc" : "desc");
    }
  };

  const SortIcon = ({ field }: { readonly field: TaskSortField }) => {
    if (field !== sortField) return <ArrowUpDown className="ml-1 h-3 w-3" />;
    return sortDirection === "asc" ? (
      <ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3" />
    );
  };

  if (isLoading) {
    return (
      <div data-testid="task-table-skeleton">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40%]">Title</TableHead>
              {showProjectColumn && <TableHead>Project</TableHead>}
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }, (_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                </TableCell>
                {showProjectColumn && (
                  <TableCell>
                    <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
                  </TableCell>
                )}
                <TableCell>
                  <div className="h-5 w-24 animate-pulse rounded-full bg-muted" />
                </TableCell>
                <TableCell>
                  <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
                </TableCell>
                <TableCell>
                  <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                </TableCell>
                <TableCell className="text-right">
                  <div className="ml-auto h-4 w-12 animate-pulse rounded bg-muted" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (sortedTasks.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-md border border-dashed p-12 text-center"
        data-testid="task-table-empty"
      >
        <p className="text-lg font-medium text-muted-foreground">No tasks found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Try adjusting your filters or create a new task.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="task-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40%]">
              <Button
                variant="ghost"
                size="sm"
                className="-ml-3 h-8 gap-0 font-medium"
                onClick={() => handleSort("title")}
                data-testid="sort-title"
              >
                Title
                <SortIcon field="title" />
              </Button>
            </TableHead>
            {showProjectColumn && <TableHead>Project</TableHead>}
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                className="-ml-3 h-8 gap-0 font-medium"
                onClick={() => handleSort("status")}
                data-testid="sort-status"
              >
                Status
                <SortIcon field="status" />
              </Button>
            </TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                className="-ml-3 h-8 gap-0 font-medium"
                onClick={() => handleSort("priority")}
                data-testid="sort-priority"
              >
                Priority
                <SortIcon field="priority" />
              </Button>
            </TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">
              <Button
                variant="ghost"
                size="sm"
                className="-mr-3 ml-auto h-8 gap-0 font-medium"
                onClick={() => handleSort("updatedAt")}
                data-testid="sort-updated"
              >
                Updated
                <SortIcon field="updatedAt" />
              </Button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedTasks.map((task) => (
            <TableRow key={task.id} className="cursor-pointer" data-testid={`task-row-${task.id}`}>
              <TableCell className="font-medium">
                <Link
                  to={`/tasks/${task.id}`}
                  className="hover:underline"
                  data-testid={`task-link-${task.id}`}
                >
                  {task.title}
                </Link>
              </TableCell>
              {showProjectColumn && (
                <TableCell>
                  <Badge
                    variant="outline"
                    className="text-xs font-normal"
                    data-testid={`task-project-badge-${task.id}`}
                  >
                    {repositoryNames!.get(task.repositoryId) ?? "Unknown"}
                  </Badge>
                </TableCell>
              )}
              <TableCell>
                <TaskStatusBadge status={task.status} />
              </TableCell>
              <TableCell>
                <TaskPriorityBadge priority={task.priority} />
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {TYPE_LABELS[task.taskType] ?? task.taskType}
              </TableCell>
              <TableCell className="text-right text-sm text-muted-foreground">
                {formatDate(task.updatedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
