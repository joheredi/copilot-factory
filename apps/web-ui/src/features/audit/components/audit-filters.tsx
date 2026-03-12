/**
 * Filter controls for the audit explorer.
 *
 * Renders toggle buttons for entity type, event type, and actor type,
 * plus text inputs for entity ID and actor ID, and date pickers for
 * time range. Active filters are highlighted visually.
 *
 * Filter state is managed by the parent via the `useAuditFilters` hook
 * which syncs to URL search params for shareable links.
 *
 * @see T100 — Build audit explorer view
 */

import { X } from "lucide-react";
import { Button } from "../../../components/ui/button.js";
import { Badge } from "../../../components/ui/badge.js";
import { Input } from "../../../components/ui/input.js";
import { Label } from "../../../components/ui/label.js";
import type { AuditFilterActions, AuditFilterState } from "../hooks/use-audit-filters.js";

/** Known entity types in the system. */
const ENTITY_TYPE_OPTIONS = [
  { value: "task", label: "Task" },
  { value: "lease", label: "Lease" },
  { value: "review_cycle", label: "Review Cycle" },
  { value: "merge_queue_item", label: "Merge Queue" },
  { value: "policy_set", label: "Policy Set" },
  { value: "worker", label: "Worker" },
] as const;

/** Known event types in the system. */
const EVENT_TYPE_OPTIONS = [
  { value: "state_transition", label: "State Transition" },
  { value: "created", label: "Created" },
  { value: "deleted", label: "Deleted" },
  { value: "policy_applied", label: "Policy Applied" },
  { value: "lease_reclaimed", label: "Lease Reclaimed" },
  { value: "operator_override", label: "Operator Override" },
] as const;

/** Known actor types in the system. */
const ACTOR_TYPE_OPTIONS = [
  { value: "system", label: "System" },
  { value: "worker", label: "Worker" },
  { value: "operator", label: "Operator" },
  { value: "scheduler", label: "Scheduler" },
  { value: "reconciliation", label: "Reconciliation" },
] as const;

export interface AuditFiltersProps {
  readonly state: AuditFilterState;
  readonly actions: AuditFilterActions;
}

/**
 * Counts the number of active filters for displaying a badge count.
 */
function countActiveFilters(state: AuditFilterState): number {
  let count = 0;
  if (state.entityTypeFilter) count++;
  if (state.entityIdFilter) count++;
  if (state.eventTypeFilter) count++;
  if (state.actorTypeFilter) count++;
  if (state.actorIdFilter) count++;
  if (state.startFilter) count++;
  if (state.endFilter) count++;
  return count;
}

/**
 * Renders the audit explorer filter bar.
 *
 * Organized into sections: entity filters (type + ID), event type,
 * actor filters (type + ID), and time range. Each toggle button section
 * allows single-select (click again to deselect). A clear-all button
 * appears when any filter is active.
 */
export function AuditFilters({ state, actions }: AuditFiltersProps) {
  const activeCount = countActiveFilters(state);

  return (
    <div className="space-y-4" data-testid="audit-filters">
      {/* Entity Type toggles */}
      <div className="space-y-2">
        <span className="text-sm font-medium text-muted-foreground">Entity Type</span>
        <div className="flex flex-wrap gap-1.5">
          {ENTITY_TYPE_OPTIONS.map(({ value, label }) => {
            const isActive = state.entityTypeFilter === value;
            return (
              <Button
                key={value}
                variant={isActive ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => actions.setEntityType(isActive ? "" : value)}
                data-testid={`filter-entity-type-${value}`}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Event Type toggles */}
      <div className="space-y-2">
        <span className="text-sm font-medium text-muted-foreground">Event Type</span>
        <div className="flex flex-wrap gap-1.5">
          {EVENT_TYPE_OPTIONS.map(({ value, label }) => {
            const isActive = state.eventTypeFilter === value;
            return (
              <Button
                key={value}
                variant={isActive ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => actions.setEventType(isActive ? "" : value)}
                data-testid={`filter-event-type-${value}`}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Actor Type toggles */}
      <div className="space-y-2">
        <span className="text-sm font-medium text-muted-foreground">Actor Type</span>
        <div className="flex flex-wrap gap-1.5">
          {ACTOR_TYPE_OPTIONS.map(({ value, label }) => {
            const isActive = state.actorTypeFilter === value;
            return (
              <Button
                key={value}
                variant={isActive ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => actions.setActorType(isActive ? "" : value)}
                data-testid={`filter-actor-type-${value}`}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Text inputs: Entity ID + Actor ID */}
      <div className="flex flex-wrap gap-4">
        <div className="w-64 space-y-1">
          <Label htmlFor="entity-id-filter" className="text-sm text-muted-foreground">
            Entity ID
          </Label>
          <Input
            id="entity-id-filter"
            type="text"
            placeholder="e.g. task-abc-123"
            value={state.entityIdFilter}
            onChange={(e) => actions.setEntityId(e.target.value)}
            className="h-8 text-sm"
            data-testid="filter-entity-id"
          />
        </div>
        <div className="w-64 space-y-1">
          <Label htmlFor="actor-id-filter" className="text-sm text-muted-foreground">
            Actor ID
          </Label>
          <Input
            id="actor-id-filter"
            type="text"
            placeholder="e.g. worker-001"
            value={state.actorIdFilter}
            onChange={(e) => actions.setActorId(e.target.value)}
            className="h-8 text-sm"
            data-testid="filter-actor-id"
          />
        </div>
      </div>

      {/* Time range */}
      <div className="flex flex-wrap gap-4">
        <div className="w-64 space-y-1">
          <Label htmlFor="start-filter" className="text-sm text-muted-foreground">
            From
          </Label>
          <Input
            id="start-filter"
            type="datetime-local"
            value={state.startFilter}
            onChange={(e) => actions.setStart(e.target.value)}
            className="h-8 text-sm"
            data-testid="filter-start"
          />
        </div>
        <div className="w-64 space-y-1">
          <Label htmlFor="end-filter" className="text-sm text-muted-foreground">
            To
          </Label>
          <Input
            id="end-filter"
            type="datetime-local"
            value={state.endFilter}
            onChange={(e) => actions.setEnd(e.target.value)}
            className="h-8 text-sm"
            data-testid="filter-end"
          />
        </div>
      </div>

      {/* Clear all */}
      {activeCount > 0 && (
        <div className="flex items-center gap-2">
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
          <Badge variant="secondary" className="text-xs" data-testid="active-filter-count">
            {activeCount} active
          </Badge>
        </div>
      )}
    </div>
  );
}
