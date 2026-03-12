/**
 * Worker Pools list page.
 *
 * Displays all worker pools as summary cards showing pool name, type,
 * enabled/disabled status, max concurrency, and provider info. Clicking
 * a card navigates to the pool detail view.
 *
 * Supports filtering by pool type and enabled status via a filter bar.
 * Data is fetched with TanStack Query and refreshed in real-time via
 * WebSocket cache invalidation (Workers channel).
 *
 * @see docs/prd/007-technical-architecture.md §7.16 — Worker Pools screen
 * @see T096 — Build worker pool monitoring panel
 */

import { useState } from "react";
import { Filter } from "lucide-react";
import { usePools } from "../../api/hooks/use-pools.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import type { PoolListParams, PoolType } from "../../api/types.js";
import { PoolCard } from "./components/pool-card.js";

/** All pool types available for filtering. */
const POOL_TYPES: { label: string; value: PoolType }[] = [
  { label: "Developer", value: "developer" },
  { label: "Reviewer", value: "reviewer" },
  { label: "Lead Reviewer", value: "lead-reviewer" },
  { label: "Merge Assist", value: "merge-assist" },
  { label: "Planner", value: "planner" },
];

export default function PoolsPage() {
  const [showFilters, setShowFilters] = useState(false);
  const [poolTypeFilter, setPoolTypeFilter] = useState<string | undefined>(undefined);
  const [enabledFilter, setEnabledFilter] = useState<boolean | undefined>(undefined);

  const params: PoolListParams = {
    limit: 100,
    poolType: poolTypeFilter,
    enabled: enabledFilter,
  };

  const { data, isLoading, isError } = usePools(params);

  const pools = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  const activeFilterCount =
    (poolTypeFilter !== undefined ? 1 : 0) + (enabledFilter !== undefined ? 1 : 0);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Worker Pools</h1>
          <p className="text-muted-foreground">Monitor worker capacity and health across pools</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setShowFilters((v) => !v)}
          data-testid="toggle-filters"
        >
          <Filter className="h-4 w-4" />
          {showFilters ? "Hide Filters" : "Filters"}
          {activeFilterCount > 0 && (
            <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      {/* Error state */}
      {isError && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
          data-testid="pools-error"
        >
          <strong>Unable to load pools.</strong> Check that the control-plane API is running.
        </div>
      )}

      {/* Filter bar */}
      {showFilters && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-4" data-testid="pool-filters">
              {/* Pool type filter */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Type:</span>
                {POOL_TYPES.map(({ label, value }) => (
                  <Button
                    key={value}
                    variant={poolTypeFilter === value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPoolTypeFilter(poolTypeFilter === value ? undefined : value)}
                    data-testid={`filter-type-${value}`}
                  >
                    {label}
                  </Button>
                ))}
              </div>

              {/* Enabled filter */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Status:</span>
                <Button
                  variant={enabledFilter === true ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEnabledFilter(enabledFilter === true ? undefined : true)}
                  data-testid="filter-enabled"
                >
                  Enabled
                </Button>
                <Button
                  variant={enabledFilter === false ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEnabledFilter(enabledFilter === false ? undefined : false)}
                  data-testid="filter-disabled"
                >
                  Disabled
                </Button>
              </div>

              {/* Clear filters */}
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPoolTypeFilter(undefined);
                    setEnabledFilter(undefined);
                  }}
                  data-testid="clear-filters"
                >
                  Clear all
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pool count summary */}
      {!isLoading && !isError && (
        <p className="text-sm text-muted-foreground" data-testid="pool-count">
          {total} pool{total !== 1 ? "s" : ""}
          {activeFilterCount > 0 ? " matching filters" : ""}
        </p>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="pools-skeleton">
          {Array.from({ length: 3 }, (_, i) => (
            <Card key={i} className="h-40">
              <CardContent className="flex h-full items-center justify-center">
                <div className="h-4 w-32 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pool cards grid */}
      {!isLoading && pools.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="pool-grid">
          {pools.map((pool) => (
            <PoolCard key={pool.id} pool={pool} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && pools.length === 0 && (
        <div
          className="flex flex-col items-center justify-center rounded-md border border-dashed p-12 text-center"
          data-testid="pools-empty"
        >
          <p className="text-lg font-medium text-muted-foreground">No pools found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeFilterCount > 0
              ? "Try adjusting your filters."
              : "Create a worker pool to get started."}
          </p>
        </div>
      )}
    </div>
  );
}
