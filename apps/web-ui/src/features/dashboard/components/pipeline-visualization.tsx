/**
 * Production line pipeline visualization for the dashboard.
 *
 * Displays a horizontal pipeline showing where tasks are across
 * 7 stages: Intake → Ready → Development → Review → Merge →
 * Validation → Done. Each stage shows the task count and a
 * per-status breakdown. An off-ramp row below the pipeline
 * surfaces tasks in terminal/exceptional states.
 *
 * @see docs/prd/001-architecture.md §1.9 — Dashboard view
 * @see docs/prd/002-data-model.md — Task state machine
 * @module
 */

import { Card, CardContent } from "../../../components/ui/card.js";
import { Badge } from "../../../components/ui/badge.js";

// ---------------------------------------------------------------------------
// Pipeline stage definitions
// ---------------------------------------------------------------------------

/** A single status within a pipeline stage. */
interface StageStatus {
  readonly status: string;
  readonly label: string;
}

/** Configuration for one pipeline stage. */
interface StageConfig {
  readonly id: string;
  readonly label: string;
  readonly statuses: readonly StageStatus[];
  readonly colorClass: string;
  readonly borderClass: string;
}

const PIPELINE_STAGES: readonly StageConfig[] = [
  {
    id: "intake",
    label: "Intake",
    statuses: [
      { status: "BACKLOG", label: "Backlog" },
      { status: "BLOCKED", label: "Blocked" },
    ],
    colorClass: "text-slate-600 dark:text-slate-400",
    borderClass: "border-t-slate-500",
  },
  {
    id: "ready",
    label: "Ready",
    statuses: [{ status: "READY", label: "Ready" }],
    colorClass: "text-amber-600 dark:text-amber-400",
    borderClass: "border-t-amber-500",
  },
  {
    id: "development",
    label: "Development",
    statuses: [
      { status: "ASSIGNED", label: "Assigned" },
      { status: "IN_DEVELOPMENT", label: "In Dev" },
      { status: "DEV_COMPLETE", label: "Dev Complete" },
    ],
    colorClass: "text-blue-600 dark:text-blue-400",
    borderClass: "border-t-blue-500",
  },
  {
    id: "review",
    label: "Review",
    statuses: [
      { status: "IN_REVIEW", label: "In Review" },
      { status: "CHANGES_REQUESTED", label: "Changes Req." },
      { status: "APPROVED", label: "Approved" },
    ],
    colorClass: "text-purple-600 dark:text-purple-400",
    borderClass: "border-t-purple-500",
  },
  {
    id: "merge",
    label: "Merge",
    statuses: [
      { status: "QUEUED_FOR_MERGE", label: "Queued" },
      { status: "MERGING", label: "Merging" },
    ],
    colorClass: "text-orange-600 dark:text-orange-400",
    borderClass: "border-t-orange-500",
  },
  {
    id: "validation",
    label: "Validation",
    statuses: [{ status: "POST_MERGE_VALIDATION", label: "Post-Merge" }],
    colorClass: "text-cyan-600 dark:text-cyan-400",
    borderClass: "border-t-cyan-500",
  },
  {
    id: "done",
    label: "Done",
    statuses: [{ status: "DONE", label: "Done" }],
    colorClass: "text-green-600 dark:text-green-400",
    borderClass: "border-t-green-500",
  },
];

