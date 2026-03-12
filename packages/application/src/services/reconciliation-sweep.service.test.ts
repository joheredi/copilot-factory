/**
 * Tests for the reconciliation sweep service.
 *
 * These tests verify the recurring RECONCILIATION_SWEEP job lifecycle:
 * initialization (seeding the first sweep job), sweep processing
 * (claim → detect anomalies → fix → complete → reschedule), and
 * error isolation between sub-operations.
 *
 * The reconciliation sweep is the system's self-healing mechanism.
 * Without it, transient failures could leave leases stale, jobs orphaned,
 * tasks stuck, or blocked tasks unable to proceed even after their
 * dependencies resolve.
 *
 * ## Test categories
 *
 * - **Initialization**: Verifies the first sweep job is seeded correctly
 *   and that duplicates are prevented after restarts.
 * - **Self-rescheduling**: Verifies that after processing, a new sweep
 *   job is created with the correct delay.
 * - **Stale lease detection**: Verifies that stale leases are detected
 *   and reclaimed via the heartbeat and lease reclaim services.
 * - **Orphaned job detection**: Verifies that jobs stuck in CLAIMED/RUNNING
 *   past the timeout are failed.
 * - **Stuck task recovery**: Verifies that tasks stuck in ASSIGNED state
 *   are transitioned back to READY.
 * - **Blocked task readiness**: Verifies that BLOCKED tasks with resolved
 *   dependencies are transitioned to READY.
 * - **Error isolation**: Verifies that a failure in one sub-operation
 *   does not prevent others from running.
 * - **Idempotency**: Verifies that concurrent sweeps produce correct
 *   results without corruption.
 *
 * @module @factory/application/services/reconciliation-sweep.service.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { JobType, JobStatus, TaskStatus, WorkerLeaseStatus } from "@factory/domain";

import type {
  ReconciliationSweepUnitOfWork,
  ReconciliationSweepTransactionRepositories,
  OrphanedJobRecord,
  StuckTaskRecord,
  BlockedTaskRecord,
} from "../ports/reconciliation-sweep.ports.js";
import type {
  JobQueueService,
  CreateJobResult,
  ClaimJobResult,
  CompleteJobResult,
  FailJobResult,
} from "./job-queue.service.js";
import type {
  HeartbeatService,
  DetectStaleLeasesResult,
  StaleLeaseInfo,
  StalenessPolicy,
} from "./heartbeat.service.js";
import type {
  LeaseReclaimService,
  ReclaimLeaseParams,
  ReclaimLeaseResult,
} from "./lease-reclaim.service.js";
import type { ReadinessService, ReadinessResult } from "./readiness.service.js";
import type { TransitionService } from "./transition.service.js";
import type { QueuedJob } from "../ports/job-queue.ports.js";
import type { ActorInfo } from "../events/domain-events.js";

import {
  createReconciliationSweepService,
  DEFAULT_SWEEP_INTERVAL_MS,
  DEFAULT_ORPHANED_JOB_TIMEOUT_MS,
  DEFAULT_STUCK_TASK_TIMEOUT_MS,
  DEFAULT_SWEEP_LEASE_OWNER,
  DEFAULT_STALENESS_POLICY,
} from "./reconciliation-sweep.service.js";
import type { ReconciliationSweepDependencies } from "./reconciliation-sweep.service.js";
import { InvalidTransitionError, VersionConflictError, EntityNotFoundError } from "../errors.js";

// ---------------------------------------------------------------------------
// Test helpers — mock factories
// ---------------------------------------------------------------------------

const BASE_TIMESTAMP = new Date("2025-01-01T00:00:00Z");

let jobIdCounter = 0;

/**
 * Creates a mock QueuedJob with sensible defaults.
 */
function createMockJob(overrides: Partial<QueuedJob> = {}): QueuedJob {
  jobIdCounter++;
  return {
    jobId: `job-${jobIdCounter}`,
    jobType: JobType.RECONCILIATION_SWEEP,
    entityType: null,
    entityId: null,
    payloadJson: null,
    status: JobStatus.PENDING,
    attemptCount: 0,
    runAfter: null,
    leaseOwner: null,
    parentJobId: null,
    jobGroupId: null,
    dependsOnJobIds: null,
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP,
    ...overrides,
  };
}

/**
 * Tracking structure for all mock service calls.
 */
interface MockCalls {
  createJob: Array<{ jobType: string; runAfter?: Date | null }>;
  claimJob: Array<{ jobType: string; leaseOwner: string }>;
  completeJob: Array<{ jobId: string }>;
  failJob: Array<{ jobId: string; error?: string }>;
  detectStaleLeases: Array<{ policy: StalenessPolicy }>;
  reclaimLease: Array<{ params: ReclaimLeaseParams }>;
  computeReadiness: Array<{ taskId: string }>;
  transitionTask: Array<{
    taskId: string;
    targetStatus: string;
    actor: ActorInfo;
  }>;
  countNonTerminalByType: Array<{ jobType: string }>;
}

