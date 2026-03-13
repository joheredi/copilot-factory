import { useState } from "react";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { useDashboardData } from "./hooks/use-dashboard-data.js";
import { useProjectFilter } from "./hooks/use-project-filter.js";
import { TaskSummaryCards } from "./components/task-summary-cards.js";
import { WorkerPoolSummaryCard } from "./components/worker-pool-summary.js";
import { RecentActivityFeed } from "./components/recent-activity-feed.js";
import { ProjectSelector } from "./components/project-selector.js";
import { CreateProjectDialog } from "../projects/components/CreateProjectDialog.js";
import { CreateRepositoryDialog } from "../projects/components/CreateRepositoryDialog.js";

/**
 * Dashboard overview page.
 *
 * Displays system health summary: task state counts, worker pool
 * capacity, and a live activity feed. All data is fetched via
 * TanStack Query hooks with WebSocket-driven cache invalidation
 * for real-time updates.
 *
 * Supports project-level filtering via a dropdown selector in the
 * header. The selected project is synced to the URL for bookmarkability.
 *
 * Layout:
 * 1. Project selector + Create Project button
 * 2. Four summary cards (Active, Queued, Completed, Needs Attention)
 * 3. Worker pool summary (pool count, capacity)
 * 4. Recent activity feed (last 10 audit events)
 *
 * @see docs/prd/001-architecture.md §1.9 — Dashboard view spec
 * @see docs/prd/007-technical-architecture.md §7.16 — Dashboard screen
 * @see T150 — Add multi-project filter to dashboard
 */
export default function DashboardPage() {
  const [projectFilter, projectActions] = useProjectFilter();
  const { taskCounts, poolSummary, recentActivity, isLoading, isError } = useDashboardData({
    repositoryIds: projectFilter.repositoryIds.length > 0 ? projectFilter.repositoryIds : undefined,
  });
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showCreateRepository, setShowCreateRepository] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">System overview and health status</p>
        </div>
        <div className="flex items-center gap-3">
          <ProjectSelector filterState={projectFilter} filterActions={projectActions} />
          {projectFilter.selectedProjectId && (
            <Button
              variant="outline"
              onClick={() => setShowCreateRepository(true)}
              data-testid="add-repository-button"
            >
              Add Repository
            </Button>
          )}
          <Button onClick={() => setShowCreateProject(true)} data-testid="create-project-button">
            Create Project
          </Button>
        </div>
      </div>

      <CreateProjectDialog open={showCreateProject} onOpenChange={setShowCreateProject} />
      {projectFilter.selectedProjectId && (
        <CreateRepositoryDialog
          open={showCreateRepository}
          onOpenChange={setShowCreateRepository}
          projectId={projectFilter.selectedProjectId}
        />
      )}

      {isError && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
          data-testid="dashboard-error"
        >
          <strong>Unable to load dashboard data.</strong> Some metrics may be unavailable. Check
          that the control-plane API is running.
        </div>
      )}

      <TaskSummaryCards counts={taskCounts} isLoading={isLoading} />

      <div className="grid gap-4 lg:grid-cols-2">
        <WorkerPoolSummaryCard summary={poolSummary} isLoading={isLoading} />
        <TotalTasksCard total={taskCounts.total} isLoading={isLoading} />
      </div>

      <RecentActivityFeed events={recentActivity} isLoading={isLoading} />
    </div>
  );
}

/**
 * Simple card showing the total task count across all statuses.
 * Provides a quick aggregate alongside the per-category breakdown.
 */
function TotalTasksCard({
  total,
  isLoading,
}: {
  readonly total: number;
  readonly isLoading: boolean;
}) {
  return (
    <div
      className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm"
      data-testid="total-tasks-card"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">Total Tasks</p>
        {isLoading ? (
          <div className="h-8 w-16 animate-pulse rounded bg-muted" />
        ) : (
          <p className="text-2xl font-bold" data-testid="total-tasks-count">
            {total}
          </p>
        )}
        <p className="text-xs text-muted-foreground">Across all statuses</p>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Badge variant="outline">Live</Badge>
        <span className="text-xs text-muted-foreground">Updates via WebSocket</span>
      </div>
    </div>
  );
}
