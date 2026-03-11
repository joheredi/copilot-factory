/**
 * Fake implementation of {@link WorkspaceProviderPort} for testing.
 *
 * Provides deterministic workspace creation with in-memory tracking,
 * configurable error injection, and cleanup support.
 *
 * @module @factory/testing/fakes/fake-workspace-manager
 */

import type { WorkspaceProviderPort, SupervisorWorkspaceResult } from "@factory/application";

/**
 * Configuration options for {@link FakeWorkspaceManager}.
 */
export interface FakeWorkspaceManagerConfig {
  /** Base path prefix for generated workspace paths. Default: "/fake-workspaces" */
  readonly basePath?: string;
  /** If set, createWorkspace will throw this error. */
  readonly createError?: Error;
  /** If set, cleanupWorkspace will throw this error. */
  readonly cleanupError?: Error;
}

/**
 * Record of a workspace created by {@link FakeWorkspaceManager}.
 */
export interface TrackedWorkspace {
  readonly taskId: string;
  readonly repoPath: string;
  readonly attempt: number | undefined;
  readonly result: SupervisorWorkspaceResult;
  readonly createdAt: number;
}

/**
 * In-memory fake of the workspace provider for deterministic testing.
 *
 * All workspace paths are derived from the taskId, repoPath, and basePath
 * so tests can assert on exact values without filesystem access.
 *
 * @example
 * ```ts
 * const mgr = new FakeWorkspaceManager();
 * const ws = await mgr.createWorkspace("task-1", "/repo");
 * expect(ws.layout.rootPath).toBe("/fake-workspaces/task-1");
 * ```
 */
export class FakeWorkspaceManager implements WorkspaceProviderPort {
  /** All workspaces created via {@link createWorkspace}. */
  readonly createdWorkspaces: TrackedWorkspace[] = [];

  /** Task IDs passed to {@link cleanupWorkspace}. */
  readonly cleanedWorkspaces: string[] = [];

  private readonly basePath: string;
  private readonly createError: Error | undefined;
  private readonly cleanupError: Error | undefined;

  /** Create a new FakeWorkspaceManager with optional configuration. */
  constructor(config: FakeWorkspaceManagerConfig = {}) {
    this.basePath = config.basePath ?? "/fake-workspaces";
    this.createError = config.createError;
    this.cleanupError = config.cleanupError;
  }

  /**
   * Create a deterministic workspace for a task.
   *
   * The workspace layout paths are derived from the basePath and taskId.
   * The branch name encodes the taskId and optional attempt number.
   * The workspace is never reported as reused.
   *
   * @param taskId - The task to create a workspace for.
   * @param repoPath - Absolute path to the source repository.
   * @param attempt - Retry attempt number (undefined for first attempt).
   * @returns Workspace result with deterministic layout and branch info.
   * @throws The configured {@link FakeWorkspaceManagerConfig.createError} if set.
   */
  async createWorkspace(
    taskId: string,
    repoPath: string,
    attempt?: number,
  ): Promise<SupervisorWorkspaceResult> {
    if (this.createError) {
      throw this.createError;
    }

    const rootPath = `${this.basePath}/${taskId}`;
    const branchName =
      attempt !== undefined ? `factory/${taskId}/r${String(attempt)}` : `factory/${taskId}`;

    const result: SupervisorWorkspaceResult = {
      layout: {
        rootPath,
        worktreePath: `${rootPath}/worktree`,
        logsPath: `${rootPath}/logs`,
        outputsPath: `${rootPath}/outputs`,
      },
      branchName,
      reused: false,
    };

    this.createdWorkspaces.push({
      taskId,
      repoPath,
      attempt,
      result,
      createdAt: Date.now(),
    });

    return result;
  }

  /**
   * Record a workspace cleanup for a task.
   *
   * @param taskId - The task whose workspace should be cleaned up.
   * @throws The configured {@link FakeWorkspaceManagerConfig.cleanupError} if set.
   */
  async cleanupWorkspace(taskId: string): Promise<void> {
    if (this.cleanupError) {
      throw this.cleanupError;
    }
    this.cleanedWorkspaces.push(taskId);
  }

  /**
   * Reset all tracked state (created and cleaned workspaces).
   * Useful between test cases.
   */
  reset(): void {
    this.createdWorkspaces.length = 0;
    this.cleanedWorkspaces.length = 0;
  }
}