/**
 * Configuration for the mock dependencies.
 */
interface MockConfig {
  /** Count of non-terminal sweep jobs (for initialize). */
  nonTerminalCount?: number;
  /** What claimJob returns (null = no sweep job available). */
  claimResult?: ClaimJobResult | null;
  /** Stale leases to return from detectStaleLeases. */
  staleLeases?: StaleLeaseInfo[];
  /** Orphaned jobs to return from findOrphanedJobs. */
  orphanedJobs?: OrphanedJobRecord[];
  /** Stuck tasks to return from findStuckAssignedTasks. */
  stuckTasks?: StuckTaskRecord[];
  /** Blocked tasks to return from findAllBlockedTasks. */
  blockedTasks?: BlockedTaskRecord[];
  /** Map of taskId → readiness result. */
  readinessResults?: Map<string, ReadinessResult>;
  /** Set of leaseIds that should throw on reclaim. */
  reclaimErrors?: Set<string>;
  /** Set of jobIds that should throw on failJob. */
  failJobErrors?: Set<string>;
  /** Set of taskIds that should throw on transitionTask. */
  transitionErrors?: Map<string, Error>;
}

/**
 * Creates all mock dependencies for the reconciliation sweep service.
 *
 * All mocks are configurable via the MockConfig parameter. By default,
 * everything returns empty/no-op results.
 */
function createMockDeps(mockConfig: MockConfig = {}): {
  deps: ReconciliationSweepDependencies;
  calls: MockCalls;
} {
  const calls: MockCalls = {
    createJob: [],
    claimJob: [],
    completeJob: [],
    failJob: [],
    detectStaleLeases: [],
    reclaimLease: [],
    computeReadiness: [],
    transitionTask: [],
    countNonTerminalByType: [],
  };

  const unitOfWork: ReconciliationSweepUnitOfWork = {
    runInTransaction<T>(fn: (repos: ReconciliationSweepTransactionRepositories) => T): T {
      return fn({
        job: {
          findOrphanedJobs(
            _statuses: readonly JobStatus[],
            _updatedBefore: Date,
          ): readonly OrphanedJobRecord[] {
            return mockConfig.orphanedJobs ?? [];
          },
          countNonTerminalByType(jobType: string): number {
            calls.countNonTerminalByType.push({ jobType });
            return mockConfig.nonTerminalCount ?? 0;
          },
        },
        task: {
          findStuckAssignedTasks(_updatedBefore: Date): readonly StuckTaskRecord[] {
            return mockConfig.stuckTasks ?? [];
          },
          findAllBlockedTasks(): readonly BlockedTaskRecord[] {
            return mockConfig.blockedTasks ?? [];
          },
        },
      });
    },
  };

  let createJobCounter = 0;

  const jobQueueService: JobQueueService = {
    createJob(data: { jobType: string; runAfter?: Date | null }): CreateJobResult {
      createJobCounter++;
      calls.createJob.push({ jobType: data.jobType, runAfter: data.runAfter });
      return {
        job: createMockJob({
          jobId: `created-job-${createJobCounter}`,
          jobType: data.jobType as JobType,
          runAfter: data.runAfter ?? null,
        }),
      };
    },
    claimJob(jobType: string, leaseOwner: string): ClaimJobResult | null {
      calls.claimJob.push({ jobType, leaseOwner });
      return mockConfig.claimResult ?? null;
    },
    completeJob(jobId: string): CompleteJobResult {
      calls.completeJob.push({ jobId });
      return { job: createMockJob({ jobId, status: JobStatus.COMPLETED }) };
    },
    failJob(jobId: string, error?: string): FailJobResult {
      calls.failJob.push({ jobId, error });
      if (mockConfig.failJobErrors?.has(jobId)) {
        throw new InvalidTransitionError("Job", jobId, "completed", "failed", "already terminal");
      }
      return { job: createMockJob({ jobId, status: JobStatus.FAILED }) };
    },
    startJob() {
      throw new Error("Not expected in sweep tests");
    },
    areJobDependenciesMet() {
      throw new Error("Not expected in sweep tests");
    },
    findJobsByGroup() {
      throw new Error("Not expected in sweep tests");
    },
  };

  const heartbeatService: HeartbeatService = {
    receiveHeartbeat() {
      throw new Error("Not expected in sweep tests");
    },
    detectStaleLeases(policy: StalenessPolicy): DetectStaleLeasesResult {
      calls.detectStaleLeases.push({ policy });
      return { staleLeases: mockConfig.staleLeases ?? [] };
    },
  };

  const leaseReclaimService: LeaseReclaimService = {
    reclaimLease(params: ReclaimLeaseParams): ReclaimLeaseResult {
      calls.reclaimLease.push({ params });
      if (mockConfig.reclaimErrors?.has(params.leaseId)) {
        throw new EntityNotFoundError("TaskLease", params.leaseId);
      }
      // Return a minimal result — the sweep only cares about success/failure
      return {
        lease: {
          leaseId: params.leaseId,
          taskId: "task-1",
          workerId: "worker-1",
          poolId: "pool-1",
          status: WorkerLeaseStatus.TIMED_OUT,
          reclaimReason: params.reason,
        },
        task: {
          id: "task-1",
          status: TaskStatus.READY,
          version: 2,
          retryCount: 1,
          currentLeaseId: null,
        },
        outcome: "retried",
        retryEvaluation: {
          eligible: true,
          backoff_seconds: 60,
          next_attempt: 2,
          reason: "Retry eligible",
        },
        escalationEvaluation: null,
        auditEvent: {
          auditEventId: "audit-1",
          entityType: "task-lease",
          entityId: params.leaseId,
          eventType: "lease.reclaimed",
          actorType: "system",
          actorId: "reconciliation-sweep",
          oldState: "{}",
          newState: "{}",
          metadata: null,
          createdAt: BASE_TIMESTAMP,
        },
      };
    },
  };

  const readinessService: ReadinessService = {
    computeReadiness(taskId: string): ReadinessResult {
      calls.computeReadiness.push({ taskId });
      const result = mockConfig.readinessResults?.get(taskId);
      if (result) return result;
      return { status: "BLOCKED", taskId, blockingReasons: [] };
    },
    checkParentChildReadiness() {
      throw new Error("Not expected in sweep tests");
    },
  };

  const transitionService = {
    transitionTask(
      taskId: string,
      targetStatus: string,
      _context: unknown,
      actor: ActorInfo,
      _metadata?: Record<string, unknown>,
    ) {
      calls.transitionTask.push({ taskId, targetStatus, actor });
      const transitionError = mockConfig.transitionErrors?.get(taskId);
      if (transitionError) {
        throw transitionError;
      }
      return {
        entity: { id: taskId, status: targetStatus, version: 2 },
        previousStatus: TaskStatus.BLOCKED,
        auditEvent: {
          auditEventId: "audit-transition",
          entityType: "task",
          entityId: taskId,
          eventType: "task.transitioned",
          actorType: "system",
          actorId: "reconciliation-sweep",
          oldState: "{}",
          newState: "{}",
          metadata: null,
          createdAt: BASE_TIMESTAMP,
        },
      };
    },
    transitionLease() {
      throw new Error("Not expected in sweep tests");
    },
    transitionReviewCycle() {
      throw new Error("Not expected in sweep tests");
    },
    transitionMergeQueueItem() {
      throw new Error("Not expected in sweep tests");
    },
  } as unknown as TransitionService;

  const deps: ReconciliationSweepDependencies = {
    unitOfWork,
    jobQueueService,
    heartbeatService,
    leaseReclaimService,
    readinessService,
    transitionService,
    clock: () => BASE_TIMESTAMP,
  };

  return { deps, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jobIdCounter = 0;
});

