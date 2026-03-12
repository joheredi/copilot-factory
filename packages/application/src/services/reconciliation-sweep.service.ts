/**
 * Reconciliation sweep service — detects and fixes inconsistent system state
 * as a self-rescheduling background job.
 *
 * The reconciliation sweep is the system's self-healing mechanism. It runs
 * periodically (default: every 60 seconds) and detects four classes of
 * anomalies:
 *
 * 1. **Stale leases** — Workers that stopped sending heartbeats or exceeded
 *    their TTL. Detected via {@link HeartbeatService.detectStaleLeases} and
 *    recovered via {@link LeaseReclaimService.reclaimLease}.
 *
 * 2. **Orphaned jobs** — Jobs stuck in CLAIMED or RUNNING state past a
 *    configurable timeout (default: 10 minutes). These indicate a worker
 *    that crashed or lost connectivity after claiming a job but before
 *    completing or failing it.
 *
 * 3. **Stuck tasks** — Tasks in ASSIGNED state without an active
 *    heartbeating lease, past a configurable timeout (default: 5 minutes).
 *    These indicate a missed state transition after lease failure.
 *
 * 4. **Blocked task readiness** — BLOCKED tasks whose dependencies may have
 *    resolved but whose readiness wasn't recalculated due to a missed event.
 *    Evaluated via {@link ReadinessService.computeReadiness} and transitioned
 *    via {@link TransitionService.transitionTask}.
 *
 * ## Self-rescheduling pattern
 *
 * Like the scheduler tick (T028), the reconciliation sweep uses the job
 * queue itself for scheduling. After processing, it creates the next
 * RECONCILIATION_SWEEP job with `runAfter = now + sweepIntervalMs`. This
 * ensures persistence across restarts and exactly-once execution.
 *
 * ## Idempotency
 *
 * All sweep operations are idempotent. Running two sweeps concurrently
 * is harmless — the composed services use optimistic concurrency and
 * gracefully handle race conditions.
 *
 * ## Error isolation
 *
 * Each sub-operation is wrapped in a try/catch. A failure in one category
 * (e.g., stale lease reclaim) does not prevent the others from running.
 * All errors are captured in the sweep result for debugging.
 *
 * @see docs/prd/007-technical-architecture.md §7.8 — Queue / Job Architecture
 * @see docs/prd/002-data-model.md §2.8 — Worker Lease Protocol
 * @module @factory/application/services/reconciliation-sweep.service
 */

import {
  JobStatus,
  JobType,
  TaskStatus,
  DEFAULT_RETRY_POLICY,
  DEFAULT_ESCALATION_POLICY,
} from "@factory/domain";

import type { ReconciliationSweepUnitOfWork } from "../ports/reconciliation-sweep.ports.js";
import type { JobQueueService } from "./job-queue.service.js";
import type { HeartbeatService, StalenessPolicy, StaleLeaseInfo } from "./heartbeat.service.js";
import type { LeaseReclaimService, ReclaimReason } from "./lease-reclaim.service.js";
import type { ReadinessService } from "./readiness.service.js";
import type { TransitionService } from "./transition.service.js";
import type { ActorInfo } from "../events/domain-events.js";
import { InvalidTransitionError, VersionConflictError, EntityNotFoundError } from "../errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default interval between reconciliation sweeps in milliseconds.
 * The sweep creates the next job with `runAfter = now + DEFAULT_SWEEP_INTERVAL_MS`.
 */
export const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

/**
 * Default timeout for orphaned job detection in milliseconds.
 * Jobs in CLAIMED or RUNNING state older than this are considered orphaned.
 */
export const DEFAULT_ORPHANED_JOB_TIMEOUT_MS = 10 * 60_000;

/**
 * Default timeout for stuck task detection in milliseconds.
 * Tasks in ASSIGNED state older than this without active leases are considered stuck.
 */
export const DEFAULT_STUCK_TASK_TIMEOUT_MS = 5 * 60_000;

/**
 * Default lease owner identity for the reconciliation sweep processor.
 * Used when claiming sweep jobs from the queue.
 */
export const DEFAULT_SWEEP_LEASE_OWNER = "reconciliation-sweep";

/**
 * Default staleness policy for detecting stale leases.
 * Workers must heartbeat every 30s; after 2 missed + 15s grace = stale.
 */
export const DEFAULT_STALENESS_POLICY: StalenessPolicy = {
  heartbeatIntervalSeconds: 30,
  missedHeartbeatThreshold: 2,
  gracePeriodSeconds: 15,
};

