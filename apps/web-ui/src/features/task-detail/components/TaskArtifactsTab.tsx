/**
 * Artifacts tab for task detail page.
 *
 * Displays the artifact tree for a task, organized by artifact type
 * (review packets, lead decisions, validation runs, merge queue items).
 * Each artifact node is shown in a tree structure with type indicators.
 *
 * @see T095 — Build task detail timeline view
 */

import { ChevronDown, ChevronRight, File, FileJson, Folder } from "lucide-react";
import { useState } from "react";
import { useTaskArtifacts } from "../../../api/hooks/use-reviews.js";
import type { ArtifactNode } from "../../../api/types.js";

export interface TaskArtifactsTabProps {
  /** The task ID to load artifacts for. */
  readonly taskId: string;
}

/**
 * Renders the Artifacts tab showing the hierarchical artifact tree.
 *
 * Artifacts are organized by type and can be expanded to show
 * nested children. The tree mirrors the filesystem layout used
 * by the artifact storage system.
 */
export function TaskArtifactsTab({ taskId }: TaskArtifactsTabProps) {
  const { data, isLoading, isError } = useTaskArtifacts(taskId);

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="artifacts-loading">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-4 w-4 animate-pulse rounded bg-muted" />
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        role="alert"
        data-testid="artifacts-error"
      >
        <strong>Unable to load artifacts.</strong> Check that the control-plane API is running.
      </div>
    );
  }

  const artifacts = data?.artifacts ?? [];

  if (artifacts.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-md border border-dashed p-12 text-center"
        data-testid="artifacts-empty"
      >
        <Folder className="mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-lg font-medium text-muted-foreground">No artifacts yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Artifacts will appear as the task progresses through development and review.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border p-4" data-testid="task-artifacts-tab">
      <div className="space-y-1">
        {artifacts.map((node) => (
          <ArtifactTreeNode key={node.id} node={node} depth={0} />
        ))}
      </div>
    </div>
  );
}

/**
 * Renders a single node in the artifact tree.
 *
 * Directory nodes are expandable with a toggle chevron.
 * File nodes show a file icon and the artifact label.
 */
function ArtifactTreeNode({
  node,
  depth,
}: {
  readonly node: ArtifactNode;
  readonly depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;
  const isDirectory = node.type === "directory" || hasChildren;

  const Icon = isDirectory ? Folder : node.label.endsWith(".json") ? FileJson : File;

  return (
    <div data-testid={`artifact-node-${node.id}`}>
      <button
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-muted/50"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
        disabled={!hasChildren}
        type="button"
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="inline-block w-3.5" />
        )}
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className={isDirectory ? "font-medium" : ""}>{node.label}</span>
      </button>

      {expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <ArtifactTreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
