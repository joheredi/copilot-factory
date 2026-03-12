/**
 * Port interfaces for the merge executor service.
 *
 * Defines the minimal contracts for git operations, validation, conflict
 * classification, artifact persistence, and data access required by the
 * merge executor. Each port is intentionally narrow — exposing only the
 * operations needed for merge execution across all supported strategies
 * (rebase-and-merge, squash, merge-commit).
 *
 * @see docs/prd/010-integration-contracts.md §10.10 — Merge Pipeline
 * @see docs/prd/002-data-model.md §2.2 MergeQueueItem State
 * @module @factory/application/ports/merge-executor.ports
 */

import type { TaskStatus, MergeQueueItemStatus } from "@factory/domain";
import type { AuditEventRepositoryPort } from "./repository.ports.js";
import type { ValidationRunResult } from "./validation-runner.ports.js";

// ---------------------------------------------------------------------------
// Entity shapes — minimal fields the merge executor reads/writes
// ---------------------------------------------------------------------------

/**
 * Minimal task record for merge executor transitions.
 * Includes status and version for optimistic concurrency.
 */
export interface MergeExecutorTask {
  readonly id: string;
  readonly status: TaskStatus;
  readonly version: number;
  readonly repositoryId: string;
}

/**
 * Merge queue item record for merge executor transitions.
 * Includes the approved commit SHA and branch context needed for rebase.
 */
export interface MergeExecutorItem {
  readonly mergeQueueItemId: string;
  readonly taskId: string;
  readonly repositoryId: string;
  readonly status: MergeQueueItemStatus;
  readonly approvedCommitSha: string | null;
}

// ---------------------------------------------------------------------------
// Git operations port
// ---------------------------------------------------------------------------

/**
 * Result of a git rebase operation.
 * When `success` is false, `conflictFiles` lists the files with conflicts.
 */
export interface RebaseResult {
  /** Whether the rebase completed without conflicts. */
  readonly success: boolean;
  /** Files with conflicts when rebase fails. Empty array on success. */
  readonly conflictFiles: readonly string[];
}

/**
 * Result of a merge operation (squash or merge-commit).
 * Structurally identical to RebaseResult — when `success` is false,
 * `conflictFiles` lists the files with conflicts.
 */
export interface MergeOperationResult {
  /** Whether the merge completed without conflicts. */
  readonly success: boolean;
  /** Files with conflicts when the merge fails. Empty array on success. */
  readonly conflictFiles: readonly string[];
}

/**
 * Port for git operations needed during merge execution.
 *
 * Implementations execute real git CLI commands; test doubles mock
 * the behavior for deterministic testing.
 *
 * All operations run against a workspace (worktree) path.
 */
export interface MergeGitOperationsPort {
  /**
   * Fetch the latest refs from a remote.
   * Equivalent to: `git fetch <remote>`
   *
   * @param workspacePath - Absolute path to the git worktree.
   * @param remote - Remote name (typically "origin").
   */
  fetch(workspacePath: string, remote: string): Promise<void>;

  /**
   * Rebase the current branch onto a target ref.
   * Equivalent to: `git rebase <onto>`
   *
   * If conflicts occur, the rebase is automatically aborted and the
   * conflicting files are reported.
   *
   * @param workspacePath - Absolute path to the git worktree.
   * @param onto - The ref to rebase onto (e.g., "origin/main").
   * @returns A RebaseResult indicating success or failure with conflict files.
   */
  rebase(workspacePath: string, onto: string): Promise<RebaseResult>;

  /**
   * Squash-merge a source branch into the current (target) branch.
   * Equivalent to: `git checkout <targetBranch> && git merge --squash <sourceBranch> && git commit -m <message>`
   *
   * The workspace must have the target branch checked out (or this method
   * checks it out). All source branch commits are squashed into a single
   * commit on the target branch.
   *
   * If conflicts occur, the merge is automatically aborted and the
   * conflicting files are reported.
   *
   * @param workspacePath - Absolute path to the git worktree.
   * @param sourceBranch - The branch whose changes are being squashed (e.g., "factory/task-001").
   * @param targetBranch - The branch to squash into (e.g., "origin/main").
   * @param commitMessage - The commit message for the squashed commit.
   * @returns A MergeOperationResult indicating success or failure with conflict files.
   */
  squashMerge(
    workspacePath: string,
    sourceBranch: string,
    targetBranch: string,
    commitMessage: string,
  ): Promise<MergeOperationResult>;

  /**
   * Merge a source branch into the current (target) branch with a merge commit.
   * Equivalent to: `git checkout <targetBranch> && git merge --no-ff <sourceBranch>`
   *
   * The workspace must have the target branch checked out (or this method
   * checks it out). A merge commit is created preserving the full branch
   * topology.
   *
   * If conflicts occur, the merge is automatically aborted and the
   * conflicting files are reported.
   *
   * @param workspacePath - Absolute path to the git worktree.
   * @param sourceBranch - The branch being merged (e.g., "factory/task-001").
   * @param targetBranch - The branch to merge into (e.g., "origin/main").
   * @returns A MergeOperationResult indicating success or failure with conflict files.
   */
  mergeCommit(
    workspacePath: string,
    sourceBranch: string,
    targetBranch: string,
  ): Promise<MergeOperationResult>;

