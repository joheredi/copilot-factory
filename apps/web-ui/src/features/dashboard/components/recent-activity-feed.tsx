/**
 * Recent activity feed for the dashboard.
 *
 * Displays the last N audit events in a chronological list with
 * type badges and relative timestamps. The feed updates live via
 * WebSocket-driven cache invalidation.
 *
 * @see docs/prd/001-architecture.md §1.9 — Dashboard view
 * @module
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card.js";
import { Badge } from "../../../components/ui/badge.js";
import type { AuditEvent } from "../../../api/types.js";

/** Props for the {@link RecentActivityFeed} component. */
export interface RecentActivityFeedProps {
  /** Audit events to display, ordered newest first. */
  readonly events: readonly AuditEvent[];
  /** Whether the data is still loading. */
  readonly isLoading: boolean;
}

/**
 * Maps event type prefixes to display-friendly labels and badge variants.
 * Unrecognised event types fall back to a neutral "secondary" badge.
 */
function eventBadgeVariant(eventType: string): "default" | "secondary" | "destructive" | "outline" {
  if (eventType.startsWith("task.")) return "default";
  if (eventType.startsWith("worker.")) return "secondary";
  if (eventType.startsWith("review.")) return "outline";
  if (eventType.startsWith("merge.")) return "outline";
  if (eventType.startsWith("escalation.") || eventType.startsWith("failure.")) {
    return "destructive";
  }
  return "secondary";
}

/**
 * Formats an ISO timestamp into a concise relative time string.
 *
 * @param isoString - ISO 8601 timestamp.
 * @returns A human-readable relative time (e.g., "2m ago", "1h ago").
 */
export function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (Number.isNaN(diffMs) || diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Formats an event type string into a human-readable label.
 *
 * @param eventType - Dot-separated event type (e.g., "task.state_changed").
 * @returns Title-cased label with underscores replaced by spaces.
 */
export function formatEventType(eventType: string): string {
  const parts = eventType.split(".");
  const label = parts[parts.length - 1] ?? eventType;
  return label.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Renders a card containing the most recent audit events with
 * type badges, entity context, and relative timestamps.
 *
 * Shows an empty state message when no events are available,
 * and a loading skeleton while data is being fetched.
 */
export function RecentActivityFeed({ events, isLoading }: RecentActivityFeedProps) {
  return (
    <Card data-testid="recent-activity-card">
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>Latest task transitions and system events</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3" data-testid="activity-skeleton">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-5 w-24 animate-pulse rounded bg-muted" />
                <div className="h-4 w-48 animate-pulse rounded bg-muted" />
                <div className="ml-auto h-4 w-16 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="activity-empty">
            No recent activity. Events will appear here as the system processes tasks.
          </p>
        ) : (
          <div className="space-y-3" data-testid="activity-list">
            {events.map((event) => (
              <ActivityItem key={event.id} event={event} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A single row in the activity feed showing an audit event.
 */
function ActivityItem({ event }: { readonly event: AuditEvent }) {
  return (
    <div className="flex items-center gap-3 text-sm" data-testid={`activity-item-${event.id}`}>
      <Badge variant={eventBadgeVariant(event.eventType)}>{formatEventType(event.eventType)}</Badge>
      <span className="truncate text-muted-foreground">
        {event.entityType}
        {event.entityId ? ` ${event.entityId.slice(0, 8)}…` : ""}
      </span>
      <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
        {formatRelativeTime(event.timestamp)}
      </span>
    </div>
  );
}
