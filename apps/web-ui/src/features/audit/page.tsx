/**
 * Audit Explorer page.
 *
 * Displays a searchable, filterable, and paginated audit event timeline.
 * Operators can search by entity type/ID, event type, actor type/ID,
 * and time range. Each event row is expandable to show full details
 * including old/new state transitions and formatted metadata JSON.
 *
 * Architecture:
 * - Filter state is stored in URL search params via `useAuditFilters` hook
 *   for shareable/bookmarkable links
 * - Data fetching via `useAuditLog` TanStack Query hook with WebSocket
 *   cache invalidation for real-time updates
 * - Results ordered chronologically (newest first, API default)
 * - Server-side filtering and pagination via query params
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — Audit Explorer screen
 * @see T100 — Build audit explorer view
 */

import { Filter, Search } from "lucide-react";
import { useState } from "react";
import { useAuditLog } from "../../api/hooks/use-audit.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { AuditFilters } from "./components/audit-filters.js";
import { AuditEventTable } from "./components/audit-event-table.js";
import { AuditPagination } from "./components/audit-pagination.js";
import { useAuditFilters } from "./hooks/use-audit-filters.js";

export default function AuditPage() {
  const [filterState, filterActions] = useAuditFilters();
  const [showFilters, setShowFilters] = useState(true);

  const { data, isLoading, isError } = useAuditLog(filterState.params);

  const events = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit Explorer</h1>
          <p className="text-muted-foreground">
            Search and browse system events across all entities
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setShowFilters((v) => !v)}
          data-testid="toggle-filters"
        >
          <Filter className="h-4 w-4" />
          {showFilters ? "Hide Filters" : "Show Filters"}
        </Button>
      </div>

      {/* Error state */}
      {isError && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
          data-testid="audit-error"
        >
          <strong>Unable to load audit events.</strong> Check that the control-plane API is running.
        </div>
      )}

      {/* Filters */}
      {showFilters && (
        <Card>
          <CardContent className="pt-6">
            <AuditFilters state={filterState} actions={filterActions} />
          </CardContent>
        </Card>
      )}

      {/* Results summary */}
      {!isLoading && !isError && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Search className="h-4 w-4" />
          <span data-testid="results-summary">
            {total === 0
              ? "No events match your filters"
              : `Found ${total} event${total === 1 ? "" : "s"}`}
          </span>
        </div>
      )}

      {/* Event table */}
      <AuditEventTable events={events} isLoading={isLoading} />

      {/* Pagination */}
      {!isLoading && (
        <AuditPagination
          page={filterState.page}
          limit={filterState.limit}
          total={total}
          onPageChange={filterActions.setPage}
          onLimitChange={filterActions.setLimit}
        />
      )}
    </div>
  );
}
