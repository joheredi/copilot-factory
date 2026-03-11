/**
 * @module workspace/errors
 * Error classes for workspace management operations.
 * Each error captures relevant context for diagnostics and error handling.
 */

// ─── Git Operation Error ───────────────────────────────────────────────────────

/**
 * Thrown when a git CLI command fails during workspace management.
 * Captures the full command, exit code, and stderr for diagnostics.
 */
export class GitOperationError extends Error {
  /** The git command that failed (e.g., "git worktree add ..."). */
  readonly command: string;
  /** The process exit code, or null if unavailable. */
  readonly exitCode: number | null;
  /** Standard error output from the git process. */
  readonly stderr: string;

  constructor(command: string, exitCode: number | null, stderr: string) {
    super(`Git operation failed: ${command}\nExit code: ${exitCode}\n${stderr}`);
    this.name = "GitOperationError";
    this.command = command;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

// ─── Workspace Branch Exists Error ─────────────────────────────────────────────

/**
 * Thrown when the target branch for a new workspace already exists.
 * Indicates the workspace was previously created and not cleaned up,
 * or the task was already attempted without proper retry numbering.
 */
export class WorkspaceBranchExistsError extends Error {
  /** The branch name that already exists. */
  readonly branchName: string;
  /** The task ID the workspace was being created for. */
  readonly taskId: string;

  constructor(branchName: string, taskId: string) {
    super(
      `Branch "${branchName}" already exists for task "${taskId}". ` +
        `Use an attempt number to create a retry branch, or clean up the existing workspace.`,
    );
    this.name = "WorkspaceBranchExistsError";
    this.branchName = branchName;
    this.taskId = taskId;
  }
}

// ─── Workspace Dirty Error ─────────────────────────────────────────────────────

/**
 * Thrown when an existing workspace has uncommitted changes and cannot be
 * reused for a retry attempt. The caller must clean or remove the workspace
 * before retrying.
 */
export class WorkspaceDirtyError extends Error {
  /** The filesystem path to the dirty worktree. */
  readonly worktreePath: string;
  /** The task ID the workspace belongs to. */
  readonly taskId: string;

  constructor(worktreePath: string, taskId: string) {
    super(
      `Workspace at "${worktreePath}" for task "${taskId}" has uncommitted changes ` +
        `and cannot be reused. Clean or remove the workspace before retrying.`,
    );
    this.name = "WorkspaceDirtyError";
    this.worktreePath = worktreePath;
    this.taskId = taskId;
  }
}
