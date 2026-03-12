import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Filter,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { useTasks } from "../../api/hooks";
import { useReviewHistory } from "../../api/hooks";
import { TaskStatusBadge } from "../tasks/components/task-status-badge";
import { TaskPriorityBadge } from "../tasks/components/task-priority-badge";
import { ReviewCycleStatusBadge } from "./components/review-cycle-status-badge";
import { ReviewVerdictBadge } from "./components/review-verdict-badge";
import { ReviewCycleDetail } from "./components/review-cycle-detail";
import type { Task, ReviewCycle } from "../../api/types";

/** Task statuses that appear in the review center. */
const REVIEW_STATUSES = ["IN_REVIEW", "CHANGES_REQUESTED"] as const;

/** Maximum review round count before showing a warning. */
const MAX_REVIEW_ROUNDS_WARNING = 3;

/**
 * Format an ISO timestamp to a locale-aware string.
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
 * Inline component that fetches and displays review cycle rows for a task.
 *
 * Shows each review cycle with status, specialist count, lead decision,
 * and an expandable detail section. Warns when the review round count
 * approaches the configured maximum.
 */
function TaskReviewCycles({
  taskId,
  expanded,
}: {
  readonly taskId: string;
  readonly expanded: boolean;
}) {
  const { data, isLoading, isError } = useReviewHistory(expanded ? taskId : undefined);
  const [expandedCycle, setExpandedCycle] = useState<string | null>(null);

  if (!expanded) return null;

  if (isLoading) {
    return (
      <tr>
        <td colSpan={7} className="px-4 py-3">
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid={`review-history-loading-${taskId}`}
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading review history…
          </div>
        </td>
      </tr>
    );
  }

  if (isError) {
    return (
      <tr>
        <td colSpan={7} className="px-4 py-3">
          <div
            role="alert"
            className="text-sm text-destructive"
            data-testid={`review-history-error-${taskId}`}
          >
            Failed to load review history.
          </div>
        </td>
      </tr>
    );
  }

  const cycles = data?.cycles ?? [];

  if (cycles.length === 0) {
    return (
      <tr>
        <td colSpan={7} className="px-4 py-3">
          <p className="text-sm text-muted-foreground" data-testid={`no-review-cycles-${taskId}`}>
            No review cycles recorded for this task.
          </p>
        </td>
      </tr>
    );
  }

  return (
    <>
      {cycles.map((cycle: ReviewCycle) => (
        <tr key={cycle.cycleId} className="border-b bg-muted/30 last:border-0">
          <td className="py-2 pl-10 pr-4" colSpan={2}>
            <button
              className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              onClick={() =>
                setExpandedCycle(expandedCycle === cycle.cycleId ? null : cycle.cycleId)
              }
              data-testid={`toggle-cycle-${cycle.cycleId}`}
            >
              {expandedCycle === cycle.cycleId ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Cycle {cycle.cycleId.slice(0, 8)}…
            </button>
            {expandedCycle === cycle.cycleId && (
              <div className="mt-2 pl-4">
                <ReviewCycleDetail taskId={taskId} cycleId={cycle.cycleId} />
              </div>
            )}
          </td>
          <td className="py-2 pr-4">
            <ReviewCycleStatusBadge status={cycle.status} />
          </td>
          <td className="py-2 pr-4 text-sm text-muted-foreground">
            {cycle.specialistCount} reviewer{cycle.specialistCount !== 1 ? "s" : ""}
          </td>
          <td className="py-2 pr-4">
            {cycle.leadDecision ? (
              <ReviewVerdictBadge verdict={cycle.leadDecision} />
            ) : (
              <span className="text-sm text-muted-foreground">Pending</span>
            )}
          </td>
          <td className="py-2 pr-4 text-sm text-muted-foreground">{formatTime(cycle.createdAt)}</td>
          <td className="py-2 text-sm text-muted-foreground">{formatTime(cycle.updatedAt)}</td>
        </tr>
      ))}
    </>
  );
}

/**
 * Review Center page.
 *
 * Displays tasks currently in review states (IN_REVIEW and CHANGES_REQUESTED),
 * their review cycle details with specialist packets, lead decisions,
 * and escalation warnings. Supports status filtering and click-through
 * to review cycle detail with issue breakdowns.
 *
 * The review center is the operator's primary view for monitoring review
 * quality and identifying bottlenecks in the review pipeline.
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — Review Center screen
 * @see T097 — Build review center view
 */
export default function ReviewsPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [showFilters, setShowFilters] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const inReviewQuery = useTasks({ status: "IN_REVIEW", limit: 100 });
  const changesRequestedQuery = useTasks({ status: "CHANGES_REQUESTED", limit: 100 });

  const isLoading = inReviewQuery.isLoading || changesRequestedQuery.isLoading;
  const isError = inReviewQuery.isError || changesRequestedQuery.isError;

  const inReviewTasks = inReviewQuery.data?.items ?? [];
  const changesRequestedTasks = changesRequestedQuery.data?.items ?? [];
  const allTasks = [...inReviewTasks, ...changesRequestedTasks];

  const filteredTasks = statusFilter ? allTasks.filter((t) => t.status === statusFilter) : allTasks;

  const hasEscalationWarnings = changesRequestedTasks.length > 0;
  const activeFilterCount = statusFilter ? 1 : 0;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Review Center</h1>
        <p className="text-muted-foreground">Track code reviews and approval status</p>
      </div>

      {/* Warning: tasks with changes requested */}
      {hasEscalationWarnings && (
        <Card className="border-amber-300 bg-amber-50" data-testid="changes-requested-warning">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <div>
              <p className="font-medium text-amber-800">
                {changesRequestedTasks.length} task{changesRequestedTasks.length !== 1 ? "s" : ""}{" "}
                with changes requested
              </p>
              <p className="text-sm text-amber-700">
                These tasks need rework before they can proceed.
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
        <span className="text-sm text-muted-foreground" data-testid="review-count">
          {filteredTasks.length} task{filteredTasks.length !== 1 ? "s" : ""} in review
        </span>
      </div>

      {showFilters && (
        <Card data-testid="filter-bar">
          <CardContent className="flex flex-wrap items-center gap-2 py-3">
            <span className="text-sm font-medium">Status:</span>
            {REVIEW_STATUSES.map((status) => (
              <Button
                key={status}
                variant={statusFilter === status ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(statusFilter === status ? undefined : status)}
                data-testid={`filter-status-${status.toLowerCase().replace(/_/g, "-")}`}
              >
                {status === "IN_REVIEW" ? "In Review" : "Changes Requested"}
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
          data-testid="review-center-error"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <p>Failed to load review data. Please try again.</p>
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <Card data-testid="review-center-loading">
          <CardContent className="py-6">
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-muted" />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Review table */}
      {!isLoading && !isError && filteredTasks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Tasks in Review
            </CardTitle>
            <CardDescription>
              Click a task row to expand review cycle details with specialist packets and lead
              decisions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="review-table">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium" style={{ width: "2rem" }}></th>
                    <th className="pb-2 pr-4 font-medium">Task</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Priority</th>
                    <th className="pb-2 pr-4 font-medium">Type</th>
                    <th className="pb-2 pr-4 font-medium">Created</th>
                    <th className="pb-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map((task: Task) => {
                    const isExpanded = expandedTaskId === task.id;
                    return (
                      <TaskRow
                        key={task.id}
                        task={task}
                        isExpanded={isExpanded}
                        onToggle={() => setExpandedTaskId(isExpanded ? null : task.id)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !isError && filteredTasks.length === 0 && (
        <Card data-testid="review-center-empty">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquare className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-lg font-medium">No tasks in review</p>
            <p className="text-sm text-muted-foreground">
              {statusFilter
                ? `No tasks match the "${statusFilter === "IN_REVIEW" ? "In Review" : "Changes Requested"}" filter.`
                : "Tasks will appear here when they enter the review pipeline."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Individual task row in the review table with expand/collapse behavior.
 *
 * Shows task metadata in the main row. When expanded, renders review
 * cycle sub-rows with specialist and lead review details. Displays
 * a round count warning badge when the task has many review cycles.
 */
function TaskRow({
  task,
  isExpanded,
  onToggle,
}: {
  readonly task: Task;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}) {
  const { data: reviewData } = useReviewHistory(isExpanded ? task.id : undefined);
  const roundCount = reviewData?.cycles?.length ?? 0;
  const showRoundWarning = roundCount >= MAX_REVIEW_ROUNDS_WARNING;

  return (
    <>
      <tr
        className={`border-b cursor-pointer hover:bg-muted/50 ${isExpanded ? "bg-muted/30" : ""}`}
        onClick={onToggle}
        data-testid={`review-task-${task.id}`}
      >
        <td className="py-3 pr-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </td>
        <td className="py-3 pr-4">
          <Link
            to={`/tasks/${task.id}`}
            className="font-medium text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
            data-testid={`task-link-${task.id}`}
          >
            {task.title}
          </Link>
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">{task.id.slice(0, 8)}…</p>
            {showRoundWarning && (
              <Badge
                variant="outline"
                className="border-amber-300 bg-amber-50 text-amber-700 text-xs"
                data-testid={`round-warning-${task.id}`}
              >
                <AlertTriangle className="mr-1 h-3 w-3" />
                {roundCount} rounds
              </Badge>
            )}
          </div>
        </td>
        <td className="py-3 pr-4">
          <TaskStatusBadge status={task.status} />
        </td>
        <td className="py-3 pr-4">
          <TaskPriorityBadge priority={task.priority} />
        </td>
        <td className="py-3 pr-4 text-muted-foreground">{task.taskType}</td>
        <td className="py-3 pr-4 text-muted-foreground">{formatTime(task.createdAt)}</td>
        <td className="py-3 text-muted-foreground">{formatTime(task.updatedAt)}</td>
      </tr>
      <TaskReviewCycles taskId={task.id} expanded={isExpanded} />
    </>
  );
}
