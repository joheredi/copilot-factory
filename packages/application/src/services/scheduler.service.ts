/**
 * Scheduler service — selects the next ready task, matches it to a
 * compatible worker pool, acquires a lease, and creates a worker dispatch job.
 *
 * The scheduler is the core assignment engine of the control plane. On each
 * invocation of `scheduleNext()`, it:
 *
 * 1. Queries tasks in READY status ordered by priority (CRITICAL first)
 * 2. For each candidate task, finds compatible enabled DEVELOPER pools
 * 3. Matches capabilities: pool must provide all capabilities the task requires
 * 4. Checks concurrency: pool must have capacity (activeLeaseCount < maxConcurrency)
 * 5. Acquires a lease atomically via the LeaseService
 * 6. Creates a WORKER_DISPATCH job via the JobQueueService
 *
 * If no task can be assigned (no ready tasks, no compatible pools, or all
 * pools at capacity), it returns null without side effects.
 *
 * Duplicate assignment is prevented by the LeaseService's exclusivity check —
 * if another scheduler tick already assigned a task, the ExclusivityViolationError
 * is caught and the scheduler moves to the next candidate.
 *
 * @see docs/prd/001-architecture.md §1.6.4 Scheduler
 * @see docs/prd/007-technical-architecture.md §7.6 Scheduler Module
 * @module @factory/application/services/scheduler.service
 */

import { JobType, TaskPriority, WorkerPoolType } from "@factory/domain";

import type { ActorInfo } from "../events/domain-events.js";
import { ExclusivityViolationError, TaskNotReadyForLeaseError } from "../errors.js";
import type { LeaseService, LeaseAcquisitionResult } from "./lease.service.js";
import type { JobQueueService, CreateJobResult } from "./job-queue.service.js";
import type {
  SchedulableTask,
  SchedulablePool,
  SchedulerUnitOfWork,
} from "../ports/scheduler.ports.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Priority ordering used by the scheduler to compare task priorities.
 * Lower index = higher scheduling priority.
 */
const PRIORITY_ORDER: readonly TaskPriority[] = [
  TaskPriority.CRITICAL,
  TaskPriority.HIGH,
  TaskPriority.MEDIUM,
  TaskPriority.LOW,
] as const;

/**
 * Default maximum number of ready tasks to evaluate per scheduling tick.
 * This prevents loading the entire READY queue when there are thousands of tasks.
 */
const DEFAULT_CANDIDATE_LIMIT = 50;

/**
 * Default lease TTL in seconds when the pool does not specify one.
 */
const DEFAULT_LEASE_TTL_SECONDS = 3600;

/**
 * The pool type that handles task development work.
 * The scheduler assigns READY tasks exclusively to DEVELOPER pools.
 */
const ASSIGNMENT_POOL_TYPE: WorkerPoolType = WorkerPoolType.DEVELOPER;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * Result of a successful task assignment.
 *
 * Contains the lease acquisition result (lease + task + audit event)
 * and the dispatch job created for the worker supervisor to pick up.
 */
export interface ScheduleAssignmentResult {
  /** The task that was assigned. */
  readonly task: SchedulableTask;
  /** The pool the task was assigned to. */
  readonly pool: SchedulablePool;
  /** Lease acquisition details including the created lease and audit event. */
  readonly leaseResult: LeaseAcquisitionResult;
  /** The worker dispatch job created for the worker supervisor. */
  readonly dispatchJob: CreateJobResult;
}

/**
 * Reason why scheduling could not assign a task.
 * Used for diagnostics and observability.
 */
export type ScheduleSkipReason =
  | "no_ready_tasks"
  | "no_compatible_pools"
  | "all_pools_at_capacity"
  | "all_candidates_contended";

/**
 * Result returned when no task could be assigned.
 * Includes a reason for observability and debugging.
 */
export interface ScheduleNoAssignmentResult {
  readonly assigned: false;
  readonly reason: ScheduleSkipReason;
  /** Number of candidate tasks evaluated before giving up. */
  readonly candidatesEvaluated: number;
}

