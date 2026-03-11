/**
 * Scheduler tick port interfaces.
 *
 * These interfaces define the minimal data-access contract that the
 * scheduler tick service requires beyond what {@link JobQueueService}
 * and {@link SchedulerService} already provide. The primary need is
 * a query to check whether a non-terminal SCHEDULER_TICK job already
 * exists so that `initialize()` can avoid creating duplicates.
 *
 * @see docs/prd/007-technical-architecture.md §7.8 — Queue / Job Architecture
 * @module @factory/application/ports/scheduler-tick.ports
 */

import type { JobType } from "@factory/domain";

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

/**
 * Port for querying job existence by type in non-terminal statuses.
 *
 * Used by the scheduler tick service during initialization to detect
 * whether a SCHEDULER_TICK job is already queued or running. This
 * prevents duplicate tick jobs from accumulating after restarts.
 */
export interface SchedulerTickJobQueryPort {
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

// ---------------------------------------------------------------------------
// Transaction boundary
// ---------------------------------------------------------------------------

/**
 * Repository ports available inside a scheduler tick transaction.
 */
export interface SchedulerTickTransactionRepositories {
  readonly job: SchedulerTickJobQueryPort;
}

/**
 * Unit of work for scheduler tick operations.
 *
 * Provides transactional access to job query operations needed
 * for tick initialization and duplicate detection.
 */
export interface SchedulerTickUnitOfWork {
  runInTransaction<T>(fn: (repos: SchedulerTickTransactionRepositories) => T): T;
}
