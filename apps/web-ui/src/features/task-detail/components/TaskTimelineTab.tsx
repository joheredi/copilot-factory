/**
 * Timeline tab for task detail page.
 *
 * Displays a vertical chronological list of audit events for the task,
 * showing state transitions, actor information, timestamps, and
 * metadata details. Supports pagination for tasks with many events.
 *
 * @see T095 — Build task detail timeline view
 */

import { Clock, User, Zap } from "lucide-react";
import { useState } from "react";
import { useTaskTimeline } from "../../../api/hooks/use-tasks.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import type { AuditEvent } from "../../../api/types.js";

/** Maps event types to human-readable labels. */
const EVENT_TYPE_LABELS: Record<string, string> = {
  state_transition: "State Transition",
  created: "Created",
  updated: "Updated",
  lease_acquired: "Lease Acquired",
  lease_released: "Lease Released",
  lease_expired: "Lease Expired",
  review_started: "Review Started",
  review_completed: "Review Completed",
  merge_queued: "Queued for Merge",
  merge_completed: "Merge Completed",
  merge_failed: "Merge Failed",
  validation_passed: "Validation Passed",
  validation_failed: "Validation Failed",
  escalated: "Escalated",
  operator_action: "Operator Action",
};

/** Maps actor types to display icons. */
const ACTOR_TYPE_LABELS: Record<string, string> = {
  system: "System",
  worker: "Worker",
  operator: "Operator",
  scheduler: "Scheduler",
};

/** Styling for event type categories. */
function getEventStyle(eventType: string): string {
  if (eventType.includes("fail") || eventType === "escalated") {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300";
  }
  if (eventType.includes("complet") || eventType.includes("passed") || eventType === "created") {
    return "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300";
  }
  if (eventType.startsWith("lease") || eventType.startsWith("review")) {
    return "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300";
  }
  return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300";
}

/**
 * Formats a timestamp into a relative + absolute string.
 */
function formatTimestamp(timestamp: string): { relative: string; absolute: string } {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  let relative: string;
  if (diffMinutes < 1) relative = "just now";
  else if (diffMinutes < 60) relative = `${diffMinutes}m ago`;
  else if (diffHours < 24) relative = `${diffHours}h ago`;
  else if (diffDays < 30) relative = `${diffDays}d ago`;
  else relative = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const absolute = date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return { relative, absolute };
}

export interface TaskTimelineTabProps {
  /** The task ID to load timeline for. */
  readonly taskId: string;
}

/**
 * Renders the Timeline tab with a paginated, vertical list of audit events.
 *
 * Events are displayed in reverse chronological order (newest first)
 * with a vertical line connecting them for visual continuity.
 */
export function TaskTimelineTab({ taskId }: TaskTimelineTabProps) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useTaskTimeline(taskId, { page, limit: 50 });

  const events = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const hasMore = data?.meta ? data.meta.page * data.meta.limit < data.meta.total : false;

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="timeline-loading">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex gap-4">
            <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </div>
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
        data-testid="timeline-error"
      >
        <strong>Unable to load timeline.</strong> Check that the control-plane API is running.
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-md border border-dashed p-12 text-center"
        data-testid="timeline-empty"
      >
        <Clock className="mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-lg font-medium text-muted-foreground">No timeline events</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Events will appear as the task progresses through its lifecycle.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="task-timeline-tab">
      <div className="mb-2 text-sm text-muted-foreground">
        Showing {events.length} of {total} events
      </div>

      {/* Vertical timeline */}
      <div className="relative space-y-0">
        {/* Vertical line */}
        <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

        {events.map((event, index) => (
          <TimelineEvent key={event.id} event={event} isLast={index === events.length - 1} />
        ))}
      </div>

      {/* Pagination */}
      {(hasMore || page > 1) && (
        <div
          className="mt-4 flex items-center justify-center gap-2"
          data-testid="timeline-pagination"
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Newer
          </Button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore}
          >
            Older
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Renders a single audit event in the timeline.
 *
 * Shows the event type, actor, timestamp, and any metadata
 * including old/new state for transitions.
 */
function TimelineEvent({
  event,
  isLast,
}: {
  readonly event: AuditEvent;
  readonly isLast: boolean;
}) {
  const { relative, absolute } = formatTimestamp(event.timestamp);
  const eventLabel = EVENT_TYPE_LABELS[event.eventType] ?? event.eventType;
  const actorLabel = ACTOR_TYPE_LABELS[event.actorType] ?? event.actorType;
  const eventStyle = getEventStyle(event.eventType);
  const metadata = event.metadata;

  return (
    <div
      className={`relative flex gap-4 pb-6 ${isLast ? "pb-0" : ""}`}
      data-testid={`timeline-event-${event.id}`}
    >
      {/* Timeline dot */}
      <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background">
        <Zap className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Event content */}
      <div className="flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={eventStyle}>
            {eventLabel}
          </Badge>
          <span className="text-xs text-muted-foreground" title={absolute}>
            {relative}
          </span>
        </div>

        {/* Actor */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <User className="h-3 w-3" />
          <span>{actorLabel}</span>
          {event.actorId && (
            <code className="text-xs text-muted-foreground">({event.actorId})</code>
          )}
        </div>

        {/* State transition details */}
        {metadata && typeof metadata === "object" && Object.keys(metadata).length > 0 && (
          <div className="mt-2 rounded-md bg-muted/50 p-2 text-xs" data-testid="event-metadata">
            {metadata.oldState !== undefined && metadata.newState !== undefined && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {String(metadata.oldState)}
                </Badge>
                <span className="text-muted-foreground">→</span>
                <Badge variant="outline" className="text-xs">
                  {String(metadata.newState)}
                </Badge>
              </div>
            )}
            {metadata.reason && (
              <p className="mt-1 text-muted-foreground">Reason: {String(metadata.reason)}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
