/**
 * Starter metrics inventory — the initial Prometheus-compatible metrics
 * for operational visibility.
 *
 * Defines all metrics from docs/prd/010-integration-contracts.md §10.13.3
 * with correct types (counter, histogram, gauge) and low-cardinality labels
 * per §10.13.4. These metrics are the first operational surface for operators.
 *
 * ## Usage
 *
 * Metrics are created lazily on first access via {@link getStarterMetrics}.
 * The metrics subsystem ({@link initMetrics}) must be initialized before
 * first access; otherwise metrics are registered on the prom-client default
 * global registry.
 *
 * Services import and use metrics at their instrumentation points:
 * ```ts
 * import { getStarterMetrics } from "@factory/observability";
 *
 * const metrics = getStarterMetrics();
 * metrics.taskTransitions.inc({ task_state: "APPROVED", result: "success" });
 * ```
 *
 * ## Label rules (§10.13.4)
 *
 * All labels are low-cardinality by design. The following are **never** used
 * as Prometheus labels: `task_id`, `run_id`, `branch_name` — those values
 * belong in traces and logs.
 *
 * @see docs/prd/010-integration-contracts.md §10.13.3 — Starter metrics list
 * @see docs/prd/010-integration-contracts.md §10.13.4 — Label cardinality rules
 * @module @factory/observability
 */

import { createCounter, createHistogram, createGauge } from "./metrics.js";
import type { Counter, Histogram, Gauge } from "prom-client";

// ─── Metric Type Definitions ────────────────────────────────────────────────

/**
 * Labels for task transition counters.
 *
 * - `task_state`: The target state of the transition (e.g., "APPROVED", "DONE").
 * - `result`: Outcome of the transition attempt — "success" or "error".
 */
type TaskTransitionLabels = "task_state" | "result";

/**
 * Labels for terminal task counters.
 *
 * - `task_state`: The terminal state ("DONE", "FAILED", "CANCELLED").
 */
type TaskTerminalLabels = "task_state";

/**
 * Labels for worker run metrics.
 *
 * - `pool_id`: Worker pool that executed the run.
 * - `result`: Outcome — "success", "failed", "cancelled".
 */
type WorkerRunLabels = "pool_id" | "result";

/**
 * Labels for worker run duration histograms.
 *
 * - `pool_id`: Worker pool that executed the run.
 */
type WorkerRunDurationLabels = "pool_id";

/**
 * Labels for heartbeat timeout counters.
 *
 * - `pool_id`: Worker pool where the timeout occurred.
 */
type HeartbeatTimeoutLabels = "pool_id";

/**
 * Labels for review cycle counters.
 *
 * - `result`: Outcome of the review cycle — "approved", "changes_requested", "rejected".
 */
type ReviewCycleLabels = "result";

/**
 * Labels for merge attempt counters.
 *
 * - `result`: Outcome — "merged", "rebase_conflict", "validation_failed", "push_failed".
 */
type MergeAttemptLabels = "result";

/**
 * Labels for validation run metrics.
 *
 * - `validation_profile`: Name of the validation profile executed.
 * - `result`: Outcome — "passed" or "failed".
 */
type ValidationRunLabels = "validation_profile" | "result";

/**
 * Labels for validation duration histograms.
 *
 * - `validation_profile`: Name of the validation profile executed.
 */
type ValidationDurationLabels = "validation_profile";

/**
 * Labels for queue depth gauges.
 *
 * - `job_type`: The type of job in the queue.
 */
type QueueDepthLabels = "job_type";

// ─── StarterMetrics Interface ───────────────────────────────────────────────

/**
 * The complete set of starter metrics from §10.13.3.
 *
 * Each property corresponds to one Prometheus metric with the correct
 * type (counter, histogram, or gauge) and label set.
 */
export interface StarterMetrics {
  /**
   * Total number of task state transitions.
   *
   * Incremented on every successful or failed task transition attempt
   * in the TransitionService.
   *
   * @metric factory_task_transitions_total
   * @type Counter
   * @labels task_state, result
   */
  readonly taskTransitions: Counter<TaskTransitionLabels>;

  /**
   * Total number of tasks reaching terminal state (DONE, FAILED, CANCELLED).
   *
   * Incremented when a task transitions to a terminal state, providing
   * a quick view of task completion rates and failure modes.
   *
   * @metric factory_task_terminal_total
   * @type Counter
   * @labels task_state
   */
  readonly taskTerminal: Counter<TaskTerminalLabels>;

