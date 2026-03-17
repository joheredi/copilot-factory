/**
 * Tests for the worker dispatch service.
 *
 * These tests verify the WORKER_DISPATCH job lifecycle: claiming a job,
 * resolving task/repository context, spawning a worker via the supervisor,
 * and completing or failing the job based on the outcome.
 *
 * The worker dispatch service is the bridge between the scheduler
 * (which creates dispatch jobs when assigning tasks) and the worker
 * supervisor (which manages worker processes). Without it, tasks would
 * get stuck in ASSIGNED state because no worker would be spawned.
 *
 * Test categories:
 * - **No-op cases**: No dispatch job available → returns skip result
 * - **Happy path**: Job claimed → context resolved → worker spawned → job completed
 * - **Context resolution failure**: Task not found → job failed
 * - **Spawn failure**: Worker supervisor throws → job failed
 * - **Configuration**: Custom lease owner propagated correctly
 * - **Payload extraction**: Correct fields passed to spawn params
 *
 * @module @factory/application/services/worker-dispatch.service.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { JobType, JobStatus } from "@factory/domain";

import type { WorkerDispatchUnitOfWork } from "../ports/worker-dispatch.ports.js";
import type { WorkerSpawnContext } from "../ports/worker-dispatch.ports.js";
import type { JobQueueService, ClaimJobResult } from "./job-queue.service.js";
import type {
  WorkerSupervisorService,
  SpawnWorkerParams,
  SpawnWorkerResult,
} from "./worker-supervisor.service.js";
import type { QueuedJob } from "../ports/job-queue.ports.js";

import {
  createWorkerDispatchService,
  DEFAULT_DISPATCH_LEASE_OWNER,
} from "./worker-dispatch.service.js";
import type { WorkerDispatchDependencies, DispatchPayload } from "./worker-dispatch.service.js";

// ---------------------------------------------------------------------------
// Test helpers — mock factories
// ---------------------------------------------------------------------------

const BASE_TIMESTAMP = new Date("2025-01-01T00:00:00Z");

let jobIdCounter = 0;

/**
 * Creates a mock QueuedJob with WORKER_DISPATCH defaults.
 * Every field is overridable via the `overrides` parameter.
 */
function createMockJob(overrides: Partial<QueuedJob> = {}): QueuedJob {
  jobIdCounter++;
  return {
    jobId: `dispatch-job-${jobIdCounter}`,
    jobType: JobType.WORKER_DISPATCH,
    entityType: "task",
    entityId: "task-001",
    payloadJson: createMockPayload(),
    status: JobStatus.CLAIMED,
    attemptCount: 1,
    runAfter: null,
    leaseOwner: DEFAULT_DISPATCH_LEASE_OWNER,
    parentJobId: null,
    jobGroupId: null,
    dependsOnJobIds: null,
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP,
    ...overrides,
  };
}

/**
 * Creates a mock dispatch payload matching the shape created by
 * the scheduler when it enqueues a WORKER_DISPATCH job.
 */
function createMockPayload(overrides: Partial<DispatchPayload> = {}): DispatchPayload {
  return {
    taskId: "task-001",
    leaseId: "lease-001",
    poolId: "pool-001",
    workerId: "worker-001",
    priority: 10,
    requiredCapabilities: ["typescript"],
    ...overrides,
  };
}

/**
 * Creates a mock WorkerSpawnContext with default values for all
 * fields needed to build SpawnWorkerParams.
 */
function createMockSpawnContext(overrides: Partial<WorkerSpawnContext> = {}): WorkerSpawnContext {
  return {
    repoPath: "/repos/my-project",
    workerName: "worker-task-001",
    runContext: {
      taskPacket: { packet_type: "task_packet", schema_version: "1.0" },
      effectivePolicySnapshot: {
        policy_snapshot_version: "1.0",
        policy_set_id: "default",
      },
      workspacePaths: {
        worktreePath: "/worktrees/task-001",
        artifactRoot: "/artifacts/task-001",
        packetInputPath: "/worktrees/task-001/.factory/packets",
        policySnapshotPath: "/worktrees/task-001/.factory/policy",
      },
      outputSchemaExpectation: {
        packetType: "implementation_result",
        schemaVersion: "1.0",
      },
      timeoutSettings: {
        timeBudgetSeconds: 3600,
        expiresAt: "2025-01-01T01:00:00Z",
        heartbeatIntervalSeconds: 30,
        missedHeartbeatThreshold: 3,
        gracePeriodSeconds: 60,
      },
    },
    ...overrides,
  };
}

