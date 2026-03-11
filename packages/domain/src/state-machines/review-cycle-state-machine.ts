/**
 * Review Cycle state machine — pure domain module for validating review cycle state transitions.
 *
 * Implements the review cycle lifecycle from PRD §2.2: a review cycle progresses from
 * NOT_STARTED through routing (ROUTED), active reviews (IN_PROGRESS), waiting for
 * required reviews (AWAITING_REQUIRED_REVIEWS), consolidation (CONSOLIDATING), and
 * finally to a terminal decision (APPROVED, REJECTED, or ESCALATED).
 *
 * Each rework cycle on a task creates a new ReviewCycle instance, so there is no
 * "retry" path within a single ReviewCycle — instead, a new ReviewCycle is created.
 *
 * The control plane is the sole authority for committing review cycle state transitions.
 * Review agents propose decisions via schema-valid packets; this module validates
 * whether the proposed transition is legal before the orchestrator commits it.
 *
 * Design decision: Map-based transition table with guard functions,
 * matching the pattern established by the Task state machine.
 * @see {@link file://docs/prd/002-data-model.md} §2.2 Review Cycle State
 * @see {@link file://packages/domain/src/state-machines/task-state-machine.ts} — pattern reference
 *
 * @module @factory/domain/state-machines/review-cycle-state-machine
 */

import { ReviewCycleStatus } from "../enums.js";

// ─── Transition Context ─────────────────────────────────────────────────────

/**
 * Context provided to guard functions for evaluating review cycle transition preconditions.
 *
 * Each field maps to a specific precondition in the review cycle lifecycle.
 * Callers supply only the fields relevant to the transition being validated;
 * missing fields default to `undefined` and will cause guards that require
 * them to reject the transition.
 */
export interface ReviewCycleTransitionContext {
  /**
   * Whether the Review Router has emitted a routing decision assigning specialist reviewers.
   * Required for: NOT_STARTED → ROUTED
   */
  readonly routingDecisionEmitted?: boolean;

  /**
   * Whether at least one specialist reviewer has begun reviewing.
   * Required for: ROUTED → IN_PROGRESS
   */
  readonly reviewStarted?: boolean;

  /**
   * Whether all dispatched specialist reviews are complete but some required reviews
   * are still pending (e.g., waiting for minimum number of approvals).
   * Required for: IN_PROGRESS → AWAITING_REQUIRED_REVIEWS
   */
  readonly awaitingRequiredReviews?: boolean;

  /**
   * Whether all required specialist reviews have been submitted.
   * Required for: IN_PROGRESS → CONSOLIDATING, AWAITING_REQUIRED_REVIEWS → CONSOLIDATING
   */
  readonly allRequiredReviewsComplete?: boolean;

  /**
   * The lead reviewer's consolidated decision after examining all specialist reviews.
   * Required for: CONSOLIDATING → APPROVED, CONSOLIDATING → REJECTED, CONSOLIDATING → ESCALATED
   */
  readonly leadReviewDecision?: "approved" | "approved_with_follow_up" | "rejected" | "escalated";

  /**
   * Whether an escalation trigger fired (automatic or operator-initiated).
   * Required for: IN_PROGRESS → ESCALATED, AWAITING_REQUIRED_REVIEWS → ESCALATED
   */
  readonly hasEscalationTrigger?: boolean;
}

// ─── Transition Result ──────────────────────────────────────────────────────

/**
 * Result of a review cycle transition validation attempt.
 *
 * When `valid` is true, the transition may be committed. When false,
 * `reason` explains why the transition was rejected.
 */
export interface ReviewCycleTransitionResult {
  /** Whether the proposed transition is valid. */
  readonly valid: boolean;
  /** Human-readable explanation when the transition is rejected. */
  readonly reason?: string;
}

// ─── Guard Functions ────────────────────────────────────────────────────────

type GuardFn = (ctx: ReviewCycleTransitionContext) => ReviewCycleTransitionResult;

