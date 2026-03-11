/**
 * Review decision application repository port interfaces.
 *
 * These interfaces define the minimal data-access contract that the
 * review decision service requires. They are intentionally narrow —
 * each port exposes only the operations needed for applying a lead
 * reviewer's decision to the task and review cycle state.
 *
 * The review decision service processes the LeadReviewDecisionPacket
 * and applies the decision: approved, approved_with_follow_up,
 * changes_requested, or escalated. All state changes occur within
 * a single atomic transaction.
 *
 * @see docs/prd/002-data-model.md §2.2 — Review Cycle State
 * @see docs/prd/002-data-model.md §2.5 — Rework and Review Round Rules
 * @see docs/prd/007-technical-architecture.md §7.8 — Review Cycle Coordination
 * @see docs/backlog/tasks/T061-review-decision-apply.md
 *
 * @module @factory/application/ports/review-decision.ports
 */

import type { ReviewCycleStatus, TaskStatus } from "@factory/domain";

// ---------------------------------------------------------------------------
// Entity shapes — the minimal fields the review decision service reads/writes
// ---------------------------------------------------------------------------

/**
 * Minimal task record required by the review decision service.
 *
 * Includes `status` for state machine validation, `version` for optimistic
 * concurrency, `reviewRoundCount` for escalation policy checks, and
 * `currentReviewCycleId` for verifying the packet targets the current cycle.
 */
export interface ReviewDecisionTask {
  readonly id: string;
  readonly projectId: string;
  readonly status: TaskStatus;
  readonly version: number;
  readonly reviewRoundCount: number;
  readonly currentReviewCycleId: string | null;
}

/**
 * A review cycle record as read by the review decision service.
 *
 * Must be in CONSOLIDATING state for a decision to be applied.
 */
export interface ReviewDecisionCycle {
  readonly reviewCycleId: string;
  readonly taskId: string;
  readonly status: ReviewCycleStatus;
}

/**
 * Data required to persist a LeadReviewDecision record.
 */
export interface NewLeadReviewDecisionData {
  readonly leadReviewDecisionId: string;
  readonly reviewCycleId: string;
  readonly taskId: string;
  readonly decision: string;
  readonly summary: string;
  readonly blockingIssueCount: number;
  readonly nonBlockingIssueCount: number;
  readonly followUpTaskRefs: readonly string[];
  readonly packetJson: unknown;
}

/**
 * A persisted lead review decision record.
 */
export interface LeadReviewDecisionRecord {
  readonly leadReviewDecisionId: string;
  readonly reviewCycleId: string;
  readonly taskId: string;
  readonly decision: string;
  readonly summary: string;
  readonly blockingIssueCount: number;
  readonly nonBlockingIssueCount: number;
  readonly followUpTaskRefs: readonly string[];
  readonly packetJson: unknown;
  readonly createdAt: Date;
}

/**
 * Data required to create a skeleton follow-up task.
 */
export interface NewFollowUpTaskData {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly parentTaskId: string;
  readonly source: string;
}

/**
 * A created follow-up task record.
 */
export interface FollowUpTaskRecord {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly parentTaskId: string;
  readonly status: TaskStatus;
}

/**
 * An audit event record created during decision application.
 */
export interface ReviewDecisionAuditEvent {
  readonly auditEventId: string;
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
 * Port for reading and updating the task entity during decision application.
 */
export interface ReviewDecisionTaskRepositoryPort {
  /**
   * Find a task by its ID.
   *
   * @param id - The task ID
   * @returns The task record, or undefined if not found
   */
  findById(id: string): ReviewDecisionTask | undefined;

  /**
   * Update task status with version-based optimistic concurrency.
   *
   * @param id - The task ID
   * @param expectedVersion - The version the task must currently be at
   * @param newStatus - The target status
   * @returns The updated task, or undefined if version guard fails
   */
  updateStatus(
    id: string,
    expectedVersion: number,
    newStatus: TaskStatus,
  ): ReviewDecisionTask | undefined;

  /**
   * Increment the review round count for a task.
   *
   * Called when a review cycle is rejected (changes_requested).
   *
   * @param id - The task ID
   * @param expectedVersion - The version the task must currently be at
   * @returns The updated task, or undefined if version guard fails
   */
  incrementReviewRoundCount(id: string, expectedVersion: number): ReviewDecisionTask | undefined;
}

/**
 * Port for reading and updating review cycles during decision application.
 */
export interface ReviewDecisionCycleRepositoryPort {
  /**
   * Find a review cycle by its ID.
   *
   * @param reviewCycleId - The review cycle ID
   * @returns The review cycle record, or undefined if not found
   */
  findById(reviewCycleId: string): ReviewDecisionCycle | undefined;

  /**
   * Transition a review cycle's status with an expected-status guard.
   *
   * @param reviewCycleId - The review cycle to update
   * @param expectedStatus - The status the cycle must currently be in
   * @param newStatus - The target status
   * @returns The updated review cycle, or undefined if the guard failed
   */
  updateStatus(
    reviewCycleId: string,
    expectedStatus: ReviewCycleStatus,
    newStatus: ReviewCycleStatus,
  ): ReviewDecisionCycle | undefined;
}

/**
 * Port for persisting lead review decision records.
 */
export interface ReviewDecisionRecordRepositoryPort {
  /**
   * Create a new lead review decision record.
   *
   * @param data - The decision data to persist
   * @returns The created decision record
   */
  create(data: NewLeadReviewDecisionData): LeadReviewDecisionRecord;
}

/**
 * Port for creating follow-up tasks from approved_with_follow_up decisions.
 */
export interface ReviewDecisionFollowUpTaskPort {
  /**
   * Create a skeleton follow-up task.
   *
   * @param data - The follow-up task data
   * @returns The created follow-up task record
   */
  create(data: NewFollowUpTaskData): FollowUpTaskRecord;
}

/**
 * Port for recording audit events during decision application.
 */
export interface ReviewDecisionAuditRepositoryPort {
  /**
   * Create an audit event record.
   *
   * @param event - The audit event data (without ID and timestamp)
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
  }): ReviewDecisionAuditEvent;
}

// ---------------------------------------------------------------------------
// Transaction boundary
// ---------------------------------------------------------------------------

/**
 * Repositories available within a review decision application transaction.
 */
export interface ReviewDecisionTransactionRepositories {
  readonly task: ReviewDecisionTaskRepositoryPort;
  readonly reviewCycle: ReviewDecisionCycleRepositoryPort;
  readonly leadReviewDecision: ReviewDecisionRecordRepositoryPort;
  readonly followUpTask: ReviewDecisionFollowUpTaskPort;
  readonly auditEvent: ReviewDecisionAuditRepositoryPort;
}

/**
 * Unit of work for atomic review decision application operations.
 */
export interface ReviewDecisionUnitOfWork {
  /**
   * Execute a function within a single database transaction.
   *
   * Uses BEGIN IMMEDIATE for write safety per §10.3.
   *
   * @param fn - The transactional work
   * @returns The result of the function
   */
  runInTransaction<T>(fn: (repos: ReviewDecisionTransactionRepositories) => T): T;
}
