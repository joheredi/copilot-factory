/**
 * Tests for the DB-backed job queue service.
 *
 * These tests validate the core job queue operations: create, claim,
 * start, complete, and fail. The most critical property under test is
 * **atomic claiming** — no two workers may claim the same job. This is
 * verified through concurrent claim simulation tests.
 *
 * All tests use in-memory mock implementations of the ports, following
 * the same patterns established by the transition and lease service tests.
 *
 * @see docs/prd/002-data-model.md §2.3 — Entity: Job
 * @see docs/prd/007-technical-architecture.md §7.8 — Queue / Job Architecture
 * @module @factory/application/services/job-queue.service.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { JobStatus, JobType } from "@factory/domain";

import { createJobQueueService, type JobQueueService } from "./job-queue.service.js";

import type {
  QueuedJob,
  JobQueueRepositoryPort,
  JobQueueTransactionRepositories,
  JobQueueUnitOfWork,
} from "../ports/job-queue.ports.js";

import { EntityNotFoundError, InvalidTransitionError } from "../errors.js";

// ─── Mock Factories ─────────────────────────────────────────────────────────

/**
 * Counter for generating sequential mock IDs.
 */
let mockIdCounter = 0;

/**
 * Fixed timestamp used by the mock clock for deterministic tests.
 */
const FIXED_NOW = new Date("2025-06-15T12:00:00Z");

/**
 * Creates an in-memory mock job repository that implements the
 * JobQueueRepositoryPort interface.
 *
 * This mock stores jobs in a plain array and performs status-based
 * optimistic concurrency checks, matching the contract the real
 * SQLite repository provides.
 */
function createMockJobRepo(
  initialJobs: QueuedJob[] = [],
): JobQueueRepositoryPort & { jobs: QueuedJob[] } {
  const jobs = [...initialJobs];

  return {
    jobs,

    findById(jobId: string): QueuedJob | undefined {
      return jobs.find((j) => j.jobId === jobId);
    },

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
    }): QueuedJob {
      const job: QueuedJob = {
        jobId: data.jobId,
        jobType: data.jobType,
        entityType: data.entityType,
        entityId: data.entityId,
        payloadJson: data.payloadJson,
        status: data.status,
        attemptCount: data.attemptCount,
        runAfter: data.runAfter,
        leaseOwner: null,
        parentJobId: data.parentJobId,
        jobGroupId: data.jobGroupId,
        dependsOnJobIds: data.dependsOnJobIds,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      };
      jobs.push(job);
      return job;
    },

    claimNextByType(jobType: JobType, leaseOwner: string, now: Date): QueuedJob | undefined {
      // Find the oldest eligible job: PENDING, runAfter <= now or null, matching type
      const eligible = jobs
        .filter(
          (j) =>
            j.status === JobStatus.PENDING &&
            j.jobType === jobType &&
            (j.runAfter === null || j.runAfter <= now),
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      const target = eligible[0];
      if (!target) {
        return undefined;
      }

      // Atomically claim it (simulate UPDATE...WHERE)
      const idx = jobs.findIndex((j) => j.jobId === target.jobId);
      if (idx === -1 || jobs[idx]!.status !== JobStatus.PENDING) {
        return undefined;
      }

      const claimed: QueuedJob = {
        ...jobs[idx]!,
        status: JobStatus.CLAIMED,
        leaseOwner,
        attemptCount: jobs[idx]!.attemptCount + 1,
        updatedAt: now,
      };
      jobs[idx] = claimed;
      return claimed;
    },

    updateStatus(
      jobId: string,
      expectedStatus: JobStatus,
      newStatus: JobStatus,
    ): QueuedJob | undefined {
      const idx = jobs.findIndex((j) => j.jobId === jobId);
      if (idx === -1) {
        return undefined;
      }

      if (jobs[idx]!.status !== expectedStatus) {
        return undefined;
      }

      const updated: QueuedJob = {
        ...jobs[idx]!,
        status: newStatus,
        updatedAt: FIXED_NOW,
      };
      jobs[idx] = updated;
      return updated;
    },
  };
}

