/**
 * Workspace reconciliation service — periodically cleans up expired and
 * orphaned workspaces as a self-rescheduling background job.
 *
 * The workspace reconciliation is responsible for automated disk space
 * management. It runs periodically (default: every hour) and performs
 * two classes of cleanup:
 *
 * 1. **Expired workspaces** — Tasks in terminal states (DONE, FAILED,
 *    CANCELLED) whose workspace retention period has elapsed. Eligibility
 *    is determined by {@link isWorkspaceCleanupEligible} from `@factory/domain`,
 *    and cleanup is performed via the {@link WorkspaceProviderPort}.
 *
 * 2. **Orphaned workspaces** — Directories under the workspace root that
 *    don't correspond to any known task. These can arise from crashes during
 *    cleanup or workspace creation failures.
 *
 * ## Self-rescheduling pattern
 *
 * Like the reconciliation sweep (T029) and scheduler tick (T028), the
 * workspace reconciliation uses the job queue itself for scheduling. After
 * processing, it creates the next CLEANUP job with
 * `runAfter = now + reconciliationIntervalMs`. This ensures persistence
 * across restarts and exactly-once execution.
 *
 * ## Idempotency
 *
 * All cleanup operations are idempotent. The workspace provider's
 * `cleanupWorkspace` method handles cases where resources are already
 * gone. Running two reconciliations concurrently is harmless.
 *
 * ## Error isolation
 *
 * Each workspace cleanup is wrapped independently. A failure cleaning
 * one workspace does not prevent others from being processed. All errors
 * are captured in the reconciliation result for debugging.
 *
 * @see docs/prd/007-technical-architecture.md §7.10 — Workspace Strategy
 * @see docs/prd/002-data-model.md §2.9 — Workspace Retention Rules
 * @see docs/backlog/tasks/T042-reconcile-workspaces-command.md
 * @module @factory/application/services/workspace-reconciliation.service
 */

import { JobType, isWorkspaceCleanupEligible } from "@factory/domain";
import type { WorkspaceRetentionPolicy } from "@factory/domain";

import type {
  WorkspaceReconciliationUnitOfWork,
  ExpiredWorkspaceRecord,
  WorkspaceDirectoryScannerPort,
  WorkspaceDirectoryEntry,
} from "../ports/workspace-reconciliation.ports.js";
import type { JobQueueService } from "./job-queue.service.js";
import type {
  WorkspaceProviderPort,
  SupervisorCleanupResult,
} from "../ports/worker-supervisor.ports.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default interval between workspace reconciliation runs in milliseconds.
 * The reconciliation creates the next job with
 * `runAfter = now + DEFAULT_RECONCILIATION_INTERVAL_MS`.
 *
 * Default: 1 hour (3,600,000 ms). Workspace cleanup is not as
 * time-sensitive as the reconciliation sweep, so a longer interval
 * reduces unnecessary I/O.
 */
export const DEFAULT_RECONCILIATION_INTERVAL_MS = 60 * 60_000;

/**
 * Default lease owner identity for the workspace reconciliation processor.
 * Used when claiming CLEANUP jobs from the queue.
 */
export const DEFAULT_RECONCILIATION_LEASE_OWNER = "workspace-reconciliation";

/**
 * Default workspace retention policy.
 *
 * - 24 hours retention after terminal state
 * - Retain FAILED workspaces (useful for debugging)
 * - Retain ESCALATED workspaces (need operator review)
 */
