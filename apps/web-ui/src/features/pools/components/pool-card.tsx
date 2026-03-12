/**
 * Pool summary card component for the pool list view.
 *
 * Displays a compact card showing the pool's name, type, concurrency,
 * enabled status, and provider/model info. Clicking the card navigates
 * to the pool detail page.
 *
 * @see T096 — Build worker pool monitoring panel
 */

import { Link } from "react-router-dom";
import { Cpu, Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card.js";
import type { WorkerPool } from "../../../api/types.js";
import { PoolStatusBadge } from "./pool-status-badge.js";
import { PoolTypeBadge } from "./pool-type-badge.js";

export interface PoolCardProps {
  /** The pool to display. */
  readonly pool: WorkerPool;
}

/**
 * Renders a clickable summary card for a single worker pool.
 *
 * Shows key operational metrics at a glance:
 * - Pool name and type badge
 * - Enabled/disabled status
 * - Max concurrency
 * - Provider and model (when configured)
 */
export function PoolCard({ pool }: PoolCardProps) {
  return (
    <Link
      to={`/workers/${pool.id}`}
      className="block transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
      data-testid={`pool-card-${pool.id}`}
    >
      <Card className="h-full">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base font-semibold">{pool.name}</CardTitle>
            <PoolTypeBadge poolType={pool.poolType} />
          </div>
          <PoolStatusBadge enabled={pool.enabled} />
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2" data-testid={`pool-concurrency-${pool.id}`}>
              <Layers className="h-4 w-4" />
              <span>
                Max concurrency: <strong className="text-foreground">{pool.maxConcurrency}</strong>
              </span>
            </div>
            {(pool.provider || pool.model) && (
              <div className="flex items-center gap-2" data-testid={`pool-provider-${pool.id}`}>
                <Cpu className="h-4 w-4" />
                <span>{[pool.provider, pool.model].filter(Boolean).join(" / ")}</span>
              </div>
            )}
            {pool.runtime && (
              <div
                className="text-xs text-muted-foreground"
                data-testid={`pool-runtime-${pool.id}`}
              >
                Runtime: {pool.runtime}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