/** Off-ramp statuses shown below the main pipeline. */
const OFFRAMP_STATUSES: readonly StageStatus[] = [
  { status: "FAILED", label: "Failed" },
  { status: "ESCALATED", label: "Escalated" },
  { status: "CANCELLED", label: "Cancelled" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCount(statusCounts: ReadonlyMap<string, number>, status: string): number {
  return statusCounts.get(status) ?? 0;
}

function getStageTotal(
  statusCounts: ReadonlyMap<string, number>,
  statuses: readonly StageStatus[],
): number {
  return statuses.reduce((sum, s) => sum + getCount(statusCounts, s.status), 0);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Arrow connector between pipeline stages. */
function PipelineConnector() {
  return (
    <div className="hidden items-center text-muted-foreground/40 lg:flex" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="shrink-0">
        <path
          d="M9 6l6 6-6 6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/** Props for {@link PipelineStage}. */
interface PipelineStageProps {
  readonly stage: StageConfig;
  readonly statusCounts: ReadonlyMap<string, number>;
}

/** A single stage column in the pipeline. */
function PipelineStage({ stage, statusCounts }: PipelineStageProps) {
  const total = getStageTotal(statusCounts, stage.statuses);

  return (
    <Card
      className={`border-t-2 ${stage.borderClass} flex-1 min-w-0`}
      data-testid={`pipeline-stage-${stage.id}`}
      aria-label={`${stage.label}: ${total} tasks`}
    >
      <CardContent className="p-3 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {stage.label}
        </p>
        <p
          className={`mt-1 text-2xl font-bold ${stage.colorClass}`}
          data-testid={`pipeline-count-${stage.id}`}
        >
          {total}
        </p>
        {stage.statuses.length > 1 && (
          <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
            {stage.statuses.map((s) => {
              const count = getCount(statusCounts, s.status);
              if (count === 0) return null;
              return (
                <span
                  key={s.status}
                  className="text-[10px] text-muted-foreground whitespace-nowrap"
                >
                  {count} {s.label}
                </span>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Off-ramp row showing tasks in terminal/exceptional states. */
function PipelineOfframp({ statusCounts }: { readonly statusCounts: ReadonlyMap<string, number> }) {
  const totalOfframp = OFFRAMP_STATUSES.reduce(
    (sum, s) => sum + getCount(statusCounts, s.status),
    0,
  );

  if (totalOfframp === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-destructive/30 bg-destructive/5 px-4 py-2"
      role="status"
      data-testid="pipeline-offramp"
    >
      <span className="text-xs font-medium text-muted-foreground">Off-pipeline:</span>
      {OFFRAMP_STATUSES.map((s) => {
        const count = getCount(statusCounts, s.status);
        return (
          <Badge
            key={s.status}
            variant="outline"
            className={
              count > 0 ? "border-destructive/50 text-destructive" : "text-muted-foreground"
            }
            data-testid={`offramp-${s.status.toLowerCase()}`}
          >
            {s.label}: {count}
          </Badge>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/** Props for {@link PipelineVisualization}. */
export interface PipelineVisualizationProps {
  /** Per-status task counts. */
  readonly statusCounts: ReadonlyMap<string, number>;
  /** Whether data is still loading. */
  readonly isLoading: boolean;
}

/**
 * Horizontal production-line pipeline visualization.
 *
 * Shows 7 stages from Intake to Done with task counts and
 * connecting arrows. Responsive: horizontal on lg+, grid on smaller.
 */
export function PipelineVisualization({ statusCounts, isLoading }: PipelineVisualizationProps) {
  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="pipeline-skeleton">
        <h2 className="text-sm font-medium text-muted-foreground">Production Pipeline</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:flex lg:items-stretch">
          {PIPELINE_STAGES.map((stage) => (
            <Card key={stage.id} className="border-t-2 border-t-muted flex-1 min-w-0">
              <CardContent className="p-3 text-center">
                <div className="mx-auto h-3 w-12 animate-pulse rounded bg-muted" />
                <div className="mx-auto mt-2 h-7 w-8 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="pipeline-visualization">
      <h2 className="text-sm font-medium text-muted-foreground">Production Pipeline</h2>

      {/* Pipeline stages with connectors */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:flex lg:items-stretch lg:gap-0">
        {PIPELINE_STAGES.map((stage, index) => (
          <div key={stage.id} className="flex items-stretch lg:contents">
            <PipelineStage stage={stage} statusCounts={statusCounts} />
            {index < PIPELINE_STAGES.length - 1 && <PipelineConnector />}
          </div>
        ))}
      </div>

      {/* Off-ramp row */}
      <PipelineOfframp statusCounts={statusCounts} />
    </div>
  );
}
