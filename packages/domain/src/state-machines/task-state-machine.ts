/**
 * Task state machine — pure domain module for validating task state transitions.
 *
 * Implements the canonical task lifecycle from PRD §2.1, including all 16 states,
 * explicit transition rules, wildcard transitions (* → ESCALATED, * → CANCELLED),
 * and guard-based precondition checks.
 *
 * The control plane is the sole authority for committing task state transitions.
 * Workers propose transitions via schema-valid packets; this module validates
 * whether the proposed transition is legal before the orchestrator commits it.
 *
 * Design decision: Map-based transition table with guard functions.
 * @see {@link file://docs/design-decisions/task-state-machine-design.md}
 * @see {@link file://docs/prd/002-data-model.md} §2.1 Task State Machine
 * @see {@link file://docs/prd/010-integration-contracts.md} §10.2 Canonical State Transition Ownership
 *
 * @module @factory/domain/state-machines/task-state-machine
 */

import { TaskStatus } from "../enums.js";

// ─── Transition Context ─────────────────────────────────────────────────────

/**
 * Context provided to guard functions for evaluating transition preconditions.
 *
 * Each field maps to a specific precondition from PRD §2.1 transition table.
 * Callers supply only the fields relevant to the transition being validated;
 * missing fields default to `undefined` and will cause guards that require
 * them to reject the transition.
 */
export interface TransitionContext {
  /**
   * Whether all hard-block dependencies for the task are resolved.
   * Required for: BACKLOG → READY, BLOCKED → READY
   */
  readonly allDependenciesResolved?: boolean;

  /**
   * Whether policy blockers exist for the task.
   * Required for: BACKLOG → READY (must be false), BACKLOG → BLOCKED, BLOCKED → READY (must be false)
   */
  readonly hasPolicyBlockers?: boolean;

  /**
   * Whether a hard-block dependency was added or policy blocker detected.
   * Required for: BACKLOG → BLOCKED
   */
  readonly hasBlockers?: boolean;

  /**
   * Whether the scheduler selected the task and a lease was successfully acquired.
   * Required for: READY → ASSIGNED, CHANGES_REQUESTED → ASSIGNED, ESCALATED → ASSIGNED
   */
  readonly leaseAcquired?: boolean;

  /**
   * Whether the worker has sent its first heartbeat confirming session start.
   * Required for: ASSIGNED → IN_DEVELOPMENT
   */
  readonly hasHeartbeat?: boolean;

  /**
   * Whether the worker has emitted a schema-valid DevResultPacket.
   * Required for: IN_DEVELOPMENT → DEV_COMPLETE
   */
  readonly hasDevResultPacket?: boolean;

  /**
   * Whether required validations have passed (e.g., default-dev profile checks).
   * Required for: IN_DEVELOPMENT → DEV_COMPLETE
   */
  readonly requiredValidationsPassed?: boolean;

  /**
   * Whether the Review Router has emitted a routing decision and ReviewCycle was created.
   * Required for: DEV_COMPLETE → IN_REVIEW
   */
  readonly hasReviewRoutingDecision?: boolean;

  /**
   * The lead reviewer's decision.
   * Required for: IN_REVIEW → CHANGES_REQUESTED, IN_REVIEW → APPROVED
   */
  readonly leadReviewDecision?:
    | "approved"
    | "approved_with_follow_up"
    | "changes_requested"
    | "escalated";

  /**
   * Whether the merge completed successfully.
   * Required for: MERGING → POST_MERGE_VALIDATION
   */
  readonly mergeSuccessful?: boolean;

  /**
   * Classification of merge conflict per merge_policy.conflict_classification.
   * Required for: MERGING → CHANGES_REQUESTED, MERGING → FAILED
   */
  readonly mergeConflictClassification?: "reworkable" | "non_reworkable";

  /**
   * Whether all required post-merge checks passed.
   * Required for: POST_MERGE_VALIDATION → DONE, POST_MERGE_VALIDATION → FAILED
   */
  readonly postMergeValidationPassed?: boolean;

  /**
   * Whether an unrecoverable execution failure occurred.
   * Required for: IN_DEVELOPMENT → FAILED
   */
  readonly hasUnrecoverableFailure?: boolean;

  /**
   * Whether the lease timed out with no retries remaining.
   * Required for: IN_DEVELOPMENT → FAILED
   */
  readonly leaseTimedOutNoRetry?: boolean;

  /**
   * Whether the caller is an operator (human or escalation policy).
   * Required for: * → ESCALATED, * → CANCELLED, ESCALATED → *
   */
  readonly isOperator?: boolean;

