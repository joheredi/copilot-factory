/**
 * @module workspace/workspace-manager
 * Orchestrates workspace provisioning using git worktrees.
 * Creates isolated workspaces per task following the directory structure from §7.10.
 *
 * Each task gets its own worktree with a dedicated branch, ensuring workers
 * cannot interfere with each other. Retry attempts can reuse clean workspaces
 * or create new branches with a `/r{attempt}` suffix.
 *
 * @see docs/prd/007-technical-architecture.md §7.10 — Workspace Strategy
 * @see docs/prd/007-technical-architecture.md §7.6 — Workspace Module
 */

import { join, basename } from "node:path";

import type {
  GitOperations,
  FileSystem,
  CreateWorkspaceOptions,
  WorkspaceLayout,
  WorkspaceResult,
} from "./types.js";
import { WorkspaceBranchExistsError, WorkspaceDirtyError } from "./errors.js";

// ─── Workspace Manager ────────────────────────────────────────────────────────

/**
 * Manages workspace provisioning using git worktrees.
 *
 * Responsibilities:
 * - Create isolated worktrees per task with deterministic branch naming
 * - Create the standard directory structure (worktree/, logs/, outputs/)
 * - Reuse existing clean workspaces on retry attempts
 * - Validate branch uniqueness before creation
 *
 * The workspace directory layout follows §7.10:
 * ```text
 * {workspacesRoot}/{repoId}/{taskId}/
 *   worktree/     ← git worktree checkout
 *   logs/         ← execution logs
 *   outputs/      ← task outputs
 * ```
 *
 * Branch naming convention:
 * - First attempt: `factory/{taskId}`
 * - Retry N: `factory/{taskId}/r{N}`
 */
export class WorkspaceManager {
  private readonly git: GitOperations;
  private readonly fs: FileSystem;
  private readonly workspacesRoot: string;

  /**
   * @param git - Git operations implementation for worktree management.
   * @param fs - Filesystem operations for directory creation and existence checks.
   * @param workspacesRoot - Root directory for all workspaces (e.g., "/workspaces").
   */
  constructor(git: GitOperations, fs: FileSystem, workspacesRoot: string) {
    this.git = git;
    this.fs = fs;
    this.workspacesRoot = workspacesRoot;
  }

  /**
   * Create or reuse a workspace for the given task.
   *
   * **First attempt** (no attempt number or attempt &lt; 1):
   * - Creates a new worktree with branch `factory/{taskId}`
   * - Throws {@link WorkspaceBranchExistsError} if the branch already exists
   *
   * **Retry attempt** (attempt &gt;= 1):
   * - Checks if an existing workspace can be reused (exists and has clean working tree)
   * - If reusable: returns the existing workspace with `reused: true`
   * - If dirty: throws {@link WorkspaceDirtyError}
   * - If not present: creates a new worktree with branch `factory/{taskId}/r{attempt}`
   *
   * In all cases, the `logs/` and `outputs/` subdirectories are created if they
   * don't already exist.
   *
   * @param options - Workspace creation options.
   * @returns The workspace result with layout, branch name, and reuse status.
   * @throws {WorkspaceBranchExistsError} If the target branch already exists.
   * @throws {WorkspaceDirtyError} If an existing workspace has uncommitted changes on retry.
   * @throws {GitOperationError} If a git command fails unexpectedly.
   */
  async createWorkspace(options: CreateWorkspaceOptions): Promise<WorkspaceResult> {
    const { taskId, repoPath, attempt } = options;
    const repoId = options.repoId ?? basename(repoPath);
    const baseBranch = options.baseBranch ?? (await this.git.getDefaultBranch(repoPath));

    const layout = this.computeLayout(repoId, taskId);
    const isRetry = attempt !== undefined && attempt >= 1;

    // For retries, check if existing workspace can be reused
    if (isRetry) {
      const reuseResult = await this.tryReuseWorkspace(layout, taskId);
      if (reuseResult !== null) {
        return reuseResult;
      }
    }

    // Compute branch name for new workspace
    const branchName = this.computeBranchName(taskId, attempt);

    // Verify branch doesn't already exist to produce a clear error
    const branchAlreadyExists = await this.git.branchExists(repoPath, branchName);
    if (branchAlreadyExists) {
      throw new WorkspaceBranchExistsError(branchName, taskId);
    }

    // Create workspace directory structure (logs/ and outputs/)
    // The worktree/ directory is created by `git worktree add`.
    await this.createDirectoryStructure(layout);

    // Create the git worktree with a new branch
    await this.git.addWorktree(repoPath, layout.worktreePath, branchName, baseBranch);

    return { layout, branchName, reused: false };
  }

  /**
   * Compute the branch name for a task workspace.
   *
   * @param taskId - The task identifier.
   * @param attempt - Optional retry attempt number (1+).
   * @returns Branch name: `factory/{taskId}` or `factory/{taskId}/r{attempt}`.
   */
  computeBranchName(taskId: string, attempt?: number): string {
    if (attempt !== undefined && attempt >= 1) {
      return `factory/${taskId}/r${attempt}`;
    }
    return `factory/${taskId}`;
  }

  /**
   * Compute the workspace directory layout for a task.
   *
   * @param repoId - Repository identifier for the workspace path.
   * @param taskId - Task identifier.
   * @returns The complete workspace layout with all directory paths.
   */
  computeLayout(repoId: string, taskId: string): WorkspaceLayout {
    const rootPath = join(this.workspacesRoot, repoId, taskId);
    return {
      rootPath,
      worktreePath: join(rootPath, "worktree"),
      logsPath: join(rootPath, "logs"),
      outputsPath: join(rootPath, "outputs"),
    };
  }

  /**
   * Attempt to reuse an existing workspace for a retry.
   *
   * Returns a {@link WorkspaceResult} with `reused: true` if the workspace
   * exists and has a clean working tree. Returns null if the worktree
   * directory does not exist.
   *
   * @param layout - The workspace layout to check.
   * @param taskId - The task ID (used in error messages).
   * @returns WorkspaceResult if reusable, null if worktree doesn't exist.
   * @throws {WorkspaceDirtyError} If the workspace exists but has uncommitted changes.
   */
  private async tryReuseWorkspace(
    layout: WorkspaceLayout,
    taskId: string,
  ): Promise<WorkspaceResult | null> {
    const worktreeExists = await this.fs.exists(layout.worktreePath);
    if (!worktreeExists) {
      return null;
    }

    const isClean = await this.git.isCleanWorkingTree(layout.worktreePath);
    if (!isClean) {
      throw new WorkspaceDirtyError(layout.worktreePath, taskId);
    }

    // Workspace exists and is clean — reuse it with whatever branch is checked out
    const currentBranch = await this.git.getCurrentBranch(layout.worktreePath);
    return {
      layout,
      branchName: currentBranch ?? "HEAD",
      reused: true,
    };
  }

  /**
   * Create the workspace directory structure.
   * Creates root, logs, and outputs directories. The worktree directory
   * is created by `git worktree add` and must not be pre-created.
   */
  private async createDirectoryStructure(layout: WorkspaceLayout): Promise<void> {
    await this.fs.mkdir(layout.rootPath, { recursive: true });
    await this.fs.mkdir(layout.logsPath, { recursive: true });
    await this.fs.mkdir(layout.outputsPath, { recursive: true });
  }
}