/** Shorthand for a passing guard result. */
const VALID: ReviewCycleTransitionResult = { valid: true };

/** Shorthand for creating a rejection result. */
function reject(reason: string): ReviewCycleTransitionResult {
  return { valid: false, reason };
}

/**
 * Guard: NOT_STARTED → ROUTED
 * Review Router emits a routing decision assigning specialist reviewers.
 * @see PRD §2.2 Review Cycle State
 */
function guardNotStartedToRouted(ctx: ReviewCycleTransitionContext): ReviewCycleTransitionResult {
  if (ctx.routingDecisionEmitted !== true) {
    return reject("Cannot transition NOT_STARTED → ROUTED: routing decision not emitted");
  }
  return VALID;
}

/**
 * Guard: ROUTED → IN_PROGRESS
 * At least one specialist reviewer has begun reviewing.
 * @see PRD §2.2 Review Cycle State
 */
function guardRoutedToInProgress(ctx: ReviewCycleTransitionContext): ReviewCycleTransitionResult {
  if (ctx.reviewStarted !== true) {
    return reject("Cannot transition ROUTED → IN_PROGRESS: no review has started");
  }
  return VALID;
}

/**
 * Guard: IN_PROGRESS → AWAITING_REQUIRED_REVIEWS
 * Some specialist reviews are complete but required reviews are still pending.
 * @see PRD §2.2 Review Cycle State
 */
function guardInProgressToAwaitingRequiredReviews(
  ctx: ReviewCycleTransitionContext,
): ReviewCycleTransitionResult {
  if (ctx.awaitingRequiredReviews !== true) {
    return reject(
      "Cannot transition IN_PROGRESS → AWAITING_REQUIRED_REVIEWS: not awaiting required reviews",
    );
  }
  return VALID;
}

/**
 * Guard: IN_PROGRESS → CONSOLIDATING
 * All required specialist reviews have been submitted.
 * @see PRD §2.2 Review Cycle State
 */
function guardInProgressToConsolidating(
  ctx: ReviewCycleTransitionContext,
): ReviewCycleTransitionResult {
  if (ctx.allRequiredReviewsComplete !== true) {
    return reject(
      "Cannot transition IN_PROGRESS → CONSOLIDATING: not all required reviews are complete",
    );
  }
  return VALID;
}

/**
 * Guard: AWAITING_REQUIRED_REVIEWS → CONSOLIDATING
 * All required specialist reviews have now been submitted.
 * @see PRD §2.2 Review Cycle State
 */
function guardAwaitingToConsolidating(
  ctx: ReviewCycleTransitionContext,
): ReviewCycleTransitionResult {
  if (ctx.allRequiredReviewsComplete !== true) {
    return reject(
      "Cannot transition AWAITING_REQUIRED_REVIEWS → CONSOLIDATING: not all required reviews are complete",
    );
  }
  return VALID;
}

/**
 * Guard: CONSOLIDATING → APPROVED
 * Lead reviewer emits approved or approved_with_follow_up decision.
 * @see PRD §2.2 Review Cycle State
 */
function guardConsolidatingToApproved(
  ctx: ReviewCycleTransitionContext,
): ReviewCycleTransitionResult {
  if (
    ctx.leadReviewDecision !== "approved" &&
    ctx.leadReviewDecision !== "approved_with_follow_up"
  ) {
    return reject(
      "Cannot transition CONSOLIDATING → APPROVED: lead reviewer decision must be 'approved' or 'approved_with_follow_up'",
    );
  }
  return VALID;
}

/**
 * Guard: CONSOLIDATING → REJECTED
 * Lead reviewer emits rejected decision.
 * @see PRD §2.2 Review Cycle State
 */
function guardConsolidatingToRejected(
  ctx: ReviewCycleTransitionContext,
): ReviewCycleTransitionResult {
  if (ctx.leadReviewDecision !== "rejected") {
    return reject(
      "Cannot transition CONSOLIDATING → REJECTED: lead reviewer decision must be 'rejected'",
    );
  }
  return VALID;
}