  /**
   * Whether an automatic escalation trigger fired (per §2.7 escalation policy).
   * Required for: * → ESCALATED (when not operator-initiated)
   */
  readonly hasEscalationTrigger?: boolean;
}

// ─── Transition Result ──────────────────────────────────────────────────────

/**
 * Result of a transition validation attempt.
 *
 * When `valid` is true, the transition may be committed. When false,
 * `reason` explains why the transition was rejected.
 */
export interface TransitionResult {
  /** Whether the proposed transition is valid. */
  readonly valid: boolean;
  /** Human-readable explanation when the transition is rejected. */
  readonly reason?: string;
}

// ─── Guard Functions ────────────────────────────────────────────────────────

/**
 * Guard function signature: receives transition context and returns a TransitionResult.
 */
type GuardFn = (ctx: TransitionContext) => TransitionResult;

/** Shorthand for a passing guard result. */
const VALID: TransitionResult = { valid: true };

/** Shorthand for creating a rejection result. */
function reject(reason: string): TransitionResult {
  return { valid: false, reason };
}

/**
 * Guard: BACKLOG → READY
 * All hard-block dependencies must be resolved AND no policy blockers remain.
 * @see PRD §2.1 Transition Preconditions
 */
function guardBacklogToReady(ctx: TransitionContext): TransitionResult {
  if (ctx.allDependenciesResolved !== true) {
    return reject(
      "Cannot transition BACKLOG → READY: not all hard-block dependencies are resolved",
    );
  }
  if (ctx.hasPolicyBlockers === true) {
    return reject("Cannot transition BACKLOG → READY: policy blockers remain");
  }
  return VALID;
}

/**
 * Guard: BACKLOG → BLOCKED
 * Hard-block dependency added or policy blocker detected.
 * @see PRD §2.1 Transition Preconditions
 */
function guardBacklogToBlocked(ctx: TransitionContext): TransitionResult {
  if (ctx.hasBlockers !== true && ctx.hasPolicyBlockers !== true) {
    return reject(
      "Cannot transition BACKLOG → BLOCKED: no hard-block dependency or policy blocker detected",
    );
  }
  return VALID;
}

/**
 * Guard: BLOCKED → READY
 * Last hard-block dependency resolved AND no policy blockers remain.
 * @see PRD §2.1 Transition Preconditions
 */
function guardBlockedToReady(ctx: TransitionContext): TransitionResult {
  if (ctx.allDependenciesResolved !== true) {
    return reject(
      "Cannot transition BLOCKED → READY: not all hard-block dependencies are resolved",
    );
  }
  if (ctx.hasPolicyBlockers === true) {
    return reject("Cannot transition BLOCKED → READY: policy blockers remain");
  }
  return VALID;
}

/**
 * Guard: READY → ASSIGNED
 * Scheduler selects task AND lease acquired successfully.
 * @see PRD §2.1 Transition Preconditions
 */
function guardReadyToAssigned(ctx: TransitionContext): TransitionResult {
  if (ctx.leaseAcquired !== true) {
    return reject("Cannot transition READY → ASSIGNED: lease not acquired");
  }
  return VALID;
}

/**
 * Guard: ASSIGNED → IN_DEVELOPMENT
 * Worker sends first heartbeat confirming session start.
 * @see PRD §2.1 Transition Preconditions
 */
function guardAssignedToInDevelopment(ctx: TransitionContext): TransitionResult {
  if (ctx.hasHeartbeat !== true) {
    return reject("Cannot transition ASSIGNED → IN_DEVELOPMENT: no worker heartbeat received");
  }
  return VALID;
}

/**
 * Guard: IN_DEVELOPMENT → DEV_COMPLETE
 * Worker emits schema-valid DevResultPacket AND required validations pass.
 * @see PRD §2.1 Transition Preconditions
 * @see PRD §2.11 — IN_DEVELOPMENT → DEV_COMPLETE requires default-dev profile checks to pass
 */
function guardInDevelopmentToDevComplete(ctx: TransitionContext): TransitionResult {
  if (ctx.hasDevResultPacket !== true) {
    return reject(
      "Cannot transition IN_DEVELOPMENT → DEV_COMPLETE: no schema-valid DevResultPacket received",
    );
  }
  if (ctx.requiredValidationsPassed !== true) {
    return reject(
      "Cannot transition IN_DEVELOPMENT → DEV_COMPLETE: required validations have not passed",
    );
  }
  return VALID;
}

