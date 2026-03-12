/**
 * Lead review consolidation service — assembles lead reviewer context
 * after all specialist reviews complete.
 *
 * When the `lead_review_consolidation` job becomes claimable (all specialist
 * reviewer jobs reached terminal status), this service:
 *
 * 1. Validates the review cycle is in a consolidation-eligible state
 *    (IN_PROGRESS or AWAITING_REQUIRED_REVIEWS)
 * 2. Verifies all specialist jobs in the group are terminal
 * 3. Gathers all specialist ReviewPackets from the current cycle
 * 4. Fetches review history from prior cycles on the same task
 * 5. Transitions the ReviewCycle to CONSOLIDATING
 * 6. Records an audit event for the transition
 * 7. Emits a domain event after the transaction commits
 * 8. Returns the assembled context for the lead reviewer
 *
 * All database reads and writes occur within a single transaction to
 * guarantee atomicity per §10.3.
 *
 * @see docs/prd/002-data-model.md §2.2 — Review Cycle State
 * @see docs/prd/007-technical-architecture.md §7.8 — Review Cycle Coordination
 * @see docs/backlog/tasks/T060-lead-reviewer-dispatch.md
 *
 * @module @factory/application/services/lead-review-consolidation
 */

import {
  ReviewCycleStatus,
  JobStatus,
  JobType,
  validateReviewCycleTransition,
} from "@factory/domain";
import type { ReviewCycleTransitionContext } from "@factory/domain";

import { getStarterMetrics } from "@factory/observability";

import type { ActorInfo, DomainEvent } from "../events/domain-events.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type {
  LeadReviewConsolidationUnitOfWork,
  LeadReviewCycle,
  SpecialistReviewPacket,
  ReviewCycleHistoryEntry,
  LeadReviewAuditEvent,
  LeadReviewJob,
} from "../ports/lead-review-consolidation.ports.js";
import { EntityNotFoundError, InvalidTransitionError } from "../errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Terminal job statuses that satisfy job dependency requirements.
 * A specialist job must be in one of these states to be considered complete.
 */
const TERMINAL_JOB_STATUSES: ReadonlySet<string> = new Set([
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
]);

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

/**
 * Parameters for assembling the lead reviewer's context.
 *
 * The caller provides the review cycle and task identifiers, plus
 * the actor triggering the consolidation (typically the system/scheduler).
 */
export interface AssembleLeadReviewContextParams {
  /** The review cycle whose specialist reviews are being consolidated. */
  readonly reviewCycleId: string;

  /** The task under review. */
  readonly taskId: string;

  /** The actor initiating the consolidation (typically system/scheduler). */
  readonly actor: ActorInfo;
}

/**
 * Result of a successful lead review context assembly.
 *
 * Contains all the information the lead reviewer needs to make a
 * consolidated decision: specialist review packets from the current
 * cycle, review history from prior cycles, and the review cycle state.
 */
export interface AssembleLeadReviewContextResult {
  /** The review cycle, now in CONSOLIDATING status. */
  readonly reviewCycle: LeadReviewCycle;

  /** All specialist review packets from the current review cycle. */
  readonly specialistPackets: readonly SpecialistReviewPacket[];

  /**
   * Review history from prior cycles on the same task.
   * Empty array if this is the first review cycle.
   * Ordered by startedAt ascending (oldest first).
   */
  readonly reviewHistory: readonly ReviewCycleHistoryEntry[];

  /** All specialist jobs from the current cycle for status inspection. */
  readonly specialistJobs: readonly LeadReviewJob[];

  /** Audit events recorded during the consolidation. */
  readonly auditEvents: readonly LeadReviewAuditEvent[];
}

/**
 * The lead review consolidation service interface.
 *
 * Exposes a single orchestration method that assembles the lead
 * reviewer's full context atomically.
 */
export interface LeadReviewConsolidationService {
  /**
   * Assemble the lead reviewer's context for a review cycle.
   *
   * Gathers all specialist ReviewPackets, fetches review history from
   * prior cycles, transitions the ReviewCycle to CONSOLIDATING, and
   * returns the complete context for the lead reviewer.
   *
   * @param params - The consolidation parameters
   * @returns The assembled lead review context
   * @throws EntityNotFoundError if the task or review cycle doesn't exist
   * @throws InvalidTransitionError if the review cycle cannot transition to CONSOLIDATING
   * @throws InvalidTransitionError if specialist jobs have not all completed
   */
  assembleLeadReviewContext(
    params: AssembleLeadReviewContextParams,
  ): AssembleLeadReviewContextResult;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies injected into the lead review consolidation service factory.
 */
export interface LeadReviewConsolidationDependencies {
  /** Unit of work for atomic multi-entity operations. */
  readonly unitOfWork: LeadReviewConsolidationUnitOfWork;