/**
 * Creates a mock WorkerDispatchUnitOfWork that returns a configurable
 * spawn context. Tracks all resolveSpawnContext calls for assertions.
 *
 * @param spawnContext - Context to return, or null for task-not-found simulation
 */
function createMockUnitOfWork(spawnContext: WorkerSpawnContext | null = createMockSpawnContext()): {
  unitOfWork: WorkerDispatchUnitOfWork;
  calls: { resolveSpawnContext: string[] };
} {
  const calls: { resolveSpawnContext: string[] } = {
    resolveSpawnContext: [],
  };

  const unitOfWork: WorkerDispatchUnitOfWork = {
    runInTransaction<T>(
      fn: (repos: {
        dispatch: { resolveSpawnContext: (taskId: string) => WorkerSpawnContext | null };
      }) => T,
    ): T {
      return fn({
        dispatch: {
          resolveSpawnContext(taskId: string): WorkerSpawnContext | null {
            calls.resolveSpawnContext.push(taskId);
            return spawnContext;
          },
        },
      });
    },
  };

  return { unitOfWork, calls };
}

/**
 * Tracking structure for mock JobQueueService calls.
 */
interface JobQueueCalls {
  claimJob: Array<{ jobType: JobType; leaseOwner: string }>;
  completeJob: Array<{ jobId: string }>;
  failJob: Array<{ jobId: string; error?: string }>;
}

/**
 * Creates a mock JobQueueService with configurable claim behavior.
 * Only implements the subset of methods used by the dispatch service.
 *
 * @param claimResult - What `claimJob` returns (null = no job available)
 */
function createMockJobQueueService(claimResult: ClaimJobResult | null = null): {
  service: JobQueueService;
  calls: JobQueueCalls;
} {
  const calls: JobQueueCalls = {
    claimJob: [],
    completeJob: [],
    failJob: [],
  };

  const service = {
    claimJob(jobType: JobType, leaseOwner: string): ClaimJobResult | null {
      calls.claimJob.push({ jobType, leaseOwner });
      return claimResult;
    },
    completeJob(jobId: string) {
      calls.completeJob.push({ jobId });
      return { job: createMockJob({ jobId, status: JobStatus.COMPLETED }) };
    },
    failJob(jobId: string, error?: string) {
      calls.failJob.push({ jobId, error });
      return { job: createMockJob({ jobId, status: JobStatus.FAILED }) };
    },
    // Unused methods — stub to satisfy the interface
    createJob() {
      throw new Error("createJob not expected in dispatch tests");
    },
    startJob() {
      throw new Error("startJob not expected in dispatch tests");
    },
    areJobDependenciesMet() {
      throw new Error("areJobDependenciesMet not expected in dispatch tests");
    },
    findJobsByGroup() {
      throw new Error("findJobsByGroup not expected in dispatch tests");
    },
  } as unknown as JobQueueService;

  return { service, calls };
}

/**
 * Tracking structure for mock WorkerSupervisorService calls.
 */
interface SupervisorCalls {
  spawnWorker: SpawnWorkerParams[];
}

/**
 * Creates a mock SpawnWorkerResult with default success values.
 */
function createMockSpawnResult(overrides: Partial<SpawnWorkerResult> = {}): SpawnWorkerResult {
  return {
    worker: {
      workerId: "worker-001",
      poolId: "pool-001",
      name: "test-worker",
      status: "completed",
      currentTaskId: null,
      currentRunId: null,
      lastHeartbeatAt: null,
    },
    finalizeResult: {
      runId: "run-001",
      status: "success",
      packetOutput: { packet_type: "dev_result_packet" },
      artifactPaths: [],
      logs: [],
      exitCode: 0,
      durationMs: 1500,
      finalizedAt: "2025-01-01T00:00:01.500Z",
    },
    outputEvents: [],
    ...overrides,
  };
}

/**
 * Creates a mock WorkerSupervisorService that resolves immediately
 * with a configurable result, or rejects with a configured error.
 *
 * @param throwError - If provided, spawnWorker will reject with this error
 * @param spawnResult - The SpawnWorkerResult to return on success
 */
