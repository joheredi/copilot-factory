/**
 * Task Detail page.
 *
 * Displays complete task information organized into tabbed sections:
 * - **Overview**: All task metadata, classification, criteria, and runtime state
 * - **Timeline**: Chronological audit events with state transitions and actors
 * - **Packets**: Review cycle packets with syntax-highlighted JSON content
 * - **Artifacts**: Hierarchical tree of task artifacts matching filesystem layout
 * - **Dependencies**: Forward and reverse dependency relationships with navigation
 *
 * Includes an operator action bar that shows state-dependent controls
 * for pausing, cancelling, requeueing, and other operator actions.
 *
 * Uses React Router's `useParams` to extract the task ID from the URL,
 * then fetches the enriched task detail via the `useTask` hook.
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — Task Detail screen
 * @see T095 — Build task detail timeline view
 * @see T104 — Integrate operator controls into task detail UI
 */

import { ArrowLeft } from "lucide-react";
import { useParams, Link } from "react-router-dom";
import { useTask } from "../../api/hooks/use-tasks.js";
import { Button } from "../../components/ui/button.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import { TaskStatusBadge } from "../tasks/components/task-status-badge.js";
import { TaskPriorityBadge } from "../tasks/components/task-priority-badge.js";
import { TaskOverviewTab } from "./components/TaskOverviewTab.js";
import { TaskTimelineTab } from "./components/TaskTimelineTab.js";
import { TaskPacketsTab } from "./components/TaskPacketsTab.js";
import { TaskArtifactsTab } from "./components/TaskArtifactsTab.js";
import { TaskDependenciesTab } from "./components/TaskDependenciesTab.js";
import { TaskActionBar } from "./components/operator-actions/TaskActionBar.js";
import type { TaskPriority } from "../../api/types.js";

/**
 * Task detail page component.
 *
 * Renders a full-page view of a single task with tabbed sections
 * for overview, timeline, packets, artifacts, and dependencies.
 * Provides a back button to return to the task board.
 */
export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: detail, isLoading, isError } = useTask(id);

  if (isLoading) {
    return (
      <div className="space-y-6" data-testid="task-detail-loading">
        <div className="flex items-center gap-4">
          <div className="h-8 w-8 animate-pulse rounded bg-muted" />
          <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-10 w-96 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div className="space-y-4" data-testid="task-detail-error">
        <Link to="/tasks">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Task Board
          </Button>
        </Link>
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          <strong>Unable to load task.</strong>{" "}
          {id ? `Task "${id}" was not found or the API is unavailable.` : "No task ID provided."}
        </div>
      </div>
    );
  }

  const { task } = detail;

  return (
    <div className="space-y-6" data-testid="task-detail-page">
      {/* Back navigation + header */}
      <div>
        <Link to="/tasks">
          <Button variant="ghost" size="sm" className="mb-2 gap-2" data-testid="back-to-tasks">
            <ArrowLeft className="h-4 w-4" />
            Back to Task Board
          </Button>
        </Link>

        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight" data-testid="task-title">
              {task.title}
            </h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <code data-testid="task-id">{task.id}</code>
              <span>·</span>
              <TaskStatusBadge status={task.status} />
              <TaskPriorityBadge priority={task.priority as TaskPriority} />
            </div>
          </div>
        </div>

        {/* Operator action controls — shows only valid actions for current state */}
        <TaskActionBar task={task} />
      </div>

      {/* Tabbed content */}
      <Tabs defaultValue="overview" data-testid="task-detail-tabs">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">
            Overview
          </TabsTrigger>
          <TabsTrigger value="timeline" data-testid="tab-timeline">
            Timeline
          </TabsTrigger>
          <TabsTrigger value="packets" data-testid="tab-packets">
            Packets
          </TabsTrigger>
          <TabsTrigger value="artifacts" data-testid="tab-artifacts">
            Artifacts
          </TabsTrigger>
          <TabsTrigger value="dependencies" data-testid="tab-dependencies">
            Dependencies
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <TaskOverviewTab detail={detail} />
        </TabsContent>

        <TabsContent value="timeline">
          <TaskTimelineTab taskId={task.id} />
        </TabsContent>

        <TabsContent value="packets">
          <TaskPacketsTab taskId={task.id} />
        </TabsContent>

        <TabsContent value="artifacts">
          <TaskArtifactsTab taskId={task.id} />
        </TabsContent>

        <TabsContent value="dependencies">
          <TaskDependenciesTab
            taskId={task.id}
            dependencies={detail.dependencies}
            dependents={detail.dependents}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
