/**
 * Port interfaces for the post-merge validation service.
 *
 * Defines the minimal contracts for task state management, merge queue
 * pause/resume, follow-up task creation, and operator notifications
 * required by the post-merge validation and failure policy service.
 *
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.11 — Post-Merge Failure Policy
 * @see docs/backlog/tasks/T067-post-merge-failure.md
 * @module @factory/application/ports/post-merge-validation.ports
 */

import type { TaskStatus } from "@factory/domain";
import type { AuditEventRepositoryPort } from "./repository.ports.js";
import type { ValidationRunResult } from "./validation-runner.ports.js";

// ---------------------------------------------------------------------------
// Entity shapes
// ---------------------------------------------------------------------------

/**
 * Minimal task record for post-merge validation transitions.
 */
export interface PostMergeTask {
  readonly id: string;
  readonly status: TaskStatus;
  readonly version: number;
  readonly repositoryId: string;
  readonly projectId: string;
}

// ---------------------------------------------------------------------------
// Validation execution port
// ---------------------------------------------------------------------------

/**
 * Port for running merge-gate validation after merge completes.
 *
 * Reuses the same validation interface as the merge executor's pre-push
 * validation but is invoked after the push succeeds.
 */
export interface PostMergeValidationRunnerPort {
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
// Task creation port
// ---------------------------------------------------------------------------

/**
 * Data for creating a follow-up task (revert or diagnostic).
 */
export interface CreateFollowUpTaskData {
  /** Title of the follow-up task. */
  readonly title: string;
  /** Description of the follow-up task with context. */
  readonly description: string;
  /** Repository ID the task belongs to. */
  readonly repositoryId: string;
  /** Project ID the task belongs to. */
  readonly projectId: string;
  /** Task type: "revert" for revert tasks, "diagnostic" for diagnostic tasks. */
  readonly taskType: "revert" | "diagnostic";
  /** ID of the task that triggered this follow-up. */
  readonly originTaskId: string;
  /** Priority override (revert tasks get boosted priority). */
  readonly priority: number;
}

/**
 * Record returned after follow-up task creation.
 */
export interface PostMergeFollowUpTaskRecord {
  readonly id: string;
  readonly title: string;
  readonly taskType: "revert" | "diagnostic";
}

/**
 * Port for creating follow-up tasks (revert or diagnostic).
 */
export interface PostMergeFollowUpTaskCreationPort {
  /**
   * Create a follow-up task in the task registry.
   *
   * @param data - The follow-up task data.
   * @returns The created follow-up task record.
   */
  createFollowUpTask(data: CreateFollowUpTaskData): PostMergeFollowUpTaskRecord;
}

// ---------------------------------------------------------------------------
// Merge queue pause port
// ---------------------------------------------------------------------------

/**
 * Port for pausing and resuming the merge queue for a repository.
 */
export interface MergeQueuePausePort {
  /**
   * Pause the merge queue for a repository.
   * No new items will be dequeued until the queue is resumed.
   *
   * @param repositoryId - The repository whose queue should be paused.
   * @param reason - Human-readable reason for the pause.
   */
  pauseQueue(repositoryId: string, reason: string): void;

  /**
   * Resume a paused merge queue for a repository.
   *
   * @param repositoryId - The repository whose queue should be resumed.
   */
  resumeQueue(repositoryId: string): void;

  /**
   * Check whether the merge queue for a repository is paused.
   *
   * @param repositoryId - The repository to check.
   * @returns True if the queue is currently paused.
   */
  isPaused(repositoryId: string): boolean;
}

// ---------------------------------------------------------------------------
// Operator notification port
// ---------------------------------------------------------------------------

/**
 * Severity level for operator notifications.
 */
export type NotificationSeverity = "critical" | "high" | "low";

/**
 * Port for notifying operators about post-merge validation outcomes.
 */
export interface OperatorNotificationPort {
  /**
   * Send a notification to the operator queue.
   *
   * @param notification - The notification details.
   */
  notify(notification: {
    readonly taskId: string;
    readonly repositoryId: string;
    readonly severity: NotificationSeverity;
    readonly message: string;
    readonly requiresAction: boolean;
  }): void;
}

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

/**
 * Task data access for post-merge validation operations.
 */
export interface PostMergeTaskRepositoryPort {
  /** Find a task by ID. */
  findById(id: string): PostMergeTask | undefined;

  /** Update task status with optimistic concurrency via version column. */
  updateStatus(id: string, expectedVersion: number, newStatus: TaskStatus): PostMergeTask;
}

// ---------------------------------------------------------------------------
// Transaction boundary
// ---------------------------------------------------------------------------

/**
 * Repository ports available inside a post-merge validation transaction.
 */
export interface PostMergeTransactionRepositories {
  readonly task: PostMergeTaskRepositoryPort;
  readonly auditEvent: AuditEventRepositoryPort;
  readonly followUpTask: PostMergeFollowUpTaskCreationPort;
}

/**
 * Unit of work for post-merge validation operations.
 */
export interface PostMergeUnitOfWork {
  runInTransaction<T>(fn: (repos: PostMergeTransactionRepositories) => T): T;
}
