/**
 * Rework context repository port interfaces.
 *
 * These interfaces define the minimal data-access contract that the
 * rework context service requires. They are intentionally narrow —
 * each port exposes only the operations needed for building a
 * {@link RejectionContext} from persisted review data.
 *
 * When a task receives a `changes_requested` decision, the rework
 * context service assembles a {@link RejectionContext} from the
 * lead review decision packet, specialist review packets, and the
 * prior development result's unresolved issues. This context is
 * then included in the next TaskPacket so the reworking developer
 * has precise feedback on what must change.
 *
 * @see docs/prd/008-packet-and-schema-spec.md §8.12 — RejectionContext
 * @see docs/prd/002-data-model.md §2.5 — Rework and Review Round Rules
 * @see docs/backlog/tasks/T062-rework-loop.md
 *
 * @module @factory/application/ports/rework-context.ports
 */

// ---------------------------------------------------------------------------
// Entity shapes — the minimal fields the rework context service reads
// ---------------------------------------------------------------------------

/**
 * A task record as read by the rework context service.
 *
 * Includes the current review cycle reference and the task's review
 * round count for diagnostic context.
 */
export interface ReworkTask {
  readonly id: string;
  readonly currentReviewCycleId: string | null;
  readonly reviewRoundCount: number;
}

/**
 * A review cycle record as read by the rework context service.
 *
 * Must be in a terminal rejected state for rejection context to be
 * assembled from it.
 */
export interface ReworkReviewCycle {
  readonly reviewCycleId: string;
  readonly taskId: string;
  readonly status: string;
}

/**
 * A lead review decision record as stored in the database.
 *
 * Contains the full decision packet JSON for extracting blocking
 * issues and the lead reviewer's summary.
 */
export interface ReworkLeadReviewDecision {
  readonly leadReviewDecisionId: string;
  readonly reviewCycleId: string;
  readonly taskId: string;
  readonly decision: string;
  readonly summary: string;
  readonly blockingIssueCount: number;
  readonly packetJson: unknown;
  readonly createdAt: Date;
}

/**
 * A specialist review packet as stored in the database.
 *
 * Contains the full packet JSON for extracting blocking issues
 * from individual specialist reviews.
 */
export interface ReworkSpecialistPacket {
  readonly reviewPacketId: string;
  readonly reviewCycleId: string;
  readonly reviewerType: string;
  readonly verdict: string;
  readonly packetJson: unknown;
}

/**
 * A dev result record as stored in the database or artifact store.
 *
 * Contains the full dev result packet JSON for extracting
 * unresolved issues from the prior development attempt.
 */
export interface ReworkDevResult {
  readonly runId: string;
  readonly taskId: string;
  readonly packetJson: unknown;
}

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

/**
 * Port for reading the task entity during rejection context assembly.
 */
export interface ReworkTaskRepositoryPort {
  /**
   * Find a task by its ID.
   *
   * @param id - The task ID
   * @returns The task record, or undefined if not found
   */
  findById(id: string): ReworkTask | undefined;
}

/**
 * Port for reading review cycles during rejection context assembly.
 */
export interface ReworkReviewCycleRepositoryPort {
  /**
   * Find a review cycle by its ID.
   *
   * @param reviewCycleId - The review cycle ID
   * @returns The review cycle record, or undefined if not found
   */
  findById(reviewCycleId: string): ReworkReviewCycle | undefined;

  /**
   * Find the most recently rejected review cycle for a task.
   *
   * Returns the latest review cycle whose status is REJECTED,
   * ordered by creation time descending.
   *
   * @param taskId - The task to find rejected cycles for
   * @returns The most recent rejected cycle, or undefined if none
   */
  findLatestRejectedByTaskId(taskId: string): ReworkReviewCycle | undefined;
}

/**
 * Port for reading lead review decisions during rejection context assembly.
 */
export interface ReworkLeadReviewDecisionRepositoryPort {
  /**
   * Find the lead review decision for a specific review cycle.
   *
   * A review cycle has at most one lead review decision.
   *
   * @param reviewCycleId - The review cycle whose decision to retrieve
   * @returns The decision record, or undefined if not found
   */
  findByReviewCycleId(reviewCycleId: string): ReworkLeadReviewDecision | undefined;
}

/**
 * Port for reading specialist review packets during rejection context assembly.
 */
export interface ReworkSpecialistPacketRepositoryPort {
  /**
   * Find all specialist review packets for a specific review cycle.
   *
   * @param reviewCycleId - The review cycle whose packets to retrieve
   * @returns Array of specialist review packets (may be empty)
   */
  findByReviewCycleId(reviewCycleId: string): readonly ReworkSpecialistPacket[];
}

/**
 * Port for reading the most recent dev result for a task.
 *
 * Used to include `unresolved_issues` from the prior development
 * attempt in the rejection context.
 */
export interface ReworkDevResultRepositoryPort {
  /**
   * Find the most recent dev result for a task.
   *
   * @param taskId - The task whose latest dev result to retrieve
   * @returns The latest dev result, or undefined if none
   */
  findLatestByTaskId(taskId: string): ReworkDevResult | undefined;
}

// ---------------------------------------------------------------------------
// Transaction boundary
// ---------------------------------------------------------------------------

/**
 * Repositories available within a rework context assembly transaction.
 */
export interface ReworkContextTransactionRepositories {
  readonly task: ReworkTaskRepositoryPort;
  readonly reviewCycle: ReworkReviewCycleRepositoryPort;
  readonly leadReviewDecision: ReworkLeadReviewDecisionRepositoryPort;
  readonly specialistPacket: ReworkSpecialistPacketRepositoryPort;
  readonly devResult: ReworkDevResultRepositoryPort;
}

/**
 * Unit of work for rework context assembly operations.
 *
 * Uses a read-only transaction for consistent snapshot reads
 * across multiple repository queries.
 */
export interface ReworkContextUnitOfWork {
  /**
   * Execute a function within a single database transaction.
   *
   * @param fn - The transactional work
   * @returns The result of the function
   */
  runInTransaction<T>(fn: (repos: ReworkContextTransactionRepositories) => T): T;
}
