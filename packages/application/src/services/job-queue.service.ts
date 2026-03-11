/**
 * Job queue service — DB-backed job queue with create, claim, complete,
 * fail, dependency checking, and group coordination.
 *
 * This service provides reliable job processing backed by SQLite. Jobs are
 * enqueued with a type, optional entity reference, and optional delay
 * (run_after). Workers claim jobs atomically — the claim operation uses
 * an atomic UPDATE...WHERE to ensure no two workers can claim the same job.
 *
 * ## Job status lifecycle
 *
 * ```
 * PENDING → CLAIMED → RUNNING → COMPLETED
 *                            ↘ FAILED
 * ```
 *
 * - **PENDING**: Job is waiting in the queue.
 * - **CLAIMED**: A worker has atomically reserved this job.
 * - **RUNNING**: The worker has started executing the job.
 * - **COMPLETED**: The job finished successfully.
 * - **FAILED**: The job failed (may be retried by a higher-level policy).
 *
 * ## Job dependencies
 *
 * Jobs may declare `dependsOnJobIds` — a list of job IDs that must reach
 * terminal status (`completed` or `failed`) before this job can be claimed.
 * The claim operation checks dependency satisfaction atomically within the
 * same transaction.
 *
 * ## Job groups
 *
 * Related jobs can share a `jobGroupId` for coordination. The primary use
 * case is review fan-out: specialist reviewer jobs share a group ID, and the
 * lead reviewer job depends on all of them.
 *
 * ## Transaction pattern
 *
 * All mutating operations execute inside a `BEGIN IMMEDIATE` transaction
 * via the injected `JobQueueUnitOfWork`. This prevents SQLITE_BUSY errors
 * and guarantees atomicity of the claim operation.
 *
 * @see docs/prd/002-data-model.md §2.3 — Entity: Job
 * @see docs/prd/007-technical-architecture.md §7.8 — Queue / Job Architecture
 * @module @factory/application/services/job-queue.service
 */

import { JobStatus, type JobType } from "@factory/domain";

import { EntityNotFoundError, InvalidTransitionError } from "../errors.js";

import type { QueuedJob, CreateJobData, JobQueueUnitOfWork } from "../ports/job-queue.ports.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Job statuses from which a job may be completed.
 * A job must be either CLAIMED or RUNNING to transition to COMPLETED.
 */
const COMPLETABLE_STATUSES: ReadonlySet<string> = new Set([JobStatus.CLAIMED, JobStatus.RUNNING]);

/**
 * Job statuses from which a job may be failed.
 * A job must be either CLAIMED or RUNNING to transition to FAILED.
 */
const FAILABLE_STATUSES: ReadonlySet<string> = new Set([JobStatus.CLAIMED, JobStatus.RUNNING]);

/**
 * Job statuses from which a job may transition to RUNNING.
 * Only CLAIMED jobs can start running.
 */
const RUNNABLE_STATUSES: ReadonlySet<string> = new Set([JobStatus.CLAIMED]);

/**
 * Terminal job statuses. A dependency is considered satisfied when the
 * dependency job is in one of these statuses.
 *
 * @see docs/prd/002-data-model.md — Job coordination rules
 */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([JobStatus.COMPLETED, JobStatus.FAILED]);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Safely parse the `dependsOnJobIds` field from a job record.
 *
 * The field is stored as a JSON array in SQLite and typed as `unknown`
 * in the port interface. This helper normalizes it to a string array,
 * returning an empty array for null, undefined, or non-array values.
 */
function parseDependsOnJobIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

// ─── Service Input/Output Types ─────────────────────────────────────────────

/**
 * Result of a successful job creation.
 */
export interface CreateJobResult {
  /** The persisted job in PENDING status. */
  readonly job: QueuedJob;
}

/**
 * Result of a successful job claim.
 */
export interface ClaimJobResult {
  /** The claimed job with status CLAIMED and incremented attempt count. */
  readonly job: QueuedJob;
}

/**
 * Result of a successful job completion.
 */
export interface CompleteJobResult {
  /** The job with status COMPLETED. */
  readonly job: QueuedJob;
}

/**
 * Result of a successful job failure.
 */
export interface FailJobResult {
  /** The job with status FAILED. */
  readonly job: QueuedJob;
}

/**
 * Result of a successful transition to RUNNING.
 */
export interface StartJobResult {
  /** The job with status RUNNING. */
  readonly job: QueuedJob;
}

/**
 * Result of a dependency check.
 */
export interface AreJobDependenciesMetResult {
  /** Whether all dependencies are satisfied. */
  readonly met: boolean;
  /** IDs of dependency jobs that are not yet in terminal status. */
  readonly pendingDependencyIds: string[];
  /** IDs of dependency jobs that could not be found in the database. */
  readonly missingDependencyIds: string[];
}