/**
 * Guard: CONSOLIDATING → ESCALATED
 * Lead reviewer emits escalated decision.
 * @see PRD §2.2 Review Cycle State
 */
function guardConsolidatingToEscalated(
  ctx: ReviewCycleTransitionContext,
): ReviewCycleTransitionResult {
  if (ctx.leadReviewDecision !== "escalated" && ctx.hasEscalationTrigger !== true) {
    return reject(
      "Cannot transition CONSOLIDATING → ESCALATED: requires lead reviewer 'escalated' decision or escalation trigger",
    );
  }
  return VALID;
}

/**
 * Guard: IN_PROGRESS → ESCALATED
 * Escalation trigger fired during active review (e.g., timeout, policy violation).
 * @see PRD §2.2 Review Cycle State
 */
function guardInProgressToEscalated(
  ctx: ReviewCycleTransitionContext,
): ReviewCycleTransitionResult {
  if (ctx.hasEscalationTrigger !== true) {
    return reject("Cannot transition IN_PROGRESS → ESCALATED: no escalation trigger");
  }
  return VALID;
}

/**
 * Guard: AWAITING_REQUIRED_REVIEWS → ESCALATED
 * Escalation trigger fired while waiting for required reviews (e.g., timeout).
 * @see PRD §2.2 Review Cycle State
 */
function guardAwaitingToEscalated(ctx: ReviewCycleTransitionContext): ReviewCycleTransitionResult {
  if (ctx.hasEscalationTrigger !== true) {
    return reject("Cannot transition AWAITING_REQUIRED_REVIEWS → ESCALATED: no escalation trigger");
  }
  return VALID;
}

// ─── Transition Map ─────────────────────────────────────────────────────────

/**
 * Key for the transition map: "fromState→toState".
 */
type TransitionKey = `${ReviewCycleStatus}→${ReviewCycleStatus}`;

/**
 * Complete transition map for the Review Cycle state machine.
 *
 * The happy path is: NOT_STARTED → ROUTED → IN_PROGRESS → CONSOLIDATING → APPROVED.
 * Alternative paths include AWAITING_REQUIRED_REVIEWS (partial reviews done),
 * REJECTED (rework needed), and ESCALATED (human intervention needed).
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.2 Review Cycle State
 */
const TRANSITION_GUARDS: ReadonlyMap<TransitionKey, GuardFn> = new Map<TransitionKey, GuardFn>([
  // Happy path
  [`${ReviewCycleStatus.NOT_STARTED}→${ReviewCycleStatus.ROUTED}`, guardNotStartedToRouted],
  [`${ReviewCycleStatus.ROUTED}→${ReviewCycleStatus.IN_PROGRESS}`, guardRoutedToInProgress],
  [
    `${ReviewCycleStatus.IN_PROGRESS}→${ReviewCycleStatus.CONSOLIDATING}`,
    guardInProgressToConsolidating,
  ],
  [
    `${ReviewCycleStatus.CONSOLIDATING}→${ReviewCycleStatus.APPROVED}`,
    guardConsolidatingToApproved,
  ],

  // Awaiting required reviews path
  [
    `${ReviewCycleStatus.IN_PROGRESS}→${ReviewCycleStatus.AWAITING_REQUIRED_REVIEWS}`,
    guardInProgressToAwaitingRequiredReviews,
  ],
  [
    `${ReviewCycleStatus.AWAITING_REQUIRED_REVIEWS}→${ReviewCycleStatus.CONSOLIDATING}`,
    guardAwaitingToConsolidating,
  ],

  // Rejection path
  [
    `${ReviewCycleStatus.CONSOLIDATING}→${ReviewCycleStatus.REJECTED}`,
    guardConsolidatingToRejected,
  ],

  // Escalation paths
  [
    `${ReviewCycleStatus.CONSOLIDATING}→${ReviewCycleStatus.ESCALATED}`,
    guardConsolidatingToEscalated,
  ],
  [`${ReviewCycleStatus.IN_PROGRESS}→${ReviewCycleStatus.ESCALATED}`, guardInProgressToEscalated],
  [
    `${ReviewCycleStatus.AWAITING_REQUIRED_REVIEWS}→${ReviewCycleStatus.ESCALATED}`,
    guardAwaitingToEscalated,
  ],
]);

