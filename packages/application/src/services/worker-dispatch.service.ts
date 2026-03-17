/**
 * Worker dispatch service — processes WORKER_DISPATCH jobs from the queue.
 *
 * The scheduler creates a WORKER_DISPATCH job when it assigns a task to a
 * worker pool. This service consumes those jobs by:
 *
 * 1. Claiming the oldest eligible WORKER_DISPATCH job from the queue
 * 2. Resolving task/repository context via the UnitOfWork
 * 3. Building {@link SpawnWorkerParams} from the job payload and context
 * 4. Calling {@link WorkerSupervisorService.spawnWorker} to start the worker
 * 5. Completing or failing the job based on the outcome
 *
 * ## Non-self-rescheduling
 *
 * Unlike {@link SchedulerTickService} and {@link ReconciliationSweepService},
 * WORKER_DISPATCH jobs are created on-demand by the scheduler — one per task
 * assignment. This service does not have an `initialize()` method or
 * self-rescheduling logic; it simply processes whatever dispatch jobs exist.
 *
 * ## Async operation
 *
 * This service is async because {@link WorkerSupervisorService.spawnWorker}
 * returns a Promise. The caller (e.g., the NestJS controller or job
 * processor loop) should handle the async lifecycle, including fire-and-forget
 * with error logging if appropriate.
 *
 * @see docs/prd/007-technical-architecture.md §7.8 — Queue / Job Architecture
 * @module @factory/application/services/worker-dispatch.service
 */

import { JobType } from "@factory/domain";

import type { WorkerDispatchUnitOfWork } from "../ports/worker-dispatch.ports.js";
import type { ActorInfo } from "../events/domain-events.js";
import type { JobQueueService } from "./job-queue.service.js";
import type {
  WorkerSupervisorService,
  SpawnWorkerParams,
  SpawnWorkerResult,
} from "./worker-supervisor.service.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default lease owner identity for the dispatch processor.
 * Used when claiming WORKER_DISPATCH jobs from the queue.
 */
export const DEFAULT_DISPATCH_LEASE_OWNER = "worker-dispatch";

/**
 * System actor used for dispatch operations in audit trails.
 * The dispatch service acts on behalf of the control plane,
 * not a specific operator or worker.
 */