/**
 * Guard: IN_DEVELOPMENT → FAILED
 * Unrecoverable execution failure OR lease timeout with no retry remaining.
 * @see PRD §2.1 Transition Preconditions
 */
function guardInDevelopmentToFailed(ctx: TransitionContext): TransitionResult {
  if (ctx.hasUnrecoverableFailure !== true && ctx.leaseTimedOutNoRetry !== true) {
    return reject(
      "Cannot transition IN_DEVELOPMENT → FAILED: no unrecoverable failure and lease has not timed out without retry",
    );
  }
  return VALID;
}

/**
 * Guard: DEV_COMPLETE → IN_REVIEW
 * Review Router emits routing decision; ReviewCycle created.
 * @see PRD §2.1 Transition Preconditions
 */
function guardDevCompleteToInReview(ctx: TransitionContext): TransitionResult {
  if (ctx.hasReviewRoutingDecision !== true) {
    return reject("Cannot transition DEV_COMPLETE → IN_REVIEW: no review routing decision emitted");
  }
  return VALID;
}

/**
 * Guard: IN_REVIEW → CHANGES_REQUESTED
 * Lead reviewer emits changes_requested or escalated decision mapped to rework.
 * @see PRD §2.1 Transition Preconditions
 */
function guardInReviewToChangesRequested(ctx: TransitionContext): TransitionResult {
  if (ctx.leadReviewDecision !== "changes_requested" && ctx.leadReviewDecision !== "escalated") {
    return reject(
      "Cannot transition IN_REVIEW → CHANGES_REQUESTED: lead reviewer decision must be 'changes_requested' or 'escalated'",
    );
  }
  return VALID;
}

/**
 * Guard: IN_REVIEW → APPROVED
 * Lead reviewer emits approved or approved_with_follow_up decision.
 * @see PRD §2.1 Transition Preconditions
 */
function guardInReviewToApproved(ctx: TransitionContext): TransitionResult {
  if (
    ctx.leadReviewDecision !== "approved" &&
    ctx.leadReviewDecision !== "approved_with_follow_up"
  ) {
    return reject(
      "Cannot transition IN_REVIEW → APPROVED: lead reviewer decision must be 'approved' or 'approved_with_follow_up'",
    );
  }
  return VALID;
}

/**
 * Guard: CHANGES_REQUESTED → ASSIGNED
 * Scheduler re-selects task for rework; new lease acquired.
 * @see PRD §2.1 Transition Preconditions
 */
function guardChangesRequestedToAssigned(ctx: TransitionContext): TransitionResult {
  if (ctx.leaseAcquired !== true) {
    return reject(
      "Cannot transition CHANGES_REQUESTED → ASSIGNED: new lease not acquired for rework",
    );
  }
  return VALID;
}

/**
 * Guard: APPROVED → QUEUED_FOR_MERGE
 * Orchestrator enqueues task. No additional preconditions beyond being APPROVED.
 * @see PRD §2.1 Transition Preconditions
 */
function guardApprovedToQueuedForMerge(_ctx: TransitionContext): TransitionResult {
  return VALID;
}

/**
 * Guard: QUEUED_FOR_MERGE → MERGING
 * Merge worker dequeues item and begins integration.
 * @see PRD §2.1 Transition Preconditions
 */
function guardQueuedForMergeToMerging(_ctx: TransitionContext): TransitionResult {
  return VALID;
}

/**
 * Guard: MERGING → POST_MERGE_VALIDATION
 * Merge completes successfully; post-merge validation triggered.
 * @see PRD §2.1 Transition Preconditions
 */
function guardMergingToPostMergeValidation(ctx: TransitionContext): TransitionResult {
  if (ctx.mergeSuccessful !== true) {
    return reject(
      "Cannot transition MERGING → POST_MERGE_VALIDATION: merge did not complete successfully",
    );
  }
  return VALID;
}

/**
 * Guard: MERGING → CHANGES_REQUESTED
 * Merge conflict classified as reworkable by merge_policy.conflict_classification.
 * @see PRD §2.1 Transition Preconditions
 * @see PRD §10.10.2 Merge Conflict Classification
 */
function guardMergingToChangesRequested(ctx: TransitionContext): TransitionResult {
  if (ctx.mergeConflictClassification !== "reworkable") {
    return reject(
      "Cannot transition MERGING → CHANGES_REQUESTED: merge conflict not classified as reworkable",
    );
  }
  return VALID;
}

