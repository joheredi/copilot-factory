/**
 * Scheduler port interfaces.
 *
 * These interfaces define the minimal data-access contract that the
 * scheduler service requires for selecting ready tasks and matching
 * them to compatible worker pools. They are intentionally narrow —
 * each port exposes only the read operations needed for scheduling
 * decisions, not the full CRUD surface of the underlying repositories.
 *
 * @see docs/prd/001-architecture.md §1.6.4 Scheduler
 * @see docs/prd/007-technical-architecture.md §7.6 Scheduler Module
 * @module @factory/application/ports/scheduler.ports
 */

import type { TaskPriority, TaskStatus, WorkerPoolType } from "@factory/domain";

// ---------------------------------------------------------------------------
// Entity shapes — the minimal fields the scheduler reads
// ---------------------------------------------------------------------------

/**
 * Minimal task record required by the scheduler for assignment decisions.
 *
 * Includes fields needed to determine scheduling priority and pool
 * compatibility. Tasks are returned in priority order (CRITICAL first,
 * then by creation time ascending within the same priority).
 */
export interface SchedulableTask {
  readonly taskId: string;
  readonly repositoryId: string;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  /** Capabilities the task requires from a worker pool (e.g., ["typescript", "react"]). */
  readonly requiredCapabilities: readonly string[];
  readonly createdAt: Date;
}

/**
 * Worker pool record with current utilization data.
 *
 * The scheduler uses this to determine pool compatibility and whether
 * the pool has available capacity for new assignments.
 */
export interface SchedulablePool {
  readonly poolId: string;
  readonly poolType: WorkerPoolType;
  /** Capabilities this pool provides (e.g., ["typescript", "react", "database"]). */
  readonly capabilities: readonly string[];
  /** Maximum number of concurrent active leases this pool supports. */
  readonly maxConcurrency: number;
  /** Current number of active leases in this pool. */
  readonly activeLeaseCount: number;
  /** Default lease timeout in seconds for tasks assigned to this pool. */
  readonly defaultTimeoutSec: number;
  /** Whether the pool is accepting new assignments. */
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

/**
 * Port for querying tasks eligible for scheduling.
 *
 * `findReadyByPriority` returns tasks in READY status, ordered by
 * priority (CRITICAL > HIGH > MEDIUM > LOW), then by creation time
 * ascending (oldest first within the same priority level).
 *
 * The `limit` parameter caps the number of tasks returned to avoid
 * loading the entire READY queue on every tick.
 */
export interface SchedulerTaskRepositoryPort {
  findReadyByPriority(limit: number): readonly SchedulableTask[];
}

/**
 * Port for querying worker pools that can accept new assignments.
 *
 * `findEnabledByType` returns all enabled pools of the given type,
 * including their current active lease count for concurrency checks.
 */
export interface SchedulerPoolRepositoryPort {
  findEnabledByType(poolType: WorkerPoolType): readonly SchedulablePool[];
}

// ---------------------------------------------------------------------------
// Transaction boundary
// ---------------------------------------------------------------------------

/**
 * Collection of repository ports available inside a scheduler read transaction.
 *
 * The scheduler primarily performs reads to select tasks and pools.
 * Writes (lease acquisition, job creation) are delegated to the
 * LeaseService and JobQueueService which manage their own transactions.
 */
export interface SchedulerTransactionRepositories {
  readonly task: SchedulerTaskRepositoryPort;
  readonly pool: SchedulerPoolRepositoryPort;
}

/**
 * Defines the contract for running scheduler queries inside a consistent read.
 *
 * While the scheduler's reads don't strictly require a write transaction,
 * wrapping them in a transaction ensures a consistent snapshot when
 * selecting tasks and matching pools within the same tick.
 */
export interface SchedulerUnitOfWork {
  runInTransaction<T>(fn: (repos: SchedulerTransactionRepositories) => T): T;
}
