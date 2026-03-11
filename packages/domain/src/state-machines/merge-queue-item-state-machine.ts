/**
 * Merge Queue Item state machine — pure domain module for validating merge queue item state transitions.
 *
 * Implements the merge queue item lifecycle from PRD §2.2: a merge queue item progresses
 * from ENQUEUED through preparation (PREPARING), rebase (REBASING), validation
 * (VALIDATING), merge execution (MERGING), and finally to a terminal state
 * (MERGED or FAILED). Items may also be REQUEUED if conditions change.
 *
 * The control plane is the sole authority for committing merge queue item state transitions.
 * Merge workers propose transitions via result packets; this module validates
 * whether the proposed transition is legal before the orchestrator commits it.
 *
 * Design decision: Map-based transition table with guard functions,
 * matching the pattern established by the Task state machine.
 * @see {@link file://docs/prd/002-data-model.md} §2.2 Merge Queue Item State
 * @see {@link file://packages/domain/src/state-machines/task-state-machine.ts} — pattern reference
 *
 * @module @factory/domain/state-machines/merge-queue-item-state-machine
 */

import { MergeQueueItemStatus } from "../enums.js";

// ─── Transition Context ─────────────────────────────────────────────────────

/**
 * Context provided to guard functions for evaluating merge queue item transition preconditions.
 *
 * Each field maps to a specific precondition in the merge queue item lifecycle.
 * Callers supply only the fields relevant to the transition being validated;
 * missing fields default to `undefined` and will cause guards that require
 * them to reject the transition.
 */
export interface MergeQueueItemTransitionContext {
  /**
   * Whether the merge worker has been assigned and workspace preparation has begun.
   * Required for: ENQUEUED → PREPARING
   */
  readonly preparationStarted?: boolean;

  /**
   * Whether the workspace has been prepared and rebase can begin.
   * Required for: PREPARING → REBASING
   */
  readonly workspaceReady?: boolean;

  /**
   * Whether the rebase operation completed successfully.
   * Required for: REBASING → VALIDATING
   */
  readonly rebaseSuccessful?: boolean;

  /**
   * Whether the rebase operation failed with conflicts.
   * Required for: REBASING → FAILED, REBASING → REQUEUED
   */
  readonly rebaseFailed?: boolean;

  /**
   * Whether the conflict from a failed rebase is classified as reworkable,
   * meaning the item can be requeued for another attempt.
   * Required for: REBASING → REQUEUED
   */
  readonly conflictReworkable?: boolean;

  /**
   * Whether all pre-merge validation checks passed.
   * Required for: VALIDATING → MERGING
   */
  readonly validationPassed?: boolean;

  /**
   * Whether pre-merge validation checks failed.
   * Required for: VALIDATING → FAILED, VALIDATING → REQUEUED
   */
  readonly validationFailed?: boolean;

  /**
   * Whether the validation failure is transient and the item should be requeued.
   * Required for: VALIDATING → REQUEUED
   */
  readonly failureTransient?: boolean;

  /**
   * Whether the merge operation completed successfully.
   * Required for: MERGING → MERGED
   */
  readonly mergeSuccessful?: boolean;

  /**
   * Whether the merge operation failed.
   * Required for: MERGING → FAILED, MERGING → REQUEUED
   */
  readonly mergeFailed?: boolean;

  /**
   * Whether a higher-priority item has been inserted ahead of this item,
   * requiring a requeue to re-validate against a new base.
   * Required for: ENQUEUED → REQUEUED, VALIDATING → REQUEUED
   */
  readonly preempted?: boolean;
}

// ─── Transition Result ──────────────────────────────────────────────────────

/**
 * Result of a merge queue item transition validation attempt.
 *
 * When `valid` is true, the transition may be committed. When false,
 * `reason` explains why the transition was rejected.
 */
export interface MergeQueueItemTransitionResult {
  /** Whether the proposed transition is valid. */
  readonly valid: boolean;
  /** Human-readable explanation when the transition is rejected. */
  readonly reason?: string;
}

// ─── Guard Functions ────────────────────────────────────────────────────────