  /** Event emitter for post-commit domain event publication. */
  readonly eventEmitter: DomainEventEmitter;

  /** Clock function for timestamps (injected for testability). */
  readonly clock?: () => Date;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Determines the previous status from which the review cycle will
 * transition to CONSOLIDATING.
 *
 * Valid source states are IN_PROGRESS and AWAITING_REQUIRED_REVIEWS.
 * Returns the appropriate source status or undefined if the cycle is
 * not in a valid state for consolidation.
 */
function getConsolidationSourceStatus(cycle: LeadReviewCycle): ReviewCycleStatus | undefined {
  if (
    cycle.status === ReviewCycleStatus.IN_PROGRESS ||
    cycle.status === ReviewCycleStatus.AWAITING_REQUIRED_REVIEWS
  ) {
    return cycle.status;
  }
  return undefined;
}

/**
 * Checks whether all specialist jobs (REVIEWER_DISPATCH type) in the
 * group have reached terminal status.
 *
 * The lead_review_consolidation job itself is excluded from the check.
 *
 * @returns An object with `allTerminal` flag and the filtered specialist jobs
 */
function checkSpecialistJobsCompletion(jobs: readonly LeadReviewJob[]): {
  readonly allTerminal: boolean;
  readonly specialistJobs: readonly LeadReviewJob[];
  readonly pendingJobIds: readonly string[];
} {
  const specialistJobs = jobs.filter((j) => j.jobType === JobType.REVIEWER_DISPATCH);

  const pendingJobIds: string[] = [];
  for (const job of specialistJobs) {
    if (!TERMINAL_JOB_STATUSES.has(job.status)) {
      pendingJobIds.push(job.jobId);
    }
  }

  return {
    allTerminal: pendingJobIds.length === 0,
    specialistJobs,
    pendingJobIds,
  };
}

/**
 * Builds review history entries from prior review cycles.
 *
 * Excludes the current cycle and orders by startedAt ascending.
 * Each entry includes the specialist packets from that cycle.
 */
function buildReviewHistory(
  allCycles: readonly LeadReviewCycle[],
  currentCycleId: string,
  getPackets: (cycleId: string) => readonly SpecialistReviewPacket[],
): readonly ReviewCycleHistoryEntry[] {
  const priorCycles = allCycles
    .filter((c) => c.reviewCycleId !== currentCycleId)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  return priorCycles.map((cycle) => ({
    reviewCycleId: cycle.reviewCycleId,
    taskId: cycle.taskId,
    status: cycle.status,
    requiredReviewers: cycle.requiredReviewers,
    optionalReviewers: cycle.optionalReviewers,
    specialistPackets: getPackets(cycle.reviewCycleId),
    startedAt: cycle.startedAt,
    completedAt: cycle.completedAt,
  }));
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

/**
 * Creates a LeadReviewConsolidationService instance.
 *
 * The service orchestrates the full lead review context assembly workflow:
 * validation → specialist job verification → packet gathering →
 * history assembly → cycle transition, all within a single atomic transaction.
 *
 * @param deps - Injected dependencies
 * @returns A LeadReviewConsolidationService instance
 *
 * @example
 * ```ts
 * const service = createLeadReviewConsolidationService({
 *   unitOfWork,
 *   eventEmitter,
 * });
 *
 * const result = service.assembleLeadReviewContext({
 *   reviewCycleId: "cycle-456",
 *   taskId: "task-123",
 *   actor: { type: "system", id: "scheduler" },
 * });
 * // result.specialistPackets contains all specialist reviews
 * // result.reviewHistory contains prior cycle summaries
 * // result.reviewCycle.status === "CONSOLIDATING"
 * ```
 */
export function createLeadReviewConsolidationService(
  deps: LeadReviewConsolidationDependencies,
): LeadReviewConsolidationService {
  const { unitOfWork, eventEmitter, clock = () => new Date() } = deps;

  return {
    assembleLeadReviewContext(
      params: AssembleLeadReviewContextParams,
    ): AssembleLeadReviewContextResult {
      // ── Execute all reads and writes atomically ─────────────────────
      const transactionResult = unitOfWork.runInTransaction((repos) => {
        // 1. Fetch and validate the task exists
        const task = repos.task.findById(params.taskId);
        if (!task) {
          throw new EntityNotFoundError("Task", params.taskId);
        }

        // 2. Fetch and validate the review cycle
        const cycle = repos.reviewCycle.findById(params.reviewCycleId);
        if (!cycle) {
          throw new EntityNotFoundError("ReviewCycle", params.reviewCycleId);
        }

        // Ensure the cycle belongs to the specified task
        if (cycle.taskId !== params.taskId) {
          throw new EntityNotFoundError(
            "ReviewCycle",
            `${params.reviewCycleId} (not associated with task ${params.taskId})`,
          );
        }

        // 3. Determine the valid source status for CONSOLIDATING transition
        const sourceStatus = getConsolidationSourceStatus(cycle);
        if (sourceStatus === undefined) {
          throw new InvalidTransitionError(
            "ReviewCycle",
            params.reviewCycleId,
            cycle.status,
            ReviewCycleStatus.CONSOLIDATING,
            `ReviewCycle must be in IN_PROGRESS or AWAITING_REQUIRED_REVIEWS state, but is ${cycle.status}`,
          );
        }

        // 4. Verify all specialist jobs in the group are terminal
        const groupJobs = repos.job.findByGroupId(params.reviewCycleId);
        const { allTerminal, specialistJobs, pendingJobIds } =
          checkSpecialistJobsCompletion(groupJobs);

        if (!allTerminal) {
          throw new InvalidTransitionError(
            "ReviewCycle",
            params.reviewCycleId,
            cycle.status,
            ReviewCycleStatus.CONSOLIDATING,
            `Cannot consolidate: specialist jobs not yet complete. Pending: [${pendingJobIds.join(", ")}]`,
          );
        }

        // 5. Validate state machine transition
        const transitionContext: ReviewCycleTransitionContext = {
          allRequiredReviewsComplete: true,
        };
        const validation = validateReviewCycleTransition(
          sourceStatus,
          ReviewCycleStatus.CONSOLIDATING,
          transitionContext,
        );
        if (!validation.valid) {
          throw new InvalidTransitionError(
            "ReviewCycle",
            params.reviewCycleId,
            sourceStatus,
            ReviewCycleStatus.CONSOLIDATING,
            validation.reason,
          );
        }

        // 6. Gather specialist review packets for the current cycle
        const specialistPackets = repos.reviewPacket.findByReviewCycleId(params.reviewCycleId);

        // 7. Fetch all review cycles for the task (for history)
        const allCycles = repos.reviewCycle.findByTaskId(params.taskId);

        // 8. Build review history from prior cycles
        const reviewHistory = buildReviewHistory(allCycles, params.reviewCycleId, (cycleId) =>
          repos.reviewPacket.findByReviewCycleId(cycleId),
        );

        // 9. Transition ReviewCycle to CONSOLIDATING
        const updatedCycle = repos.reviewCycle.updateStatus(
          params.reviewCycleId,
          sourceStatus,
          ReviewCycleStatus.CONSOLIDATING,
        );
        if (!updatedCycle) {
          throw new InvalidTransitionError(
            "ReviewCycle",
            params.reviewCycleId,
            sourceStatus,
            ReviewCycleStatus.CONSOLIDATING,
            "Status update failed — concurrent modification detected",
          );
        }

        // 10. Record audit event
        const auditEvent = repos.auditEvent.create({
          entityType: "review-cycle",
          entityId: params.reviewCycleId,
          eventType: "review-cycle.consolidation-started",
          actorType: params.actor.type,
          actorId: params.actor.id,
          oldState: sourceStatus,
          newState: ReviewCycleStatus.CONSOLIDATING,
          metadata: JSON.stringify({
            taskId: params.taskId,
            specialistPacketCount: specialistPackets.length,
            priorCycleCount: reviewHistory.length,
            specialistJobIds: specialistJobs.map((j) => j.jobId),
          }),
        });

        return {
          reviewCycle: updatedCycle,
          specialistPackets,
          reviewHistory,
          specialistJobs,
          auditEvents: [auditEvent],
          previousStatus: sourceStatus,
        };
      });

      // ── Emit domain event after commit ──────────────────────────────
      const reviewCycleEvent: DomainEvent = {
        type: "review-cycle.transitioned",
        entityType: "review-cycle",
        entityId: params.reviewCycleId,
        actor: params.actor,
        timestamp: clock(),
        fromStatus: transactionResult.previousStatus,
        toStatus: ReviewCycleStatus.CONSOLIDATING,
      };
      eventEmitter.emit(reviewCycleEvent);

      // ── Return result ───────────────────────────────────────────────
      // ── Metrics instrumentation (§10.13.3) ──────────────────────────
      getStarterMetrics().reviewRounds.inc();

      return {
        reviewCycle: transactionResult.reviewCycle,
        specialistPackets: transactionResult.specialistPackets,
        reviewHistory: transactionResult.reviewHistory,
        specialistJobs: transactionResult.specialistJobs,
        auditEvents: transactionResult.auditEvents,
      };
    },
  };
}