/**
 * Guard: MERGING → FAILED
 * Integration irrecoverably fails (policy classifies as non-reworkable).
 * @see PRD §2.1 Transition Preconditions
 */
function guardMergingToFailed(ctx: TransitionContext): TransitionResult {
  if (ctx.mergeConflictClassification !== "non_reworkable") {
    return reject(
      "Cannot transition MERGING → FAILED: merge conflict not classified as non-reworkable",
    );
  }
  return VALID;
}

/**
 * Guard: POST_MERGE_VALIDATION → DONE
 * All required post-merge checks pass.
 * @see PRD §2.1 Transition Preconditions
 */
function guardPostMergeValidationToDone(ctx: TransitionContext): TransitionResult {
  if (ctx.postMergeValidationPassed !== true) {
    return reject(
      "Cannot transition POST_MERGE_VALIDATION → DONE: required post-merge checks have not passed",
    );
  }
  return VALID;
}

/**
 * Guard: POST_MERGE_VALIDATION → FAILED
 * Required post-merge check fails.
 * @see PRD §2.1 Transition Preconditions
 */
function guardPostMergeValidationToFailed(ctx: TransitionContext): TransitionResult {
  if (ctx.postMergeValidationPassed !== false) {
    return reject(
      "Cannot transition POST_MERGE_VALIDATION → FAILED: post-merge validation has not explicitly failed",
    );
  }
  return VALID;
}

/**
 * Guard: * → ESCALATED
 * Operator manual escalation OR automatic trigger per escalation policy (§2.7).
 * Only non-terminal states may transition to ESCALATED.
 * @see PRD §2.1 Transition Preconditions
 * @see PRD §2.7 Escalation Trigger Conditions
 */
function guardToEscalated(ctx: TransitionContext): TransitionResult {
  if (ctx.isOperator !== true && ctx.hasEscalationTrigger !== true) {
    return reject("Cannot transition to ESCALATED: requires operator action or escalation trigger");
  }
  return VALID;
}

/**
 * Guard: * → CANCELLED
 * Operator cancels task OR policy-driven cancellation.
 * Only non-terminal states may transition to CANCELLED.
 * @see PRD §2.1 Transition Preconditions
 */
function guardToCancelled(ctx: TransitionContext): TransitionResult {
  if (ctx.isOperator !== true) {
    return reject("Cannot transition to CANCELLED: requires operator action");
  }
  return VALID;
}

/**
 * Guard: ESCALATED → ASSIGNED
 * Operator resolves escalation by retrying the task; new lease acquired.
 * @see PRD §2.1 Transition Preconditions
 */
function guardEscalatedToAssigned(ctx: TransitionContext): TransitionResult {
  if (ctx.isOperator !== true) {
    return reject("Cannot transition ESCALATED → ASSIGNED: requires operator action");
  }
  if (ctx.leaseAcquired !== true) {
    return reject("Cannot transition ESCALATED → ASSIGNED: new lease not acquired");
  }
  return VALID;
}

/**
 * Guard: ESCALATED → CANCELLED
 * Operator resolves escalation by abandoning the task.
 * @see PRD §2.1 Transition Preconditions
 */
function guardEscalatedToCancelled(ctx: TransitionContext): TransitionResult {
  if (ctx.isOperator !== true) {
    return reject("Cannot transition ESCALATED → CANCELLED: requires operator action");
  }
  return VALID;
}

/**
 * Guard: ESCALATED → DONE
 * Operator resolves escalation by marking task as externally completed.
 * @see PRD §2.1 Transition Preconditions
 */
function guardEscalatedToDone(ctx: TransitionContext): TransitionResult {
  if (ctx.isOperator !== true) {
    return reject("Cannot transition ESCALATED → DONE: requires operator action");
  }
  return VALID;
}

// ─── Transition Map ─────────────────────────────────────────────────────────

/**
 * Key for the transition map: "fromState→toState".
 */
type TransitionKey = `${TaskStatus}→${TaskStatus}`;

/**
 * Complete transition map from PRD §2.1.
 *
 * Maps each valid (from, to) pair to its guard function. Wildcard transitions
 * (* → ESCALATED, * → CANCELLED) are handled separately in {@link validateTransition}
 * but also have entries here for the specific ESCALATED source state.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.1 Transition Rules
 */
