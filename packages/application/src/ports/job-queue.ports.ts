/**
 * Job queue repository port interfaces.
 *
 * These interfaces define the minimal data-access contract that the
 * job queue service requires. They are intentionally narrow — each
 * port exposes only the operations needed for job queue management,
 * not the full CRUD surface of the underlying job repository.
 *
 * @see docs/prd/002-data-model.md §2.3 — Entity: Job
 * @see docs/prd/007-technical-architecture.md §7.8 — Queue / Job Architecture
 * @module @factory/application/ports/job-queue.ports
 */

import type { JobStatus, JobType } from "@factory/domain";

// ---------------------------------------------------------------------------
// Entity shapes — the minimal fields the job queue service reads/writes
// ---------------------------------------------------------------------------

/**
 * A job record as seen by the job queue service.
 *
 * Contains all fields needed for queue operations: claiming,
 * completing, failing, and status inspection.
 */
export interface QueuedJob {
  readonly jobId: string;
  readonly jobType: JobType;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly payloadJson: unknown;
  readonly status: JobStatus;
  readonly attemptCount: number;
  readonly runAfter: Date | null;
  readonly leaseOwner: string | null;
  readonly parentJobId: string | null;
  readonly jobGroupId: string | null;
  readonly dependsOnJobIds: unknown;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Data required to create a new job in the queue.
 *
 * Only includes the fields that callers control. Server-generated
 * fields (jobId, status, attemptCount, timestamps) are set by
 * the service or repository.
 */
export interface CreateJobData {
  readonly jobType: JobType;
  readonly entityType?: string | null;
  readonly entityId?: string | null;
  readonly payloadJson?: unknown;
  readonly runAfter?: Date | null;
  readonly parentJobId?: string | null;
  readonly jobGroupId?: string | null;
  readonly dependsOnJobIds?: string[] | null;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

/**
 * Port for job data access within the job queue service.
 *
 * Operations are designed for atomic queue semantics:
 * - `findById` for status checks and validation
 * - `create` for enqueueing new jobs
 * - `claimNextByType` atomically selects and claims the oldest eligible job
 * - `updateStatus` for completing or failing a claimed job
 */
export interface JobQueueRepositoryPort {
  /**
   * Find a job by its ID.
   *
   * @returns The job record, or undefined if not found.
   */
  findById(jobId: string): QueuedJob | undefined;

  /**
   * Insert a new job into the queue.
   *
   * @returns The persisted job record with server-generated fields.
   */
  create(data: {
    readonly jobId: string;
    readonly jobType: JobType;
    readonly entityType: string | null;
    readonly entityId: string | null;
    readonly payloadJson: unknown;
    readonly status: JobStatus;
    readonly attemptCount: number;
    readonly runAfter: Date | null;
    readonly parentJobId: string | null;
    readonly jobGroupId: string | null;
    readonly dependsOnJobIds: string[] | null;
  }): QueuedJob;

  /**
   * Atomically claim the oldest eligible job of a given type.
   *
   * "Eligible" means:
   * - status is PENDING
   * - run_after is null or <= `now`
   *
   * The claim sets:
   * - status to CLAIMED
   * - lease_owner to `leaseOwner`
   * - attempt_count incremented by 1
   * - updated_at to current time
   *
   * Returns the claimed job, or undefined if no eligible job exists.
   * The operation must be atomic to prevent double-claiming.
   */
  claimNextByType(jobType: JobType, leaseOwner: string, now: Date): QueuedJob | undefined;

  /**
   * Update a job's status. Used for complete and fail transitions.
   *
   * Only updates if the current status matches `expectedStatus`
   * (status-based optimistic concurrency). Returns the updated job
   * or undefined if the status didn't match (indicating a concurrent
   * modification or invalid transition).
   */
  updateStatus(
    jobId: string,
    expectedStatus: JobStatus,
    newStatus: JobStatus,
  ): QueuedJob | undefined;
}

// ---------------------------------------------------------------------------
// Transaction boundary
// ---------------------------------------------------------------------------

/**
 * Collection of repository ports available inside a job queue transaction.
 */
export interface JobQueueTransactionRepositories {
  readonly job: JobQueueRepositoryPort;
}

/**
 * Defines the contract for running job queue operations inside a
 * database transaction.
 *
 * Implementations must:
 * - Begin a write transaction before invoking `fn` (e.g., `BEGIN IMMEDIATE`)
 * - Commit on success, rollback on exception
 * - Provide transaction-scoped repository instances
 * - Guarantee atomicity of all reads and writes within `fn`
 */
export interface JobQueueUnitOfWork {
  runInTransaction<T>(fn: (repos: JobQueueTransactionRepositories) => T): T;
}