export const DEFAULT_WORKSPACE_RETENTION_POLICY: WorkspaceRetentionPolicy = {
  workspace_retention_hours: 24,
  retain_failed_workspaces: true,
  retain_escalated_workspaces: true,
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the workspace reconciliation service.
 *
 * All fields are optional and fall back to sensible defaults.
 */
export interface WorkspaceReconciliationConfig {
  /**
   * Interval between workspace reconciliation runs in milliseconds.
   * @default 3600000 (1 hour)
   */
  readonly reconciliationIntervalMs?: number;

  /**
   * Identity string used as the lease owner when claiming cleanup jobs.
   * @default "workspace-reconciliation"
   */
  readonly leaseOwner?: string;

  /**
   * Workspace retention policy governing cleanup eligibility.
   * @default { workspace_retention_hours: 24, retain_failed_workspaces: true, retain_escalated_workspaces: true }
   */
  readonly retentionPolicy?: WorkspaceRetentionPolicy;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * Result of the `initialize()` call.
 */
export interface InitializeReconciliationResult {
  /** Whether a new cleanup job was created. */
  readonly created: boolean;
  /** ID of the cleanup job (newly created or existing). */
  readonly jobId?: string;
}

/**
 * An action taken for an expired workspace cleanup.
 */
export interface ExpiredWorkspaceCleanupAction {
  /** The task whose workspace was cleaned up. */
  readonly taskId: string;
  /** The project/repository associated with the task. */
  readonly projectId: string;
  /** Outcome of the cleanup attempt. */
  readonly outcome: "cleaned" | "skipped" | "error";
  /** Reason for skipping (from eligibility check) or error message. */
  readonly reason?: string;
  /** Cleanup details when outcome is "cleaned". */
  readonly cleanupResult?: SupervisorCleanupResult;
}

/**
 * An action taken for an orphaned workspace directory.
 */
export interface OrphanedWorkspaceCleanupAction {
  /** The task ID extracted from the directory. */
  readonly taskId: string;
  /** The absolute path of the orphaned directory. */
  readonly absolutePath: string;
  /** Outcome of the cleanup attempt. */
  readonly outcome: "cleaned" | "error";
  /** Error message when outcome is "error". */
  readonly error?: string;
  /** Cleanup details when outcome is "cleaned". */
  readonly cleanupResult?: SupervisorCleanupResult;
}

/**
 * Summary of all actions taken during a single workspace reconciliation.
 */
export interface WorkspaceReconciliationSummary {
  /** Actions taken for tasks with expired workspaces. */
  readonly expiredWorkspaceActions: readonly ExpiredWorkspaceCleanupAction[];
  /** Actions taken for orphaned workspace directories. */
  readonly orphanedWorkspaceActions: readonly OrphanedWorkspaceCleanupAction[];
}

/**
 * Result when a reconciliation was successfully processed.
 */
export interface ReconciliationProcessedResult {
  readonly processed: true;
  /** ID of the cleanup job that was processed. */
  readonly cleanupJobId: string;
  /** Summary of all cleanup actions. */
  readonly summary: WorkspaceReconciliationSummary;
  /** ID of the next cleanup job created for the following interval. */
  readonly nextCleanupJobId: string;
}

/**
 * Result when no cleanup job was available to process.
 */
export interface ReconciliationSkippedResult {
  readonly processed: false;
  /** Why the reconciliation was skipped. */
  readonly reason: "no_cleanup_job";
}

/**
 * Union result type for the `processReconciliation()` operation.
 */
export type ProcessReconciliationResult =
  | ReconciliationProcessedResult
  | ReconciliationSkippedResult;

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * The workspace reconciliation service manages the recurring CLEANUP
 * job lifecycle: initialization, processing, and self-rescheduling.
 *
 * @see docs/prd/007-technical-architecture.md §7.10 — Workspace Strategy
 */
export interface WorkspaceReconciliationService {
  /**
   * Seed the first CLEANUP job if one does not already exist.
   *
   * Call this once during application startup. It checks for existing
   * non-terminal cleanup jobs to avoid accumulating duplicates after restarts.
   */
  initialize(): InitializeReconciliationResult;

  /**
   * Claim and process a single workspace reconciliation cycle.
   *
   * Attempts to claim the oldest eligible CLEANUP job. If one is
   * available, scans for expired and orphaned workspaces, cleans them
   * up, completes the cleanup job, and creates the next cleanup job
   * with the configured delay.
   *
   * If no cleanup job is available, returns immediately with
   * `{ processed: false, reason: "no_cleanup_job" }`.
   */
  processReconciliation(): Promise<ProcessReconciliationResult>;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies required by the workspace reconciliation service factory.
 */
export interface WorkspaceReconciliationDependencies {
  /** Unit of work for reconciliation-specific read queries. */
  readonly unitOfWork: WorkspaceReconciliationUnitOfWork;
  /** Job queue service for creating, claiming, and completing jobs. */
  readonly jobQueueService: JobQueueService;
  /** Workspace provider for performing the actual cleanup. */
  readonly workspaceProvider: WorkspaceProviderPort;
  /** Scanner for discovering workspace directories on disk. */
  readonly workspaceScanner: WorkspaceDirectoryScannerPort;
  /** Returns the current time. Injected for testability. */
  readonly clock: () => Date;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Clean up expired workspaces for tasks in terminal states.
 *
 * For each task in a terminal state, evaluates workspace cleanup
 * eligibility using the domain policy, then invokes workspace cleanup
 * for eligible tasks. Force-deletes branches for terminal tasks since
 * they may not have been merged.
 *
 * Each cleanup is independent — a failure on one workspace doesn't
 * prevent processing of others.
 *
 * @param tasks - Tasks in terminal states with workspace info
 * @param workspaceProvider - Port for performing workspace cleanup
 * @param retentionPolicy - Policy controlling cleanup eligibility
 * @param now - Current time for retention period comparison
 * @returns Array of actions taken for each task
 */
async function cleanupExpiredWorkspaces(
  tasks: readonly ExpiredWorkspaceRecord[],
  workspaceProvider: WorkspaceProviderPort,
  retentionPolicy: WorkspaceRetentionPolicy,
  now: Date,
): Promise<ExpiredWorkspaceCleanupAction[]> {
  const actions: ExpiredWorkspaceCleanupAction[] = [];

  for (const task of tasks) {
    try {
      const eligibility = isWorkspaceCleanupEligible({
        taskStatus: task.status,
        retentionPolicy,
        terminalStateAt: task.terminalStateAt,
        now,
      });

      if (!eligibility.eligible) {
        actions.push({
          taskId: task.taskId,
          projectId: task.projectId,
          outcome: "skipped",
          reason: eligibility.reason,
        });
        continue;
      }

      const cleanupResult = await workspaceProvider.cleanupWorkspace(task.taskId, task.repoPath, {
        deleteBranch: true,
        forceBranchDelete: true,
      });

      actions.push({
        taskId: task.taskId,
        projectId: task.projectId,
        outcome: "cleaned",
        cleanupResult,
      });
    } catch (error: unknown) {
      actions.push({
        taskId: task.taskId,
        projectId: task.projectId,
        outcome: "error",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return actions;
}

/**
 * Detect and clean up orphaned workspace directories.
 *
 * Scans all workspace directories on disk and cross-references them
 * against the set of known task IDs from the database. Directories
 * whose task ID doesn't match any known task are considered orphaned
 * and cleaned up.
 *
 * Each cleanup is independent — a failure on one directory doesn't
 * prevent processing of others.
 *
 * @param knownTaskIds - Set of task IDs with known database records
 * @param workspaceScanner - Port for listing workspace directories
 * @param workspaceProvider - Port for performing workspace cleanup
 * @param defaultRepoPath - Default repository path for orphaned cleanup
 * @returns Array of actions taken for each orphaned directory
 */
async function cleanupOrphanedWorkspaces(
  knownTaskIds: ReadonlySet<string>,
  workspaceScanner: WorkspaceDirectoryScannerPort,
  workspaceProvider: WorkspaceProviderPort,
): Promise<OrphanedWorkspaceCleanupAction[]> {
  const actions: OrphanedWorkspaceCleanupAction[] = [];

  let entries: readonly WorkspaceDirectoryEntry[];
  try {
    entries = await workspaceScanner.listWorkspaceDirectories();
  } catch (error: unknown) {
    // If the scanner itself fails (e.g., workspace root doesn't exist),
    // return a single error action and move on.
    actions.push({
      taskId: "unknown",
      absolutePath: "unknown",
      outcome: "error",
      error: `Scanner failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return actions;
  }

  for (const entry of entries) {
    if (knownTaskIds.has(entry.taskId)) {
      // This workspace belongs to a known task — skip it.
      // The expired workspace cleanup handles known tasks.
      continue;
    }

    try {
      // Orphaned directory: no matching task in the database.
      // Use the directory path to infer cleanup parameters.
      const cleanupResult = await workspaceProvider.cleanupWorkspace(
        entry.taskId,
        entry.absolutePath,
        {
          deleteBranch: true,
          forceBranchDelete: true,
        },
      );

      actions.push({
        taskId: entry.taskId,
        absolutePath: entry.absolutePath,
        outcome: "cleaned",
        cleanupResult,
      });
    } catch (error: unknown) {
      actions.push({
        taskId: entry.taskId,
        absolutePath: entry.absolutePath,
        outcome: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a WorkspaceReconciliationService instance with injected dependencies.
 *
 * The service orchestrates the interaction between the job queue (for
 * cleanup job lifecycle), the workspace provider (for actual workspace
 * removal), and the directory scanner (for orphan detection). It does
 * not own any state — all persistence is delegated to the composed
 * services and ports.
 *
 * @param deps - Service dependencies
 * @param config - Optional configuration overrides
 * @returns A WorkspaceReconciliationService instance
 *
 * @example
 * ```typescript
 * const reconciliationService = createWorkspaceReconciliationService(
 *   {
 *     unitOfWork,
 *     jobQueueService,
 *     workspaceProvider,
 *     workspaceScanner,
 *     clock: () => new Date(),
 *   },
 *   { reconciliationIntervalMs: 30 * 60_000 }, // 30-minute interval
 * );
 *
 * // On startup
 * reconciliationService.initialize();
 *
 * // In a polling loop or job processor
 * const result = await reconciliationService.processReconciliation();
 * ```
 */
export function createWorkspaceReconciliationService(
  deps: WorkspaceReconciliationDependencies,
  config?: WorkspaceReconciliationConfig,
): WorkspaceReconciliationService {
  const reconciliationIntervalMs =
    config?.reconciliationIntervalMs ?? DEFAULT_RECONCILIATION_INTERVAL_MS;
  const leaseOwner = config?.leaseOwner ?? DEFAULT_RECONCILIATION_LEASE_OWNER;
  const retentionPolicy = config?.retentionPolicy ?? DEFAULT_WORKSPACE_RETENTION_POLICY;

  return {
    initialize(): InitializeReconciliationResult {
      // Check if a non-terminal cleanup job already exists
      const existingCount = deps.unitOfWork.runInTransaction((repos) => {
        return repos.job.countNonTerminalByType(JobType.CLEANUP);
      });

      if (existingCount > 0) {
        return { created: false };
      }

      // Create the initial cleanup job — eligible for immediate claiming
      const { job } = deps.jobQueueService.createJob({
        jobType: JobType.CLEANUP,
      });

      return { created: true, jobId: job.jobId };
    },

    async processReconciliation(): Promise<ProcessReconciliationResult> {
      // Step 1: Attempt to claim a cleanup job
      const claimed = deps.jobQueueService.claimJob(JobType.CLEANUP, leaseOwner);

      if (!claimed) {
        return { processed: false, reason: "no_cleanup_job" };
      }

      const cleanupJobId = claimed.job.jobId;
      const now = deps.clock();

      // Step 2: Query tasks in terminal states
      const terminalTasks = deps.unitOfWork.runInTransaction((repos) => {
        return repos.task.findTasksInTerminalStates();
      });

      // Step 3: Clean up expired workspaces (error-isolated per task)
      const expiredWorkspaceActions = await cleanupExpiredWorkspaces(
        terminalTasks,
        deps.workspaceProvider,
        retentionPolicy,
        now,
      );

      // Step 4: Build set of known task IDs for orphan detection
      const knownTaskIds = new Set(terminalTasks.map((t) => t.taskId));

      // Step 5: Detect and clean up orphaned workspace directories
      const orphanedWorkspaceActions = await cleanupOrphanedWorkspaces(
        knownTaskIds,
        deps.workspaceScanner,
        deps.workspaceProvider,
      );

      const summary: WorkspaceReconciliationSummary = {
        expiredWorkspaceActions,
        orphanedWorkspaceActions,
      };

      // Step 6: Complete the cleanup job
      deps.jobQueueService.completeJob(cleanupJobId);

      // Step 7: Create the next cleanup job with a delay
      const nextRunAfter = new Date(now.getTime() + reconciliationIntervalMs);
      const { job: nextJob } = deps.jobQueueService.createJob({
        jobType: JobType.CLEANUP,
        runAfter: nextRunAfter,
      });

      return {
        processed: true,
        cleanupJobId,
        summary,
        nextCleanupJobId: nextJob.jobId,
      };
    },
  };
}