/**
 * Creates a mock UnitOfWork that simply calls the function with the
 * provided repository ports. In tests, this gives us synchronous
 * transaction-like behavior without a real database.
 */
function createMockUnitOfWork(jobRepo: JobQueueRepositoryPort): JobQueueUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: JobQueueTransactionRepositories) => T): T {
      return fn({ job: jobRepo });
    },
  };
}

/**
 * Creates a sequential ID generator for deterministic test output.
 */
function createMockIdGenerator(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `job-${String(counter).padStart(3, "0")}`;
  };
}

/**
 * Creates a fixed clock for deterministic time in tests.
 */
function createMockClock(fixedTime: Date): () => Date {
  return () => fixedTime;
}

// ─── Helper: create a PENDING job for tests ─────────────────────────────────

function makePendingJob(overrides: Partial<QueuedJob> = {}): QueuedJob {
  mockIdCounter += 1;
  return {
    jobId: `existing-job-${String(mockIdCounter)}`,
    jobType: JobType.WORKER_DISPATCH,
    entityType: "task",
    entityId: "task-123",
    payloadJson: { data: "test" },
    status: JobStatus.PENDING,
    attemptCount: 0,
    runAfter: null,
    leaseOwner: null,
    parentJobId: null,
    jobGroupId: null,
    dependsOnJobIds: null,
    createdAt: new Date("2025-06-15T10:00:00Z"),
    updatedAt: new Date("2025-06-15T10:00:00Z"),
    ...overrides,
  };
}

function makeClaimedJob(overrides: Partial<QueuedJob> = {}): QueuedJob {
  mockIdCounter += 1;
  return {
    jobId: `claimed-job-${String(mockIdCounter)}`,
    jobType: JobType.WORKER_DISPATCH,
    entityType: "task",
    entityId: "task-123",
    payloadJson: { data: "test" },
    status: JobStatus.CLAIMED,
    attemptCount: 1,
    runAfter: null,
    leaseOwner: "worker-1",
    parentJobId: null,
    jobGroupId: null,
    dependsOnJobIds: null,
    createdAt: new Date("2025-06-15T10:00:00Z"),
    updatedAt: new Date("2025-06-15T10:00:00Z"),
    ...overrides,
  };
}