/**
 * Result of a group query.
 */
export interface FindJobsByGroupResult {
  /** All jobs belonging to the group. */
  readonly jobs: QueuedJob[];
}

/**
 * Job queue service interface.
 *
 * Provides the core operations for DB-backed job queue management:
 * create, claim, start, complete, fail, dependency checking, and
 * group coordination.
 */
export interface JobQueueService {
  /**
   * Create a new job in the queue with PENDING status.
   *
   * The job will be eligible for claiming once its `runAfter` time
   * has passed (or immediately if `runAfter` is null/not provided).
   * If `dependsOnJobIds` is specified, the job will not be claimable
   * until all dependency jobs reach terminal status.
   *
   * @param data - Job creation parameters (type, entity reference, payload, etc.)
   * @returns The persisted job record.
   */
  createJob(data: CreateJobData): CreateJobResult;

  /**
   * Atomically claim the oldest eligible job of the given type.
   *
   * The claim operation is atomic: an `UPDATE...WHERE` ensures that no
   * two workers can claim the same job. Jobs with `runAfter` in the
   * future are skipped. Jobs with unmet dependencies (any job in
   * `dependsOnJobIds` not in terminal status) are skipped. The attempt
   * count is incremented on each claim.
   *
   * @param jobType - The type of job to claim (e.g., WORKER_DISPATCH).
   * @param leaseOwner - Identifier of the worker claiming the job.
   * @returns The claimed job, or null if no eligible job exists.
   */
  claimJob(jobType: JobType, leaseOwner: string): ClaimJobResult | null;

  /**
   * Transition a claimed job to RUNNING status.
   *
   * Called by the worker after it has started executing the job.
   * The job must be in CLAIMED status.
   *
   * @param jobId - ID of the job to start.
   * @throws EntityNotFoundError if the job does not exist.
   * @throws InvalidTransitionError if the job is not in CLAIMED status.
   */
  startJob(jobId: string): StartJobResult;

  /**
   * Mark a job as COMPLETED.
   *
   * The job must be in CLAIMED or RUNNING status. Terminal — no further
   * transitions are possible after completion.
   *
   * @param jobId - ID of the job to complete.
   * @throws EntityNotFoundError if the job does not exist.
   * @throws InvalidTransitionError if the job is not in a completable status.
   */
  completeJob(jobId: string): CompleteJobResult;

  /**
   * Mark a job as FAILED.
   *
   * The job must be in CLAIMED or RUNNING status. Whether the job is
   * retried is determined by higher-level policy (scheduler / retry
   * service), not by this service.
   *
   * @param jobId - ID of the job to fail.
   * @param error - Optional error message describing the failure.
   * @throws EntityNotFoundError if the job does not exist.
   * @throws InvalidTransitionError if the job is not in a failable status.
   */
  failJob(jobId: string, error?: string): FailJobResult;

  /**
   * Check whether all dependency jobs for a given job are in terminal status.
   *
   * A job's dependencies are met when every job ID in its `dependsOnJobIds`
   * array is in `completed` or `failed` status. Jobs with no dependencies
   * (null or empty `dependsOnJobIds`) always have met dependencies.
   *
   * @param jobId - ID of the job whose dependencies to check.
   * @returns Whether dependencies are met, plus lists of pending and missing dependency IDs.
   * @throws EntityNotFoundError if the job does not exist.
   */
  areJobDependenciesMet(jobId: string): AreJobDependenciesMetResult;

