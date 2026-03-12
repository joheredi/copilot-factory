/**
 * @module workspace/types
 * Types and interfaces for workspace management.
 * Defines the contracts for git operations, filesystem access, and workspace layout.
 *
 * @see docs/prd/007-technical-architecture.md §7.10 — Workspace Strategy
 * @see docs/prd/007-technical-architecture.md §7.6 — Workspace Module
 */

// ─── Workspace Layout ──────────────────────────────────────────────────────────

/**
 * Directory layout for a single task workspace.
 * Follows the structure defined in §7.10 of the technical architecture.
 *
 * ```text
 * {workspacesRoot}/{repoId}/{taskId}/
 *   worktree/     ← git worktree checkout
 *   logs/         ← execution logs
 *   outputs/      ← task outputs and artifacts
 * ```
 */
export interface WorkspaceLayout {
  /** Root directory: {workspacesRoot}/{repoId}/{taskId}/ */
  readonly rootPath: string;
  /** Git worktree checkout: {rootPath}/worktree/ */
  readonly worktreePath: string;
  /** Execution logs: {rootPath}/logs/ */
  readonly logsPath: string;
  /** Task outputs: {rootPath}/outputs/ */
  readonly outputsPath: string;
}

/**
 * Result of a workspace creation or reuse operation.
 */
export interface WorkspaceResult {
  /** The workspace directory layout with all paths. */
  readonly layout: WorkspaceLayout;
  /** The git branch name created or found in a reused worktree. */
  readonly branchName: string;
  /** Whether an existing workspace was reused instead of creating a new one. */
  readonly reused: boolean;
}

/**
 * Options for creating a task workspace.
 */
export interface CreateWorkspaceOptions {
  /** The task identifier. Used in branch naming and directory paths. */
  readonly taskId: string;
  /** Absolute path to the source git repository. */
  readonly repoPath: string;
  /**
   * Base branch to create the worktree from.
   * Defaults to the repository's current HEAD branch.
   */
  readonly baseBranch?: string;
  /**
   * Retry attempt number (1+). When set, the branch uses
   * `factory/{taskId}/r{attempt}` naming. When omitted or 0,
   * uses `factory/{taskId}`.
   */
  readonly attempt?: number;
  /**
   * Repository identifier for workspace path construction.
   * Defaults to the basename of repoPath.
   */
  readonly repoId?: string;
}

// ─── Git Worktree Info ─────────────────────────────────────────────────────────

/**
 * Parsed entry from `git worktree list --porcelain`.
 */
export interface WorktreeEntry {
  /** Absolute path to the worktree directory. */
  readonly path: string;
  /** HEAD commit SHA. */
  readonly head: string;
  /** Branch ref (e.g., "refs/heads/main") or null if detached. */
  readonly branch: string | null;
  /** Whether this is the bare/main worktree entry. */
  readonly bare: boolean;
}

// ─── Git Operations Interface ──────────────────────────────────────────────────

/**
 * Abstraction over git CLI operations used by the workspace manager.
 * Implementations execute actual git commands; test doubles can mock behavior.
 *
 * @see createExecGitOperations for the production implementation using execFile.
 */
export interface GitOperations {
  /**
   * Get the current HEAD branch of a repository.
   *
   * @param repoPath - Absolute path to the git repository.
   * @returns The current branch name (e.g., "main").
   * @throws {GitOperationError} If the repository is in detached HEAD state or not a git repo.
   */
  getDefaultBranch(repoPath: string): Promise<string>;

  /**
   * Add a new git worktree with a new branch.
   * Equivalent to: `git worktree add <path> -b <branch> <startPoint>`
   *
   * @param repoPath - Absolute path to the main repository.
   * @param worktreePath - Absolute path where the worktree will be created.
   * @param branchName - Name for the new branch to create.
   * @param startPoint - Commit, tag, or branch to base the new branch on.
   * @throws {GitOperationError} If the worktree cannot be created.
   */
  addWorktree(
    repoPath: string,
    worktreePath: string,
    branchName: string,
    startPoint: string,
  ): Promise<void>;

  /**
   * List all worktrees for a repository.
   *
   * @param repoPath - Absolute path to the git repository.
   * @returns Array of parsed worktree entries.
   */
  listWorktrees(repoPath: string): Promise<readonly WorktreeEntry[]>;

  /**
   * Check if a local branch exists in the repository.
   *
   * @param repoPath - Absolute path to the git repository.
   * @param branchName - Branch name to check (without refs/heads/ prefix).
   * @returns True if the branch exists locally.
   */
  branchExists(repoPath: string, branchName: string): Promise<boolean>;

  /**
   * Check if a worktree has a clean working tree (no uncommitted changes).
   *
   * @param worktreePath - Absolute path to the worktree directory.
   * @returns True if the working tree has no modified, staged, or untracked files.
   */
  isCleanWorkingTree(worktreePath: string): Promise<boolean>;

  /**
   * Get the current branch name of a worktree.
   *
   * @param worktreePath - Absolute path to the worktree directory.
   * @returns The short branch name (e.g., "factory/T001") or null if detached HEAD.
   */
  getCurrentBranch(worktreePath: string): Promise<string | null>;

