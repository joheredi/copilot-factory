/**
 * Worker pool summary card for the dashboard.
 *
 * Shows an overview of worker pool health: how many pools exist,
 * how many are enabled, and the aggregate maximum concurrency.
 * This gives operators a quick sense of available processing capacity.
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
import type { PoolSummary } from "../hooks/use-dashboard-data.js";

/** Props for the {@link WorkerPoolSummaryCard} component. */
export interface WorkerPoolSummaryCardProps {
  /** Aggregated pool statistics. */
  readonly summary: PoolSummary;
  /** Whether the data is still loading. */
  readonly isLoading: boolean;
}

/**
 * Renders a summary card with three pool metrics displayed
 * in a horizontal stat row.
 */
export function WorkerPoolSummaryCard({ summary, isLoading }: WorkerPoolSummaryCardProps) {
  return (
    <Card data-testid="pool-summary-card">
      <CardHeader>
        <CardTitle>Worker Pools</CardTitle>
        <CardDescription>Pool capacity and availability</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-1">
                <div className="h-6 w-12 animate-pulse rounded bg-muted" />
                <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-6">
            <StatItem label="Total Pools" value={summary.totalPools} testId="stat-total-pools" />
            <StatItem label="Enabled" value={summary.enabledPools} testId="stat-enabled-pools" />
            <StatItem
              label="Max Concurrency"
              value={summary.totalMaxConcurrency}
              testId="stat-max-concurrency"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A single statistic within the pool summary card.
 */
function StatItem({
  label,
  value,
  testId,
}: {
  readonly label: string;
  readonly value: number;
  readonly testId: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-2xl font-bold" data-testid={testId}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
