/**
 * Dependencies tab for task detail page.
 *
 * Displays both forward dependencies (tasks this task depends on)
 * and reverse dependencies (tasks that depend on this task) with
 * status badges, dependency types, and navigable links.
 *
 * @see T095 — Build task detail timeline view
 */

import { ArrowRight, GitBranch, Link2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "../../../components/ui/badge.js";
import { Card, CardContent, CardHeader } from "../../../components/ui/card.js";
import type { TaskDependency } from "../../../api/types.js";

/** Display labels for dependency types. */
const DEPENDENCY_TYPE_LABELS: Record<string, string> = {
  blocks: "Blocks",
  relates_to: "Relates To",
  parent_child: "Parent/Child",
};

export interface TaskDependenciesTabProps {
  /** The current task ID. */
  readonly taskId: string;
  /** Tasks this task depends on (forward deps). */
  readonly dependencies: readonly TaskDependency[];
  /** Tasks that depend on this task (reverse deps). */
  readonly dependents: readonly TaskDependency[];
}

/**
 * Renders the Dependencies tab showing forward and reverse dependencies.
 *
 * Each dependency is displayed as a card with the dependency type,
 * hard/soft block indicator, and a link to navigate to the related task.
 */
export function TaskDependenciesTab({
  taskId: _taskId,
  dependencies,
  dependents,
}: TaskDependenciesTabProps) {
  const hasDeps = dependencies.length > 0;
  const hasDependents = dependents.length > 0;

  if (!hasDeps && !hasDependents) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-md border border-dashed p-12 text-center"
        data-testid="dependencies-empty"
      >
        <GitBranch className="mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-lg font-medium text-muted-foreground">No dependencies</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This task has no dependency relationships.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="task-dependencies-tab">
      {/* Forward dependencies (tasks this task depends on) */}
      {hasDeps && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">
              Depends On
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({dependencies.length})
              </span>
            </h3>
          </CardHeader>
          <CardContent>
            <div className="space-y-2" data-testid="forward-dependencies">
              {dependencies.map((dep) => (
                <DependencyRow
                  key={dep.taskDependencyId}
                  dep={dep}
                  linkedTaskId={dep.dependsOnTaskId}
                  direction="forward"
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reverse dependencies (tasks that depend on this task) */}
      {hasDependents && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">
              Required By
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({dependents.length})
              </span>
            </h3>
          </CardHeader>
          <CardContent>
            <div className="space-y-2" data-testid="reverse-dependencies">
              {dependents.map((dep) => (
                <DependencyRow
                  key={dep.taskDependencyId}
                  dep={dep}
                  linkedTaskId={dep.taskId}
                  direction="reverse"
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Renders a single dependency relationship row.
 *
 * Shows the dependency type, hard/soft block status, and a
 * navigable link to the related task's detail page.
 */
function DependencyRow({
  dep,
  linkedTaskId,
  direction,
}: {
  readonly dep: TaskDependency;
  readonly linkedTaskId: string;
  readonly direction: "forward" | "reverse";
}) {
  const typeLabel = DEPENDENCY_TYPE_LABELS[dep.dependencyType] ?? dep.dependencyType;

  return (
    <div
      className="flex items-center justify-between rounded-md border px-3 py-2"
      data-testid={`dependency-${dep.taskDependencyId}`}
    >
      <div className="flex items-center gap-3">
        <ArrowRight
          className={`h-4 w-4 text-muted-foreground ${direction === "reverse" ? "rotate-180" : ""}`}
        />
        <Link
          to={`/tasks/${linkedTaskId}`}
          className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <Link2 className="h-3.5 w-3.5" />
          <code>{linkedTaskId}</code>
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">
          {typeLabel}
        </Badge>
        {dep.isHardBlock && (
          <Badge
            variant="outline"
            className="border-orange-200 bg-orange-50 text-orange-700 text-xs dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300"
          >
            Hard Block
          </Badge>
        )}
      </div>
    </div>
  );
}