  /**
   * Find all jobs belonging to a job group.
   *
   * Job groups coordinate related jobs — e.g., all specialist reviewer
   * jobs in one review cycle share the same `job_group_id`. This method
   * returns all jobs in the group, regardless of status.
   *
   * @param groupId - The group identifier.
   * @returns All jobs with matching `jobGroupId`.
   */
  findJobsByGroup(groupId: string): FindJobsByGroupResult;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a job queue service with injected dependencies.
 *
 * @param unitOfWork - Transaction boundary for atomic operations.
 * @param idGenerator - Produces unique IDs for new job records (e.g., UUID v4).
 * @param clock - Returns the current time. Defaults to `() => new Date()`.
 *               Injected for testability (deterministic time in tests).
 */
export function createJobQueueService(
  unitOfWork: JobQueueUnitOfWork,
  idGenerator: () => string,
  clock: () => Date = () => new Date(),
): JobQueueService {
  return {
    createJob(data: CreateJobData): CreateJobResult {
      const job = unitOfWork.runInTransaction((repos) => {
        return repos.job.create({
          jobId: idGenerator(),
          jobType: data.jobType,
          entityType: data.entityType ?? null,
          entityId: data.entityId ?? null,
          payloadJson: data.payloadJson ?? null,
          status: JobStatus.PENDING,
          attemptCount: 0,
          runAfter: data.runAfter ?? null,
          parentJobId: data.parentJobId ?? null,
          jobGroupId: data.jobGroupId ?? null,
          dependsOnJobIds: data.dependsOnJobIds ?? null,
        });
      });

      return { job };
    },

    claimJob(jobType: JobType, leaseOwner: string): ClaimJobResult | null {
      const job = unitOfWork.runInTransaction((repos) => {
        return repos.job.claimNextByType(jobType, leaseOwner, clock());
      });

      if (!job) {
        return null;
      }

      return { job };
    },

    startJob(jobId: string): StartJobResult {
      const job = unitOfWork.runInTransaction((repos) => {
        const existing = repos.job.findById(jobId);
        if (!existing) {
          throw new EntityNotFoundError("Job", jobId);
        }

        if (!RUNNABLE_STATUSES.has(existing.status)) {
          throw new InvalidTransitionError(
            "Job",
            jobId,
            existing.status,
            JobStatus.RUNNING,
            `Job must be in CLAIMED status to start running, but is ${existing.status}`,
          );
        }

        const updated = repos.job.updateStatus(
          jobId,
          existing.status as JobStatus,
          JobStatus.RUNNING,
        );
        if (!updated) {
          throw new InvalidTransitionError(
            "Job",
            jobId,
            existing.status,
            JobStatus.RUNNING,
            "Concurrent status change detected during start transition",
          );
        }

        return updated;
      });

      return { job };
    },

    completeJob(jobId: string): CompleteJobResult {
      const job = unitOfWork.runInTransaction((repos) => {
        const existing = repos.job.findById(jobId);
        if (!existing) {
          throw new EntityNotFoundError("Job", jobId);
        }

        if (!COMPLETABLE_STATUSES.has(existing.status)) {
          throw new InvalidTransitionError(
            "Job",
            jobId,
            existing.status,
            JobStatus.COMPLETED,
            `Job must be in CLAIMED or RUNNING status to complete, but is ${existing.status}`,
          );
        }

        const updated = repos.job.updateStatus(
          jobId,
          existing.status as JobStatus,
          JobStatus.COMPLETED,
        );
        if (!updated) {
          throw new InvalidTransitionError(
            "Job",
            jobId,
            existing.status,
            JobStatus.COMPLETED,
            "Concurrent status change detected during complete transition",
          );
        }

        return updated;
      });

      return { job };
    },

    failJob(jobId: string, _error?: string): FailJobResult {
      const job = unitOfWork.runInTransaction((repos) => {
        const existing = repos.job.findById(jobId);
        if (!existing) {
          throw new EntityNotFoundError("Job", jobId);
        }

        if (!FAILABLE_STATUSES.has(existing.status)) {
          throw new InvalidTransitionError(
            "Job",
            jobId,
            existing.status,
            JobStatus.FAILED,
            `Job must be in CLAIMED or RUNNING status to fail, but is ${existing.status}`,
          );
        }

        const updated = repos.job.updateStatus(
          jobId,
          existing.status as JobStatus,
          JobStatus.FAILED,
        );
        if (!updated) {
          throw new InvalidTransitionError(
            "Job",
            jobId,
            existing.status,
            JobStatus.FAILED,
            "Concurrent status change detected during fail transition",
          );
        }

        return updated;
      });

      return { job };
    },

    areJobDependenciesMet(jobId: string): AreJobDependenciesMetResult {
      return unitOfWork.runInTransaction((repos) => {
        const job = repos.job.findById(jobId);
        if (!job) {
          throw new EntityNotFoundError("Job", jobId);
        }

        const depIds = parseDependsOnJobIds(job.dependsOnJobIds);
        if (depIds.length === 0) {
          return { met: true, pendingDependencyIds: [], missingDependencyIds: [] };
        }

        const depJobs = repos.job.findByIds(depIds);
        const foundIds = new Set(depJobs.map((j) => j.jobId));

        const missingDependencyIds: string[] = [];
        const pendingDependencyIds: string[] = [];

        for (const depId of depIds) {
          if (!foundIds.has(depId)) {
            missingDependencyIds.push(depId);
          } else {
            const depJob = depJobs.find((j) => j.jobId === depId)!;
            if (!TERMINAL_STATUSES.has(depJob.status)) {
              pendingDependencyIds.push(depId);
            }
          }
        }

        const met = pendingDependencyIds.length === 0 && missingDependencyIds.length === 0;
        return { met, pendingDependencyIds, missingDependencyIds };
      });
    },

    findJobsByGroup(groupId: string): FindJobsByGroupResult {
      const jobs = unitOfWork.runInTransaction((repos) => {
        return repos.job.findByGroupId(groupId);
      });

      return { jobs };
    },
  };
}