/**
 * Result returned when a task was successfully assigned.
 */
export interface ScheduleSuccessResult {
  readonly assigned: true;
  readonly assignment: ScheduleAssignmentResult;
}

/**
 * Union result type for the scheduleNext operation.
 */
export type ScheduleResult = ScheduleSuccessResult | ScheduleNoAssignmentResult;

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * The Scheduler service automates task-to-worker assignment based on
 * readiness, priority, and pool compatibility.
 *
 * @see docs/prd/001-architecture.md §1.6.4 Scheduler
 */
export interface SchedulerService {
  /**
   * Attempt to assign the highest-priority ready task to a compatible pool.
   *
   * Evaluates up to `candidateLimit` ready tasks in priority order. For each
   * candidate, checks pool compatibility and capacity, then attempts lease
   * acquisition. On success, creates a worker dispatch job and returns the
   * assignment. On failure (contention, no pools), moves to the next candidate.
   *
   * @param candidateLimit - Maximum number of ready tasks to evaluate (default: 50)
   * @returns Assignment result or no-assignment with reason
   */
  scheduleNext(candidateLimit?: number): ScheduleResult;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Determines whether a pool can handle a task based on capabilities.
 *
 * A pool is compatible if it provides ALL capabilities the task requires.
 * If the task has no required capabilities, any pool is compatible.
 *
 * @param task - The task with required capabilities
 * @param pool - The pool with provided capabilities
 * @returns true if the pool satisfies all task capability requirements
 */
export function isPoolCompatible(task: SchedulableTask, pool: SchedulablePool): boolean {
  if (task.requiredCapabilities.length === 0) {
    return true;
  }

  const poolCapSet = new Set(pool.capabilities);
  return task.requiredCapabilities.every((cap) => poolCapSet.has(cap));
}

/**
 * Checks whether a pool has available capacity for a new assignment.
 *
 * @param pool - The pool to check
 * @returns true if activeLeaseCount < maxConcurrency
 */
export function hasPoolCapacity(pool: SchedulablePool): boolean {
  return pool.activeLeaseCount < pool.maxConcurrency;
}

/**
 * Selects the best pool for a task from a list of compatible pools.
 *
 * Selection criteria (in order):
 * 1. Must have available capacity
 * 2. Among pools with capacity, prefer the one with the most available slots
 *    (maxConcurrency - activeLeaseCount) to spread load evenly.
 *
 * @param pools - Compatible pools to choose from
 * @returns The best pool, or undefined if none have capacity
 */
export function selectBestPool(pools: readonly SchedulablePool[]): SchedulablePool | undefined {
  let best: SchedulablePool | undefined;
  let bestAvailable = -1;

  for (const pool of pools) {
    if (!hasPoolCapacity(pool)) {
      continue;
    }
    const available = pool.maxConcurrency - pool.activeLeaseCount;
    if (available > bestAvailable) {
      best = pool;
      bestAvailable = available;
    }
  }

  return best;
}

/**
 * Compares two task priorities for scheduling order.
 * Returns negative if `a` has higher priority (should be scheduled first).
 *
 * @param a - First priority
 * @param b - Second priority
 * @returns Comparison result for sorting
 */
export function comparePriority(a: TaskPriority, b: TaskPriority): number {
  return PRIORITY_ORDER.indexOf(a) - PRIORITY_ORDER.indexOf(b);
}

/**
 * Creates a SchedulerService instance with injected dependencies.
 *
 * The scheduler composes three collaborators:
 * - SchedulerUnitOfWork: read-only access to task and pool repositories
 * - LeaseService: atomic lease acquisition with exclusivity enforcement
 * - JobQueueService: worker dispatch job creation
 *
 * @param unitOfWork - Provides transactional read access to tasks and pools
 * @param leaseService - Handles atomic lease acquisition
 * @param jobQueueService - Handles job creation for worker dispatch
 * @param idGenerator - Function to generate unique worker IDs for lease acquisition
 * @returns A SchedulerService instance
 */
export function createSchedulerService(
  unitOfWork: SchedulerUnitOfWork,
  leaseService: LeaseService,
  jobQueueService: JobQueueService,
  idGenerator: () => string,
): SchedulerService {
  /** System actor identity for scheduler-initiated transitions. */
  const SCHEDULER_ACTOR: ActorInfo = {
    type: "system",
    id: "scheduler",
  };

  return {
    scheduleNext(candidateLimit: number = DEFAULT_CANDIDATE_LIMIT): ScheduleResult {
      // Step 1: Query ready tasks ordered by priority
      const candidates = unitOfWork.runInTransaction((repos) => {
        return repos.task.findReadyByPriority(candidateLimit);
      });

      if (candidates.length === 0) {
        return {
          assigned: false,
          reason: "no_ready_tasks",
          candidatesEvaluated: 0,
        };
      }

      // Step 2: Fetch all enabled developer pools once (shared across candidates)
      const developerPools = unitOfWork.runInTransaction((repos) => {
        return repos.pool.findEnabledByType(ASSIGNMENT_POOL_TYPE);
      });

      if (developerPools.length === 0) {
        return {
          assigned: false,
          reason: "no_compatible_pools",
          candidatesEvaluated: 0,
        };
      }

      // Step 3: Try each candidate in priority order
      let candidatesEvaluated = 0;
      let anyPoolHadCapacity = false;

      for (const task of candidates) {
        candidatesEvaluated++;

        // Filter pools compatible with this task's required capabilities
        const compatiblePools = developerPools.filter((pool) => isPoolCompatible(task, pool));

        if (compatiblePools.length === 0) {
          continue;
        }

        // Select the best pool with available capacity
        const selectedPool = selectBestPool(compatiblePools);

        if (!selectedPool) {
          // All compatible pools are at capacity — note this but try next task
          // (different tasks may have different capability requirements)
          continue;
        }

        anyPoolHadCapacity = true;

        // Step 4: Attempt lease acquisition
        const workerId = idGenerator();
        const ttlSeconds = selectedPool.defaultTimeoutSec || DEFAULT_LEASE_TTL_SECONDS;

        let leaseResult: LeaseAcquisitionResult;
        try {
          leaseResult = leaseService.acquireLease({
            taskId: task.taskId,
            workerId,
            poolId: selectedPool.poolId,
            ttlSeconds,
            actor: SCHEDULER_ACTOR,
            metadata: {
              scheduledPriority: task.priority,
              poolType: selectedPool.poolType,
            },
          });
        } catch (error: unknown) {
          // Another scheduler tick may have assigned this task concurrently.
          // ExclusivityViolationError and TaskNotReadyForLeaseError are expected
          // race conditions — skip this task and try the next candidate.
          if (
            error instanceof ExclusivityViolationError ||
            error instanceof TaskNotReadyForLeaseError
          ) {
            continue;
          }
          // Unexpected errors should propagate
          throw error;
        }

        // Step 5: Create a worker dispatch job for the worker supervisor
        const dispatchJob = jobQueueService.createJob({
          jobType: JobType.WORKER_DISPATCH,
          entityType: "task",
          entityId: task.taskId,
          payloadJson: {
            taskId: task.taskId,
            leaseId: leaseResult.lease.leaseId,
            poolId: selectedPool.poolId,
            workerId,
            priority: task.priority,
            requiredCapabilities: task.requiredCapabilities,
          },
        });

        // Step 6: Return successful assignment
        return {
          assigned: true,
          assignment: {
            task,
            pool: selectedPool,
            leaseResult,
            dispatchJob,
          },
        };
      }

      // All candidates evaluated, none could be assigned
      if (!anyPoolHadCapacity) {
        return {
          assigned: false,
          reason: "all_pools_at_capacity",
          candidatesEvaluated,
        };
      }

      return {
        assigned: false,
        reason: "all_candidates_contended",
        candidatesEvaluated,
      };
    },
  };
}