/**
 * Active job statuses that indicate a job may be orphaned when stale.
 */
const ORPHANED_JOB_STATUSES: readonly JobStatus[] = [JobStatus.CLAIMED, JobStatus.RUNNING];

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the reconciliation sweep service.
 *
 * All fields are optional and fall back to sensible defaults.
 */
export interface ReconciliationSweepConfig {
  /**
   * Interval between reconciliation sweeps in milliseconds.
   * @default 60000
   */
  readonly sweepIntervalMs?: number;

  /**
   * Timeout for orphaned job detection in milliseconds.
   * Jobs in CLAIMED/RUNNING state older than this are considered orphaned.
   * @default 600000 (10 minutes)
   */
  readonly orphanedJobTimeoutMs?: number;

  /**
   * Timeout for stuck task detection in milliseconds.
   * Tasks in ASSIGNED state older than this are considered stuck.
   * @default 300000 (5 minutes)
   */
  readonly stuckTaskTimeoutMs?: number;

  /**
   * Identity string used as the lease owner when claiming sweep jobs.
   * @default "reconciliation-sweep"
   */
  readonly leaseOwner?: string;

  /**
   * Staleness policy for heartbeat-based stale lease detection.
   * @default { heartbeatIntervalSeconds: 30, missedHeartbeatThreshold: 2, gracePeriodSeconds: 15 }
   */
  readonly stalenessPolicy?: StalenessPolicy;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * Result of the `initialize()` call.
 */
export interface InitializeSweepResult {
  /** Whether a new sweep job was created. */
  readonly created: boolean;
  /** ID of the sweep job (newly created or existing). */
  readonly jobId?: string;
}

/**
 * An action taken by the sweep for a stale lease.
 */
export interface StaleLeaseSweepAction {
  readonly leaseId: string;
  readonly taskId: string;
  readonly reason: ReclaimReason;
  readonly outcome: "reclaimed" | "error";
  readonly error?: string;
}

/**
 * An action taken by the sweep for an orphaned job.
 */
export interface OrphanedJobSweepAction {
  readonly jobId: string;
  readonly jobType: string;
  readonly outcome: "failed" | "error";
  readonly error?: string;
}

/**
 * An action taken by the sweep for a stuck task.
 */
export interface StuckTaskSweepAction {
  readonly taskId: string;
  readonly outcome: "transitioned_to_ready" | "error";
  readonly error?: string;
}

/**
 * An action taken by the sweep for a blocked task readiness recalculation.
 */
export interface ReadinessRecalcAction {
  readonly taskId: string;
  readonly outcome: "transitioned_to_ready" | "still_blocked" | "error";
  readonly error?: string;
}

/**
 * Summary of all actions taken during a single reconciliation sweep.
 */
export interface SweepSummary {
  /** Stale leases detected and reclaim actions taken. */
  readonly staleLeaseActions: readonly StaleLeaseSweepAction[];
  /** Orphaned jobs detected and failure actions taken. */
  readonly orphanedJobActions: readonly OrphanedJobSweepAction[];
  /** Stuck tasks detected and transition actions taken. */
  readonly stuckTaskActions: readonly StuckTaskSweepAction[];
  /** Blocked tasks evaluated for readiness recalculation. */
  readonly readinessRecalcActions: readonly ReadinessRecalcAction[];
}

/**
 * Result when a sweep was successfully processed.
 */
export interface SweepProcessedResult {
  readonly processed: true;
  /** ID of the sweep job that was processed. */
  readonly sweepJobId: string;
  /** Summary of all reconciliation actions. */
  readonly summary: SweepSummary;
  /** ID of the next sweep job created for the following interval. */
  readonly nextSweepJobId: string;
}

/**
 * Result when no sweep job was available to process.
 */
export interface SweepSkippedResult {
  readonly processed: false;
  /** Why the sweep was skipped. */
  readonly reason: "no_sweep_job";
}

/**
 * Union result type for the `processSweep()` operation.
 */
export type ProcessSweepResult = SweepProcessedResult | SweepSkippedResult;

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * The reconciliation sweep service manages the recurring RECONCILIATION_SWEEP
 * job lifecycle: initialization, processing, and self-rescheduling.
 *
 * @see docs/prd/007-technical-architecture.md §7.8 — Queue / Job Architecture
 */
export interface ReconciliationSweepService {
  /**
   * Seed the first RECONCILIATION_SWEEP job if one does not already exist.
   *
   * Call this once during application startup. It checks for existing
   * non-terminal sweep jobs to avoid accumulating duplicates after restarts.
   */
  initialize(): InitializeSweepResult;