const TRANSITION_GUARDS: ReadonlyMap<TransitionKey, GuardFn> = new Map<TransitionKey, GuardFn>([
  // Normal flow
  [`${TaskStatus.BACKLOG}→${TaskStatus.READY}`, guardBacklogToReady],
  [`${TaskStatus.BACKLOG}→${TaskStatus.BLOCKED}`, guardBacklogToBlocked],
  [`${TaskStatus.BLOCKED}→${TaskStatus.READY}`, guardBlockedToReady],
  [`${TaskStatus.READY}→${TaskStatus.ASSIGNED}`, guardReadyToAssigned],
  [`${TaskStatus.ASSIGNED}→${TaskStatus.IN_DEVELOPMENT}`, guardAssignedToInDevelopment],
  [`${TaskStatus.IN_DEVELOPMENT}→${TaskStatus.DEV_COMPLETE}`, guardInDevelopmentToDevComplete],
  [`${TaskStatus.IN_DEVELOPMENT}→${TaskStatus.FAILED}`, guardInDevelopmentToFailed],
  [`${TaskStatus.DEV_COMPLETE}→${TaskStatus.IN_REVIEW}`, guardDevCompleteToInReview],
  [`${TaskStatus.IN_REVIEW}→${TaskStatus.CHANGES_REQUESTED}`, guardInReviewToChangesRequested],
  [`${TaskStatus.IN_REVIEW}→${TaskStatus.APPROVED}`, guardInReviewToApproved],
  [`${TaskStatus.CHANGES_REQUESTED}→${TaskStatus.ASSIGNED}`, guardChangesRequestedToAssigned],
  [`${TaskStatus.APPROVED}→${TaskStatus.QUEUED_FOR_MERGE}`, guardApprovedToQueuedForMerge],
  [`${TaskStatus.QUEUED_FOR_MERGE}→${TaskStatus.MERGING}`, guardQueuedForMergeToMerging],
  [`${TaskStatus.MERGING}→${TaskStatus.POST_MERGE_VALIDATION}`, guardMergingToPostMergeValidation],
  [`${TaskStatus.MERGING}→${TaskStatus.CHANGES_REQUESTED}`, guardMergingToChangesRequested],
  [`${TaskStatus.MERGING}→${TaskStatus.FAILED}`, guardMergingToFailed],
  [`${TaskStatus.POST_MERGE_VALIDATION}→${TaskStatus.DONE}`, guardPostMergeValidationToDone],
  [`${TaskStatus.POST_MERGE_VALIDATION}→${TaskStatus.FAILED}`, guardPostMergeValidationToFailed],

  // ESCALATED resolutions (operator only)
  [`${TaskStatus.ESCALATED}→${TaskStatus.ASSIGNED}`, guardEscalatedToAssigned],
  [`${TaskStatus.ESCALATED}→${TaskStatus.CANCELLED}`, guardEscalatedToCancelled],
  [`${TaskStatus.ESCALATED}→${TaskStatus.DONE}`, guardEscalatedToDone],
]);

// ─── Terminal and Escalatable State Sets ────────────────────────────────────

/**
 * Terminal states from which no further automated transitions are possible.
 * DONE is immutable except via reopen operation. FAILED and CANCELLED are final.
 *
 * @see PRD §2.1 Global Invariants: "a task in DONE is immutable except via reopen operation"
 */
const TERMINAL_STATES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.DONE,
  TaskStatus.FAILED,
  TaskStatus.CANCELLED,
]);

/**
 * States from which a task can be escalated or cancelled.
 * This is all states except terminal states (DONE, FAILED, CANCELLED).
 * ESCALATED itself CAN be cancelled (ESCALATED → CANCELLED is in the explicit map).
 *
 * Note: ESCALATED tasks use the explicit transition map (ESCALATED → ASSIGNED/CANCELLED/DONE),
 * not the wildcard * → ESCALATED path (you don't escalate an already-escalated task).
 */
const WILDCARD_ESCALATION_SOURCES: ReadonlySet<TaskStatus> = new Set(
  Object.values(TaskStatus).filter((s) => !TERMINAL_STATES.has(s) && s !== TaskStatus.ESCALATED),
);

/**
 * States from which a task can be cancelled via wildcard.
 * All non-terminal states including ESCALATED (which has its own explicit guard).
 */