// ─── Terminal States ────────────────────────────────────────────────────────

/**
 * Terminal states from which no further transitions are possible.
 * APPROVED, REJECTED, and ESCALATED are all terminal for a ReviewCycle.
 * A new ReviewCycle is created for rework rather than reusing this one.
 *
 * @see PRD §2.2 Review Cycle State
 */
const TERMINAL_STATES: ReadonlySet<ReviewCycleStatus> = new Set([
  ReviewCycleStatus.APPROVED,
  ReviewCycleStatus.REJECTED,
  ReviewCycleStatus.ESCALATED,
]);

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Validates whether a proposed review cycle state transition is legal.
 *
 * Checks two layers:
 * 1. Is the transition structurally valid (in the transition map)?
 * 2. Does the guard function accept the provided context?
 *
 * @param current - The review cycle's current state
 * @param target - The proposed target state
 * @param context - Contextual information for guard evaluation
 * @returns A ReviewCycleTransitionResult indicating validity and reason for rejection
 *
 * @see PRD §2.2 Review Cycle State
 *
 * @example
 * ```ts
 * const result = validateReviewCycleTransition(
 *   ReviewCycleStatus.NOT_STARTED,
 *   ReviewCycleStatus.ROUTED,
 *   { routingDecisionEmitted: true },
 * );
 * // result.valid === true
 * ```
 */
export function validateReviewCycleTransition(
  current: ReviewCycleStatus,
  target: ReviewCycleStatus,
  context: ReviewCycleTransitionContext = {},
): ReviewCycleTransitionResult {
  // Same-state transitions are never valid
  if (current === target) {
    return reject(`Cannot transition from ${current} to itself`);
  }

  const key: TransitionKey = `${current}→${target}`;
  const guard = TRANSITION_GUARDS.get(key);

  if (guard) {
    return guard(context);
  }

  return reject(
    `Invalid transition: ${current} → ${target} is not a valid review cycle state transition`,
  );
}

/**
 * Returns the set of all states reachable from the given state.
 *
 * Useful for UI display and testing that the transition map is complete.
 *
 * @param current - The review cycle's current state
 * @returns Array of ReviewCycleStatus values that are valid targets from the current state
 */
export function getValidReviewCycleTargets(
  current: ReviewCycleStatus,
): readonly ReviewCycleStatus[] {
  const targets: ReviewCycleStatus[] = [];

  for (const [key] of TRANSITION_GUARDS) {
    const [from, to] = key.split("→") as [ReviewCycleStatus, ReviewCycleStatus];
    if (from === current) {
      targets.push(to);
    }
  }

  return targets;
}

/**
 * Returns whether a given review cycle state is terminal
 * (no further transitions possible).
 *
 * Terminal states: APPROVED, REJECTED, ESCALATED.
 *
 * @param state - The state to check
 * @returns true if the state is terminal
 */
export function isTerminalReviewCycleState(state: ReviewCycleStatus): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Returns the complete set of all valid (from, to) transition pairs.
 *
 * Useful for exhaustive testing and documentation generation.
 *
 * @returns Array of [from, to] tuples representing all valid transitions
 */
export function getAllValidReviewCycleTransitions(): ReadonlyArray<
  readonly [ReviewCycleStatus, ReviewCycleStatus]
> {
  const transitions: Array<[ReviewCycleStatus, ReviewCycleStatus]> = [];

  for (const [key] of TRANSITION_GUARDS) {
    const [from, to] = key.split("→") as [ReviewCycleStatus, ReviewCycleStatus];
    transitions.push([from, to]);
  }

  return transitions;
}