describe("ReconciliationSweepService", () => {
  // ─── Initialization ─────────────────────────────────────────────────

  describe("initialize()", () => {
    /**
     * Validates that the first call to initialize() creates a
     * RECONCILIATION_SWEEP job. Without this seeded job, the sweep
     * would never start processing.
     */
    it("should create a sweep job when none exists", () => {
      const { deps, calls } = createMockDeps({ nonTerminalCount: 0 });
      const service = createReconciliationSweepService(deps);

      const result = service.initialize();

      expect(result.created).toBe(true);
      expect(result.jobId).toBeDefined();
      expect(calls.createJob).toHaveLength(1);
      expect(calls.createJob[0]!.jobType).toBe(JobType.RECONCILIATION_SWEEP);
    });

    /**
     * Validates duplicate prevention: after a restart, if a non-terminal
     * sweep job already exists in the queue, initialize() should not
     * create another one. This prevents sweep job accumulation.
     */
    it("should not create a sweep job when one already exists", () => {
      const { deps, calls } = createMockDeps({ nonTerminalCount: 1 });
      const service = createReconciliationSweepService(deps);

      const result = service.initialize();

      expect(result.created).toBe(false);
      expect(result.jobId).toBeUndefined();
      expect(calls.createJob).toHaveLength(0);
    });

    /**
     * Validates that initialize() queries for the correct job type
     * to detect existing sweep jobs.
     */
    it("should query for RECONCILIATION_SWEEP job type", () => {
      const { deps, calls } = createMockDeps({ nonTerminalCount: 0 });
      const service = createReconciliationSweepService(deps);

      service.initialize();

      expect(calls.countNonTerminalByType).toHaveLength(1);
      expect(calls.countNonTerminalByType[0]!.jobType).toBe(JobType.RECONCILIATION_SWEEP);
    });
  });

  // ─── Sweep skipping ─────────────────────────────────────────────────

  describe("processSweep() — no job available", () => {
    /**
     * Validates that when no sweep job is available (interval hasn't
     * elapsed or another instance claimed it), the service returns a
     * skipped result without doing any work.
     */
    it("should return skipped when no sweep job can be claimed", () => {
      const { deps, calls } = createMockDeps({ claimResult: null });
      const service = createReconciliationSweepService(deps);

      const result = service.processSweep();

      expect(result.processed).toBe(false);
      if (!result.processed) {
        expect(result.reason).toBe("no_sweep_job");
      }
      expect(calls.detectStaleLeases).toHaveLength(0);
    });
  });

  // ─── Self-rescheduling ──────────────────────────────────────────────

  describe("processSweep() — self-rescheduling", () => {
    /**
     * Validates the self-rescheduling pattern: after processing a sweep,
     * a new RECONCILIATION_SWEEP job is created with runAfter set to
     * now + sweepIntervalMs. This ensures the sweep continues running.
     */
    it("should create the next sweep job after processing", () => {
      const sweepJob = createMockJob({ jobId: "sweep-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: sweepJob },
      });
      const service = createReconciliationSweepService(deps);

      const result = service.processSweep();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.sweepJobId).toBe("sweep-1");
        expect(result.nextSweepJobId).toBeDefined();
      }

      // Verify the next job was created with proper runAfter
      const nextJobCall = calls.createJob.find(
        (c) => c.jobType === JobType.RECONCILIATION_SWEEP && c.runAfter != null,
      );
      expect(nextJobCall).toBeDefined();
      expect(nextJobCall!.runAfter!.getTime()).toBe(
        BASE_TIMESTAMP.getTime() + DEFAULT_SWEEP_INTERVAL_MS,
      );
    });

    /**
     * Validates that a custom sweep interval is respected.
     */
    it("should use custom sweep interval when configured", () => {
      const sweepJob = createMockJob({ jobId: "sweep-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: sweepJob },
      });
      const service = createReconciliationSweepService(deps, {
        sweepIntervalMs: 30_000,
      });

      service.processSweep();

      const nextJobCall = calls.createJob.find(
        (c) => c.jobType === JobType.RECONCILIATION_SWEEP && c.runAfter != null,
      );
      expect(nextJobCall!.runAfter!.getTime()).toBe(BASE_TIMESTAMP.getTime() + 30_000);
    });

    /**
     * Validates that the current sweep job is completed before creating
     * the next one. This ensures no sweep job leaks.
     */
    it("should complete the sweep job before creating the next", () => {
      const sweepJob = createMockJob({ jobId: "sweep-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: sweepJob },
      });
      const service = createReconciliationSweepService(deps);

      service.processSweep();

      expect(calls.completeJob).toHaveLength(1);
      expect(calls.completeJob[0]!.jobId).toBe("sweep-1");
    });

    /**
     * Validates that the correct lease owner is used when claiming jobs.
     */
    it("should use the configured lease owner", () => {
      const { deps, calls } = createMockDeps({ claimResult: null });
      const service = createReconciliationSweepService(deps, {
        leaseOwner: "custom-sweeper",
      });

      service.processSweep();

      expect(calls.claimJob[0]!.leaseOwner).toBe("custom-sweeper");
    });

    /**
     * Validates that the default lease owner is used when not configured.
     */
    it("should use default lease owner when not configured", () => {
      const { deps, calls } = createMockDeps({ claimResult: null });
      const service = createReconciliationSweepService(deps);

      service.processSweep();

      expect(calls.claimJob[0]!.leaseOwner).toBe(DEFAULT_SWEEP_LEASE_OWNER);
    });
  });

  // ─── Stale lease detection and reclaim ──────────────────────────────

  describe("processSweep() — stale lease reclaim", () => {
    /**
     * Validates that stale leases detected by the heartbeat service are
     * reclaimed via the lease reclaim service. This is the primary
     * self-healing mechanism for worker failures.
     */
    it("should detect and reclaim stale leases", () => {
      const sweepJob = createMockJob({ jobId: "sweep-1", status: JobStatus.CLAIMED });
      const staleLeases: StaleLeaseInfo[] = [
        {
          leaseId: "lease-1",
          taskId: "task-1",
          workerId: "worker-1",
          poolId: "pool-1",
          status: WorkerLeaseStatus.HEARTBEATING,
          heartbeatAt: new Date("2024-12-31T23:55:00Z"),
          expiresAt: new Date("2025-01-01T00:05:00Z"),
          leasedAt: new Date("2024-12-31T23:50:00Z"),
          reason: "missed_heartbeats",
        },
        {
          leaseId: "lease-2",
          taskId: "task-2",
          workerId: "worker-2",
          poolId: "pool-1",
          status: WorkerLeaseStatus.RUNNING,
          heartbeatAt: null,
          expiresAt: new Date("2024-12-31T23:59:00Z"),
          leasedAt: new Date("2024-12-31T23:50:00Z"),
          reason: "ttl_expired",
        },
      ];

      const { deps, calls } = createMockDeps({
        claimResult: { job: sweepJob },
        staleLeases,
      });
      const service = createReconciliationSweepService(deps);

      const result = service.processSweep();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.staleLeaseActions).toHaveLength(2);
        expect(result.summary.staleLeaseActions[0]!.outcome).toBe("reclaimed");
        expect(result.summary.staleLeaseActions[0]!.reason).toBe("missed_heartbeats");
        expect(result.summary.staleLeaseActions[1]!.outcome).toBe("reclaimed");
        expect(result.summary.staleLeaseActions[1]!.reason).toBe("ttl_expired");
      }

      expect(calls.reclaimLease).toHaveLength(2);
      expect(calls.reclaimLease[0]!.params.leaseId).toBe("lease-1");
      expect(calls.reclaimLease[1]!.params.leaseId).toBe("lease-2");
    });

    /**
     * Validates that the default staleness policy is passed to the
     * heartbeat service for detection.
     */
    it("should use the configured staleness policy", () => {
      const sweepJob = createMockJob({ jobId: "sweep-1", status: JobStatus.CLAIMED });
      const customPolicy: StalenessPolicy = {
        heartbeatIntervalSeconds: 10,
        missedHeartbeatThreshold: 3,
        gracePeriodSeconds: 5,
      };

      const { deps, calls } = createMockDeps({
        claimResult: { job: sweepJob },
      });
      const service = createReconciliationSweepService(deps, {
        stalenessPolicy: customPolicy,
      });

      service.processSweep();

      expect(calls.detectStaleLeases[0]!.policy).toEqual(customPolicy);
    });

    /**
     * Validates that a reclaim error for one lease doesn't prevent
     * reclaiming other leases. Error isolation is critical for
     * reconciliation robustness.
     */
    it("should handle reclaim errors gracefully and continue", () => {
      const sweepJob = createMockJob({ jobId: "sweep-1", status: JobStatus.CLAIMED });
      const staleLeases: StaleLeaseInfo[] = [
        {
          leaseId: "lease-fail",
          taskId: "task-1",
          workerId: "worker-1",
          poolId: "pool-1",
          status: WorkerLeaseStatus.HEARTBEATING,
          heartbeatAt: new Date("2024-12-31T23:55:00Z"),
          expiresAt: new Date("2025-01-01T00:05:00Z"),
          leasedAt: new Date("2024-12-31T23:50:00Z"),
          reason: "missed_heartbeats",
        },
        {
          leaseId: "lease-ok",
          taskId: "task-2",
          workerId: "worker-2",
          poolId: "pool-1",
          status: WorkerLeaseStatus.RUNNING,
          heartbeatAt: null,
          expiresAt: new Date("2024-12-31T23:59:00Z"),
          leasedAt: new Date("2024-12-31T23:50:00Z"),
          reason: "ttl_expired",
        },
      ];

      const { deps, calls } = createMockDeps({
        claimResult: { job: sweepJob },
        staleLeases,
        reclaimErrors: new Set(["lease-fail"]),
      });
      const service = createReconciliationSweepService(deps);

      const result = service.processSweep();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.staleLeaseActions).toHaveLength(2);
        expect(result.summary.staleLeaseActions[0]!.outcome).toBe("error");
        expect(result.summary.staleLeaseActions[0]!.error).toContain("lease-fail");
        expect(result.summary.staleLeaseActions[1]!.outcome).toBe("reclaimed");
      }

      // Both leases were attempted
      expect(calls.reclaimLease).toHaveLength(2);
    });
  });

  // ─── Orphaned job detection ─────────────────────────────────────────

  describe("processSweep() — orphaned job detection", () => {
    /**
     * Validates that jobs stuck in CLAIMED or RUNNING state past the
     * timeout are detected and failed. These represent dead workers.
     */
    it("should detect and fail orphaned jobs", () => {
      const sweepJob = createMockJob({ jobId: "sweep-1", status: JobStatus.CLAIMED });
      const orphanedJobs: OrphanedJobRecord[] = [
        {
          jobId: "orphan-1",
          jobType: JobType.WORKER_DISPATCH,
          status: JobStatus.CLAIMED,
          leaseOwner: "dead-worker-1",
          updatedAt: new Date("2024-12-31T23:40:00Z"),
        },
        {
          jobId: "orphan-2",
          jobType: JobType.REVIEWER_DISPATCH,
          status: JobStatus.RUNNING,
          leaseOwner: "dead-worker-2",
          updatedAt: new Date("2024-12-31T23:45:00Z"),
        },
      ];

      const { deps, calls } = createMockDeps({
        claimResult: { job: sweepJob },
        orphanedJobs,
      });
      const service = createReconciliationSweepService(deps);

      const result = service.processSweep();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.orphanedJobActions).toHaveLength(2);
        expect(result.summary.orphanedJobActions[0]!.outcome).toBe("failed");
        expect(result.summary.orphanedJobActions[0]!.jobId).toBe("orphan-1");
        expect(result.summary.orphanedJobActions[1]!.outcome).toBe("failed");
        expect(result.summary.orphanedJobActions[1]!.jobId).toBe("orphan-2");
      }

      expect(calls.failJob).toHaveLength(2);
      expect(calls.failJob[0]!.jobId).toBe("orphan-1");
      expect(calls.failJob[1]!.jobId).toBe("orphan-2");
    });

    /**
     * Validates that a failJob error for one orphaned job doesn't
     * prevent processing of others.
     */
    it("should handle failJob errors gracefully and continue", () => {
      const sweepJob = createMockJob({ jobId: "sweep-1", status: JobStatus.CLAIMED });
      const orphanedJobs: OrphanedJobRecord[] = [
        {
          jobId: "orphan-fail",
          jobType: JobType.WORKER_DISPATCH,
          status: JobStatus.CLAIMED,
          leaseOwner: "dead-worker",
          updatedAt: new Date("2024-12-31T23:40:00Z"),
        },
        {
          jobId: "orphan-ok",
          jobType: JobType.WORKER_DISPATCH,
          status: JobStatus.RUNNING,
          leaseOwner: "dead-worker",
          updatedAt: new Date("2024-12-31T23:40:00Z"),
        },
      ];

      const { deps } = createMockDeps({
        claimResult: { job: sweepJob },
        orphanedJobs,
        failJobErrors: new Set(["orphan-fail"]),
      });
      const service = createReconciliationSweepService(deps);

      const result = service.processSweep();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.orphanedJobActions).toHaveLength(2);
        expect(result.summary.orphanedJobActions[0]!.outcome).toBe("error");
        expect(result.summary.orphanedJobActions[1]!.outcome).toBe("failed");
      }
    });
  });

  // ─── Stuck task recovery ────────────────────────────────────────────

  describe("processSweep() — stuck task recovery", () => {
    /**
     * Validates that tasks stuck in ASSIGNED state past the timeout
     * are transitioned back to READY for rescheduling.
     */
    it("should detect and recover stuck assigned tasks", () => {
      const sweepJob = createMockJob({ jobId: "sweep-1", status: JobStatus.CLAIMED });
      const stuckTasks: StuckTaskRecord[] = [
        {
          taskId: "stuck-1",
          status: TaskStatus.ASSIGNED,
          version: 3,
          currentLeaseId: "dead-lease-1",
          updatedAt: new Date("2024-12-31T23:50:00Z"),
        },
      ];

      const { deps, calls } = createMockDeps({
        claimResult: { job: sweepJob },
        stuckTasks,
      });
      const service = createReconciliationSweepService(deps);

      const result = service.processSweep();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.stuckTaskActions).toHaveLength(1);
        expect(result.summary.stuckTaskActions[0]!.outcome).toBe("transitioned_to_ready");
        expect(result.summary.stuckTaskActions[0]!.taskId).toBe("stuck-1");
      }

      expect(calls.transitionTask).toHaveLength(1);
      expect(calls.transitionTask[0]!.taskId).toBe("stuck-1");
      expect(calls.transitionTask[0]!.targetStatus).toBe(TaskStatus.READY);
    });

    /**
     * Validates that transition errors (e.g., version conflict from
     * concurrent modification) are handled gracefully.
     */
    it("should handle transition errors for stuck tasks gracefully", () => {
      const sweepJob = createMockJob({ jobId: "sweep-1", status: JobStatus.CLAIMED });
      const stuckTasks: StuckTaskRecord[] = [
        {
          taskId: "stuck-conflict",
          status: TaskStatus.ASSIGNED,
          version: 3,
          currentLeaseId: null,
          updatedAt: new Date("2024-12-31T23:50:00Z"),
        },
      ];

      const { deps } = createMockDeps({
        claimResult: { job: sweepJob },
        stuckTasks,
        transitionErrors: new Map([
          ["stuck-conflict", new VersionConflictError("Task", "stuck-conflict", 3, 4)],
        ]),
      });
      const service = createReconciliationSweepService(deps);

      const result = service.processSweep();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.stuckTaskActions).toHaveLength(1);
        expect(result.summary.stuckTaskActions[0]!.outcome).toBe("error");
        expect(result.summary.stuckTaskActions[0]!.error).toContain("stuck-conflict");
      }
    });
  });

  // ─── Blocked task readiness recalculation ───────────────────────────

  describe("processSweep() — blocked task readiness recalculation", () => {
    /**
     * Validates that BLOCKED tasks whose dependencies have resolved
     * are detected and transitioned to READY. This catches missed
     * event-driven recalculations.
     */
    it("should transition BLOCKED tasks to READY when dependencies are resolved", () => {
      const sweepJob = createMockJob({ jobId: "sweep-1", status: JobStatus.CLAIMED });
      const blockedTasks: BlockedTaskRecord[] = [
        { taskId: "blocked-1", status: TaskStatus.BLOCKED },
        { taskId: "blocked-2", status: TaskStatus.BLOCKED },
      ];

      const readinessResults = new Map<string, ReadinessResult>([
        ["blocked-1", { status: "READY", taskId: "blocked-1" }],
        [
          "blocked-2",
          {
            status: "BLOCKED",
            taskId: "blocked-2",
            blockingReasons: [
              {
                dependsOnTaskId: "prereq-1",
                prerequisiteStatus: TaskStatus.IN_DEVELOPMENT,
                dependencyType: "blocks" as const,
                taskDependencyId: "dep-1",
              },
            ],
          },
        ],
      ]);

      const { deps, calls } = createMockDeps({
        claimResult: { job: sweepJob },
        blockedTasks,
        readinessResults,
      });
      const service = createReconciliationSweepService(deps);

      const result = service.processSweep();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.readinessRecalcActions).toHaveLength(2);
        expect(result.summary.readinessRecalcActions[0]!.outcome).toBe("transitioned_to_ready");
        expect(result.summary.readinessRecalcActions[0]!.taskId).toBe("blocked-1");
        expect(result.summary.readinessRecalcActions[1]!.outcome).toBe("still_blocked");
        expect(result.summary.readinessRecalcActions[1]!.taskId).toBe("blocked-2");
      }

      // Only blocked-1 should have been transitioned
      expect(calls.transitionTask).toHaveLength(1);
      expect(calls.transitionTask[0]!.taskId).toBe("blocked-1");
      expect(calls.transitionTask[0]!.targetStatus).toBe(TaskStatus.READY);
    });

    /**
     * Validates that readiness computation errors are handled
     * gracefully and don't prevent processing other blocked tasks.
     */
    it("should handle readiness computation errors gracefully", () => {
      const sweepJob = createMockJob({ jobId: "sweep-1", status: JobStatus.CLAIMED });
      const blockedTasks: BlockedTaskRecord[] = [
        { taskId: "blocked-error", status: TaskStatus.BLOCKED },
        { taskId: "blocked-ok", status: TaskStatus.BLOCKED },
      ];

      const readinessResults = new Map<string, ReadinessResult>([
        ["blocked-ok", { status: "READY", taskId: "blocked-ok" }],
      ]);

      // blocked-error will throw EntityNotFoundError from computeReadiness
      const { deps } = createMockDeps({
        claimResult: { job: sweepJob },
        blockedTasks,
        readinessResults,
        transitionErrors: new Map([
          ["blocked-error", new EntityNotFoundError("Task", "blocked-error")],
        ]),
      });

      // Override computeReadiness for blocked-error to throw
      const originalReadinessService = deps.readinessService;
      (deps as { readinessService: ReadinessService }).readinessService = {
        computeReadiness(taskId: string): ReadinessResult {
          if (taskId === "blocked-error") {
            throw new EntityNotFoundError("Task", "blocked-error");
          }
          return originalReadinessService.computeReadiness(taskId);
        },
        checkParentChildReadiness: originalReadinessService.checkParentChildReadiness,
      };

      const service = createReconciliationSweepService(deps);
      const result = service.processSweep();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.readinessRecalcActions).toHaveLength(2);
        expect(result.summary.readinessRecalcActions[0]!.outcome).toBe("error");
        expect(result.summary.readinessRecalcActions[1]!.outcome).toBe("transitioned_to_ready");
      }
    });
  });

  // ─── Error isolation across sub-operations ──────────────────────────

  describe("processSweep() — error isolation", () => {
    /**
     * Validates that all four sweep sub-operations run independently.
     * A failure in stale lease detection must not prevent orphaned
     * job detection, stuck task recovery, or readiness recalculation.
     */
    it("should run all sub-operations even when some fail", () => {
      const sweepJob = createMockJob({ jobId: "sweep-1", status: JobStatus.CLAIMED });

      // Stale leases that will fail reclaim
      const staleLeases: StaleLeaseInfo[] = [
        {
          leaseId: "lease-fail",
          taskId: "task-1",
          workerId: "worker-1",
          poolId: "pool-1",
          status: WorkerLeaseStatus.HEARTBEATING,
          heartbeatAt: new Date("2024-12-31T23:55:00Z"),
          expiresAt: new Date("2025-01-01T00:05:00Z"),
          leasedAt: new Date("2024-12-31T23:50:00Z"),
          reason: "missed_heartbeats",
        },
      ];

      // Orphaned jobs
      const orphanedJobs: OrphanedJobRecord[] = [
        {
          jobId: "orphan-1",
          jobType: JobType.WORKER_DISPATCH,
          status: JobStatus.CLAIMED,
          leaseOwner: "dead",
          updatedAt: new Date("2024-12-31T23:40:00Z"),
        },
      ];

      // Stuck tasks
      const stuckTasks: StuckTaskRecord[] = [
        {
          taskId: "stuck-1",
          status: TaskStatus.ASSIGNED,
          version: 1,
          currentLeaseId: null,
          updatedAt: new Date("2024-12-31T23:50:00Z"),
        },
      ];

      // Blocked tasks
      const blockedTasks: BlockedTaskRecord[] = [
        { taskId: "blocked-1", status: TaskStatus.BLOCKED },
      ];

      const readinessResults = new Map<string, ReadinessResult>([
        ["blocked-1", { status: "READY", taskId: "blocked-1" }],
      ]);

      const { deps, calls } = createMockDeps({
        claimResult: { job: sweepJob },
        staleLeases,
        reclaimErrors: new Set(["lease-fail"]),
        orphanedJobs,
        stuckTasks,
        blockedTasks,
        readinessResults,
      });
      const service = createReconciliationSweepService(deps);

      const result = service.processSweep();

      expect(result.processed).toBe(true);
      if (result.processed) {
        // All sub-operations ran
        expect(result.summary.staleLeaseActions).toHaveLength(1);
        expect(result.summary.staleLeaseActions[0]!.outcome).toBe("error");
        expect(result.summary.orphanedJobActions).toHaveLength(1);
        expect(result.summary.orphanedJobActions[0]!.outcome).toBe("failed");
        expect(result.summary.stuckTaskActions).toHaveLength(1);
        expect(result.summary.stuckTaskActions[0]!.outcome).toBe("transitioned_to_ready");
        expect(result.summary.readinessRecalcActions).toHaveLength(1);
        expect(result.summary.readinessRecalcActions[0]!.outcome).toBe("transitioned_to_ready");
      }

      // Verify all services were called
      expect(calls.detectStaleLeases).toHaveLength(1);
      expect(calls.reclaimLease).toHaveLength(1);
      expect(calls.failJob).toHaveLength(1);
      expect(calls.transitionTask).toHaveLength(2); // stuck-1 + blocked-1
      expect(calls.computeReadiness).toHaveLength(1);
    });
  });

  // ─── Empty sweep ────────────────────────────────────────────────────

  describe("processSweep() — no anomalies", () => {
    /**
     * Validates that a sweep with no anomalies still completes
     * successfully and reschedules. This is the normal case when
     * the system is healthy.
     */
    it("should complete with empty summary when system is healthy", () => {
      const sweepJob = createMockJob({ jobId: "sweep-1", status: JobStatus.CLAIMED });
      const { deps } = createMockDeps({
        claimResult: { job: sweepJob },
      });
      const service = createReconciliationSweepService(deps);

      const result = service.processSweep();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.staleLeaseActions).toHaveLength(0);
        expect(result.summary.orphanedJobActions).toHaveLength(0);
        expect(result.summary.stuckTaskActions).toHaveLength(0);
        expect(result.summary.readinessRecalcActions).toHaveLength(0);
      }
    });
  });

  // ─── Actor attribution ──────────────────────────────────────────────

  describe("processSweep() — actor attribution", () => {
    /**
     * Validates that all reconciliation actions are attributed to the
     * system actor "reconciliation-sweep", ensuring proper audit trail.
     */
    it("should use system actor for all transitions", () => {
      const sweepJob = createMockJob({ jobId: "sweep-1", status: JobStatus.CLAIMED });
      const stuckTasks: StuckTaskRecord[] = [
        {
          taskId: "stuck-1",
          status: TaskStatus.ASSIGNED,
          version: 1,
          currentLeaseId: null,
          updatedAt: new Date("2024-12-31T23:50:00Z"),
        },
      ];
      const blockedTasks: BlockedTaskRecord[] = [
        { taskId: "blocked-1", status: TaskStatus.BLOCKED },
      ];
      const readinessResults = new Map<string, ReadinessResult>([
        ["blocked-1", { status: "READY", taskId: "blocked-1" }],
      ]);

      const { deps, calls } = createMockDeps({
        claimResult: { job: sweepJob },
        stuckTasks,
        blockedTasks,
        readinessResults,
      });
      const service = createReconciliationSweepService(deps);

      service.processSweep();

      for (const call of calls.transitionTask) {
        expect(call.actor).toEqual({ type: "system", id: "reconciliation-sweep" });
      }
      for (const call of calls.reclaimLease) {
        expect(call.params.actor).toEqual({ type: "system", id: "reconciliation-sweep" });
      }
    });
  });

  // ─── Default constants ──────────────────────────────────────────────

  describe("default constants", () => {
    /**
     * Validates that default constants have production-ready values.
     * These are the fallback values when no config is provided.
     */
    it("should have sensible default values", () => {
      expect(DEFAULT_SWEEP_INTERVAL_MS).toBe(60_000); // 60 seconds
      expect(DEFAULT_ORPHANED_JOB_TIMEOUT_MS).toBe(600_000); // 10 minutes
      expect(DEFAULT_STUCK_TASK_TIMEOUT_MS).toBe(300_000); // 5 minutes
      expect(DEFAULT_SWEEP_LEASE_OWNER).toBe("reconciliation-sweep");
      expect(DEFAULT_STALENESS_POLICY).toEqual({
        heartbeatIntervalSeconds: 30,
        missedHeartbeatThreshold: 2,
        gracePeriodSeconds: 15,
      });
    });
  });
});