  /**
   * Total number of worker runs started.
   *
   * Incremented when a worker run completes (success, failure, or cancellation)
   * in the WorkerSupervisorService.
   *
   * @metric factory_worker_runs_total
   * @type Counter
   * @labels pool_id, result
   */
  readonly workerRuns: Counter<WorkerRunLabels>;

  /**
   * Duration of worker runs in seconds.
   *
   * Observed at the end of each worker run in the WorkerSupervisorService.
   * Histogram buckets are tuned for typical AI agent execution times
   * (seconds to minutes).
   *
   * @metric factory_worker_run_duration_seconds
   * @type Histogram
   * @labels pool_id
   */
  readonly workerRunDuration: Histogram<WorkerRunDurationLabels>;

  /**
   * Total number of worker heartbeat timeouts detected.
   *
   * Incremented in the HeartbeatService when stale leases are detected
   * due to missed heartbeats or TTL expiry.
   *
   * @metric factory_worker_heartbeat_timeouts_total
   * @type Counter
   * @labels pool_id
   */
  readonly workerHeartbeatTimeouts: Counter<HeartbeatTimeoutLabels>;

  /**
   * Total number of review cycles created.
   *
   * Incremented when the ReviewerDispatchService creates a new review cycle
   * and fans out specialist reviewer jobs.
   *
   * @metric factory_review_cycles_total
   * @type Counter
   * @labels result
   */
  readonly reviewCycles: Counter<ReviewCycleLabels>;

  /**
   * Total number of review rounds (consolidations) completed.
   *
   * Incremented when the LeadReviewConsolidationService assembles
   * specialist review context for lead review.
   *
   * @metric factory_review_rounds_total
   * @type Counter
   */
  readonly reviewRounds: Counter<string>;

  /**
   * Total number of merge attempts.
   *
   * Incremented on every merge execution attempt in the MergeExecutorService,
   * regardless of outcome.
   *
   * @metric factory_merge_attempts_total
   * @type Counter
   * @labels result
   */
  readonly mergeAttempts: Counter<MergeAttemptLabels>;

  /**
   * Total number of merge failures.
   *
   * Incremented when a merge attempt ends in a non-success outcome
   * (rebase_conflict, validation_failed, push_failed).
   *
   * @metric factory_merge_failures_total
   * @type Counter
   */
  readonly mergeFailures: Counter<string>;

  /**
   * Total number of validation runs executed.
   *
   * Incremented after each validation run in the ValidationRunnerService.
   *
   * @metric factory_validation_runs_total
   * @type Counter
   * @labels validation_profile, result
   */
  readonly validationRuns: Counter<ValidationRunLabels>;

  /**
   * Duration of validation runs in seconds.
   *
   * Observed at the end of each validation run in the ValidationRunnerService.
   * Histogram buckets are tuned for typical check suite durations.
   *
   * @metric factory_validation_duration_seconds
   * @type Histogram
   * @labels validation_profile
   */
  readonly validationDuration: Histogram<ValidationDurationLabels>;

  /**
   * Current depth of the job queue by type.
   *
   * Updated when jobs are created, completed, or failed in the JobQueueService.
   * Operators use this to monitor queue backlog.
   *
   * @metric factory_queue_depth
   * @type Gauge
   * @labels job_type
   */
  readonly queueDepth: Gauge<QueueDepthLabels>;
}

// ─── Default Histogram Buckets ──────────────────────────────────────────────

/**
 * Histogram buckets for worker run duration.
 * Tuned for AI agent execution: 5s to 30min in exponential-ish steps.
 */
const WORKER_RUN_BUCKETS = [5, 15, 30, 60, 120, 300, 600, 1200, 1800];

/**
 * Histogram buckets for validation run duration.
 * Tuned for check suite execution: 1s to 10min.
 */
const VALIDATION_DURATION_BUCKETS = [1, 5, 10, 30, 60, 120, 300, 600];

// ─── Terminal State Set ─────────────────────────────────────────────────────

/**
 * Task states considered terminal per §2.2 of the data model.
 * Used to determine when to increment the `factory_task_terminal_total` counter.
 */
export const TERMINAL_TASK_STATES: ReadonlySet<string> = new Set(["DONE", "FAILED", "CANCELLED"]);

