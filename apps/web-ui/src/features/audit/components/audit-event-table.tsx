/**
 * Audit event table with expandable detail rows.
 *
 * Renders audit events in a timeline-style table ordered chronologically
 * (newest first, matching API default). Each row can be expanded to show
 * full event details including old/new state and formatted metadata JSON.
 *
 * @see T100 — Build audit explorer view
 */

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.js";
import { Badge } from "../../../components/ui/badge.js";
import { Card, CardContent } from "../../../components/ui/card.js";
import type { AuditEvent } from "../../../api/types.js";

export interface AuditEventTableProps {
  /** The audit events to display. */
  readonly events: readonly AuditEvent[];
  /** Whether data is still loading. */
  readonly isLoading: boolean;
}

/**
 * Formats a timestamp to a human-readable absolute format with time.
 *
 * Unlike the task table which uses relative times, the audit explorer
 * shows exact timestamps since operators need precise timing information
 * for incident investigation.
 */
function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** Color mapping for entity type badges. */
const ENTITY_TYPE_VARIANTS: Record<string, string> = {
  task: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  lease: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  review_cycle: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  merge_queue_item: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  policy_set: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
  worker: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

/** Human-readable labels for entity types. */
const ENTITY_TYPE_LABELS: Record<string, string> = {
  task: "Task",
  lease: "Lease",
  review_cycle: "Review Cycle",
  merge_queue_item: "Merge Queue",
  policy_set: "Policy Set",
  worker: "Worker",
};

/** Human-readable labels for event types. */
const EVENT_TYPE_LABELS: Record<string, string> = {
  state_transition: "State Transition",
  created: "Created",
  deleted: "Deleted",
  policy_applied: "Policy Applied",
  lease_reclaimed: "Lease Reclaimed",
  operator_override: "Operator Override",
};

/** Human-readable labels for actor types. */
const ACTOR_TYPE_LABELS: Record<string, string> = {
  system: "System",
  worker: "Worker",
  operator: "Operator",
  scheduler: "Scheduler",
  reconciliation: "Reconciliation",
};

/**
 * Renders a colored badge for entity types.
 */
function EntityTypeBadge({ type }: { readonly type: string }) {
  const className = ENTITY_TYPE_VARIANTS[type] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
      data-testid={`entity-type-badge-${type}`}
    >
      {ENTITY_TYPE_LABELS[type] ?? type}
    </span>
  );
}

/**
 * Renders the expanded detail view for an audit event.
 *
 * Shows old state → new state transition (if present), actor details,
 * and metadata formatted as indented JSON for readability.
 */
function AuditEventDetail({ event }: { readonly event: AuditEvent }) {
  const hasStateTransition = event.oldState !== null || event.newState !== null;
  const hasMetadata = Object.keys(event.metadata).length > 0;

  return (
    <Card className="border-l-4 border-l-primary/30" data-testid={`event-detail-${event.id}`}>
      <CardContent className="space-y-3 pt-4">
        {/* State transition */}
        {hasStateTransition && (
          <div className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              State Transition
            </span>
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="outline" data-testid="old-state">
                {event.oldState ?? "(none)"}
              </Badge>
              <span className="text-muted-foreground">→</span>
              <Badge variant="secondary" data-testid="new-state">
                {event.newState ?? "(none)"}
              </Badge>
            </div>
          </div>
        )}

        {/* Actor info */}
        <div className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Actor
          </span>
          <div className="text-sm">
            <span className="font-medium">
              {ACTOR_TYPE_LABELS[event.actorType] ?? event.actorType}
            </span>
            {event.actorId && <span className="ml-1 text-muted-foreground">({event.actorId})</span>}
          </div>
        </div>

        {/* Entity link */}
        <div className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Entity
          </span>
          <div className="text-sm">
            <EntityTypeBadge type={event.entityType} />
            {event.entityType === "task" ? (
              <Link
                to={`/tasks/${event.entityId}`}
                className="ml-2 text-primary hover:underline"
                data-testid="entity-link"
              >
                {event.entityId}
              </Link>
            ) : (
              <code className="ml-2 text-xs" data-testid="entity-id">
                {event.entityId}
              </code>
            )}
          </div>
        </div>

        {/* Metadata JSON */}
        {hasMetadata && (
          <div className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Metadata
            </span>
            <pre
              className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs"
              data-testid="event-metadata"
            >
              {JSON.stringify(event.metadata, null, 2)}
            </pre>
          </div>
        )}

        {/* Timestamp */}
        <div className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Timestamp
          </span>
          <div className="text-xs text-muted-foreground" data-testid="event-timestamp-detail">
            {new Date(event.timestamp).toISOString()}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Renders the audit event table with expandable detail rows.
 *
 * Shows a timeline of events with columns: Time, Entity, Event, Actor.
 * Clicking a row expands it to show full details including state
 * transitions and metadata.
 */
export function AuditEventTable({ events, isLoading }: AuditEventTableProps) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  if (isLoading) {
    return (
      <div data-testid="audit-table-skeleton">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Time</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Actor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }, (_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <div className="h-4 w-4 animate-pulse rounded bg-muted" />
                </TableCell>
                <TableCell>
                  <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                </TableCell>
                <TableCell>
                  <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
                </TableCell>
                <TableCell>
                  <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                </TableCell>
                <TableCell>
                  <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-md border border-dashed p-12 text-center"
        data-testid="audit-table-empty"
      >
        <p className="text-lg font-medium text-muted-foreground">No audit events found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Try adjusting your filters or check that the system has recorded events.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="audit-event-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Time</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Actor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => {
            const isExpanded = expandedIds.has(event.id);
            return (
              <TableRow
                key={event.id}
                className="cursor-pointer"
                data-testid={`audit-row-${event.id}`}
                onClick={() => toggleExpanded(event.id)}
              >
                <TableCell className="w-8 px-2">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {formatTimestamp(event.timestamp)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <EntityTypeBadge type={event.entityType} />
                    <code className="text-xs text-muted-foreground">{event.entityId}</code>
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
                  {event.oldState !== null && event.newState !== null && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {event.oldState} → {event.newState}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {ACTOR_TYPE_LABELS[event.actorType] ?? event.actorType}
                  {event.actorId && (
                    <span className="ml-1 text-xs opacity-70">({event.actorId})</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Expanded details rendered below the table for expanded rows */}
      {events
        .filter((event) => expandedIds.has(event.id))
        .map((event) => (
          <div key={`detail-${event.id}`} className="mt-2 mb-4 ml-8">
            <AuditEventDetail event={event} />
          </div>
        ))}
    </div>
  );
}
