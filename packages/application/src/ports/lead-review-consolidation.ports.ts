/**
 * Lead review consolidation repository port interfaces.
 *
 * These interfaces define the minimal data-access contract that the
 * lead review consolidation service requires. They are intentionally narrow —
 * each port exposes only the operations needed for assembling the lead
 * reviewer's context when the `lead_review_consolidation` job becomes
 * claimable (all specialist jobs complete).
 *
 * The consolidation service gathers all specialist ReviewPackets from the
 * current review cycle, fetches review history from prior cycles, and
 * transitions the ReviewCycle to CONSOLIDATING — all within a single
 * atomic transaction.
 *
 * @see docs/prd/002-data-model.md §2.2 — Review Cycle State
 * @see docs/prd/002-data-model.md §2.3 — Entity: ReviewCycle, Entity: Job
 * @see docs/prd/007-technical-architecture.md §7.8 — Review Cycle Coordination
 * @see docs/backlog/tasks/T060-lead-reviewer-dispatch.md
 *
 * @module @factory/application/ports/lead-review-consolidation.ports
 */

import type { JobStatus, JobType, ReviewCycleStatus } from "@factory/domain";

// ---------------------------------------------------------------------------
// Entity shapes — the minimal fields the consolidation service reads/writes
// ---------------------------------------------------------------------------

/**
 * Minimal task record required by the lead review consolidation service.
 *
 * Includes `status` for validation that the task is in IN_REVIEW,
 * and `repositoryId` for assembling the lead reviewer context.
 */
export interface LeadReviewTask {
  readonly id: string;
  readonly status: string;
  readonly repositoryId: string;
}

/**
 * A review cycle record as read by the consolidation service.
 *
 * Includes the status for state machine validation and the reviewer
 * lists for verifying that all required reviewers have submitted packets.
 */
export interface LeadReviewCycle {
  readonly reviewCycleId: string;
  readonly taskId: string;
  readonly status: ReviewCycleStatus;
  readonly requiredReviewers: readonly string[];
  readonly optionalReviewers: readonly string[];
  readonly startedAt: Date;
  readonly completedAt: Date | null;
}

/**
 * A specialist review packet as stored in the database.
 *
 * Contains the full packet JSON produced by a specialist reviewer,
 * along with the reviewer type and verdict for quick access without
 * parsing the full packet.
 */
export interface SpecialistReviewPacket {
  readonly reviewPacketId: string;
  readonly taskId: string;
  readonly reviewCycleId: string;
  readonly reviewerType: string;
  readonly verdict: string;
  readonly packetJson: unknown;
  readonly createdAt: Date;
}

/**
 * A job record as read by the consolidation service.
 *
 * Used to verify that all specialist jobs in the group have reached
 * terminal status before assembling the lead context.
 */
export interface LeadReviewJob {
  readonly jobId: string;
  readonly jobType: JobType;
  readonly status: JobStatus;
  readonly jobGroupId: string | null;
  readonly dependsOnJobIds: unknown;
  readonly payloadJson: unknown;
}

/**
 * Summary of a prior review cycle for the same task.
 *
 * Provides the lead reviewer with historical context about past
 * review rounds, including the final decision and specialist packets.
 */
export interface ReviewCycleHistoryEntry {
  readonly reviewCycleId: string;
  readonly taskId: string;
  readonly status: ReviewCycleStatus;
  readonly requiredReviewers: readonly string[];
  readonly optionalReviewers: readonly string[];
  readonly specialistPackets: readonly SpecialistReviewPacket[];
  readonly startedAt: Date;
  readonly completedAt: Date | null;
}

/**
 * An audit event record created during the consolidation.
 */
export interface LeadReviewAuditEvent {
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
 * Port for reading the task entity during consolidation.
 */
export interface LeadReviewTaskRepositoryPort {
  /**
   * Find a task by its ID.
   *
   * @param id - The task ID
   * @returns The task record, or undefined if not found
   */
  findById(id: string): LeadReviewTask | undefined;
}

/**
 * Port for reading and updating review cycles during consolidation.
 */
export interface LeadReviewCycleRepositoryPort {
  /**
   * Find a review cycle by its ID.
   *
   * @param reviewCycleId - The review cycle ID
   * @returns The review cycle record, or undefined if not found
   */
  findById(reviewCycleId: string): LeadReviewCycle | undefined;

  /**
   * Find all review cycles for a task, ordered by startedAt ascending.
   *
   * Used to build the review history for the lead reviewer.
   *
   * @param taskId - The task ID
   * @returns All review cycles for the task
   */
  findByTaskId(taskId: string): readonly LeadReviewCycle[];

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
  ): LeadReviewCycle | undefined;
}

/**
 * Port for reading specialist review packets.
 */
export interface LeadReviewPacketRepositoryPort {
  /**
   * Find all specialist review packets for a review cycle.
   *
   * @param reviewCycleId - The review cycle ID
   * @returns All specialist review packets for the cycle
   */
  findByReviewCycleId(reviewCycleId: string): readonly SpecialistReviewPacket[];
}

/**
 * Port for reading jobs related to the review cycle.
 */
export interface LeadReviewJobRepositoryPort {
  /**
   * Find all jobs in a job group (by jobGroupId).
   *
   * Used to verify all specialist jobs have completed.
   *
   * @param groupId - The job group ID (equals reviewCycleId)
   * @returns All jobs in the group
   */
  findByGroupId(groupId: string): readonly LeadReviewJob[];
}

/**
 * Port for recording audit events during consolidation.
 */
export interface LeadReviewAuditRepositoryPort {
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
  }): LeadReviewAuditEvent;
}

// ---------------------------------------------------------------------------
// Transaction boundary
// ---------------------------------------------------------------------------

/**
 * Repositories available within a lead review consolidation transaction.
 */
export interface LeadReviewTransactionRepositories {
  readonly task: LeadReviewTaskRepositoryPort;
  readonly reviewCycle: LeadReviewCycleRepositoryPort;
  readonly reviewPacket: LeadReviewPacketRepositoryPort;
  readonly job: LeadReviewJobRepositoryPort;
  readonly auditEvent: LeadReviewAuditRepositoryPort;
}

/**
 * Unit of work for atomic lead review consolidation operations.
 */
export interface LeadReviewConsolidationUnitOfWork {
  /**
   * Execute a function within a single database transaction.
   *
   * Uses BEGIN IMMEDIATE for write safety per §10.3.
   *
   * @param fn - The transactional work
   * @returns The result of the function
   */
  runInTransaction<T>(fn: (repos: LeadReviewTransactionRepositories) => T): T;
}
