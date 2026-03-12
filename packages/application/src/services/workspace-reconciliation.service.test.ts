/**
 * Tests for the workspace reconciliation service.
 *
 * These tests verify the recurring CLEANUP job lifecycle: initialization
 * (seeding the first cleanup job), reconciliation processing (claim →
 * detect expired/orphaned workspaces → cleanup → complete → reschedule),
 * and error isolation between operations.
 *
 * The workspace reconciliation is the system's automated disk space
 * management mechanism. Without it, workspaces would accumulate
 * indefinitely, requiring manual operator intervention.
 *
 * ## Test categories
 *
 * - **Initialization**: Verifies the first cleanup job is seeded correctly
 *   and that duplicates are prevented after restarts.
 * - **Self-rescheduling**: Verifies that after processing, a new cleanup
 *   job is created with the correct delay.
 * - **Expired workspace cleanup**: Verifies that workspaces for tasks
 *   past retention are cleaned up, respecting the domain eligibility rules.
 * - **Orphaned workspace detection**: Verifies that workspace directories
 *   not matching any known task are detected and removed.
 * - **Error isolation**: Verifies that a failure cleaning one workspace
 *   does not prevent others from being processed.
 * - **Skipping ineligible workspaces**: Verifies that the domain retention
 *   policy is respected (FAILED retention, ESCALATED retention, retention
 *   period not elapsed).
 *
 * @module @factory/application/services/workspace-reconciliation.service.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { JobType, JobStatus, TaskStatus } from "@factory/domain";

import type {
  WorkspaceReconciliationUnitOfWork,
  WorkspaceReconciliationTransactionRepositories,
  ExpiredWorkspaceRecord,
  WorkspaceDirectoryScannerPort,
  WorkspaceDirectoryEntry,
} from "../ports/workspace-reconciliation.ports.js";
import type {
  JobQueueService,
  CreateJobResult,
  ClaimJobResult,
  CompleteJobResult,
  FailJobResult,
} from "./job-queue.service.js";
import type {
  WorkspaceProviderPort,
  SupervisorWorkspaceResult,
  SupervisorCleanupOptions,
  SupervisorCleanupResult,
} from "../ports/worker-supervisor.ports.js";
import type { QueuedJob } from "../ports/job-queue.ports.js";

import {
  createWorkspaceReconciliationService,
  DEFAULT_RECONCILIATION_INTERVAL_MS,
  DEFAULT_RECONCILIATION_LEASE_OWNER,
  DEFAULT_WORKSPACE_RETENTION_POLICY,
} from "./workspace-reconciliation.service.js";
import type { WorkspaceReconciliationDependencies } from "./workspace-reconciliation.service.js";

// ---------------------------------------------------------------------------
// Test helpers — mock factories
// ---------------------------------------------------------------------------

const BASE_TIMESTAMP = new Date("2025-01-15T12:00:00Z");

/** 25 hours before BASE_TIMESTAMP — past default 24h retention. */
const EXPIRED_TIMESTAMP = new Date("2025-01-14T11:00:00Z");

/** 12 hours before BASE_TIMESTAMP — within default 24h retention. */
const RECENT_TIMESTAMP = new Date("2025-01-15T00:00:00Z");

let jobIdCounter = 0;

/**
 * Creates a mock QueuedJob with sensible defaults for CLEANUP jobs.
 */
