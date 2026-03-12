/**
 * Reconciliation sweep port interfaces.
 *
 * These interfaces define the minimal data-access contract that the
 * reconciliation sweep service requires beyond what the composed services
 * (HeartbeatService, LeaseReclaimService, ReadinessService, TransitionService,
 * JobQueueService) already provide.
 *
 * The reconciliation sweep needs to query for:
 * - Orphaned jobs stuck in CLAIMED/RUNNING past a timeout threshold
 * - Tasks stuck in ASSIGNED without an active heartbeating lease
 * - All BLOCKED tasks for readiness recalculation
 *
 * @see docs/prd/007-technical-architecture.md §7.8 — Queue / Job Architecture
 * @see docs/prd/002-data-model.md §2.3 — Job entity and lifecycle
 * @module @factory/application/ports/reconciliation-sweep.ports
 */

import type { JobStatus, JobType, TaskStatus } from "@factory/domain";

// ---------------------------------------------------------------------------
// Entity shapes — the minimal fields the reconciliation sweep reads
// ---------------------------------------------------------------------------

/**
 * An orphaned job record — a job stuck in a non-terminal active state
 * past a timeout threshold.
 *
 * The sweep detects jobs that were claimed or started running but never
 * completed or failed, indicating a worker crash or network partition.
 */
export interface OrphanedJobRecord {
  readonly jobId: string;
  readonly jobType: JobType;
  readonly status: JobStatus;
  readonly leaseOwner: string | null;
  readonly updatedAt: Date;
}

/**
 * A task that appears to be stuck in ASSIGNED state.
 *
 * When a task is ASSIGNED but no active lease is heartbeating, the
 * task may be stuck due to a missed transition or a worker that never
 * started. The sweep detects these and can force them back to READY.
 */
export interface StuckTaskRecord {
  readonly taskId: string;
  readonly status: TaskStatus;
  readonly version: number;
  readonly currentLeaseId: string | null;
  readonly updatedAt: Date;
}

/**
 * A BLOCKED task record for readiness recalculation.
 *
 * The reconciliation sweep periodically evaluates all BLOCKED tasks
 * to catch any missed dependency resolution events.
 */
export interface BlockedTaskRecord {
  readonly taskId: string;
  readonly status: TaskStatus;
}

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

/**
 * Port for querying orphaned jobs.
 *
 * Finds jobs in CLAIMED or RUNNING state whose `updated_at` is older
 * than the given deadline, suggesting the worker processing them has
 * died or become unreachable.
 */
export interface OrphanedJobQueryPort {
  /**
   * Find jobs in active non-terminal states that haven't been updated
   * since before the given deadline.
   *
   * @param statuses - The active statuses to check (typically CLAIMED, RUNNING)
   * @param updatedBefore - Jobs updated before this time are considered orphaned
   * @returns All matching orphaned job records
   */
  findOrphanedJobs(
    statuses: readonly JobStatus[],
    updatedBefore: Date,
  ): readonly OrphanedJobRecord[];

  /**
   * Count jobs of the given type that are not in a terminal status.
   *
   * Terminal statuses are `completed`, `failed`, and `cancelled`.
   * This returns the count of jobs that are `pending`, `claimed`,
   * or `running`.
   *
   * @param jobType - The job type to count.
   * @returns Number of non-terminal jobs of this type.
   */
  countNonTerminalByType(jobType: JobType): number;
}

/**
 * Port for querying stuck tasks.
 *
 * Finds tasks in ASSIGNED state whose `updated_at` is older than
 * the given deadline and whose current lease is either missing or
 * not in an active heartbeating state.
 */
export interface StuckTaskQueryPort {
  /**
   * Find tasks in ASSIGNED state that haven't been updated since
   * before the given deadline.
   *
   * @param updatedBefore - Tasks updated before this time are considered stuck
   * @returns All matching stuck task records
   */
  findStuckAssignedTasks(updatedBefore: Date): readonly StuckTaskRecord[];
}

/**
 * Port for querying all BLOCKED tasks for readiness recalculation.
 *
 * Returns all tasks currently in BLOCKED status so the reconciliation
 * sweep can evaluate whether their dependencies have been resolved.
 */
export interface BlockedTaskQueryPort {
  /**
   * Find all tasks in BLOCKED status.
   *
   * @returns All BLOCKED task records
   */
  findAllBlockedTasks(): readonly BlockedTaskRecord[];
}

// ---------------------------------------------------------------------------
// Transaction boundary
// ---------------------------------------------------------------------------

/**
 * Repository ports available inside a reconciliation sweep transaction.
 */
export interface ReconciliationSweepTransactionRepositories {
  readonly job: OrphanedJobQueryPort;
  readonly task: StuckTaskQueryPort & BlockedTaskQueryPort;
}

/**
 * Unit of work for reconciliation sweep read operations.
 *
 * The sweep primarily performs read queries to detect anomalies,
 * then delegates mutations to the composed services (LeaseReclaimService,
 * TransitionService, JobQueueService) which have their own transaction
 * boundaries.
 */
export interface ReconciliationSweepUnitOfWork {
  runInTransaction<T>(fn: (repos: ReconciliationSweepTransactionRepositories) => T): T;
}