  /**
   * Claim and process a single reconciliation sweep.
   *
   * Attempts to claim the oldest eligible RECONCILIATION_SWEEP job.
   * If one is available, runs all sweep operations, completes the sweep
   * job, and creates the next sweep job with the configured delay.
   *
   * If no sweep job is available, returns immediately with
   * `{ processed: false, reason: "no_sweep_job" }`.
   */
  processSweep(): ProcessSweepResult;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies required by the reconciliation sweep service factory.
 */
export interface ReconciliationSweepDependencies {
  /** Unit of work for sweep-specific read queries. */
  readonly unitOfWork: ReconciliationSweepUnitOfWork;
  /** Job queue service for creating, claiming, and completing jobs. */
  readonly jobQueueService: JobQueueService;
  /** Heartbeat service for detecting stale leases. */
  readonly heartbeatService: HeartbeatService;
  /** Lease reclaim service for recovering stale leases. */
  readonly leaseReclaimService: LeaseReclaimService;
  /** Readiness service for computing task readiness. */
  readonly readinessService: ReadinessService;
  /** Transition service for transitioning stuck/blocked tasks. */
  readonly transitionService: TransitionService;
  /** Returns the current time. Injected for testability. */
  readonly clock: () => Date;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * The actor identity used for all reconciliation sweep actions.
 * All automated reconciliation actions are attributed to the system.
 */
const SWEEP_ACTOR: ActorInfo = {
  type: "system",
  id: "reconciliation-sweep",
};

/**
 * Map a stale lease's staleness reason to a reclaim reason.
 *
 * @param staleInfo - The stale lease info from heartbeat detection
 * @returns The appropriate reclaim reason for the lease reclaim service
 */
function toReclaimReason(staleInfo: StaleLeaseInfo): ReclaimReason {
  return staleInfo.reason === "ttl_expired" ? "ttl_expired" : "missed_heartbeats";
}

/**
 * Detect and reclaim stale leases.
 *
 * Uses the heartbeat service's staleness detection to find leases that
 * have missed too many heartbeats or exceeded their TTL, then delegates
 * to the lease reclaim service for each one.
 *
 * Each reclaim is independent — a failure on one lease doesn't prevent
 * processing of others.
 *
 * @param heartbeatService - Service for detecting stale leases
 * @param leaseReclaimService - Service for reclaiming stale leases
 * @param stalenessPolicy - Policy controlling staleness thresholds
 * @returns Array of actions taken for each stale lease
 */
function sweepStaleLeases(
  heartbeatService: HeartbeatService,
  leaseReclaimService: LeaseReclaimService,
  stalenessPolicy: StalenessPolicy,
): StaleLeaseSweepAction[] {
  const { staleLeases } = heartbeatService.detectStaleLeases(stalenessPolicy);
  const actions: StaleLeaseSweepAction[] = [];

  for (const staleInfo of staleLeases) {
    const reclaimReason = toReclaimReason(staleInfo);
    try {
      leaseReclaimService.reclaimLease({
        leaseId: staleInfo.leaseId,
        reason: reclaimReason,
        retryPolicy: DEFAULT_RETRY_POLICY,
        escalationPolicy: DEFAULT_ESCALATION_POLICY,
        actor: SWEEP_ACTOR,
        metadata: {
          triggeredBy: "reconciliation-sweep",
          stalenessReason: staleInfo.reason,
        },
      });

      actions.push({
        leaseId: staleInfo.leaseId,
        taskId: staleInfo.taskId,
        reason: reclaimReason,
        outcome: "reclaimed",
      });
    } catch (error: unknown) {
      // Gracefully handle expected race conditions (another process
      // may have already reclaimed this lease).
      actions.push({
        leaseId: staleInfo.leaseId,
        taskId: staleInfo.taskId,
        reason: reclaimReason,
        outcome: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return actions;
}

/**
 * Detect and fail orphaned jobs.
 *
 * Finds jobs stuck in CLAIMED or RUNNING state past the timeout threshold
 * and marks them as FAILED. These represent worker processes that died
 * or lost connectivity after claiming a job.
 *
 * @param unitOfWork - Unit of work for querying orphaned jobs
 * @param jobQueueService - Service for failing orphaned jobs
 * @param clock - Time source
 * @param orphanedJobTimeoutMs - Timeout threshold in milliseconds
 * @returns Array of actions taken for each orphaned job
 */
function sweepOrphanedJobs(
  unitOfWork: ReconciliationSweepDependencies["unitOfWork"],
  jobQueueService: JobQueueService,
  clock: () => Date,
  orphanedJobTimeoutMs: number,
): OrphanedJobSweepAction[] {
  const deadline = new Date(clock().getTime() - orphanedJobTimeoutMs);

  const orphanedJobs = unitOfWork.runInTransaction((repos) => {
    return repos.job.findOrphanedJobs(ORPHANED_JOB_STATUSES, deadline);
  });

  const actions: OrphanedJobSweepAction[] = [];

  for (const orphan of orphanedJobs) {
    try {
      jobQueueService.failJob(orphan.jobId, "Orphaned job detected by reconciliation sweep");
      actions.push({
        jobId: orphan.jobId,
        jobType: orphan.jobType,
        outcome: "failed",
      });
    } catch (error: unknown) {
      actions.push({
        jobId: orphan.jobId,
        jobType: orphan.jobType,
        outcome: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return actions;
}

/**
 * Detect and recover stuck tasks.
 *
 * Finds tasks in ASSIGNED state past the timeout threshold and transitions
 * them back to READY for rescheduling. These tasks were assigned to a
 * worker but the worker never started processing (or the lease reclaim
 * didn't fire a task transition).
 *
 * @param unitOfWork - Unit of work for querying stuck tasks
 * @param transitionService - Service for transitioning tasks
 * @param clock - Time source
 * @param stuckTaskTimeoutMs - Timeout threshold in milliseconds
 * @returns Array of actions taken for each stuck task
 */
function sweepStuckTasks(
  unitOfWork: ReconciliationSweepDependencies["unitOfWork"],
  transitionService: TransitionService,
  clock: () => Date,
  stuckTaskTimeoutMs: number,
): StuckTaskSweepAction[] {
  const deadline = new Date(clock().getTime() - stuckTaskTimeoutMs);

  const stuckTasks = unitOfWork.runInTransaction((repos) => {
    return repos.task.findStuckAssignedTasks(deadline);
  });

  const actions: StuckTaskSweepAction[] = [];

  for (const stuck of stuckTasks) {
    try {
      transitionService.transitionTask(
        stuck.taskId,
        TaskStatus.READY,
        { leaseReclaimedRetryEligible: true },
        SWEEP_ACTOR,
        {
          triggeredBy: "reconciliation-sweep",
          reason: "Task stuck in ASSIGNED without active lease",
        },
      );

      actions.push({
        taskId: stuck.taskId,
        outcome: "transitioned_to_ready",
      });
    } catch (error: unknown) {
      // Expected: InvalidTransitionError if task already moved,
      // VersionConflictError if concurrently modified
      if (
        error instanceof InvalidTransitionError ||
        error instanceof VersionConflictError ||
        error instanceof EntityNotFoundError
      ) {
        actions.push({
          taskId: stuck.taskId,
          outcome: "error",
          error: error.message,
        });
      } else {
        actions.push({
          taskId: stuck.taskId,
          outcome: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return actions;
}

/**
 * Recalculate readiness for all BLOCKED tasks.
 *
 * Queries all tasks in BLOCKED status, evaluates each one's readiness
 * via the ReadinessService, and transitions eligible ones to READY via
 * the TransitionService. This catches any dependency resolutions that
 * were missed by the event-driven reverse-dependency recalculation.
 *
 * @param unitOfWork - Unit of work for querying blocked tasks
 * @param readinessService - Service for computing task readiness
 * @param transitionService - Service for transitioning tasks
 * @returns Array of actions taken for each blocked task
 */
function sweepBlockedTasks(
  unitOfWork: ReconciliationSweepDependencies["unitOfWork"],
  readinessService: ReadinessService,
  transitionService: TransitionService,
): ReadinessRecalcAction[] {
  const blockedTasks = unitOfWork.runInTransaction((repos) => {
    return repos.task.findAllBlockedTasks();
  });

  const actions: ReadinessRecalcAction[] = [];

  for (const blocked of blockedTasks) {
    try {
      const readiness = readinessService.computeReadiness(blocked.taskId);

      if (readiness.status === "READY") {
        transitionService.transitionTask(
          blocked.taskId,
          TaskStatus.READY,
          {
            allDependenciesResolved: true,
            hasPolicyBlockers: false,
          },
          SWEEP_ACTOR,
          {
            triggeredBy: "reconciliation-sweep",
            reason: "BLOCKED task dependencies resolved (caught by sweep)",
          },
        );

        actions.push({
          taskId: blocked.taskId,
          outcome: "transitioned_to_ready",
        });
      } else {
        actions.push({
          taskId: blocked.taskId,
          outcome: "still_blocked",
        });
      }
    } catch (error: unknown) {
      // Expected: InvalidTransitionError if task already moved,
      // VersionConflictError if concurrently modified,
      // EntityNotFoundError if task was deleted
      actions.push({
        taskId: blocked.taskId,
        outcome: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a ReconciliationSweepService instance with injected dependencies.
 *
 * The service orchestrates the interaction between the job queue (for
 * sweep job lifecycle) and the heartbeat/reclaim/readiness/transition
 * services (for anomaly detection and recovery). It does not own any
 * state — all persistence is delegated to the composed services.
 *
 * @param deps - Service dependencies
 * @param config - Optional configuration overrides
 * @returns A ReconciliationSweepService instance
 *
 * @example
 * ```typescript
 * const sweepService = createReconciliationSweepService(
 *   {
 *     unitOfWork,
 *     jobQueueService,
 *     heartbeatService,
 *     leaseReclaimService,
 *     readinessService,
 *     transitionService,
 *     clock: () => new Date(),
 *   },
 *   { sweepIntervalMs: 30_000 }, // 30-second interval
 * );
 *
 * // On startup
 * sweepService.initialize();
 *
 * // In a polling loop or job processor
 * const result = sweepService.processSweep();
 * ```
 */
export function createReconciliationSweepService(
  deps: ReconciliationSweepDependencies,
  config?: ReconciliationSweepConfig,
): ReconciliationSweepService {
  const sweepIntervalMs = config?.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const orphanedJobTimeoutMs = config?.orphanedJobTimeoutMs ?? DEFAULT_ORPHANED_JOB_TIMEOUT_MS;
  const stuckTaskTimeoutMs = config?.stuckTaskTimeoutMs ?? DEFAULT_STUCK_TASK_TIMEOUT_MS;
  const leaseOwner = config?.leaseOwner ?? DEFAULT_SWEEP_LEASE_OWNER;
  const stalenessPolicy = config?.stalenessPolicy ?? DEFAULT_STALENESS_POLICY;

  return {
    initialize(): InitializeSweepResult {
      // Check if a non-terminal sweep job already exists
      const existingCount = deps.unitOfWork.runInTransaction((repos) => {
        return repos.job.countNonTerminalByType(JobType.RECONCILIATION_SWEEP);
      });

      if (existingCount > 0) {
        return { created: false };
      }

      // Create the initial sweep job — eligible for immediate claiming
      const { job } = deps.jobQueueService.createJob({
        jobType: JobType.RECONCILIATION_SWEEP,
      });

      return { created: true, jobId: job.jobId };
    },

    processSweep(): ProcessSweepResult {
      // Step 1: Attempt to claim a sweep job
      const claimed = deps.jobQueueService.claimJob(JobType.RECONCILIATION_SWEEP, leaseOwner);

      if (!claimed) {
        return { processed: false, reason: "no_sweep_job" };
      }

      const sweepJobId = claimed.job.jobId;

      // Step 2: Run all sweep operations (each is error-isolated)
      const staleLeaseActions = sweepStaleLeases(
        deps.heartbeatService,
        deps.leaseReclaimService,
        stalenessPolicy,
      );

      const orphanedJobActions = sweepOrphanedJobs(
        deps.unitOfWork,
        deps.jobQueueService,
        deps.clock,
        orphanedJobTimeoutMs,
      );

      const stuckTaskActions = sweepStuckTasks(
        deps.unitOfWork,
        deps.transitionService,
        deps.clock,
        stuckTaskTimeoutMs,
      );

      const readinessRecalcActions = sweepBlockedTasks(
        deps.unitOfWork,
        deps.readinessService,
        deps.transitionService,
      );

      const summary: SweepSummary = {
        staleLeaseActions,
        orphanedJobActions,
        stuckTaskActions,
        readinessRecalcActions,
      };

      // Step 3: Complete the sweep job
      deps.jobQueueService.completeJob(sweepJobId);

      // Step 4: Create the next sweep job with a delay
      const nextRunAfter = new Date(deps.clock().getTime() + sweepIntervalMs);
      const { job: nextJob } = deps.jobQueueService.createJob({
        jobType: JobType.RECONCILIATION_SWEEP,
        runAfter: nextRunAfter,
      });

      return {
        processed: true,
        sweepJobId,
        summary,
        nextSweepJobId: nextJob.jobId,
      };
    },
  };
}