const WILDCARD_CANCELLATION_SOURCES: ReadonlySet<TaskStatus> = new Set(
  Object.values(TaskStatus).filter((s) => !TERMINAL_STATES.has(s)),
);

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Validates whether a proposed task state transition is legal.
 *
 * Checks three layers in order:
 * 1. Is the transition structurally valid (in the transition map or wildcard set)?
 * 2. Does the guard function for that transition accept the provided context?
 *
 * The caller must also enforce optimistic concurrency (Task.version check)
 * before committing the transition — that concern is outside this module.
 *
 * @param current - The task's current state
 * @param target - The proposed target state
 * @param context - Contextual information for guard evaluation
 * @returns A TransitionResult indicating validity and reason for rejection
 *
 * @see PRD §2.1 Task State Machine
 * @see PRD §10.2.2 — Workers never mutate task state directly
 * @see PRD §10.2.3 — Optimistic concurrency control (enforced by caller)
 *
 * @example
 * ```ts
 * const result = validateTransition(
 *   TaskStatus.BACKLOG,
 *   TaskStatus.READY,
 *   { allDependenciesResolved: true, hasPolicyBlockers: false },
 * );
 * // result.valid === true
 * ```
 */
export function validateTransition(
  current: TaskStatus,
  target: TaskStatus,
  context: TransitionContext = {},
): TransitionResult {
  // Same-state transitions are never valid
  if (current === target) {
    return reject(`Cannot transition from ${current} to itself`);
  }

  // Check explicit transition map first
  const key: TransitionKey = `${current}→${target}`;
  const guard = TRANSITION_GUARDS.get(key);

  if (guard) {
    return guard(context);
  }

  // Check wildcard: * → ESCALATED
  if (target === TaskStatus.ESCALATED) {
    if (WILDCARD_ESCALATION_SOURCES.has(current)) {
      return guardToEscalated(context);
    }
    return reject(`Cannot transition ${current} → ESCALATED: ${current} is a terminal state`);
  }

  // Check wildcard: * → CANCELLED (non-ESCALATED sources; ESCALATED → CANCELLED is in explicit map)
  if (target === TaskStatus.CANCELLED && current !== TaskStatus.ESCALATED) {
    if (WILDCARD_CANCELLATION_SOURCES.has(current)) {
      return guardToCancelled(context);
    }
    return reject(`Cannot transition ${current} → CANCELLED: ${current} is a terminal state`);
  }

  // Transition not found in any valid path
  return reject(`Invalid transition: ${current} → ${target} is not a valid task state transition`);
}

/**
 * Returns the set of all states reachable from the given state.
 *
 * Useful for UI display (showing available actions) and for testing
 * that the transition map is complete.
 *
 * @param current - The task's current state
 * @returns Array of TaskStatus values that are valid targets from the current state
 */
export function getValidTargets(current: TaskStatus): readonly TaskStatus[] {
  const targets: TaskStatus[] = [];

  // Check explicit transitions
  for (const [key] of TRANSITION_GUARDS) {
    const [from, to] = key.split("→") as [TaskStatus, TaskStatus];
    if (from === current) {
      targets.push(to);
    }
  }

  // Check wildcard escalation
  if (WILDCARD_ESCALATION_SOURCES.has(current)) {
    targets.push(TaskStatus.ESCALATED);
  }

  // Check wildcard cancellation (avoid duplicate if already in explicit map)
  if (WILDCARD_CANCELLATION_SOURCES.has(current) && !targets.includes(TaskStatus.CANCELLED)) {
    targets.push(TaskStatus.CANCELLED);
  }

  return targets;
}

/**
 * Returns whether a given state is terminal (no further automated transitions possible).
 *
 * Terminal states: DONE, FAILED, CANCELLED.
 *
 * @param state - The state to check
 * @returns true if the state is terminal
 */
export function isTerminalState(state: TaskStatus): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Returns the complete set of all valid (from, to) transition pairs.
 *
 * Includes both explicit transitions and wildcard-derived transitions.
 * Useful for exhaustive testing and documentation generation.
 *
 * @returns Array of [from, to] tuples representing all valid transitions
 */
export function getAllValidTransitions(): ReadonlyArray<readonly [TaskStatus, TaskStatus]> {
  const transitions: Array<[TaskStatus, TaskStatus]> = [];

  // Explicit transitions
  for (const [key] of TRANSITION_GUARDS) {
    const [from, to] = key.split("→") as [TaskStatus, TaskStatus];
    transitions.push([from, to]);
  }

  // Wildcard → ESCALATED
  for (const source of WILDCARD_ESCALATION_SOURCES) {
    transitions.push([source, TaskStatus.ESCALATED]);
  }

  // Wildcard → CANCELLED (skip sources already covered by explicit map)
  for (const source of WILDCARD_CANCELLATION_SOURCES) {
    if (source !== TaskStatus.ESCALATED) {
      transitions.push([source, TaskStatus.CANCELLED]);
    }
  }

  return transitions;
}