function createMockJob(overrides: Partial<QueuedJob> = {}): QueuedJob {
  jobIdCounter++;
  return {
    jobId: `job-${jobIdCounter}`,
    jobType: JobType.CLEANUP,
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
 * Creates an ExpiredWorkspaceRecord with sensible defaults.
 */
function createExpiredTask(
  overrides: Partial<ExpiredWorkspaceRecord> = {},
): ExpiredWorkspaceRecord {
  return {
    taskId: "task-1",
    projectId: "project-1",
    repoPath: "/repos/my-project",
    status: TaskStatus.DONE,
    terminalStateAt: EXPIRED_TIMESTAMP,
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
  cleanupWorkspace: Array<{
    taskId: string;
    repoPath: string;
    options?: SupervisorCleanupOptions;
  }>;
  countNonTerminalByType: Array<{ jobType: string }>;
}

/**
 * Configuration for the mock dependencies.
 */
interface MockConfig {
  /** Count of non-terminal cleanup jobs (for initialize). */
  nonTerminalCount?: number;
  /** What claimJob returns (null = no cleanup job available). */
  claimResult?: ClaimJobResult | null;
  /** Tasks in terminal states to return from the query port. */
  terminalTasks?: ExpiredWorkspaceRecord[];
  /** Workspace directory entries found on disk. */
  workspaceDirectories?: WorkspaceDirectoryEntry[];
  /** Set of taskIds for which cleanupWorkspace should throw. */
  cleanupErrors?: Set<string>;
  /** Whether the directory scanner should throw. */
  scannerError?: Error;
}

/**
 * Creates all mock dependencies for the workspace reconciliation service.
 *
 * All mocks are configurable via the MockConfig parameter. By default,
 * everything returns empty/no-op results.
 */
function createMockDeps(mockConfig: MockConfig = {}): {
  deps: WorkspaceReconciliationDependencies;
  calls: MockCalls;
} {
  const calls: MockCalls = {
    createJob: [],
    claimJob: [],
    completeJob: [],
    cleanupWorkspace: [],
    countNonTerminalByType: [],
  };

  const unitOfWork: WorkspaceReconciliationUnitOfWork = {
    runInTransaction<T>(fn: (repos: WorkspaceReconciliationTransactionRepositories) => T): T {
      return fn({
        task: {
          findTasksInTerminalStates(): readonly ExpiredWorkspaceRecord[] {
            return mockConfig.terminalTasks ?? [];
          },
        },
        job: {
          countNonTerminalByType(jobType: string): number {
            calls.countNonTerminalByType.push({ jobType });
            return mockConfig.nonTerminalCount ?? 0;
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
    failJob(_jobId: string, _error?: string): FailJobResult {
      throw new Error("Not expected in workspace reconciliation tests");
    },
    startJob() {
      throw new Error("Not expected in workspace reconciliation tests");
    },
    areJobDependenciesMet() {
      throw new Error("Not expected in workspace reconciliation tests");
    },
    findJobsByGroup() {
      throw new Error("Not expected in workspace reconciliation tests");
    },
  };

  const defaultCleanupResult: SupervisorCleanupResult = {
    worktreeRemoved: true,
    directoryRemoved: true,
    branchDeleted: true,
  };

  const workspaceProvider: WorkspaceProviderPort = {
    async createWorkspace(): Promise<SupervisorWorkspaceResult> {
      throw new Error("Not expected in workspace reconciliation tests");
    },
    async cleanupWorkspace(
      taskId: string,
      repoPath: string,
      options?: SupervisorCleanupOptions,
    ): Promise<SupervisorCleanupResult> {
      calls.cleanupWorkspace.push({ taskId, repoPath, options });
      if (mockConfig.cleanupErrors?.has(taskId)) {
        throw new Error(`Cleanup failed for ${taskId}`);
      }
      return defaultCleanupResult;
    },
  };

  const workspaceScanner: WorkspaceDirectoryScannerPort = {
    async listWorkspaceDirectories(): Promise<readonly WorkspaceDirectoryEntry[]> {
      if (mockConfig.scannerError) {
        throw mockConfig.scannerError;
      }
      return mockConfig.workspaceDirectories ?? [];
    },
  };

  const deps: WorkspaceReconciliationDependencies = {
    unitOfWork,
    jobQueueService,
    workspaceProvider,
    workspaceScanner,
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

describe("WorkspaceReconciliationService", () => {
  // ─── Initialization ─────────────────────────────────────────────────

  describe("initialize()", () => {
    /**
     * Validates that the first call to initialize() creates a CLEANUP job.
     * Without this seeded job, the workspace reconciliation would never start.
     */
    it("should create a cleanup job when none exists", () => {
      const { deps, calls } = createMockDeps({ nonTerminalCount: 0 });
      const service = createWorkspaceReconciliationService(deps);

      const result = service.initialize();

      expect(result.created).toBe(true);
      expect(result.jobId).toBeDefined();
      expect(calls.createJob).toHaveLength(1);
      expect(calls.createJob[0]!.jobType).toBe(JobType.CLEANUP);
    });

    /**
     * Validates duplicate prevention: after a restart, if a non-terminal
     * cleanup job already exists, initialize() should not create another.
     * This prevents cleanup job accumulation.
     */
    it("should not create a cleanup job when one already exists", () => {
      const { deps, calls } = createMockDeps({ nonTerminalCount: 1 });
      const service = createWorkspaceReconciliationService(deps);

      const result = service.initialize();

      expect(result.created).toBe(false);
      expect(result.jobId).toBeUndefined();
      expect(calls.createJob).toHaveLength(0);
    });

    /**
     * Validates that initialize() queries for the correct job type
     * (CLEANUP) to detect existing cleanup jobs.
     */
    it("should query for CLEANUP job type", () => {
      const { deps, calls } = createMockDeps({ nonTerminalCount: 0 });
      const service = createWorkspaceReconciliationService(deps);

      service.initialize();

      expect(calls.countNonTerminalByType).toHaveLength(1);
      expect(calls.countNonTerminalByType[0]!.jobType).toBe(JobType.CLEANUP);
    });
  });

  // ─── Reconciliation skipping ────────────────────────────────────────

  describe("processReconciliation() — no job available", () => {
    /**
     * Validates that when no cleanup job is available (interval hasn't
     * elapsed or another instance claimed it), the service returns a
     * skipped result without doing any work.
     */
    it("should return skipped when no cleanup job can be claimed", async () => {
      const { deps, calls } = createMockDeps({ claimResult: null });
      const service = createWorkspaceReconciliationService(deps);

      const result = await service.processReconciliation();

      expect(result.processed).toBe(false);
      if (!result.processed) {
        expect(result.reason).toBe("no_cleanup_job");
      }
      expect(calls.cleanupWorkspace).toHaveLength(0);
    });
  });

  // ─── Self-rescheduling ──────────────────────────────────────────────

  describe("processReconciliation() — self-rescheduling", () => {
    /**
     * Validates the self-rescheduling pattern: after processing, a new
     * CLEANUP job is created with runAfter = now + reconciliationIntervalMs.
     * This ensures workspace reconciliation continues running periodically.
     */
    it("should create the next cleanup job after processing", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: cleanupJob },
      });
      const service = createWorkspaceReconciliationService(deps);

      const result = await service.processReconciliation();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.cleanupJobId).toBe("cleanup-1");
        expect(result.nextCleanupJobId).toBeDefined();
      }

      // Verify the next job was created with proper runAfter
      const nextJobCall = calls.createJob.find(
        (c) => c.jobType === JobType.CLEANUP && c.runAfter != null,
      );
      expect(nextJobCall).toBeDefined();
      expect(nextJobCall!.runAfter!.getTime()).toBe(
        BASE_TIMESTAMP.getTime() + DEFAULT_RECONCILIATION_INTERVAL_MS,
      );
    });

    /**
     * Validates that a custom reconciliation interval is respected.
     */
    it("should use custom interval when configured", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: cleanupJob },
      });
      const service = createWorkspaceReconciliationService(deps, {
        reconciliationIntervalMs: 30 * 60_000, // 30 minutes
      });

      await service.processReconciliation();

      const nextJobCall = calls.createJob.find(
        (c) => c.jobType === JobType.CLEANUP && c.runAfter != null,
      );
      expect(nextJobCall).toBeDefined();
      expect(nextJobCall!.runAfter!.getTime()).toBe(BASE_TIMESTAMP.getTime() + 30 * 60_000);
    });

    /**
     * Validates that the current cleanup job is completed before the
     * next one is created. This ensures the job lifecycle is correct.
     */
    it("should complete the current cleanup job", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: cleanupJob },
      });
      const service = createWorkspaceReconciliationService(deps);

      await service.processReconciliation();

      expect(calls.completeJob).toHaveLength(1);
      expect(calls.completeJob[0]!.jobId).toBe("cleanup-1");
    });

    /**
     * Validates that the claim uses the correct job type and lease owner.
     */
    it("should claim with CLEANUP job type and correct lease owner", async () => {
      const { deps, calls } = createMockDeps({ claimResult: null });
      const service = createWorkspaceReconciliationService(deps);

      await service.processReconciliation();

      expect(calls.claimJob).toHaveLength(1);
      expect(calls.claimJob[0]!.jobType).toBe(JobType.CLEANUP);
      expect(calls.claimJob[0]!.leaseOwner).toBe(DEFAULT_RECONCILIATION_LEASE_OWNER);
    });

    /**
     * Validates that a custom lease owner is respected.
     */
    it("should use custom lease owner when configured", async () => {
      const { deps, calls } = createMockDeps({ claimResult: null });
      const service = createWorkspaceReconciliationService(deps, {
        leaseOwner: "custom-owner",
      });

      await service.processReconciliation();

      expect(calls.claimJob[0]!.leaseOwner).toBe("custom-owner");
    });
  });

  // ─── Expired workspace cleanup ──────────────────────────────────────

  describe("processReconciliation() — expired workspaces", () => {
    /**
     * Validates that workspaces for tasks past the retention period are
     * cleaned up. This is the primary function of the service — preventing
     * disk space exhaustion.
     */
    it("should clean up workspaces past retention period", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: cleanupJob },
        terminalTasks: [
          createExpiredTask({
            taskId: "task-done",
            status: TaskStatus.DONE,
            terminalStateAt: EXPIRED_TIMESTAMP,
          }),
        ],
      });
      const service = createWorkspaceReconciliationService(deps);

      const result = await service.processReconciliation();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.expiredWorkspaceActions).toHaveLength(1);
        expect(result.summary.expiredWorkspaceActions[0]!.outcome).toBe("cleaned");
        expect(result.summary.expiredWorkspaceActions[0]!.taskId).toBe("task-done");
      }

      expect(calls.cleanupWorkspace).toHaveLength(1);
      expect(calls.cleanupWorkspace[0]!.taskId).toBe("task-done");
    });

    /**
     * Validates that CANCELLED task workspaces are also cleaned up after
     * the retention period. CANCELLED is a terminal state.
     */
    it("should clean up CANCELLED task workspaces past retention", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: cleanupJob },
        terminalTasks: [
          createExpiredTask({
            taskId: "task-cancelled",
            status: TaskStatus.CANCELLED,
            terminalStateAt: EXPIRED_TIMESTAMP,
          }),
        ],
      });
      const service = createWorkspaceReconciliationService(deps);

      const result = await service.processReconciliation();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.expiredWorkspaceActions[0]!.outcome).toBe("cleaned");
      }
      expect(calls.cleanupWorkspace).toHaveLength(1);
    });

    /**
     * Validates that cleanup uses force-delete for branches since terminal
     * task branches may not have been merged (e.g., FAILED, CANCELLED).
     */
    it("should force-delete branches during cleanup", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: cleanupJob },
        terminalTasks: [createExpiredTask()],
      });
      const service = createWorkspaceReconciliationService(deps);

      await service.processReconciliation();

      expect(calls.cleanupWorkspace[0]!.options).toEqual({
        deleteBranch: true,
        forceBranchDelete: true,
      });
    });

    /**
     * Validates that multiple expired workspaces are all cleaned up
     * in a single reconciliation cycle.
     */
    it("should clean up multiple expired workspaces", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: cleanupJob },
        terminalTasks: [
          createExpiredTask({ taskId: "task-1" }),
          createExpiredTask({ taskId: "task-2" }),
          createExpiredTask({ taskId: "task-3" }),
        ],
      });
      const service = createWorkspaceReconciliationService(deps);

      const result = await service.processReconciliation();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.expiredWorkspaceActions).toHaveLength(3);
        const cleanedIds = result.summary.expiredWorkspaceActions
          .filter((a) => a.outcome === "cleaned")
          .map((a) => a.taskId);
        expect(cleanedIds).toEqual(["task-1", "task-2", "task-3"]);
      }
      expect(calls.cleanupWorkspace).toHaveLength(3);
    });

    /**
     * Validates that workspaces within the retention period are skipped.
     * The domain eligibility check should reject tasks that haven't been
     * terminal long enough.
     */
    it("should skip workspaces within retention period", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: cleanupJob },
        terminalTasks: [
          createExpiredTask({
            taskId: "task-recent",
            terminalStateAt: RECENT_TIMESTAMP, // Only 12 hours ago
          }),
        ],
      });
      const service = createWorkspaceReconciliationService(deps);

      const result = await service.processReconciliation();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.expiredWorkspaceActions).toHaveLength(1);
        expect(result.summary.expiredWorkspaceActions[0]!.outcome).toBe("skipped");
        expect(result.summary.expiredWorkspaceActions[0]!.reason).toContain("Retention period");
      }
      // No cleanup call should have been made
      expect(calls.cleanupWorkspace).toHaveLength(0);
    });

    /**
     * Validates that FAILED task workspaces are retained when the policy
     * says to keep them (retain_failed_workspaces: true). This is important
     * for debugging failed tasks.
     */
    it("should skip FAILED workspaces when retain_failed_workspaces is true", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: cleanupJob },
        terminalTasks: [
          createExpiredTask({
            taskId: "task-failed",
            status: TaskStatus.FAILED,
            terminalStateAt: EXPIRED_TIMESTAMP,
          }),
        ],
      });
      // Default retention policy has retain_failed_workspaces: true
      const service = createWorkspaceReconciliationService(deps);

      const result = await service.processReconciliation();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.expiredWorkspaceActions[0]!.outcome).toBe("skipped");
        expect(result.summary.expiredWorkspaceActions[0]!.reason).toContain(
          "Failed workspaces are retained",
        );
      }
      expect(calls.cleanupWorkspace).toHaveLength(0);
    });

    /**
     * Validates that FAILED workspaces ARE cleaned up when the retention
     * policy allows it (retain_failed_workspaces: false).
     */
    it("should clean FAILED workspaces when retain_failed_workspaces is false", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: cleanupJob },
        terminalTasks: [
          createExpiredTask({
            taskId: "task-failed",
            status: TaskStatus.FAILED,
            terminalStateAt: EXPIRED_TIMESTAMP,
          }),
        ],
      });
      const service = createWorkspaceReconciliationService(deps, {
        retentionPolicy: {
          workspace_retention_hours: 24,
          retain_failed_workspaces: false,
          retain_escalated_workspaces: true,
        },
      });

      const result = await service.processReconciliation();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.expiredWorkspaceActions[0]!.outcome).toBe("cleaned");
      }
      expect(calls.cleanupWorkspace).toHaveLength(1);
    });

    /**
     * Validates that ESCALATED task workspaces are always retained.
     * ESCALATED tasks need operator review before workspace can be removed.
     */
    it("should skip ESCALATED workspaces", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: cleanupJob },
        terminalTasks: [
          createExpiredTask({
            taskId: "task-escalated",
            status: TaskStatus.ESCALATED,
            terminalStateAt: EXPIRED_TIMESTAMP,
          }),
        ],
      });
      const service = createWorkspaceReconciliationService(deps);

      const result = await service.processReconciliation();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.expiredWorkspaceActions[0]!.outcome).toBe("skipped");
        expect(result.summary.expiredWorkspaceActions[0]!.reason).toContain("Escalated");
      }
      expect(calls.cleanupWorkspace).toHaveLength(0);
    });

    /**
     * Validates that when no tasks are in terminal states, the reconciliation
     * still completes successfully with empty actions.
     */
    it("should handle no terminal tasks gracefully", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps } = createMockDeps({
        claimResult: { job: cleanupJob },
        terminalTasks: [],
      });
      const service = createWorkspaceReconciliationService(deps);

      const result = await service.processReconciliation();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.expiredWorkspaceActions).toHaveLength(0);
        expect(result.summary.orphanedWorkspaceActions).toHaveLength(0);
      }
    });
  });

  // ─── Error isolation — expired workspaces ───────────────────────────

  describe("processReconciliation() — error isolation", () => {
    /**
     * Validates that a cleanup error for one workspace doesn't prevent
     * other workspaces from being cleaned up. Each cleanup is independent.
     * This is critical for reliability — a single corrupted workspace
     * shouldn't block all cleanups.
     */
    it("should continue cleaning after one workspace fails", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: cleanupJob },
        terminalTasks: [
          createExpiredTask({ taskId: "task-ok-1" }),
          createExpiredTask({ taskId: "task-error" }),
          createExpiredTask({ taskId: "task-ok-2" }),
        ],
        cleanupErrors: new Set(["task-error"]),
      });
      const service = createWorkspaceReconciliationService(deps);

      const result = await service.processReconciliation();

      expect(result.processed).toBe(true);
      if (result.processed) {
        const actions = result.summary.expiredWorkspaceActions;
        expect(actions).toHaveLength(3);
        expect(actions[0]!.outcome).toBe("cleaned");
        expect(actions[1]!.outcome).toBe("error");
        expect(actions[1]!.reason).toContain("Cleanup failed for task-error");
        expect(actions[2]!.outcome).toBe("cleaned");
      }

      // Two successful cleanups despite one failure
      expect(calls.cleanupWorkspace).toHaveLength(3);
    });

    /**
     * Validates that the reconciliation still completes and reschedules
     * even when all workspace cleanups fail. The next cycle may succeed
     * after transient issues resolve.
     */
    it("should complete and reschedule even when all cleanups fail", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: cleanupJob },
        terminalTasks: [
          createExpiredTask({ taskId: "task-err-1" }),
          createExpiredTask({ taskId: "task-err-2" }),
        ],
        cleanupErrors: new Set(["task-err-1", "task-err-2"]),
      });
      const service = createWorkspaceReconciliationService(deps);

      const result = await service.processReconciliation();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.expiredWorkspaceActions.every((a) => a.outcome === "error")).toBe(
          true,
        );
        expect(result.nextCleanupJobId).toBeDefined();
      }

      // Job was completed and next was created
      expect(calls.completeJob).toHaveLength(1);
      expect(calls.createJob.some((c) => c.runAfter != null)).toBe(true);
    });
  });

  // ─── Orphaned workspace detection ───────────────────────────────────

  describe("processReconciliation() — orphaned workspaces", () => {
    /**
     * Validates that workspace directories on disk that don't match any
     * known task are detected as orphaned and cleaned up. Orphaned
     * directories waste disk space and should be removed.
     */
    it("should clean up orphaned workspace directories", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps } = createMockDeps({
        claimResult: { job: cleanupJob },
        terminalTasks: [createExpiredTask({ taskId: "task-known" })],
        workspaceDirectories: [
          { taskId: "task-known", absolutePath: "/workspaces/repo/task-known" },
          { taskId: "task-orphan", absolutePath: "/workspaces/repo/task-orphan" },
        ],
      });
      const service = createWorkspaceReconciliationService(deps);

      const result = await service.processReconciliation();

      expect(result.processed).toBe(true);
      if (result.processed) {
        // task-known was cleaned via expired workspace path (it's past retention)
        // task-orphan was cleaned via orphan detection
        const orphanActions = result.summary.orphanedWorkspaceActions;
        expect(orphanActions).toHaveLength(1);
        expect(orphanActions[0]!.taskId).toBe("task-orphan");
        expect(orphanActions[0]!.outcome).toBe("cleaned");
      }
    });

    /**
     * Validates that workspace directories matching known tasks are NOT
     * treated as orphans. Known tasks are handled by the expired workspace
     * path (with eligibility checks).
     */
    it("should not treat known task directories as orphans", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps } = createMockDeps({
        claimResult: { job: cleanupJob },
        terminalTasks: [
          createExpiredTask({ taskId: "task-1" }),
          createExpiredTask({ taskId: "task-2" }),
        ],
        workspaceDirectories: [
          { taskId: "task-1", absolutePath: "/workspaces/repo/task-1" },
          { taskId: "task-2", absolutePath: "/workspaces/repo/task-2" },
        ],
      });
      const service = createWorkspaceReconciliationService(deps);

      const result = await service.processReconciliation();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.orphanedWorkspaceActions).toHaveLength(0);
      }
    });

    /**
     * Validates that multiple orphaned directories are all cleaned up.
     */
    it("should clean up multiple orphaned directories", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: cleanupJob },
        terminalTasks: [],
        workspaceDirectories: [
          { taskId: "orphan-1", absolutePath: "/workspaces/repo/orphan-1" },
          { taskId: "orphan-2", absolutePath: "/workspaces/repo/orphan-2" },
          { taskId: "orphan-3", absolutePath: "/workspaces/repo/orphan-3" },
        ],
      });
      const service = createWorkspaceReconciliationService(deps);

      const result = await service.processReconciliation();

      expect(result.processed).toBe(true);
      if (result.processed) {
        const orphanActions = result.summary.orphanedWorkspaceActions;
        expect(orphanActions).toHaveLength(3);
        expect(orphanActions.every((a) => a.outcome === "cleaned")).toBe(true);
      }
      // 3 orphan cleanups (no expired since no terminal tasks)
      expect(calls.cleanupWorkspace).toHaveLength(3);
    });

    /**
     * Validates error isolation for orphaned workspace cleanup.
     * One orphan failing shouldn't prevent others from being cleaned.
     */
    it("should continue cleaning orphans after one fails", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps } = createMockDeps({
        claimResult: { job: cleanupJob },
        terminalTasks: [],
        workspaceDirectories: [
          { taskId: "orphan-ok", absolutePath: "/workspaces/repo/orphan-ok" },
          { taskId: "orphan-err", absolutePath: "/workspaces/repo/orphan-err" },
        ],
        cleanupErrors: new Set(["orphan-err"]),
      });
      const service = createWorkspaceReconciliationService(deps);

      const result = await service.processReconciliation();

      expect(result.processed).toBe(true);
      if (result.processed) {
        const orphanActions = result.summary.orphanedWorkspaceActions;
        expect(orphanActions).toHaveLength(2);
        expect(orphanActions[0]!.outcome).toBe("cleaned");
        expect(orphanActions[1]!.outcome).toBe("error");
        expect(orphanActions[1]!.error).toContain("Cleanup failed for orphan-err");
      }
    });

    /**
     * Validates that if the workspace directory scanner itself fails,
     * the error is captured and the reconciliation still completes.
     * This can happen if the workspace root doesn't exist yet.
     */
    it("should handle scanner failure gracefully", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: cleanupJob },
        terminalTasks: [],
        scannerError: new Error("Directory not found: /workspaces"),
      });
      const service = createWorkspaceReconciliationService(deps);

      const result = await service.processReconciliation();

      expect(result.processed).toBe(true);
      if (result.processed) {
        const orphanActions = result.summary.orphanedWorkspaceActions;
        expect(orphanActions).toHaveLength(1);
        expect(orphanActions[0]!.outcome).toBe("error");
        expect(orphanActions[0]!.error).toContain("Scanner failed");
        expect(orphanActions[0]!.error).toContain("Directory not found");
        // Job still completed and rescheduled
        expect(result.nextCleanupJobId).toBeDefined();
      }
      expect(calls.completeJob).toHaveLength(1);
    });
  });

  // ─── Combined scenarios ─────────────────────────────────────────────

  describe("processReconciliation() — combined expired + orphaned", () => {
    /**
     * Validates that both expired and orphaned workspaces are processed
     * in a single reconciliation cycle. This is the typical production
     * scenario — a mix of eligible, ineligible, and orphaned workspaces.
     */
    it("should process both expired and orphaned workspaces", async () => {
      const cleanupJob = createMockJob({ jobId: "cleanup-1", status: JobStatus.CLAIMED });
      const { deps, calls } = createMockDeps({
        claimResult: { job: cleanupJob },
        terminalTasks: [
          createExpiredTask({
            taskId: "task-expired",
            terminalStateAt: EXPIRED_TIMESTAMP,
          }),
          createExpiredTask({
            taskId: "task-recent",
            terminalStateAt: RECENT_TIMESTAMP,
          }),
        ],
        workspaceDirectories: [
          { taskId: "task-expired", absolutePath: "/workspaces/repo/task-expired" },
          { taskId: "task-recent", absolutePath: "/workspaces/repo/task-recent" },
          { taskId: "task-orphan", absolutePath: "/workspaces/repo/task-orphan" },
        ],
      });
      const service = createWorkspaceReconciliationService(deps);

      const result = await service.processReconciliation();

      expect(result.processed).toBe(true);
      if (result.processed) {
        // Expired: 1 cleaned, 1 skipped (recent)
        expect(result.summary.expiredWorkspaceActions).toHaveLength(2);
        const expired = result.summary.expiredWorkspaceActions;
        expect(expired.find((a) => a.taskId === "task-expired")!.outcome).toBe("cleaned");
        expect(expired.find((a) => a.taskId === "task-recent")!.outcome).toBe("skipped");

        // Orphaned: 1 cleaned (task-orphan not in known tasks)
        expect(result.summary.orphanedWorkspaceActions).toHaveLength(1);
        expect(result.summary.orphanedWorkspaceActions[0]!.taskId).toBe("task-orphan");
        expect(result.summary.orphanedWorkspaceActions[0]!.outcome).toBe("cleaned");
      }

      // 1 expired + 1 orphan = 2 actual cleanups
      expect(calls.cleanupWorkspace).toHaveLength(2);
    });
  });

  // ─── Default constants ──────────────────────────────────────────────

  describe("default constants", () => {
    /**
     * Validates that the default reconciliation interval is 1 hour.
     * This is the recommended frequency for workspace cleanup to balance
     * disk space management against unnecessary I/O.
     */
    it("should have a 1-hour default interval", () => {
      expect(DEFAULT_RECONCILIATION_INTERVAL_MS).toBe(60 * 60_000);
    });

    /**
     * Validates the default lease owner identity.
     */
    it("should have correct default lease owner", () => {
      expect(DEFAULT_RECONCILIATION_LEASE_OWNER).toBe("workspace-reconciliation");
    });

    /**
     * Validates the default retention policy matches PRD §2.9 recommendations.
     */
    it("should have correct default retention policy", () => {
      expect(DEFAULT_WORKSPACE_RETENTION_POLICY).toEqual({
        workspace_retention_hours: 24,
        retain_failed_workspaces: true,
        retain_escalated_workspaces: true,
      });
    });
  });
});