function createMockSupervisor(
  throwError?: Error,
  spawnResult: SpawnWorkerResult = createMockSpawnResult(),
): {
  service: WorkerSupervisorService;
  calls: SupervisorCalls;
} {
  const calls: SupervisorCalls = {
    spawnWorker: [],
  };

  const service: WorkerSupervisorService = {
    async spawnWorker(params: SpawnWorkerParams) {
      calls.spawnWorker.push(params);
      if (throwError) {
        throw throwError;
      }
      return spawnResult;
    },
    async cancelWorker() {
      throw new Error("cancelWorker not expected in dispatch tests");
    },
  };

  return { service, calls };
}

/**
 * Creates a complete set of dependencies for the dispatch service.
 * All components use sensible defaults that can be overridden.
 */
function createDeps(
  overrides: {
    claimResult?: ClaimJobResult | null;
    spawnContext?: WorkerSpawnContext | null;
    spawnError?: Error;
    spawnResult?: SpawnWorkerResult;
  } = {},
): {
  deps: WorkerDispatchDependencies;
  jobQueueCalls: JobQueueCalls;
  supervisorCalls: SupervisorCalls;
  unitOfWorkCalls: { resolveSpawnContext: string[] };
} {
  const { unitOfWork, calls: unitOfWorkCalls } = createMockUnitOfWork(
    overrides.spawnContext !== undefined ? overrides.spawnContext : createMockSpawnContext(),
  );
  const { service: jobQueueService, calls: jobQueueCalls } = createMockJobQueueService(
    overrides.claimResult ?? null,
  );
  const { service: workerSupervisorService, calls: supervisorCalls } = createMockSupervisor(
    overrides.spawnError,
    overrides.spawnResult,
  );

  return {
    deps: {
      unitOfWork,
      jobQueueService,
      workerSupervisorService,
      clock: () => BASE_TIMESTAMP,
    },
    jobQueueCalls,
    supervisorCalls,
    unitOfWorkCalls,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkerDispatchService", () => {
  beforeEach(() => {
    jobIdCounter = 0;
  });

  // ─── No-op cases ──────────────────────────────────────────────────────

  describe("processDispatch — no job available", () => {
    /**
     * Validates that the service gracefully returns a skip result when
     * no WORKER_DISPATCH jobs exist in the queue. This is the normal
     * idle state and must not throw or produce side effects.
     */
    it("returns skip result when no dispatch job is available", async () => {
      const { deps } = createDeps({ claimResult: null });
      const service = createWorkerDispatchService(deps);

      const result = await service.processDispatch();

      expect(result).toEqual({
        processed: false,
        reason: "no_dispatch_job",
      });
    });

    /**
     * Verifies that no interaction with the supervisor or unit of work
     * occurs when there are no jobs to process. This ensures the service
     * short-circuits correctly and doesn't make unnecessary DB calls.
     */
    it("does not call supervisor or unit of work when no job exists", async () => {
      const { deps, supervisorCalls, unitOfWorkCalls } = createDeps({
        claimResult: null,
      });
      const service = createWorkerDispatchService(deps);

      await service.processDispatch();

      expect(supervisorCalls.spawnWorker).toHaveLength(0);
      expect(unitOfWorkCalls.resolveSpawnContext).toHaveLength(0);
    });
  });

  // ─── Happy path ───────────────────────────────────────────────────────

  describe("processDispatch — successful dispatch", () => {
    /**
     * End-to-end happy path: verifies the complete flow from job claim
     * through context resolution, worker spawn, and job completion.
     * This is the primary success path that unblocks tasks from ASSIGNED
     * state.
     */
    it("claims job, resolves context, spawns worker, and completes job", async () => {
      const mockJob = createMockJob();
      const mockSpawnResult = createMockSpawnResult();
      const { deps, jobQueueCalls, supervisorCalls } = createDeps({
        claimResult: { job: mockJob },
        spawnResult: mockSpawnResult,
      });
      const service = createWorkerDispatchService(deps);

      const result = await service.processDispatch();

      expect(result).toMatchObject({
        processed: true,
        dispatched: true,
        jobId: mockJob.jobId,
        taskId: "task-001",
        workerId: "worker-001",
        leaseId: "lease-001",
      });

      // Verify spawnResult is included and contains finalize data
      expect(result.processed && result.dispatched && result.spawnResult).toBeTruthy();
      if (result.processed && result.dispatched) {
        expect(result.spawnResult.finalizeResult.status).toBe("success");
        expect(result.spawnResult.finalizeResult.exitCode).toBe(0);
      }

      // Verify job was completed
      expect(jobQueueCalls.completeJob).toEqual([{ jobId: mockJob.jobId }]);
      // Verify no failures
      expect(jobQueueCalls.failJob).toHaveLength(0);
      // Verify spawn was called
      expect(supervisorCalls.spawnWorker).toHaveLength(1);
    });

    /**
     * Validates that the correct SpawnWorkerParams are built from the
     * combination of job payload (taskId, leaseId, poolId, workerId)
     * and resolved context (repoPath, workerName, runContext).
     * Incorrect parameter assembly would cause worker failures.
     */
    it("builds correct SpawnWorkerParams from payload and context", async () => {
      const payload = createMockPayload({
        taskId: "task-42",
        leaseId: "lease-42",
        poolId: "pool-typescript",
        workerId: "worker-42",
      });
      const mockJob = createMockJob({
        payloadJson: payload,
        attemptCount: 3,
      });
      const spawnContext = createMockSpawnContext({
        repoPath: "/repos/special-project",
        workerName: "worker-special",
      });

      const { deps, supervisorCalls } = createDeps({
        claimResult: { job: mockJob },
        spawnContext,
      });
      const service = createWorkerDispatchService(deps);

      await service.processDispatch();

      expect(supervisorCalls.spawnWorker).toHaveLength(1);
      const params = supervisorCalls.spawnWorker[0]!;
      expect(params.workerId).toBe("worker-42");
      expect(params.poolId).toBe("pool-typescript");
      expect(params.workerName).toBe("worker-special");
      expect(params.taskId).toBe("task-42");
      expect(params.leaseId).toBe("lease-42");
      expect(params.repoPath).toBe("/repos/special-project");
      expect(params.attempt).toBe(3);
      expect(params.runContext).toBe(spawnContext.runContext);
      expect(params.actor).toEqual({ type: "system", id: "worker-dispatch" });
    });

    /**
     * Validates that the unit of work's resolveSpawnContext is called
     * with the correct taskId from the dispatch payload.
     */
    it("passes taskId to resolveSpawnContext", async () => {
      const payload = createMockPayload({ taskId: "task-99" });
      const mockJob = createMockJob({ payloadJson: payload });
      const { deps, unitOfWorkCalls } = createDeps({
        claimResult: { job: mockJob },
      });
      const service = createWorkerDispatchService(deps);

      await service.processDispatch();

      expect(unitOfWorkCalls.resolveSpawnContext).toEqual(["task-99"]);
    });

    /**
     * Validates that the dispatch result includes the SpawnWorkerResult
     * even when the worker process returned a non-success status.
     * The supervisor handles failure recovery (lease reclaim), but the
     * caller still needs visibility into the finalize data.
     */
    it("includes spawnResult with failed worker status", async () => {
      const mockJob = createMockJob();
      const failedSpawnResult = createMockSpawnResult({
        finalizeResult: {
          runId: "run-fail",
          status: "failed",
          packetOutput: null,
          artifactPaths: [],
          logs: [],
          exitCode: 1,
          durationMs: 500,
          finalizedAt: "2025-01-01T00:00:00.500Z",
        },
      });
      const { deps } = createDeps({
        claimResult: { job: mockJob },
        spawnResult: failedSpawnResult,
      });
      const service = createWorkerDispatchService(deps);

      const result = await service.processDispatch();

      expect(result.processed).toBe(true);
      if (result.processed && result.dispatched) {
        expect(result.spawnResult.finalizeResult.status).toBe("failed");
        expect(result.spawnResult.finalizeResult.exitCode).toBe(1);
      }
    });
  });

  // ─── Context resolution failure ───────────────────────────────────────

  describe("processDispatch — context resolution failed", () => {
    /**
     * Verifies that when the unit of work returns null (task not found
     * or not in a dispatchable state), the dispatch job is failed and
     * the service returns a context_resolution_failed result.
     * This prevents silent drops of dispatch jobs for deleted tasks.
     */
    it("fails job when context resolution returns null", async () => {
      const mockJob = createMockJob();
      const { deps, jobQueueCalls, supervisorCalls } = createDeps({
        claimResult: { job: mockJob },
        spawnContext: null,
      });
      const service = createWorkerDispatchService(deps);

      const result = await service.processDispatch();

      expect(result).toEqual({
        processed: true,
        dispatched: false,
        jobId: mockJob.jobId,
        taskId: "task-001",
        reason: "context_resolution_failed",
        error: expect.stringContaining("task-001"),
      });

      // Job should be failed, not completed
      expect(jobQueueCalls.failJob).toEqual([
        { jobId: mockJob.jobId, error: expect.stringContaining("task-001") },
      ]);
      expect(jobQueueCalls.completeJob).toHaveLength(0);
      // Supervisor should not be called
      expect(supervisorCalls.spawnWorker).toHaveLength(0);
    });
  });

  // ─── Spawn failure ────────────────────────────────────────────────────

  describe("processDispatch — spawn failure", () => {
    /**
     * Verifies that when spawnWorker throws an error, the dispatch
     * job is failed with the error message. This ensures transient
     * worker failures (workspace errors, runtime errors, etc.) are
     * properly recorded in the job queue for retry or investigation.
     */
    it("fails job when spawnWorker throws an error", async () => {
      const mockJob = createMockJob();
      const { deps, jobQueueCalls } = createDeps({
        claimResult: { job: mockJob },
        spawnError: new Error("Workspace creation failed: disk full"),
      });
      const service = createWorkerDispatchService(deps);

      const result = await service.processDispatch();

      expect(result).toEqual({
        processed: true,
        dispatched: false,
        jobId: mockJob.jobId,
        taskId: "task-001",
        reason: "spawn_failed",
        error: "Workspace creation failed: disk full",
      });

      // Job should be failed
      expect(jobQueueCalls.failJob).toEqual([
        {
          jobId: mockJob.jobId,
          error: "Workspace creation failed: disk full",
        },
      ]);
      expect(jobQueueCalls.completeJob).toHaveLength(0);
    });

    /**
     * Verifies that non-Error throwables (strings, numbers) are
     * correctly stringified in the failure result. This ensures
     * robustness against unexpected throw values.
     */
    it("handles non-Error thrown values", async () => {
      const mockJob = createMockJob();
      const { deps, jobQueueCalls } = createDeps({
        claimResult: { job: mockJob },
      });

      // Override supervisor to throw a non-Error
      const service = createWorkerDispatchService({
        ...deps,
        workerSupervisorService: {
          async spawnWorker() {
            throw "unexpected string error";
          },
          async cancelWorker() {
            throw new Error("not used");
          },
        },
      });

      const result = await service.processDispatch();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.dispatched).toBe(false);
        if (!result.dispatched) {
          expect(result.reason).toBe("spawn_failed");
          expect(result.error).toBe("unexpected string error");
        }
      }

      expect(jobQueueCalls.failJob).toHaveLength(1);
    });
  });

  // ─── Configuration ────────────────────────────────────────────────────

  describe("configuration", () => {
    /**
     * Verifies that the default lease owner "worker-dispatch" is used
     * when no custom config is provided. This ensures consistent
     * lease owner tracking in the job queue.
     */
    it("uses default lease owner", async () => {
      const { deps, jobQueueCalls } = createDeps({
        claimResult: null,
      });
      const service = createWorkerDispatchService(deps);

      await service.processDispatch();

      expect(jobQueueCalls.claimJob).toEqual([
        { jobType: JobType.WORKER_DISPATCH, leaseOwner: "worker-dispatch" },
      ]);
    });

    /**
     * Verifies that a custom lease owner from config is propagated
     * to claimJob calls. This supports multi-instance deployments
     * where each dispatch instance has a unique identity.
     */
    it("uses custom lease owner from config", async () => {
      const { deps, jobQueueCalls } = createDeps({
        claimResult: null,
      });
      const service = createWorkerDispatchService(deps, {
        leaseOwner: "dispatch-node-2",
      });

      await service.processDispatch();

      expect(jobQueueCalls.claimJob).toEqual([
        {
          jobType: JobType.WORKER_DISPATCH,
          leaseOwner: "dispatch-node-2",
        },
      ]);
    });
  });

  // ─── Job type correctness ────────────────────────────────────────────

  describe("job type", () => {
    /**
     * Validates that the service claims WORKER_DISPATCH jobs
     * specifically, not SCHEDULER_TICK or RECONCILIATION_SWEEP.
     * Claiming the wrong job type would break the entire dispatch
     * pipeline.
     */
    it("claims WORKER_DISPATCH job type", async () => {
      const { deps, jobQueueCalls } = createDeps({ claimResult: null });
      const service = createWorkerDispatchService(deps);

      await service.processDispatch();

      expect(jobQueueCalls.claimJob[0]!.jobType).toBe(JobType.WORKER_DISPATCH);
    });
  });
});