const DISPATCH_ACTOR: ActorInfo = {
  type: "system",
  id: "worker-dispatch",
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the worker dispatch service.
 *
 * All fields are optional and fall back to sensible defaults.
 */
export interface WorkerDispatchConfig {
  /**
   * Identity string used as the lease owner when claiming dispatch jobs.
   * Useful for distinguishing dispatch instances in multi-process setups.
   *
   * @default "worker-dispatch"
   */
  readonly leaseOwner?: string;
}

// ---------------------------------------------------------------------------
// Payload type
// ---------------------------------------------------------------------------

/**
 * Shape of the WORKER_DISPATCH job payload as created by the scheduler.
 *
 * This matches the payload structure in
 * {@link SchedulerService.scheduleNext} when it enqueues a dispatch job
 * after successfully assigning a task to a pool.
 */
export interface DispatchPayload {
  /** ID of the task to execute. */
  readonly taskId: string;
  /** ID of the lease held for this task. */
  readonly leaseId: string;
  /** ID of the worker pool the task was assigned to. */
  readonly poolId: string;
  /** Pre-generated worker ID for the new worker entity. */
  readonly workerId: string;
  /** Task priority (propagated for ordering/monitoring). */
  readonly priority: number;
  /** Capabilities the worker pool must satisfy. */
  readonly requiredCapabilities: readonly string[];
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * Result when a dispatch job was claimed and the worker was spawned
 * successfully.
 */
export interface DispatchSuccessResult {
  readonly processed: true;
  readonly dispatched: true;
  /** ID of the dispatch job that was processed. */
  readonly jobId: string;
  /** ID of the task that was dispatched. */
  readonly taskId: string;
  /** ID of the worker that was spawned. */
  readonly workerId: string;
  /** ID of the lease associated with this dispatch. */
  readonly leaseId: string;
  /** Result from the worker supervisor containing finalize data and output events. */
  readonly spawnResult: SpawnWorkerResult;
}

/**
 * Result when a dispatch job was claimed but the worker could not be
 * spawned (context resolution failed or spawn threw an error).
 */
export interface DispatchFailedResult {
  readonly processed: true;
  readonly dispatched: false;
  /** ID of the dispatch job that was processed. */
  readonly jobId: string;
  /** ID of the task that failed dispatch. */
  readonly taskId: string;
  /** Machine-readable failure reason. */
  readonly reason: "context_resolution_failed" | "spawn_failed";
  /** Human-readable error message. */
  readonly error: string;
}

/**
 * Result when no dispatch job was available to process.
 */
export interface DispatchSkippedResult {
  readonly processed: false;
  /** Why dispatch was skipped. */
  readonly reason: "no_dispatch_job";
}

/**
 * Union result type for the {@link WorkerDispatchService.processDispatch}
 * operation.
 *
 * Follows the same discriminated-union pattern used by
 * {@link ProcessTickResult} and {@link ProcessSweepResult}:
 * - `processed: false` — no work was available
 * - `processed: true, dispatched: true` — worker spawned successfully
 * - `processed: true, dispatched: false` — job claimed but spawn failed
 */
export type ProcessDispatchResult =
  | DispatchSuccessResult
  | DispatchFailedResult
  | DispatchSkippedResult;

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * The worker dispatch service processes WORKER_DISPATCH jobs by spawning
 * worker processes via the {@link WorkerSupervisorService}.
 *
 * Unlike the scheduler tick and reconciliation sweep services, this service
 * does not self-reschedule — each dispatch job is created by the scheduler
 * for a specific task assignment.
 *
 * @see docs/prd/007-technical-architecture.md §7.8 — Queue / Job Architecture
 */
export interface WorkerDispatchService {
  /**
   * Claim and process a single WORKER_DISPATCH job.
   *
   * Attempts to claim the oldest eligible WORKER_DISPATCH job. If one
   * is available, resolves the task/repository context, builds the
   * spawn parameters, and calls the worker supervisor to start the
   * worker process.
   *
   * If no dispatch job is available (e.g., none have been created or
   * another instance already claimed it), returns immediately with
   * `{ processed: false, reason: "no_dispatch_job" }`.
   *
   * @returns Processing result with dispatch details or skip reason.
   */
  processDispatch(): Promise<ProcessDispatchResult>;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies required by the worker dispatch service factory.
 */
export interface WorkerDispatchDependencies {
  /** Unit of work for resolving task/repository context. */
  readonly unitOfWork: WorkerDispatchUnitOfWork;
  /** Job queue service for claiming, completing, and failing jobs. */
  readonly jobQueueService: JobQueueService;
  /** Worker supervisor for spawning worker processes. */
  readonly workerSupervisorService: WorkerSupervisorService;
  /** Returns the current time. Injected for testability. */
  readonly clock: () => Date;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a {@link WorkerDispatchService} instance with injected dependencies.
 *
 * The service orchestrates the interaction between the job queue (for job
 * lifecycle), the unit of work (for context resolution), and the worker
 * supervisor (for spawning). It does not own any state — all persistence
 * is delegated to the job queue and the worker supervisor.
 *
 * @param deps - Service dependencies (unit of work, job queue, supervisor, clock).
 * @param config - Optional configuration overrides.
 * @returns A {@link WorkerDispatchService} instance.
 *
 * @example
 * ```typescript
 * const dispatchService = createWorkerDispatchService(
 *   { unitOfWork, jobQueueService, workerSupervisorService, clock: () => new Date() },
 *   { leaseOwner: "dispatch-node-1" },
 * );
 *
 * // In a job processor loop
 * const result = await dispatchService.processDispatch();
 * if (result.processed && result.dispatched) {
 *   console.log(`Spawned worker ${result.workerId} for task ${result.taskId}`);
 * }
 * ```
 */
export function createWorkerDispatchService(
  deps: WorkerDispatchDependencies,
  config?: WorkerDispatchConfig,
): WorkerDispatchService {
  const leaseOwner = config?.leaseOwner ?? DEFAULT_DISPATCH_LEASE_OWNER;

  return {
    async processDispatch(): Promise<ProcessDispatchResult> {
      // Step 1: Attempt to claim a dispatch job
      const claimed = deps.jobQueueService.claimJob(JobType.WORKER_DISPATCH, leaseOwner);

      if (!claimed) {
        return { processed: false, reason: "no_dispatch_job" };
      }

      const jobId = claimed.job.jobId;
      const payload = claimed.job.payloadJson as DispatchPayload;

      try {
        // Step 2: Resolve task/repository context for spawn parameters
        const spawnContext = deps.unitOfWork.runInTransaction((repos) => {
          return repos.dispatch.resolveSpawnContext(payload.taskId, payload.poolId);
        });

        if (!spawnContext) {
          deps.jobQueueService.failJob(
            jobId,
            `Task ${payload.taskId} not found or missing required context for dispatch`,
          );
          return {
            processed: true,
            dispatched: false,
            jobId,
            taskId: payload.taskId,
            reason: "context_resolution_failed",
            error: `Task ${payload.taskId} not found or missing required context for dispatch`,
          };
        }

        // Step 3: Build the full spawn parameters
        const spawnParams: SpawnWorkerParams = {
          workerId: payload.workerId,
          poolId: payload.poolId,
          workerName: spawnContext.workerName,
          taskId: payload.taskId,
          leaseId: payload.leaseId,
          repoPath: spawnContext.repoPath,
          attempt: claimed.job.attemptCount,
          runContext: spawnContext.runContext,
          actor: DISPATCH_ACTOR,
        };

        // Step 4: Spawn the worker (async — this is the core async operation)
        const spawnResult = await deps.workerSupervisorService.spawnWorker(spawnParams);

        // Step 5: Complete the dispatch job on success
        deps.jobQueueService.completeJob(jobId);

        return {
          processed: true,
          dispatched: true,
          jobId,
          taskId: payload.taskId,
          workerId: payload.workerId,
          leaseId: payload.leaseId,
          spawnResult,
        };
      } catch (error: unknown) {
        // Fail the dispatch job on any error during context resolution or spawn
        const message = error instanceof Error ? error.message : String(error);
        deps.jobQueueService.failJob(jobId, message);

        return {
          processed: true,
          dispatched: false,
          jobId,
          taskId: payload.taskId,
          reason: "spawn_failed",
          error: message,
        };
      }
    },
  };
}
