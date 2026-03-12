/**
 * Workspace reconciliation port interfaces.
 *
 * These interfaces define the data-access contracts that the workspace
 * reconciliation service requires to discover expired and orphaned workspaces.
 *
 * The workspace reconciliation service needs to:
 * - Query tasks in terminal states whose workspaces have outlived the retention period
 * - Scan workspace directories for orphaned entries not matching any known task
 *
 * @see docs/prd/007-technical-architecture.md §7.10 — Workspace Strategy
 * @see docs/prd/002-data-model.md §2.9 — Workspace Retention Rules
 * @module @factory/application/ports/workspace-reconciliation.ports
 */

import type { JobType, TaskStatus } from "@factory/domain";

// ---------------------------------------------------------------------------
// Entity shapes — minimal fields the workspace reconciliation reads
// ---------------------------------------------------------------------------

/**
 * A task record with workspace information for cleanup evaluation.
 *
 * Contains the minimum fields needed to evaluate workspace cleanup
 * eligibility via {@link isWorkspaceCleanupEligible} and perform
 * the actual cleanup via {@link WorkspaceProviderPort.cleanupWorkspace}.
 */
export interface ExpiredWorkspaceRecord {
  /** The task identifier. */
  readonly taskId: string;
  /** The project/repository identifier associated with this task. */
  readonly projectId: string;
  /** The absolute path to the source repository. */
  readonly repoPath: string;
  /** Current task status (expected to be a terminal state). */
  readonly status: TaskStatus;
  /** When the task entered its current terminal state. */
  readonly terminalStateAt: Date;
}

/**
 * An entry representing a workspace directory found on disk.
 *
 * Used during orphan detection — the scanner reports all directories
 * it finds, and the service determines which ones are orphaned by
 * cross-referencing with known tasks.
 */
export interface WorkspaceDirectoryEntry {
  /** The task ID extracted from the directory name/path. */
  readonly taskId: string;
  /** The absolute path to the workspace directory. */
  readonly absolutePath: string;
}

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

/**
 * Port for querying tasks with expired workspaces.
 *
 * Finds tasks in terminal states (DONE, FAILED, CANCELLED) that have
 * an associated workspace. The caller uses the retention policy and
 * {@link isWorkspaceCleanupEligible} to determine actual eligibility.
 */
export interface ExpiredWorkspaceQueryPort {
  /**
   * Find tasks in terminal states that may have expired workspaces.
   *
   * Returns tasks in DONE, FAILED, or CANCELLED status whose
   * `completed_at` timestamp is set (indicating they reached a terminal
   * state). The caller is responsible for applying retention policy
   * filtering.
   *
   * @returns All task records in terminal states with workspace info
   */
  findTasksInTerminalStates(): readonly ExpiredWorkspaceRecord[];
}

// ---------------------------------------------------------------------------
// Scanner port
// ---------------------------------------------------------------------------

/**
 * Port for scanning workspace directories on disk.
 *
 * The workspace reconciliation uses this to discover orphaned directories
 * that exist on disk but don't correspond to any known task. This can
 * happen when a cleanup fails midway or a process crashes.
 */
export interface WorkspaceDirectoryScannerPort {
  /**
   * List all workspace directories under the configured workspace root.
   *
   * Scans the `{workspacesRoot}/{repoId}/{taskId}/` directory structure
   * and returns an entry for each task-level directory found.
   *
   * @returns All workspace directory entries found on disk
   */
  listWorkspaceDirectories(): Promise<readonly WorkspaceDirectoryEntry[]>;
}

// ---------------------------------------------------------------------------
// Job query port (reused from reconciliation sweep pattern)
// ---------------------------------------------------------------------------

/**
 * Port for querying job counts by type.
 *
 * Used during initialization to check for existing non-terminal cleanup
 * jobs, preventing duplicate job accumulation after restarts.
 */
export interface CleanupJobQueryPort {
  /**
   * Count jobs of the given type that are not in a terminal status.
   *
   * @param jobType - The job type to count
   * @returns Number of non-terminal jobs of this type
   */
  countNonTerminalByType(jobType: JobType): number;
}

// ---------------------------------------------------------------------------
// Transaction boundary
// ---------------------------------------------------------------------------

/**
 * Repository ports available inside a workspace reconciliation transaction.
 */
export interface WorkspaceReconciliationTransactionRepositories {
  readonly task: ExpiredWorkspaceQueryPort;
  readonly job: CleanupJobQueryPort;
}

/**
 * Unit of work for workspace reconciliation read operations.
 *
 * The reconciliation primarily performs read queries to discover expired
 * workspaces, then delegates cleanup to the workspace provider port
 * which has its own error handling.
 */
export interface WorkspaceReconciliationUnitOfWork {
  runInTransaction<T>(fn: (repos: WorkspaceReconciliationTransactionRepositories) => T): T;
}