  /**
   * Push the current branch to a remote.
   * Equivalent to: `git push <remote> <branch>`
   *
   * @param workspacePath - Absolute path to the git worktree.
   * @param remote - Remote name (typically "origin").
   * @param branch - Branch name to push.
   */
  push(workspacePath: string, remote: string, branch: string): Promise<void>;

  /**
   * Get the HEAD commit SHA of the workspace.
   * Equivalent to: `git rev-parse HEAD`
   *
   * @param workspacePath - Absolute path to the git worktree.
   * @returns The full 40-character commit SHA.
   */
  getHeadSha(workspacePath: string): Promise<string>;

  /**
   * Get the current branch name of the workspace.
   * Equivalent to: `git symbolic-ref --short HEAD`
   *
   * @param workspacePath - Absolute path to the git worktree.
   * @returns The short branch name.
   */
  getCurrentBranch(workspacePath: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Validation port
// ---------------------------------------------------------------------------

/**
 * Port for running merge-gate validation against a workspace.
 *
 * The merge executor calls this after a successful rebase to verify
 * the rebased code passes all merge-gate checks before pushing.
 */
export interface MergeValidationPort {
  /**
   * Run the merge-gate validation profile against a workspace.
   *
   * @param params - Task ID and workspace path for the validation run.
   * @returns The aggregated validation result.
   */
  runMergeGateValidation(params: {
    readonly taskId: string;
    readonly workspacePath: string;
  }): Promise<ValidationRunResult>;
}

// ---------------------------------------------------------------------------
// Conflict classification port
// ---------------------------------------------------------------------------

/** Classification of merge conflicts per merge policy. */
export type ConflictClassification = "reworkable" | "non_reworkable";

/**
 * Port for classifying merge conflicts.
 *
 * Determines whether a rebase conflict is reworkable (the developer
 * can fix it) or non-reworkable (irrecoverable, task should fail).
 *
 * The classification uses policy rules from §10.10.2:
 * - Fewer than max_conflict_files and no protected path conflicts → reworkable
 * - Otherwise → non_reworkable
 *
 * @see docs/prd/010-integration-contracts.md §10.10.2 — Merge Conflict Classification
 * @see T066 — Implements the full classification logic
 */
export interface ConflictClassifierPort {
  /**
   * Classify a set of conflict files.
   *
   * @param conflictFiles - List of file paths with conflicts.
   * @returns The classification result.
   */
  classify(conflictFiles: readonly string[]): Promise<ConflictClassification>;
}

// ---------------------------------------------------------------------------
// Artifact persistence port
// ---------------------------------------------------------------------------

/**
 * Port for persisting MergePacket artifacts.
 *
 * The merge executor creates a MergePacket after successful merge
 * and persists it via this port.
 */
export interface MergeArtifactPort {
  /**
   * Persist a MergePacket to the artifact store.
   *
   * @param mergeQueueItemId - The merge queue item this packet belongs to.
   * @param packet - The serialized MergePacket data (already validated).
   * @returns The artifact path where the packet was stored.
   */
  persistMergePacket(mergeQueueItemId: string, packet: Record<string, unknown>): Promise<string>;
}

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

/**
 * Task data access for merge executor operations.
 */
export interface MergeExecutorTaskRepositoryPort {
  /** Find a task by ID. */
  findById(id: string): MergeExecutorTask | undefined;

  /** Update task status with optimistic concurrency via version column. */
  updateStatus(id: string, expectedVersion: number, newStatus: TaskStatus): MergeExecutorTask;
}

/**
 * Merge queue item data access for merge executor operations.
 */
export interface MergeExecutorItemRepositoryPort {
  /** Find a merge queue item by ID. */
  findById(id: string): MergeExecutorItem | undefined;

  /**
   * Update item status with status-based optimistic concurrency.
   * Throws VersionConflictError if current status doesn't match expectedStatus.
   */
  updateStatus(
    mergeQueueItemId: string,
    expectedStatus: MergeQueueItemStatus,
    newStatus: MergeQueueItemStatus,
    additionalFields?: { startedAt?: Date; completedAt?: Date },
  ): MergeExecutorItem;
}

// ---------------------------------------------------------------------------
// Transaction boundary
// ---------------------------------------------------------------------------

/**
 * Repository ports available inside a merge executor transaction.
 */
export interface MergeExecutorTransactionRepositories {
  readonly task: MergeExecutorTaskRepositoryPort;
  readonly mergeQueueItem: MergeExecutorItemRepositoryPort;
  readonly auditEvent: AuditEventRepositoryPort;
}

/**
 * Unit of work for merge executor operations.
 *
 * Wraps mutations in a database transaction. All reads and writes
 * within the callback participate in the same transaction.
 */
export interface MergeExecutorUnitOfWork {
  runInTransaction<T>(fn: (repos: MergeExecutorTransactionRepositories) => T): T;
}
