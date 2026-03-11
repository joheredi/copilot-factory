/**
 * Scheduler tick service — creates and processes recurring SCHEDULER_TICK
 * jobs that drive automatic task-to-worker assignment.
 *
 * The scheduler tick is the heartbeat of the control plane's scheduling
 * engine. On each tick:
 *
 * 1. A SCHEDULER_TICK job is claimed from the job queue
 * 2. The scheduler processes all ready tasks by calling `scheduleNext()`
 *    in a loop until no more assignments are possible
 * 3. The tick job is completed
 * 4. A new SCHEDULER_TICK job is created with `runAfter` set to
 *    `now + tickIntervalMs`, establishing the recurring pattern
 *
 * ## Self-rescheduling pattern
 *
 * The tick loop uses the job queue itself for scheduling rather than
 * `setInterval` or external cron. This ensures:
 * - Persistence across restarts (the next tick survives crashes)
 * - Exactly-once execution via atomic job claiming
 * - Configurable and dynamic intervals
 * - Natural backpressure (ticks don't pile up if processing is slow)
 *
 * ## Idempotency
 *
 * Multiple concurrent tick claims are harmless — each tick independently
 * calls `scheduleNext()` which is idempotent due to the lease exclusivity
 * check in the scheduler service. At worst, a concurrent tick evaluates
 * the same candidates but all assignment attempts after the first will
 * fail with `ExclusivityViolationError` and be skipped.
 *
 * ## Initialization
 *
 * On application startup, `initialize()` must be called once to seed the
 * first SCHEDULER_TICK job. It checks for existing non-terminal tick jobs
 * to avoid accumulating duplicates after restarts.
 *
 * @see docs/prd/007-technical-architecture.md §7.8 — Queue / Job Architecture
 * @see docs/prd/007-technical-architecture.md §7.9 — Scheduler Module
 * @module @factory/application/services/scheduler-tick.service
 */

import { JobType } from "@factory/domain";

import type { SchedulerTickUnitOfWork } from "../ports/scheduler-tick.ports.js";
import type { JobQueueService } from "./job-queue.service.js";
import type { SchedulerService, ScheduleResult } from "./scheduler.service.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default interval between scheduler ticks in milliseconds.
 * The scheduler will create the next tick job with `runAfter` set
 * to `now + DEFAULT_TICK_INTERVAL_MS`.
 */
export const DEFAULT_TICK_INTERVAL_MS = 5_000;

/**
 * Default maximum number of ready tasks to evaluate per scheduling pass.
 * Passed through to `SchedulerService.scheduleNext()`.
 */
export const DEFAULT_CANDIDATE_LIMIT = 50;

/**
 * Default lease owner identity for the scheduler tick processor.
 * Used when claiming tick jobs from the queue.
 */
export const DEFAULT_LEASE_OWNER = "scheduler-tick";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the scheduler tick service.
 *
 * All fields are optional and fall back to sensible defaults.
 */
export interface SchedulerTickConfig {
  /**
   * Interval between scheduler ticks in milliseconds.
   * After completing a tick, the next tick job is created with
   * `runAfter = now + tickIntervalMs`.
   *
   * @default 5000
   */
  readonly tickIntervalMs?: number;

  /**
   * Maximum number of ready tasks to evaluate per scheduling pass
   * within a single tick. Passed to `SchedulerService.scheduleNext()`.
   *
   * @default 50
   */
  readonly candidateLimit?: number;

  /**
   * Identity string used as the lease owner when claiming tick jobs.
   * Useful for distinguishing scheduler instances in multi-process setups.
   *
   * @default "scheduler-tick"
   */
  readonly leaseOwner?: string;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * Result of the `initialize()` call.
 */
export interface InitializeTickResult {
  /**
   * Whether a new tick job was created.
   * `false` if a non-terminal tick job already existed.
   */
  readonly created: boolean;

  /**
   * ID of the tick job (newly created or existing).
   * Undefined only when an existing non-terminal tick job was detected
   * (in that case, `created` is `false`).
   */
  readonly jobId?: string;
}

/**
 * Summary of assignments made during one tick.
 */
export interface TickAssignmentSummary {
  /** Number of successful task-to-worker assignments. */
  readonly assignmentCount: number;
  /** The reason the scheduling loop stopped. */
  readonly stopReason: TickStopReason;
}

/**
 * Reasons the scheduling loop within a tick stopped.
 */
export type TickStopReason =
  | "no_ready_tasks"
  | "no_compatible_pools"
  | "all_pools_at_capacity"
  | "all_candidates_contended";

/**
 * Result when a tick was successfully processed.
 */
export interface TickProcessedResult {
  readonly processed: true;
  /** ID of the tick job that was processed. */
  readonly tickJobId: string;
  /** Summary of scheduling activity during this tick. */
  readonly summary: TickAssignmentSummary;
  /** ID of the next tick job created for the following interval. */
  readonly nextTickJobId: string;
}

/**
 * Result when no tick job was available to process.
 */
export interface TickSkippedResult {
  readonly processed: false;
  /** Why the tick was skipped. */
  readonly reason: "no_tick_job";
}

/**
 * Union result type for the `processTick()` operation.
 */
export type ProcessTickResult = TickProcessedResult | TickSkippedResult;

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * The scheduler tick service manages the recurring SCHEDULER_TICK job
 * lifecycle: initialization, processing, and self-rescheduling.
 *
 * @see docs/prd/007-technical-architecture.md §7.8 — Queue / Job Architecture
 */
export interface SchedulerTickService {
  /**
   * Seed the first SCHEDULER_TICK job if one does not already exist.
   *
   * Call this once during application startup. It checks for existing
   * non-terminal tick jobs to avoid accumulating duplicates after
   * application restarts.
   *
   * @returns Whether a new tick job was created.
   */
  initialize(): InitializeTickResult;

