/**
 * Task summary cards for the dashboard.
 *
 * Renders a responsive grid of four cards showing task counts
 * grouped by operator-facing categories: Active, Queued, Completed,
 * and Needs Attention. Each card uses colour-coded icons to help
 * operators assess system health at a glance.
 *
 * @see docs/prd/001-architecture.md §1.9 — Dashboard view
 * @module
 */

import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card.js";
import type { TaskCategoryCounts } from "../hooks/use-dashboard-data.js";

/** Props for the {@link TaskSummaryCards} component. */
export interface TaskSummaryCardsProps {
  /** Aggregated task counts by category. */
  readonly counts: TaskCategoryCounts;
  /** Whether the data is still loading. */
  readonly isLoading: boolean;
}

interface CardConfig {
  readonly title: string;
  readonly key: keyof Omit<TaskCategoryCounts, "total">;
  readonly description: string;
  readonly colorClass: string;
}

const CARD_CONFIGS: readonly CardConfig[] = [
  {
    title: "Active",
    key: "active",
    description: "Tasks in development, review, or merge",
    colorClass: "text-blue-600 dark:text-blue-400",
  },
  {
    title: "Queued",
    key: "queued",
    description: "Tasks waiting to be picked up",
    colorClass: "text-amber-600 dark:text-amber-400",
  },
  {
    title: "Completed",
    key: "completed",
    description: "Successfully finished tasks",
    colorClass: "text-green-600 dark:text-green-400",
  },
  {
    title: "Needs Attention",
    key: "attention",
    description: "Failed, escalated, or blocked tasks",
    colorClass: "text-red-600 dark:text-red-400",
  },
] as const;

/**
 * Renders four colour-coded summary cards for the main task
 * status categories. Shows a loading skeleton when data is not
 * yet available.
 */
export function TaskSummaryCards({ counts, isLoading }: TaskSummaryCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {CARD_CONFIGS.map((config) => (
        <Card key={config.key} data-testid={`card-${config.key}`}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{config.title}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div
                className="h-8 w-16 animate-pulse rounded bg-muted"
                data-testid={`skeleton-${config.key}`}
              />
            ) : (
              <div
                className={`text-2xl font-bold ${config.colorClass}`}
                data-testid={`count-${config.key}`}
              >
                {counts[config.key]}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">{config.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