// ─── Singleton ──────────────────────────────────────────────────────────────

let starterMetrics: StarterMetrics | undefined;

/**
 * Returns the singleton StarterMetrics instance, creating it on first call.
 *
 * The metrics are registered on the active prom-client registry (set by
 * {@link initMetrics}). If called before `initMetrics`, metrics register
 * on the prom-client default global registry.
 *
 * Each metric follows the `factory_*` naming convention from §10.13.3
 * and uses only low-cardinality labels per §10.13.4.
 *
 * @returns The shared StarterMetrics instance.
 *
 * @example
 * ```ts
 * // After initMetrics() has been called:
 * const metrics = getStarterMetrics();
 * metrics.taskTransitions.inc({ task_state: "APPROVED", result: "success" });
 * metrics.workerRunDuration.observe({ pool_id: "developer" }, 45.2);
 * metrics.queueDepth.set({ job_type: "worker_dispatch" }, 3);
 * ```
 */
export function getStarterMetrics(): StarterMetrics {
  if (!starterMetrics) {
    starterMetrics = createStarterMetricsInstance();
  }
  return starterMetrics;
}

/**
 * Resets the starter metrics singleton. Intended for test cleanup only.
 *
 * Must be called alongside {@link resetMetrics} in test teardown to
 * ensure metrics are re-created with a fresh registry on the next access.
 *
 * @internal
 */
export function resetStarterMetrics(): void {
  starterMetrics = undefined;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Creates all starter metric instances.
 *
 * Each metric is created via the factory functions from `metrics.ts`,
 * which register them on the active prom-client registry.
 *
 * @returns A fully populated StarterMetrics object.
 * @internal
 */
function createStarterMetricsInstance(): StarterMetrics {
  return {
    taskTransitions: createCounter<TaskTransitionLabels>({
      name: "factory_task_transitions_total",
      help: "Total number of task state transitions.",
      labelNames: ["task_state", "result"] as const,
    }),

    taskTerminal: createCounter<TaskTerminalLabels>({
      name: "factory_task_terminal_total",
      help: "Total number of tasks reaching terminal state.",
      labelNames: ["task_state"] as const,
    }),

    workerRuns: createCounter<WorkerRunLabels>({
      name: "factory_worker_runs_total",
      help: "Total number of worker runs completed.",
      labelNames: ["pool_id", "result"] as const,
    }),

    workerRunDuration: createHistogram<WorkerRunDurationLabels>({
      name: "factory_worker_run_duration_seconds",
      help: "Duration of worker runs in seconds.",
      labelNames: ["pool_id"] as const,
      buckets: WORKER_RUN_BUCKETS,
    }),

    workerHeartbeatTimeouts: createCounter<HeartbeatTimeoutLabels>({
      name: "factory_worker_heartbeat_timeouts_total",
      help: "Total number of worker heartbeat timeouts detected.",
      labelNames: ["pool_id"] as const,
    }),

    reviewCycles: createCounter<ReviewCycleLabels>({
      name: "factory_review_cycles_total",
      help: "Total number of review cycles created.",
      labelNames: ["result"] as const,
    }),

    reviewRounds: createCounter({
      name: "factory_review_rounds_total",
      help: "Total number of review consolidation rounds completed.",
    }),

    mergeAttempts: createCounter<MergeAttemptLabels>({
      name: "factory_merge_attempts_total",
      help: "Total number of merge attempts.",
      labelNames: ["result"] as const,
    }),

    mergeFailures: createCounter({
      name: "factory_merge_failures_total",
      help: "Total number of merge failures.",
    }),

    validationRuns: createCounter<ValidationRunLabels>({
      name: "factory_validation_runs_total",
      help: "Total number of validation runs executed.",
      labelNames: ["validation_profile", "result"] as const,
    }),

    validationDuration: createHistogram<ValidationDurationLabels>({
      name: "factory_validation_duration_seconds",
      help: "Duration of validation runs in seconds.",
      labelNames: ["validation_profile"] as const,
      buckets: VALIDATION_DURATION_BUCKETS,
    }),

    queueDepth: createGauge<QueueDepthLabels>({
      name: "factory_queue_depth",
      help: "Current depth of the job queue by type.",
      labelNames: ["job_type"] as const,
    }),
  };
}