function makeRunningJob(overrides: Partial<QueuedJob> = {}): QueuedJob {
  mockIdCounter += 1;
  return {
    jobId: `running-job-${String(mockIdCounter)}`,
    jobType: JobType.WORKER_DISPATCH,
    entityType: "task",
    entityId: "task-123",
    payloadJson: { data: "test" },
    status: JobStatus.RUNNING,
    attemptCount: 1,
    runAfter: null,
    leaseOwner: "worker-1",
    parentJobId: null,
    jobGroupId: null,
    dependsOnJobIds: null,
    createdAt: new Date("2025-06-15T10:00:00Z"),
    updatedAt: new Date("2025-06-15T10:00:00Z"),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("JobQueueService", () => {
  let jobRepo: ReturnType<typeof createMockJobRepo>;
  let service: JobQueueService;

  beforeEach(() => {
    mockIdCounter = 0;
    jobRepo = createMockJobRepo();
    const uow = createMockUnitOfWork(jobRepo);
    const idGen = createMockIdGenerator();
    const clock = createMockClock(FIXED_NOW);
    service = createJobQueueService(uow, idGen, clock);
  });

  // ─── createJob ──────────────────────────────────────────────────────────

  describe("createJob", () => {
    /**
     * Validates that a job is created with PENDING status, zero attempt
     * count, and a generated ID. This is the fundamental enqueue operation
     * that all other tests depend on.
     */
    it("should create a job with PENDING status and zero attempt count", () => {
      const result = service.createJob({
        jobType: JobType.WORKER_DISPATCH,
        entityType: "task",
        entityId: "task-42",
        payloadJson: { branch: "feat/x" },
      });

      expect(result.job.jobId).toBe("job-001");
      expect(result.job.status).toBe(JobStatus.PENDING);
      expect(result.job.jobType).toBe(JobType.WORKER_DISPATCH);
      expect(result.job.entityType).toBe("task");
      expect(result.job.entityId).toBe("task-42");
      expect(result.job.payloadJson).toEqual({ branch: "feat/x" });
      expect(result.job.attemptCount).toBe(0);
      expect(result.job.leaseOwner).toBeNull();
    });

    /**
     * Validates that optional fields default to null when not provided.
     * This ensures the service handles minimal job creation requests
     * without throwing on missing optional data.
     */
    it("should default optional fields to null", () => {
      const result = service.createJob({
        jobType: JobType.SCHEDULER_TICK,
      });

      expect(result.job.entityType).toBeNull();
      expect(result.job.entityId).toBeNull();
      expect(result.job.payloadJson).toBeNull();
      expect(result.job.runAfter).toBeNull();
      expect(result.job.parentJobId).toBeNull();
      expect(result.job.jobGroupId).toBeNull();
      expect(result.job.dependsOnJobIds).toBeNull();
    });

    /**
     * Validates that the runAfter field is persisted correctly.
     * Delayed jobs should not be claimable until their runAfter time.
     */
    it("should persist runAfter for delayed jobs", () => {
      const futureTime = new Date("2025-06-16T00:00:00Z");
      const result = service.createJob({
        jobType: JobType.CLEANUP,
        runAfter: futureTime,
      });

      expect(result.job.runAfter).toEqual(futureTime);
    });

    /**
     * Validates that parent job ID and group ID are persisted.
     * These fields are used for job hierarchy tracking and review
     * cycle coordination.
     */
    it("should persist parentJobId and jobGroupId", () => {
      const result = service.createJob({
        jobType: JobType.REVIEWER_DISPATCH,
        parentJobId: "parent-job-1",
        jobGroupId: "review-cycle-7",
      });

      expect(result.job.parentJobId).toBe("parent-job-1");
      expect(result.job.jobGroupId).toBe("review-cycle-7");
    });

    /**
     * Validates that each job gets a unique ID from the ID generator.
     * This prevents job collision in the queue.
     */
    it("should assign unique IDs to each created job", () => {
      const r1 = service.createJob({ jobType: JobType.SCHEDULER_TICK });
      const r2 = service.createJob({ jobType: JobType.SCHEDULER_TICK });
      const r3 = service.createJob({ jobType: JobType.SCHEDULER_TICK });

      expect(r1.job.jobId).toBe("job-001");
      expect(r2.job.jobId).toBe("job-002");
      expect(r3.job.jobId).toBe("job-003");
    });
  });

  // ─── claimJob ───────────────────────────────────────────────────────────

  describe("claimJob", () => {
    /**
     * Validates the core claim operation: the oldest eligible PENDING
     * job of the requested type is claimed by the worker. This is the
     * hot-path operation for the scheduler tick loop.
     */
    it("should claim the oldest eligible PENDING job of the requested type", () => {
      const job = makePendingJob({ jobType: JobType.WORKER_DISPATCH });
      jobRepo.jobs.push(job);

      const result = service.claimJob(JobType.WORKER_DISPATCH, "worker-A");

      expect(result).not.toBeNull();
      expect(result!.job.status).toBe(JobStatus.CLAIMED);
      expect(result!.job.leaseOwner).toBe("worker-A");
      expect(result!.job.attemptCount).toBe(1);
    });

    /**
     * Validates that claimJob returns null when no eligible jobs exist.
     * Workers should handle this by backing off and retrying later.
     */
    it("should return null when no eligible jobs exist", () => {
      const result = service.claimJob(JobType.WORKER_DISPATCH, "worker-A");
      expect(result).toBeNull();
    });

    /**
     * Validates that jobs with runAfter in the future are not claimable.
     * This is essential for delayed/scheduled execution — the queue
     * poller must skip jobs whose time hasn't come yet.
     */
    it("should not claim jobs with runAfter in the future", () => {
      const futureJob = makePendingJob({
        jobType: JobType.WORKER_DISPATCH,
        runAfter: new Date("2025-06-16T00:00:00Z"), // Future relative to FIXED_NOW
      });
      jobRepo.jobs.push(futureJob);

      const result = service.claimJob(JobType.WORKER_DISPATCH, "worker-A");
      expect(result).toBeNull();
    });

    /**
     * Validates that jobs with runAfter in the past ARE claimable.
     * Once the delay has elapsed, the job should be eligible.
     */
    it("should claim jobs with runAfter in the past", () => {
      const pastJob = makePendingJob({
        jobType: JobType.WORKER_DISPATCH,
        runAfter: new Date("2025-06-15T11:00:00Z"), // 1 hour before FIXED_NOW
      });
      jobRepo.jobs.push(pastJob);

      const result = service.claimJob(JobType.WORKER_DISPATCH, "worker-A");
      expect(result).not.toBeNull();
      expect(result!.job.status).toBe(JobStatus.CLAIMED);
    });

    /**
     * Validates that jobs with runAfter equal to now ARE claimable.
     * Edge case: exactly at the scheduled time.
     */
    it("should claim jobs with runAfter equal to now", () => {
      const exactJob = makePendingJob({
        jobType: JobType.WORKER_DISPATCH,
        runAfter: FIXED_NOW,
      });
      jobRepo.jobs.push(exactJob);

      const result = service.claimJob(JobType.WORKER_DISPATCH, "worker-A");
      expect(result).not.toBeNull();
    });

    /**
     * Validates that claim only matches the requested job type.
     * A worker requesting SCHEDULER_TICK jobs should not receive
     * a WORKER_DISPATCH job, even if one is available.
     */
    it("should only claim jobs of the requested type", () => {
      const dispatchJob = makePendingJob({ jobType: JobType.WORKER_DISPATCH });
      jobRepo.jobs.push(dispatchJob);

      const result = service.claimJob(JobType.SCHEDULER_TICK, "worker-A");
      expect(result).toBeNull();

      // The dispatch job should still be PENDING (unclaimed)
      expect(jobRepo.jobs[0]!.status).toBe(JobStatus.PENDING);
    });

    /**
     * Validates FIFO ordering: the oldest job (by createdAt) is claimed
     * first. This ensures fair processing order.
     */
    it("should claim jobs in FIFO order (oldest first)", () => {
      const older = makePendingJob({
        jobId: "job-older",
        jobType: JobType.WORKER_DISPATCH,
        createdAt: new Date("2025-06-15T08:00:00Z"),
      });
      const newer = makePendingJob({
        jobId: "job-newer",
        jobType: JobType.WORKER_DISPATCH,
        createdAt: new Date("2025-06-15T09:00:00Z"),
      });
      jobRepo.jobs.push(newer, older); // Insert in wrong order

      const result = service.claimJob(JobType.WORKER_DISPATCH, "worker-A");
      expect(result!.job.jobId).toBe("job-older");
    });

    /**
     * Validates that attempt count increments on each claim.
     * This is important for retry policy — the scheduler uses attempt
     * count to decide whether to retry or permanently fail a job.
     */
    it("should increment attempt count on claim", () => {
      const job = makePendingJob({
        jobType: JobType.WORKER_DISPATCH,
        attemptCount: 0,
      });
      jobRepo.jobs.push(job);

      const result = service.claimJob(JobType.WORKER_DISPATCH, "worker-A");
      expect(result!.job.attemptCount).toBe(1);
    });

    /**
     * Validates that already-claimed jobs are not re-claimable.
     * This is the core double-claim prevention test — once a job is
     * CLAIMED, subsequent claim attempts for the same type should skip
     * it and return null (if no other eligible jobs exist).
     */
    it("should not claim already-claimed jobs", () => {
      const claimed = makeClaimedJob({ jobType: JobType.WORKER_DISPATCH });
      jobRepo.jobs.push(claimed);

      const result = service.claimJob(JobType.WORKER_DISPATCH, "worker-B");
      expect(result).toBeNull();
    });

    /**
     * Simulates concurrent claim attempts from multiple workers.
     *
     * In production, SQLite's BEGIN IMMEDIATE serializes writes, so
     * only one worker can claim a job at a time. This test verifies
     * that the mock respects the same invariant: given one PENDING job
     * and two sequential claim attempts, exactly one succeeds.
     *
     * This is the most important correctness property of the job queue.
     */
    it("should prevent double-claiming: only one worker wins", () => {
      const job = makePendingJob({ jobType: JobType.WORKER_DISPATCH });
      jobRepo.jobs.push(job);

      const claim1 = service.claimJob(JobType.WORKER_DISPATCH, "worker-A");
      const claim2 = service.claimJob(JobType.WORKER_DISPATCH, "worker-B");

      // Exactly one claim should succeed
      expect(claim1).not.toBeNull();
      expect(claim2).toBeNull();

      // The job should be owned by worker-A
      expect(claim1!.job.leaseOwner).toBe("worker-A");
      expect(jobRepo.jobs.find((j) => j.jobId === job.jobId)!.status).toBe(JobStatus.CLAIMED);
    });

    /**
     * Validates that with multiple eligible jobs and multiple workers,
     * each worker claims a different job. No job is claimed twice.
     */
    it("should distribute claims across available jobs", () => {
      const job1 = makePendingJob({
        jobId: "job-1",
        jobType: JobType.WORKER_DISPATCH,
        createdAt: new Date("2025-06-15T08:00:00Z"),
      });
      const job2 = makePendingJob({
        jobId: "job-2",
        jobType: JobType.WORKER_DISPATCH,
        createdAt: new Date("2025-06-15T09:00:00Z"),
      });
      jobRepo.jobs.push(job1, job2);

      const claim1 = service.claimJob(JobType.WORKER_DISPATCH, "worker-A");
      const claim2 = service.claimJob(JobType.WORKER_DISPATCH, "worker-B");

      expect(claim1).not.toBeNull();
      expect(claim2).not.toBeNull();
      expect(claim1!.job.jobId).not.toBe(claim2!.job.jobId);
    });

    /**
     * Validates that jobs with null runAfter are claimable immediately.
     * Null runAfter means "no delay — available now."
     */
    it("should claim jobs with null runAfter immediately", () => {
      const job = makePendingJob({
        jobType: JobType.WORKER_DISPATCH,
        runAfter: null,
      });
      jobRepo.jobs.push(job);

      const result = service.claimJob(JobType.WORKER_DISPATCH, "worker-A");
      expect(result).not.toBeNull();
    });
  });

  // ─── startJob ───────────────────────────────────────────────────────────

  describe("startJob", () => {
    /**
     * Validates that a CLAIMED job can transition to RUNNING.
     * Workers call startJob after they begin executing the job.
     */
    it("should transition a CLAIMED job to RUNNING", () => {
      const job = makeClaimedJob();
      jobRepo.jobs.push(job);

      const result = service.startJob(job.jobId);
      expect(result.job.status).toBe(JobStatus.RUNNING);
    });

    /**
     * Validates that startJob throws EntityNotFoundError for missing jobs.
     * This catches stale references in the worker.
     */
    it("should throw EntityNotFoundError for non-existent job", () => {
      expect(() => service.startJob("nonexistent")).toThrow(EntityNotFoundError);
    });

    /**
     * Validates that PENDING jobs cannot be started (must be claimed first).
     * This prevents workers from skipping the claim step.
     */
    it("should throw InvalidTransitionError for PENDING job", () => {
      const job = makePendingJob();
      jobRepo.jobs.push(job);

      expect(() => service.startJob(job.jobId)).toThrow(InvalidTransitionError);
    });

    /**
     * Validates that already-RUNNING jobs cannot be started again.
     * Prevents duplicate execution signals.
     */
    it("should throw InvalidTransitionError for already RUNNING job", () => {
      const job = makeRunningJob();
      jobRepo.jobs.push(job);

      expect(() => service.startJob(job.jobId)).toThrow(InvalidTransitionError);
    });

    /**
     * Validates that COMPLETED jobs cannot be started.
     * Terminal states are immutable.
     */
    it("should throw InvalidTransitionError for COMPLETED job", () => {
      const job = makeClaimedJob({ status: JobStatus.COMPLETED });
      jobRepo.jobs.push(job);

      expect(() => service.startJob(job.jobId)).toThrow(InvalidTransitionError);
    });
  });

  // ─── completeJob ────────────────────────────────────────────────────────

  describe("completeJob", () => {
    /**
     * Validates that a CLAIMED job can be completed directly.
     * Some short-lived jobs may skip the RUNNING state.
     */
    it("should complete a CLAIMED job", () => {
      const job = makeClaimedJob();
      jobRepo.jobs.push(job);

      const result = service.completeJob(job.jobId);
      expect(result.job.status).toBe(JobStatus.COMPLETED);
    });

    /**
     * Validates that a RUNNING job can be completed.
     * This is the normal happy path: CLAIMED → RUNNING → COMPLETED.
     */
    it("should complete a RUNNING job", () => {
      const job = makeRunningJob();
      jobRepo.jobs.push(job);

      const result = service.completeJob(job.jobId);
      expect(result.job.status).toBe(JobStatus.COMPLETED);
    });

    /**
     * Validates that EntityNotFoundError is thrown for missing jobs.
     * Ensures stale references don't silently succeed.
     */
    it("should throw EntityNotFoundError for non-existent job", () => {
      expect(() => service.completeJob("nonexistent")).toThrow(EntityNotFoundError);
    });

    /**
     * Validates that PENDING jobs cannot be completed.
     * A job must be claimed before it can complete.
     */
    it("should throw InvalidTransitionError for PENDING job", () => {
      const job = makePendingJob();
      jobRepo.jobs.push(job);

      expect(() => service.completeJob(job.jobId)).toThrow(InvalidTransitionError);
    });

    /**
     * Validates that already-COMPLETED jobs cannot be re-completed.
     * Terminal states are immutable — idempotent callers should check
     * status before calling complete.
     */
    it("should throw InvalidTransitionError for already COMPLETED job", () => {
      const job = makeClaimedJob({ status: JobStatus.COMPLETED });
      jobRepo.jobs.push(job);

      expect(() => service.completeJob(job.jobId)).toThrow(InvalidTransitionError);
    });

    /**
     * Validates that FAILED jobs cannot be completed.
     * Once a job fails, it cannot transition to completed — it must
     * be re-created or retried via a new job.
     */
    it("should throw InvalidTransitionError for FAILED job", () => {
      const job = makeClaimedJob({ status: JobStatus.FAILED });
      jobRepo.jobs.push(job);

      expect(() => service.completeJob(job.jobId)).toThrow(InvalidTransitionError);
    });

    /**
     * Validates that CANCELLED jobs cannot be completed.
     * Cancelled is a terminal state.
     */
    it("should throw InvalidTransitionError for CANCELLED job", () => {
      const job = makeClaimedJob({ status: JobStatus.CANCELLED });
      jobRepo.jobs.push(job);

      expect(() => service.completeJob(job.jobId)).toThrow(InvalidTransitionError);
    });
  });

  // ─── failJob ────────────────────────────────────────────────────────────

  describe("failJob", () => {
    /**
     * Validates that a CLAIMED job can be failed.
     * Some jobs may fail during initialization before entering RUNNING.
     */
    it("should fail a CLAIMED job", () => {
      const job = makeClaimedJob();
      jobRepo.jobs.push(job);

      const result = service.failJob(job.jobId, "worker crashed");
      expect(result.job.status).toBe(JobStatus.FAILED);
    });

    /**
     * Validates that a RUNNING job can be failed.
     * This is the normal failure path: CLAIMED → RUNNING → FAILED.
     */
    it("should fail a RUNNING job", () => {
      const job = makeRunningJob();
      jobRepo.jobs.push(job);

      const result = service.failJob(job.jobId, "test failure");
      expect(result.job.status).toBe(JobStatus.FAILED);
    });

    /**
     * Validates that failJob works without an error message.
     * Error messages are optional — the service should not require them.
     */
    it("should fail a job without an error message", () => {
      const job = makeClaimedJob();
      jobRepo.jobs.push(job);

      const result = service.failJob(job.jobId);
      expect(result.job.status).toBe(JobStatus.FAILED);
    });

    /**
     * Validates that EntityNotFoundError is thrown for missing jobs.
     */
    it("should throw EntityNotFoundError for non-existent job", () => {
      expect(() => service.failJob("nonexistent")).toThrow(EntityNotFoundError);
    });

    /**
     * Validates that PENDING jobs cannot be directly failed.
     * A job must be claimed first — PENDING jobs should be cancelled
     * via a different mechanism.
     */
    it("should throw InvalidTransitionError for PENDING job", () => {
      const job = makePendingJob();
      jobRepo.jobs.push(job);

      expect(() => service.failJob(job.jobId)).toThrow(InvalidTransitionError);
    });

    /**
     * Validates that already-FAILED jobs cannot be re-failed.
     * Terminal states are immutable.
     */
    it("should throw InvalidTransitionError for already FAILED job", () => {
      const job = makeClaimedJob({ status: JobStatus.FAILED });
      jobRepo.jobs.push(job);

      expect(() => service.failJob(job.jobId)).toThrow(InvalidTransitionError);
    });

    /**
     * Validates that COMPLETED jobs cannot be failed.
     * Once completed, a job's outcome cannot be changed.
     */
    it("should throw InvalidTransitionError for COMPLETED job", () => {
      const job = makeClaimedJob({ status: JobStatus.COMPLETED });
      jobRepo.jobs.push(job);

      expect(() => service.failJob(job.jobId)).toThrow(InvalidTransitionError);
    });
  });

  // ─── Full lifecycle ─────────────────────────────────────────────────────

  describe("full lifecycle", () => {
    /**
     * Validates the complete happy-path lifecycle:
     * create → claim → start → complete.
     *
     * This test exercises all operations in sequence and verifies that
     * each transition produces the expected status.
     */
    it("should support create → claim → start → complete lifecycle", () => {
      // Create
      const created = service.createJob({
        jobType: JobType.WORKER_DISPATCH,
        entityType: "task",
        entityId: "task-77",
        payloadJson: { worktree: "/tmp/w1" },
      });
      expect(created.job.status).toBe(JobStatus.PENDING);

      // Claim
      const claimed = service.claimJob(JobType.WORKER_DISPATCH, "worker-X");
      expect(claimed).not.toBeNull();
      expect(claimed!.job.status).toBe(JobStatus.CLAIMED);
      expect(claimed!.job.jobId).toBe(created.job.jobId);

      // Start
      const started = service.startJob(claimed!.job.jobId);
      expect(started.job.status).toBe(JobStatus.RUNNING);

      // Complete
      const completed = service.completeJob(started.job.jobId);
      expect(completed.job.status).toBe(JobStatus.COMPLETED);
    });

    /**
     * Validates the failure lifecycle:
     * create → claim → start → fail.
     *
     * This tests the alternative terminal path where a job fails during
     * execution.
     */
    it("should support create → claim → start → fail lifecycle", () => {
      // Create
      const created = service.createJob({
        jobType: JobType.VALIDATION_EXECUTION,
        entityType: "task",
        entityId: "task-88",
      });
      expect(created.job.status).toBe(JobStatus.PENDING);

      // Claim
      const claimed = service.claimJob(JobType.VALIDATION_EXECUTION, "validator-1");
      expect(claimed).not.toBeNull();

      // Start
      const started = service.startJob(claimed!.job.jobId);
      expect(started.job.status).toBe(JobStatus.RUNNING);

      // Fail
      const failed = service.failJob(started.job.jobId, "lint errors found");
      expect(failed.job.status).toBe(JobStatus.FAILED);
    });

    /**
     * Validates that a completed job cannot undergo further transitions.
     * Once terminal, the job is immutable. This protects against
     * duplicate completion calls from workers.
     */
    it("should prevent transitions after completion", () => {
      service.createJob({ jobType: JobType.SCHEDULER_TICK });
      const claimed = service.claimJob(JobType.SCHEDULER_TICK, "scheduler");
      service.completeJob(claimed!.job.jobId);

      expect(() => service.startJob(claimed!.job.jobId)).toThrow(InvalidTransitionError);
      expect(() => service.completeJob(claimed!.job.jobId)).toThrow(InvalidTransitionError);
      expect(() => service.failJob(claimed!.job.jobId)).toThrow(InvalidTransitionError);
    });

    /**
     * Validates that a failed job cannot undergo further transitions.
     * Same immutability guarantee as completed jobs.
     */
    it("should prevent transitions after failure", () => {
      service.createJob({ jobType: JobType.SCHEDULER_TICK });
      const claimed = service.claimJob(JobType.SCHEDULER_TICK, "scheduler");
      service.failJob(claimed!.job.jobId, "oops");

      expect(() => service.startJob(claimed!.job.jobId)).toThrow(InvalidTransitionError);
      expect(() => service.completeJob(claimed!.job.jobId)).toThrow(InvalidTransitionError);
      expect(() => service.failJob(claimed!.job.jobId)).toThrow(InvalidTransitionError);
    });
  });

  // ─── Concurrent claim simulation ────────────────────────────────────────

  describe("concurrent claim simulation", () => {
    /**
     * Simulates 10 workers concurrently trying to claim from a pool
     * of 3 jobs. Validates that exactly 3 claims succeed and each
     * job is claimed by exactly one worker.
     *
     * In production, SQLite BEGIN IMMEDIATE serializes these writes,
     * so this test validates the logical invariant that the application
     * layer enforces correctly regardless of serialization mechanism.
     */
    it("should handle many workers claiming few jobs correctly", () => {
      // Create 3 pending jobs
      for (let i = 0; i < 3; i++) {
        jobRepo.jobs.push(
          makePendingJob({
            jobId: `pool-job-${String(i)}`,
            jobType: JobType.WORKER_DISPATCH,
            createdAt: new Date(`2025-06-15T0${String(i)}:00:00Z`),
          }),
        );
      }

      // 10 workers try to claim
      const results: Array<{ workerId: string; jobId: string | null }> = [];
      for (let w = 0; w < 10; w++) {
        const workerId = `worker-${String(w)}`;
        const claim = service.claimJob(JobType.WORKER_DISPATCH, workerId);
        results.push({
          workerId,
          jobId: claim?.job.jobId ?? null,
        });
      }

      // Exactly 3 should succeed
      const successful = results.filter((r) => r.jobId !== null);
      expect(successful).toHaveLength(3);

      // Each claimed job should be unique
      const claimedJobIds = new Set(successful.map((r) => r.jobId));
      expect(claimedJobIds.size).toBe(3);

      // All claimed jobs should be in CLAIMED status
      for (const job of jobRepo.jobs) {
        expect(job.status).toBe(JobStatus.CLAIMED);
      }
    });

    /**
     * Validates that when zero eligible jobs exist and multiple workers
     * try to claim, all get null. No false positives.
     */
    it("should return null for all workers when queue is empty", () => {
      const results = [];
      for (let w = 0; w < 5; w++) {
        results.push(service.claimJob(JobType.WORKER_DISPATCH, `worker-${String(w)}`));
      }

      expect(results.every((r) => r === null)).toBe(true);
    });
  });
});