  /**
   * Claim and process a single scheduler tick.
   *
   * Attempts to claim the oldest eligible SCHEDULER_TICK job. If one
   * is available, runs the scheduling loop (calling `scheduleNext()`
   * until exhaustion), completes the tick job, and creates the next
   * tick job with the configured delay.
   *
   * If no tick job is available (e.g., the interval hasn't elapsed yet
   * or another instance already claimed it), returns immediately with
   * `{ processed: false, reason: "no_tick_job" }`.
   *
   * @returns Processing result with assignment summary or skip reason.
   */
  processTick(): ProcessTickResult;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Dependencies required by the scheduler tick service factory.
 */
export interface SchedulerTickDependencies {
  /** Unit of work for querying tick job existence. */
  readonly unitOfWork: SchedulerTickUnitOfWork;
  /** Job queue service for creating, claiming, and completing jobs. */
  readonly jobQueueService: JobQueueService;
  /** Scheduler service for task-to-worker assignment. */
  readonly schedulerService: SchedulerService;
  /** Returns the current time. Injected for testability. */
  readonly clock: () => Date;
}

/**
 * Runs the scheduling loop within a single tick, calling `scheduleNext()`
 * repeatedly until no more assignments can be made.
 *
 * Each call to `scheduleNext()` attempts to assign one ready task to a
 * compatible worker pool. The loop continues until the scheduler reports
 * that no further assignments are possible (no ready tasks, no pools,
 * all at capacity, or all contended).
 *
 * @param schedulerService - The scheduler service to invoke
 * @param candidateLimit - Maximum candidates per scheduling pass
 * @returns Summary of assignments made and the stop reason
 */
function runSchedulingLoop(
  schedulerService: SchedulerService,
  candidateLimit: number,
): TickAssignmentSummary {
  let assignmentCount = 0;
  let lastResult: ScheduleResult;

  while (true) {
    lastResult = schedulerService.scheduleNext(candidateLimit);

    if (!lastResult.assigned) {
      return {
        assignmentCount,
        stopReason: lastResult.reason as TickStopReason,
      };
    }

    assignmentCount++;
  }
}

/**
 * Creates a SchedulerTickService instance with injected dependencies.
 *
 * The service orchestrates the interaction between the job queue (for
 * tick job lifecycle) and the scheduler (for task assignment). It does
 * not own any state — all persistence is delegated to the job queue.
 *
 * @param deps - Service dependencies (unit of work, job queue, scheduler, clock)
 * @param config - Optional configuration overrides
 * @returns A SchedulerTickService instance
 *
 * @example
 * ```typescript
 * const tickService = createSchedulerTickService(
 *   { unitOfWork, jobQueueService, schedulerService, clock: () => new Date() },
 *   { tickIntervalMs: 10_000 }, // 10-second interval
 * );
 *
 * // On startup
 * tickService.initialize();
 *
 * // In a polling loop or job processor
 * const result = tickService.processTick();
 * ```
 */
export function createSchedulerTickService(
  deps: SchedulerTickDependencies,
  config?: SchedulerTickConfig,
): SchedulerTickService {
  const tickIntervalMs = config?.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  const candidateLimit = config?.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
  const leaseOwner = config?.leaseOwner ?? DEFAULT_LEASE_OWNER;

  return {
    initialize(): InitializeTickResult {
      // Check if a non-terminal tick job already exists
      const existingCount = deps.unitOfWork.runInTransaction((repos) => {
        return repos.job.countNonTerminalByType(JobType.SCHEDULER_TICK);
      });

      if (existingCount > 0) {
        return { created: false };
      }

      // Create the initial tick job — eligible for immediate claiming
      const { job } = deps.jobQueueService.createJob({
        jobType: JobType.SCHEDULER_TICK,
      });

      return { created: true, jobId: job.jobId };
    },

    processTick(): ProcessTickResult {
      // Step 1: Attempt to claim a tick job
      const claimed = deps.jobQueueService.claimJob(JobType.SCHEDULER_TICK, leaseOwner);

      if (!claimed) {
        return { processed: false, reason: "no_tick_job" };
      }

      const tickJobId = claimed.job.jobId;

      // Step 2: Run the scheduling loop
      const summary = runSchedulingLoop(deps.schedulerService, candidateLimit);

      // Step 3: Complete the tick job
      deps.jobQueueService.completeJob(tickJobId);

      // Step 4: Create the next tick job with a delay
      const nextRunAfter = new Date(deps.clock().getTime() + tickIntervalMs);
      const { job: nextJob } = deps.jobQueueService.createJob({
        jobType: JobType.SCHEDULER_TICK,
        runAfter: nextRunAfter,
      });

      return {
        processed: true,
        tickJobId,
        summary,
        nextTickJobId: nextJob.jobId,
      };
    },
  };
}