type GuardFn = (ctx: MergeQueueItemTransitionContext) => MergeQueueItemTransitionResult;

/** Shorthand for a passing guard result. */
const VALID: MergeQueueItemTransitionResult = { valid: true };

/** Shorthand for creating a rejection result. */
function reject(reason: string): MergeQueueItemTransitionResult {
  return { valid: false, reason };
}

/**
 * Guard: ENQUEUED → PREPARING
 * Merge worker has been assigned and workspace preparation has begun.
 * @see PRD §2.2 Merge Queue Item State
 */
function guardEnqueuedToPreparing(
  ctx: MergeQueueItemTransitionContext,
): MergeQueueItemTransitionResult {
  if (ctx.preparationStarted !== true) {
    return reject("Cannot transition ENQUEUED → PREPARING: preparation not started");
  }
  return VALID;
}

/**
 * Guard: PREPARING → REBASING
 * Workspace has been prepared and rebase can begin.
 * @see PRD §2.2 Merge Queue Item State
 */
function guardPreparingToRebasing(
  ctx: MergeQueueItemTransitionContext,
): MergeQueueItemTransitionResult {
  if (ctx.workspaceReady !== true) {
    return reject("Cannot transition PREPARING → REBASING: workspace not ready");
  }
  return VALID;
}

/**
 * Guard: REBASING → VALIDATING
 * Rebase completed successfully; pre-merge validation can begin.
 * @see PRD §2.2 Merge Queue Item State
 */
function guardRebasingToValidating(
  ctx: MergeQueueItemTransitionContext,
): MergeQueueItemTransitionResult {
  if (ctx.rebaseSuccessful !== true) {
    return reject("Cannot transition REBASING → VALIDATING: rebase not successful");
  }
  return VALID;
}

/**
 * Guard: REBASING → FAILED
 * Rebase failed with non-reworkable conflicts.
 * @see PRD §2.2 Merge Queue Item State
 */
function guardRebasingToFailed(
  ctx: MergeQueueItemTransitionContext,
): MergeQueueItemTransitionResult {
  if (ctx.rebaseFailed !== true) {
    return reject("Cannot transition REBASING → FAILED: rebase has not failed");
  }
  return VALID;
}

/**
 * Guard: REBASING → REQUEUED
 * Rebase failed with reworkable conflicts; item is requeued for another attempt.
 * @see PRD §2.2 Merge Queue Item State
 */
function guardRebasingToRequeued(
  ctx: MergeQueueItemTransitionContext,
): MergeQueueItemTransitionResult {
  if (ctx.rebaseFailed !== true) {
    return reject("Cannot transition REBASING → REQUEUED: rebase has not failed");
  }
  if (ctx.conflictReworkable !== true) {
    return reject("Cannot transition REBASING → REQUEUED: conflict is not reworkable");
  }
  return VALID;
}

/**
 * Guard: VALIDATING → MERGING
 * All pre-merge validation checks passed.
 * @see PRD §2.2 Merge Queue Item State
 */
function guardValidatingToMerging(
  ctx: MergeQueueItemTransitionContext,
): MergeQueueItemTransitionResult {
  if (ctx.validationPassed !== true) {
    return reject("Cannot transition VALIDATING → MERGING: validation not passed");
  }
  return VALID;
}

/**
 * Guard: VALIDATING → FAILED
 * Pre-merge validation checks failed with non-transient failure.
 * @see PRD §2.2 Merge Queue Item State
 */
function guardValidatingToFailed(
  ctx: MergeQueueItemTransitionContext,
): MergeQueueItemTransitionResult {
  if (ctx.validationFailed !== true) {
    return reject("Cannot transition VALIDATING → FAILED: validation has not failed");
  }
  return VALID;
}

/**
 * Guard: VALIDATING → REQUEUED
 * Validation failed with a transient failure, or item was preempted.
 * @see PRD §2.2 Merge Queue Item State
 */
