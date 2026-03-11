/**
 * Reviewer dispatch repository port interfaces.
 *
 * These interfaces define the minimal data-access contract that the
 * reviewer dispatch service requires. They are intentionally narrow —
 * each port exposes only the operations needed for dispatching specialist
 * reviewer jobs during the DEV_COMPLETE → IN_REVIEW transition.
 *
 * The reviewer dispatch service creates a ReviewCycle, fans out
 * reviewer_dispatch jobs, and transitions both the ReviewCycle (to ROUTED)
 * and the Task (to IN_REVIEW) atomically within a single transaction.
 *
 * @see docs/prd/002-data-model.md §2.2 — Review Cycle State
 * @see docs/prd/002-data-model.md §2.3 — Entity: ReviewCycle, Entity: Job
 * @see docs/prd/010-integration-contracts.md §10.3 — Transaction Boundaries
 * @module @factory/application/ports/reviewer-dispatch.ports
 */

import type { JobStatus, JobType, ReviewCycleStatus, TaskStatus } from "@factory/domain";

// ---------------------------------------------------------------------------
// Entity shapes — the minimal fields the reviewer dispatch service reads/writes
// ---------------------------------------------------------------------------

/**
 * Minimal task record required by the reviewer dispatch service.
 *
 * Includes `status` and `version` for state machine validation and
 * optimistic concurrency, plus the `currentReviewCycleId` field that
 * is updated when a new review cycle begins.
 */
export interface ReviewDispatchTask {
  readonly id: string;
  readonly status: TaskStatus;
  readonly version: number;
  readonly currentReviewCycleId: string | null;
}

/**
 * A review cycle record as created and managed by the reviewer dispatch service.
 */
export interface ReviewDispatchCycle {
  readonly reviewCycleId: string;
  readonly taskId: string;
  readonly status: ReviewCycleStatus;
  readonly requiredReviewers: readonly string[];
  readonly optionalReviewers: readonly string[];
  readonly startedAt: Date;
  readonly completedAt: Date | null;
}

/**
 * Data required to create a new review cycle.
 */
export interface NewReviewCycleData {
  readonly reviewCycleId: string;
  readonly taskId: string;
  readonly status: ReviewCycleStatus;
  readonly requiredReviewers: readonly string[];
  readonly optionalReviewers: readonly string[];
}

/**
 * A job record as created by the reviewer dispatch service.
 * Mirrors the shape from the job queue ports for consistency.
 */
export interface ReviewDispatchJob {
  readonly jobId: string;
  readonly jobType: JobType;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly payloadJson: unknown;
  readonly status: JobStatus;
  readonly jobGroupId: string | null;
  readonly dependsOnJobIds: unknown;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Audit event record as persisted. Matches the shape from repository.ports.
 */
export interface ReviewDispatchAuditEvent {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly eventType: string;
  readonly actorType: string;
  readonly actorId: string;
  readonly oldState: string | null;
  readonly newState: string | null;
  readonly metadata: string | null;
  readonly createdAt: Date;
}

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

/**
 * Port for task data access within the reviewer dispatch transaction.
 *
 * Provides task lookup and a specialized update that atomically changes
 * both the task status and the `currentReviewCycleId` reference.
 *
 * `updateForReviewDispatch` uses the task's `version` column for
 * optimistic concurrency. If `expectedVersion` does not match, it must
 * throw a `VersionConflictError`.
 */
export interface ReviewDispatchTaskRepositoryPort {
  /** Find a task by ID. Returns undefined if not found. */
  findById(id: string): ReviewDispatchTask | undefined;

  /**
   * Atomically update task status and current review cycle reference.
   *
   * @param id - Task ID
   * @param expectedVersion - Optimistic concurrency guard
   * @param newStatus - The target status (IN_REVIEW)
   * @param currentReviewCycleId - ID of the newly created review cycle
   * @returns The updated task record
   * @throws VersionConflictError if expectedVersion doesn't match
   */
  updateForReviewDispatch(
    id: string,
    expectedVersion: number,
    newStatus: TaskStatus,
    currentReviewCycleId: string,
  ): ReviewDispatchTask;
}

/**
 * Port for review cycle creation within the reviewer dispatch transaction.
 *
 * Supports creating a new cycle and updating its status (NOT_STARTED → ROUTED)
 * within the same transaction.
 */
export interface ReviewDispatchCycleRepositoryPort {
  /**
   * Insert a new review cycle record.
   *
   * @returns The persisted review cycle with server-generated timestamp fields.
   */
  create(data: NewReviewCycleData): ReviewDispatchCycle;

  /**
   * Update a review cycle's status with status-based optimistic concurrency.
   *
   * @param id - Review cycle ID
   * @param expectedStatus - The current expected status
   * @param newStatus - The target status
   * @returns The updated review cycle, or undefined if expectedStatus didn't match
   */
  updateStatus(
    id: string,
    expectedStatus: ReviewCycleStatus,
    newStatus: ReviewCycleStatus,
  ): ReviewDispatchCycle | undefined;
}

/**
 * Port for job creation within the reviewer dispatch transaction.
 *
 * Supports creating reviewer_dispatch and lead_review_consolidation jobs
 * atomically.
 */
export interface ReviewDispatchJobRepositoryPort {
  /**
   * Insert a new job into the queue.
   *
   * @returns The persisted job record with server-generated fields.
   */
  create(data: {
    readonly jobId: string;
    readonly jobType: JobType;
    readonly entityType: string | null;
    readonly entityId: string | null;
    readonly payloadJson: unknown;
    readonly status: JobStatus;
    readonly attemptCount: number;
    readonly runAfter: Date | null;
    readonly parentJobId: string | null;
    readonly jobGroupId: string | null;
    readonly dependsOnJobIds: string[] | null;
  }): ReviewDispatchJob;
}

/**
 * Port for audit event persistence within the reviewer dispatch transaction.
 */
export interface ReviewDispatchAuditRepositoryPort {
  /** Create an audit event record. */
  create(event: {
    readonly entityType: string;
    readonly entityId: string;
    readonly eventType: string;
    readonly actorType: string;
    readonly actorId: string;
    readonly oldState: string | null;
    readonly newState: string | null;
    readonly metadata: string | null;
  }): ReviewDispatchAuditEvent;
}

// ---------------------------------------------------------------------------
// Transaction boundary
// ---------------------------------------------------------------------------

/**
 * Collection of repository ports available inside a reviewer dispatch transaction.
 *
 * All repositories participate in the same atomic transaction, ensuring that
 * ReviewCycle creation, job fan-out, task status update, and audit events
 * are committed or rolled back together.
 */
export interface ReviewDispatchTransactionRepositories {
  readonly task: ReviewDispatchTaskRepositoryPort;
  readonly reviewCycle: ReviewDispatchCycleRepositoryPort;
  readonly job: ReviewDispatchJobRepositoryPort;
  readonly auditEvent: ReviewDispatchAuditRepositoryPort;
}

/**
 * Defines the contract for running reviewer dispatch operations inside
 * a database transaction.
 *
 * Implementations must:
 * - Begin a write transaction before invoking `fn` (e.g., `BEGIN IMMEDIATE`)
 * - Commit on success, rollback on exception
 * - Provide transaction-scoped repository instances
 * - Guarantee atomicity of all reads and writes within `fn`
 *
 * @see docs/prd/010-integration-contracts.md §10.3 — Transaction Boundaries
 */
export interface ReviewerDispatchUnitOfWork {
  runInTransaction<T>(fn: (repos: ReviewDispatchTransactionRepositories) => T): T;
}