  /**
   * Remove a git worktree.
   * Equivalent to: `git worktree remove <worktreePath> --force`
   *
   * Does not throw if the worktree has already been removed or the path
   * does not exist — this makes cleanup idempotent.
   *
   * @param repoPath - Absolute path to the main repository.
   * @param worktreePath - Absolute path to the worktree to remove.
   * @throws {GitOperationError} If the worktree cannot be removed for reasons other than non-existence.
   */
  removeWorktree(repoPath: string, worktreePath: string): Promise<void>;

  /**
   * Delete a local branch from the repository.
   *
   * Uses safe delete (`-d`) by default, which refuses to delete unmerged branches.
   * Set `force` to true to use force delete (`-D`) for terminal task branches
   * that may not have been merged.
   *
   * Does not throw if the branch does not exist — this makes cleanup idempotent.
   *
   * @param repoPath - Absolute path to the git repository.
   * @param branchName - Branch name to delete (without refs/heads/ prefix).
   * @param force - If true, use force delete (-D) to remove unmerged branches.
   * @throws {GitOperationError} If the branch cannot be deleted for reasons other than non-existence.
   */
  deleteBranch(repoPath: string, branchName: string, force?: boolean): Promise<void>;
}

// ─── File System Interface ─────────────────────────────────────────────────────

/**
 * Minimal filesystem abstraction for workspace directory operations.
 * Enables testing workspace logic without touching the real filesystem.
 *
 * @see createNodeFileSystem for the production implementation.
 */
export interface FileSystem {
  /**
   * Create a directory, optionally creating parent directories.
   *
   * @param path - Absolute directory path to create.
   * @param options - Options including recursive creation.
   */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;

  /**
   * Check if a path exists and is accessible.
   *
   * @param path - Absolute path to check.
   * @returns True if the path exists and is accessible.
   */
  exists(path: string): Promise<boolean>;

  /**
   * Write string content to a file, creating it if it doesn't exist.
   * Overwrites existing content.
   *
   * @param path - Absolute file path to write.
   * @param content - String content to write.
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * Read the full contents of a file as a UTF-8 string.
   *
   * @param path - Absolute file path to read.
   * @returns The file contents as a string.
   * @throws If the file does not exist or is not readable.
   */
  readFile(path: string): Promise<string>;

  /**
   * Remove a file. Does not throw if the file does not exist.
   *
   * @param path - Absolute file path to remove.
   */
  unlink(path: string): Promise<void>;

  /**
   * Atomically rename a file from oldPath to newPath.
   * On POSIX systems this is an atomic operation on the same filesystem.
   * Used for crash-safe writes: write to a temp file, then rename into place.
   *
   * @param oldPath - Absolute path of the existing file.
   * @param newPath - Absolute path for the renamed file.
   */
  rename(oldPath: string, newPath: string): Promise<void>;

  /**
   * Read the entries of a directory.
   *
   * Each entry includes the name and whether it is a file or directory.
   * Returns an empty array if the directory does not exist.
   *
   * @param path - Absolute directory path to read.
   * @returns Array of directory entries with name and type.
   */
  readdir(path: string): Promise<Array<{ name: string; isDirectory: boolean }>>;

  /**
   * Remove a file or directory. Does not throw if the path does not exist.
   *
   * @param path - Absolute path to remove.
   * @param options - Options: `recursive` for directories, `force` to ignore non-existence.
   */
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

// ─── Cleanup Types ─────────────────────────────────────────────────────────────

/**
 * Options for cleaning up a task workspace.
 *
 * Cleanup removes the git worktree, workspace directory tree, and optionally
 * the task branch. The caller is responsible for checking retention policy
 * and task state eligibility before invoking cleanup.
 *
 * @see docs/prd/007-technical-architecture.md §7.10 — Workspace Strategy
 */
export interface CleanupWorkspaceOptions {
  /** The task identifier whose workspace should be cleaned up. */
  readonly taskId: string;
  /** Absolute path to the source git repository. */
  readonly repoPath: string;
  /**
   * Repository identifier for workspace path construction.
   * Defaults to the basename of repoPath.
   */
  readonly repoId?: string;
  /**
   * Whether to delete the task branch after removing the worktree.
   * Defaults to true.
   */
  readonly deleteBranch?: boolean;
  /**
   * Whether to force-delete the branch even if it is not fully merged.
   * Use true for terminal task states (FAILED, CANCELLED) where the branch
   * was never merged. Defaults to false (safe delete).
   */
  readonly forceBranchDelete?: boolean;
}

/**
 * Result of a workspace cleanup operation.
 * Each boolean indicates whether that specific cleanup step was performed.
 * A step may be skipped if the resource was already gone (idempotent cleanup).
 */
export interface CleanupWorkspaceResult {
  /** Whether a git worktree was removed (false if already gone). */
  readonly worktreeRemoved: boolean;
  /** Whether the workspace directory tree was removed (false if already gone). */
  readonly directoryRemoved: boolean;
  /** Whether the task branch was deleted (false if skipped, already gone, or deleteBranch=false). */
  readonly branchDeleted: boolean;
}