function guardValidatingToRequeued(
  ctx: MergeQueueItemTransitionContext,
): MergeQueueItemTransitionResult {
  const transientFailure = ctx.validationFailed === true && ctx.failureTransient === true;
  const preempted = ctx.preempted === true;

  if (!transientFailure && !preempted) {
    return reject(
      "Cannot transition VALIDATING → REQUEUED: requires transient validation failure or preemption",
    );
  }
  return VALID;
}

/**
 * Guard: MERGING → MERGED
 * Merge operation completed successfully.
 * @see PRD §2.2 Merge Queue Item State
 */
function guardMergingToMerged(
  ctx: MergeQueueItemTransitionContext,
): MergeQueueItemTransitionResult {
  if (ctx.mergeSuccessful !== true) {
    return reject("Cannot transition MERGING → MERGED: merge not successful");
  }
  return VALID;
}

/**
 * Guard: MERGING → FAILED
 * Merge operation failed irrecoverably.
 * @see PRD §2.2 Merge Queue Item State
 */
function guardMergingToFailed(
  ctx: MergeQueueItemTransitionContext,
): MergeQueueItemTransitionResult {
  if (ctx.mergeFailed !== true) {
    return reject("Cannot transition MERGING → FAILED: merge has not failed");
  }
  return VALID;
}

/**
 * Guard: MERGING → REQUEUED
 * Merge failed but can be retried (e.g., transient git error).
 * @see PRD §2.2 Merge Queue Item State
 */
function guardMergingToRequeued(
  ctx: MergeQueueItemTransitionContext,
): MergeQueueItemTransitionResult {
  if (ctx.mergeFailed !== true) {
    return reject("Cannot transition MERGING → REQUEUED: merge has not failed");
  }
  if (ctx.failureTransient !== true) {
    return reject("Cannot transition MERGING → REQUEUED: failure is not transient");
  }
  return VALID;
}

/**
 * Guard: REQUEUED → ENQUEUED
 * Item re-enters the queue for another attempt.
 * This is an unconditional transition — the orchestrator decides to re-enqueue.
 * @see PRD §2.2 Merge Queue Item State
 */
function guardRequeuedToEnqueued(
  _ctx: MergeQueueItemTransitionContext,
): MergeQueueItemTransitionResult {
  return VALID;
}

// ─── Transition Map ─────────────────────────────────────────────────────────

/**
 * Key for the transition map: "fromState→toState".
 */
type TransitionKey = `${MergeQueueItemStatus}→${MergeQueueItemStatus}`;

/**
 * Complete transition map for the Merge Queue Item state machine.
 *
 * The happy path is: ENQUEUED → PREPARING → REBASING → VALIDATING → MERGING → MERGED.
 * Alternative paths handle rebase failures, validation failures, merge failures,
 * and requeuing for retry.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.2 Merge Queue Item State
 */
const TRANSITION_GUARDS: ReadonlyMap<TransitionKey, GuardFn> = new Map<TransitionKey, GuardFn>([
  // Happy path
  [`${MergeQueueItemStatus.ENQUEUED}→${MergeQueueItemStatus.PREPARING}`, guardEnqueuedToPreparing],
  [`${MergeQueueItemStatus.PREPARING}→${MergeQueueItemStatus.REBASING}`, guardPreparingToRebasing],
  [
    `${MergeQueueItemStatus.REBASING}→${MergeQueueItemStatus.VALIDATING}`,
    guardRebasingToValidating,
  ],
  [`${MergeQueueItemStatus.VALIDATING}→${MergeQueueItemStatus.MERGING}`, guardValidatingToMerging],
  [`${MergeQueueItemStatus.MERGING}→${MergeQueueItemStatus.MERGED}`, guardMergingToMerged],

  // Rebase failure paths
  [`${MergeQueueItemStatus.REBASING}→${MergeQueueItemStatus.FAILED}`, guardRebasingToFailed],
  [`${MergeQueueItemStatus.REBASING}→${MergeQueueItemStatus.REQUEUED}`, guardRebasingToRequeued],

  // Validation failure paths
  [`${MergeQueueItemStatus.VALIDATING}→${MergeQueueItemStatus.FAILED}`, guardValidatingToFailed],
  [
    `${MergeQueueItemStatus.VALIDATING}→${MergeQueueItemStatus.REQUEUED}`,
    guardValidatingToRequeued,
  ],

  // Merge failure paths
  [`${MergeQueueItemStatus.MERGING}→${MergeQueueItemStatus.FAILED}`, guardMergingToFailed],
  [`${MergeQueueItemStatus.MERGING}→${MergeQueueItemStatus.REQUEUED}`, guardMergingToRequeued],

  // Requeue → re-enqueue
  [`${MergeQueueItemStatus.REQUEUED}→${MergeQueueItemStatus.ENQUEUED}`, guardRequeuedToEnqueued],
]);

