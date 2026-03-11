/**
 * @module workspace
 * Workspace management module — provisions isolated git worktrees per task.
 *
 * Provides workspace creation, branch management, and directory structure
 * following the layout defined in §7.10 of the technical architecture.
 *
 * @see docs/prd/007-technical-architecture.md §7.10 — Workspace Strategy
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type {
  WorkspaceLayout,
  WorkspaceResult,
  CreateWorkspaceOptions,
  WorktreeEntry,
  GitOperations,
  FileSystem,
} from "./types.js";

// ─── Errors ────────────────────────────────────────────────────────────────────

export { GitOperationError, WorkspaceBranchExistsError, WorkspaceDirtyError } from "./errors.js";

// ─── Workspace Manager ────────────────────────────────────────────────────────

export { WorkspaceManager } from "./workspace-manager.js";

// ─── Git Operations ────────────────────────────────────────────────────────────

export { createExecGitOperations, parseWorktreeListOutput } from "./exec-git-operations.js";

// ─── File System ───────────────────────────────────────────────────────────────

export { createNodeFileSystem } from "./node-fs.js";
