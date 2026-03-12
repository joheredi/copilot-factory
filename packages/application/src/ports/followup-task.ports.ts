/**
 * Follow-up task service port interfaces.
 *
 * Defines the minimal data-access contract required by the
 * FollowUpTaskService for creating follow-up tasks from various
 * sources: review decisions, post-merge failures, and analysis
 * agent recommendations.
 *
 * Follow-up tasks are created when:
 * - A lead reviewer decides `approved_with_follow_up` (review follow-ups)
 * - A post-merge validation fails critically (revert tasks)
 * - A post-merge validation has low-severity failures (diagnostic tasks)
 * - An analysis agent recommends a hotfix (hotfix tasks)
 *
 * All follow-up tasks enter BACKLOG state and get a `relates_to`
 * dependency linking them to their source task for traceability.
 *
 * @see docs/prd/008-packet-and-schema-spec.md — follow_up_task_refs
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.11 — Post-Merge Failure Policy
 * @see docs/backlog/tasks/T068-followup-task-gen.md
 *
 * @module @factory/application/ports/followup-task.ports
 */

import type { DependencyType, TaskStatus } from "@factory/domain";

// ---------------------------------------------------------------------------
// Entity shapes — minimal fields the follow-up task service reads/writes
// ---------------------------------------------------------------------------

/**
 * Minimal task record for verifying that the source task exists and
 * extracting project/repository context for the follow-up.
 */
export interface FollowUpSourceTask {
  readonly id: string;
  readonly status: TaskStatus;
  readonly repositoryId: string;
  readonly projectId: string;
  readonly title: string;
}

/**
 * Data required to insert a new task record for a follow-up.
 *
 * Maps directly to the task table columns that are set at creation time.
 * The service computes these values from the follow-up request source.
 */
export interface NewFollowUpTaskRecord {
  readonly taskId: string;
  readonly repositoryId: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly taskType: string;
  readonly priority: string;
  readonly source: string;
  readonly status: string;
}

/**
 * A persisted follow-up task record returned after creation.
 */
export interface CreatedFollowUpTaskRecord {
  readonly taskId: string;
  readonly repositoryId: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly taskType: string;
  readonly priority: string;
  readonly source: string;
  readonly status: string;
  readonly createdAt: Date;
}

/**
 * Data required to create a dependency edge between the follow-up
 * task and its source task.
 */
export interface NewFollowUpDependency {
  readonly taskDependencyId: string;
  readonly taskId: string;
  readonly dependsOnTaskId: string;
  readonly dependencyType: DependencyType;
  readonly isHardBlock: boolean;
}

/**
 * A persisted dependency edge record.
 */
export interface CreatedFollowUpDependency {
  readonly taskDependencyId: string;
  readonly taskId: string;
  readonly dependsOnTaskId: string;
  readonly dependencyType: DependencyType;
  readonly isHardBlock: boolean;
  readonly createdAt: Date;
}

/**
 * An audit event record created during follow-up task generation.
 */
export interface FollowUpAuditEvent {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly eventType: string;
  readonly actorType: string;
  readonly actorId: string;
  readonly oldState: string | null;
  readonly newState: string;
  readonly metadata: string;
  readonly createdAt: Date;
}

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

/**
 * Port for reading the source task that triggered follow-up generation.
 */
export interface FollowUpSourceTaskPort {
  /**
   * Find a task by its ID with the minimal fields needed for follow-up context.
   *
   * @param id - The source task ID
   * @returns The task record, or undefined if not found
   */
  findById(id: string): FollowUpSourceTask | undefined;
}

/**
 * Port for creating follow-up task records in the task registry.
 */
export interface FollowUpTaskCreationPort {
  /**
   * Create a new task record for a follow-up task.
   *
   * @param data - The task data to persist
   * @returns The created task record
   */
  create(data: NewFollowUpTaskRecord): CreatedFollowUpTaskRecord;
}

/**
 * Port for creating dependency edges between follow-up tasks and source tasks.
 */
export interface FollowUpDependencyCreationPort {
  /**
   * Create a dependency edge linking a follow-up to its source task.
   *
   * @param data - The dependency edge data
   * @returns The created dependency record
   */
  create(data: NewFollowUpDependency): CreatedFollowUpDependency;
}

/**
 * Port for recording audit events during follow-up task creation.
 */
export interface FollowUpAuditEventPort {
  /**
   * Create an audit event record.
   *
   * @param event - The audit event data (ID and timestamp generated by repo)
   * @returns The created audit event with generated ID and timestamp
   */
  create(event: {
    readonly entityType: string;
    readonly entityId: string;
    readonly eventType: string;
    readonly actorType: string;
    readonly actorId: string;
    readonly oldState: string | null;
    readonly newState: string;
    readonly metadata: string;
  }): FollowUpAuditEvent;
}

// ---------------------------------------------------------------------------
// Transaction boundary
// ---------------------------------------------------------------------------

/**
 * Repositories available within a follow-up task creation transaction.
 *
 * All follow-up task creation (task insert + dependency insert + audit)
 * happens atomically within a single transaction.
 */
export interface FollowUpTransactionRepositories {
  readonly sourceTask: FollowUpSourceTaskPort;
  readonly task: FollowUpTaskCreationPort;
  readonly dependency: FollowUpDependencyCreationPort;
  readonly auditEvent: FollowUpAuditEventPort;
}

/**
 * Unit of work for atomic follow-up task creation operations.
 */
export interface FollowUpUnitOfWork {
  /**
   * Execute a function within a single database transaction.
   *
   * Uses BEGIN IMMEDIATE for write safety per §10.3.
   *
   * @param fn - The transactional work
   * @returns The result of the function
   */
  runInTransaction<T>(fn: (repos: FollowUpTransactionRepositories) => T): T;
}