// ─── Terminal States ────────────────────────────────────────────────────────

/**
 * Terminal states from which no further transitions are possible.
 * MERGED means the merge completed successfully.
 * FAILED means an irrecoverable failure occurred.
 *
 * Note: REQUEUED is NOT terminal — it transitions back to ENQUEUED.
 *
 * @see PRD §2.2 Merge Queue Item State
 */
const TERMINAL_STATES: ReadonlySet<MergeQueueItemStatus> = new Set([
  MergeQueueItemStatus.MERGED,
  MergeQueueItemStatus.FAILED,
]);

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Validates whether a proposed merge queue item state transition is legal.
 *
 * Checks two layers:
 * 1. Is the transition structurally valid (in the transition map)?
 * 2. Does the guard function accept the provided context?
 *
 * @param current - The merge queue item's current state
 * @param target - The proposed target state
 * @param context - Contextual information for guard evaluation
 * @returns A MergeQueueItemTransitionResult indicating validity and reason for rejection
 *
 * @see PRD §2.2 Merge Queue Item State
 *
 * @example
 * ```ts
 * const result = validateMergeQueueItemTransition(
 *   MergeQueueItemStatus.ENQUEUED,
 *   MergeQueueItemStatus.PREPARING,
 *   { preparationStarted: true },
 * );
 * // result.valid === true
 * ```
 */
export function validateMergeQueueItemTransition(
  current: MergeQueueItemStatus,
  target: MergeQueueItemStatus,
  context: MergeQueueItemTransitionContext = {},
): MergeQueueItemTransitionResult {
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
    `Invalid transition: ${current} → ${target} is not a valid merge queue item state transition`,
  );
}

/**
 * Returns the set of all states reachable from the given state.
 *
 * Useful for UI display and testing that the transition map is complete.
 *
 * @param current - The merge queue item's current state
 * @returns Array of MergeQueueItemStatus values that are valid targets from the current state
 */
export function getValidMergeQueueItemTargets(
  current: MergeQueueItemStatus,
): readonly MergeQueueItemStatus[] {
  const targets: MergeQueueItemStatus[] = [];

  for (const [key] of TRANSITION_GUARDS) {
    const [from, to] = key.split("→") as [MergeQueueItemStatus, MergeQueueItemStatus];
    if (from === current) {
      targets.push(to);
    }
  }

  return targets;
}

/**
 * Returns whether a given merge queue item state is terminal
 * (no further transitions possible).
 *
 * Terminal states: MERGED, FAILED.
 *
 * @param state - The state to check
 * @returns true if the state is terminal
 */
export function isTerminalMergeQueueItemState(state: MergeQueueItemStatus): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Returns the complete set of all valid (from, to) transition pairs.
 *
 * Useful for exhaustive testing and documentation generation.
 *
 * @returns Array of [from, to] tuples representing all valid transitions
 */
export function getAllValidMergeQueueItemTransitions(): ReadonlyArray<
  readonly [MergeQueueItemStatus, MergeQueueItemStatus]
> {
  const transitions: Array<[MergeQueueItemStatus, MergeQueueItemStatus]> = [];

  for (const [key] of TRANSITION_GUARDS) {
    const [from, to] = key.split("→") as [MergeQueueItemStatus, MergeQueueItemStatus];
    transitions.push([from, to]);
  }

  return transitions;
}
