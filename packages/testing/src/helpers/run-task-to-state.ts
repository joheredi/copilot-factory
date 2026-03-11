/**
 * Helper to drive a task through the lifecycle to a desired target state.
 *
 * Uses the domain state machine to compute a valid transition path from any
 * source state to the target state. Builds the minimal transition context
 * required at each step so guards pass.
 *
 * This is the primary test setup helper for integration tests that need
 * a task in a specific lifecycle state without manually executing every
 * intermediate transition.
 *
 * @module @factory/testing/helpers/run-task-to-state
 */

import {
  TaskStatus,
  validateTransition,
  getValidTargets,
  type TransitionContext,
} from "@factory/domain";

// ─── Path Finding ───────────────────────────────────────────────────────────

/**
 * The canonical "happy path" through the task lifecycle.
 * runTaskToState follows this path when possible, using BFS to find
 * the shortest route if the target is off the happy path.
 */
const HAPPY_PATH: readonly TaskStatus[] = [
  TaskStatus.BACKLOG,
  TaskStatus.READY,
  TaskStatus.ASSIGNED,
  TaskStatus.IN_DEVELOPMENT,
  TaskStatus.DEV_COMPLETE,
  TaskStatus.IN_REVIEW,
  TaskStatus.APPROVED,
  TaskStatus.QUEUED_FOR_MERGE,
  TaskStatus.MERGING,
  TaskStatus.POST_MERGE_VALIDATION,
  TaskStatus.DONE,
] as const;

/**
 * Build the default transition context that satisfies guards for a given step.
 *
 * Each guard in the task state machine checks specific context fields.
 * This function returns the minimal context that makes the guard pass.
 *
 * @param from - Current state
 * @param to - Target state
 * @returns TransitionContext that satisfies the guard for this transition.
 */
function buildContextForTransition(from: TaskStatus, to: TaskStatus): TransitionContext {
  // BACKLOG → READY requires allDependenciesResolved and no policy blockers
  if (from === TaskStatus.BACKLOG && to === TaskStatus.READY) {
    return { allDependenciesResolved: true, hasPolicyBlockers: false };
  }

  // BLOCKED → READY requires allDependenciesResolved and no policy blockers
  if (from === TaskStatus.BLOCKED && to === TaskStatus.READY) {
    return { allDependenciesResolved: true, hasPolicyBlockers: false };
  }

  // BACKLOG → BLOCKED requires hasBlockers
  if (from === TaskStatus.BACKLOG && to === TaskStatus.BLOCKED) {
    return { hasBlockers: true };
  }

  // READY → ASSIGNED requires leaseAcquired
  if (from === TaskStatus.READY && to === TaskStatus.ASSIGNED) {
    return { leaseAcquired: true };
  }

  // ASSIGNED → IN_DEVELOPMENT requires hasHeartbeat
  if (from === TaskStatus.ASSIGNED && to === TaskStatus.IN_DEVELOPMENT) {
    return { hasHeartbeat: true };
  }

  // IN_DEVELOPMENT → DEV_COMPLETE requires hasDevResultPacket and requiredValidationsPassed
  if (from === TaskStatus.IN_DEVELOPMENT && to === TaskStatus.DEV_COMPLETE) {
    return { hasDevResultPacket: true, requiredValidationsPassed: true };
  }

  // DEV_COMPLETE → IN_REVIEW requires hasReviewRoutingDecision
  if (from === TaskStatus.DEV_COMPLETE && to === TaskStatus.IN_REVIEW) {
    return { hasReviewRoutingDecision: true };
  }

  // IN_REVIEW → APPROVED requires leadReviewDecision approved
  if (from === TaskStatus.IN_REVIEW && to === TaskStatus.APPROVED) {
    return { leadReviewDecision: "approved" };
  }

  // IN_REVIEW → CHANGES_REQUESTED requires leadReviewDecision changes_requested
  if (from === TaskStatus.IN_REVIEW && to === TaskStatus.CHANGES_REQUESTED) {
    return { leadReviewDecision: "changes_requested" };
  }

  // CHANGES_REQUESTED → ASSIGNED requires leaseAcquired
  if (from === TaskStatus.CHANGES_REQUESTED && to === TaskStatus.ASSIGNED) {
    return { leaseAcquired: true };
  }

  // APPROVED → QUEUED_FOR_MERGE (no specific guard needed in state machine)
  if (from === TaskStatus.APPROVED && to === TaskStatus.QUEUED_FOR_MERGE) {
    return {};
  }

  // QUEUED_FOR_MERGE → MERGING (no specific guard needed)
  if (from === TaskStatus.QUEUED_FOR_MERGE && to === TaskStatus.MERGING) {
    return {};
  }

  // MERGING → POST_MERGE_VALIDATION requires mergeSuccessful
  if (from === TaskStatus.MERGING && to === TaskStatus.POST_MERGE_VALIDATION) {
    return { mergeSuccessful: true };
  }

  // MERGING → CHANGES_REQUESTED requires reworkable conflict
  if (from === TaskStatus.MERGING && to === TaskStatus.CHANGES_REQUESTED) {
    return { mergeConflictClassification: "reworkable" };
  }

  // MERGING → FAILED requires non-reworkable conflict
  if (from === TaskStatus.MERGING && to === TaskStatus.FAILED) {
    return { mergeConflictClassification: "non_reworkable" };
  }

  // POST_MERGE_VALIDATION → DONE requires postMergeValidationPassed
  if (from === TaskStatus.POST_MERGE_VALIDATION && to === TaskStatus.DONE) {
    return { postMergeValidationPassed: true };
  }

  // POST_MERGE_VALIDATION → FAILED requires postMergeValidationPassed false
  if (from === TaskStatus.POST_MERGE_VALIDATION && to === TaskStatus.FAILED) {
    return { postMergeValidationPassed: false };
  }

  // ESCALATED → ASSIGNED requires isOperator and leaseAcquired
  if (from === TaskStatus.ESCALATED && to === TaskStatus.ASSIGNED) {
    return { isOperator: true, leaseAcquired: true };
  }

  // ESCALATED → DONE requires isOperator
  if (from === TaskStatus.ESCALATED && to === TaskStatus.DONE) {
    return { isOperator: true };
  }

  // ESCALATED → CANCELLED requires isOperator
  if (from === TaskStatus.ESCALATED && to === TaskStatus.CANCELLED) {
    return { isOperator: true };
  }

  // * → ESCALATED requires isOperator or hasEscalationTrigger
  if (to === TaskStatus.ESCALATED) {
    return { isOperator: true };
  }

  // * → CANCELLED requires isOperator
  if (to === TaskStatus.CANCELLED) {
    return { isOperator: true };
  }

  // ASSIGNED → READY requires leaseReclaimedRetryEligible
  if (from === TaskStatus.ASSIGNED && to === TaskStatus.READY) {
    return { leaseReclaimedRetryEligible: true };
  }

  // IN_DEVELOPMENT → READY requires leaseReclaimedRetryEligible
  if (from === TaskStatus.IN_DEVELOPMENT && to === TaskStatus.READY) {
    return { leaseReclaimedRetryEligible: true };
  }

  // ASSIGNED → FAILED requires leaseTimedOutNoRetry
  if (from === TaskStatus.ASSIGNED && to === TaskStatus.FAILED) {
    return { leaseTimedOutNoRetry: true };
  }

  // IN_DEVELOPMENT → FAILED requires hasUnrecoverableFailure or leaseTimedOutNoRetry
  if (from === TaskStatus.IN_DEVELOPMENT && to === TaskStatus.FAILED) {
    return { hasUnrecoverableFailure: true };
  }

  return {};
}

/**
 * Find the shortest path from one state to another using BFS.
 *
 * Attempts to follow the happy path first for efficiency. Falls back to
 * BFS when the target is off the happy path (e.g., FAILED, ESCALATED,
 * CHANGES_REQUESTED).
 *
 * @param from - Starting state.
 * @param to - Target state.
 * @returns Array of states representing the path (including both from and to),
 *   or null if no path exists.
 */
export function findTransitionPath(from: TaskStatus, to: TaskStatus): TaskStatus[] | null {
  if (from === to) {
    return [from];
  }

  // Try happy path first — check if both states are on it and in order
  const fromIdx = HAPPY_PATH.indexOf(from);
  const toIdx = HAPPY_PATH.indexOf(to);
  if (fromIdx !== -1 && toIdx !== -1 && fromIdx < toIdx) {
    return HAPPY_PATH.slice(fromIdx, toIdx + 1) as TaskStatus[];
  }

  // BFS for shortest path
  const visited = new Set<TaskStatus>([from]);
  const queue: Array<{ state: TaskStatus; path: TaskStatus[] }> = [{ state: from, path: [from] }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const targets = getValidTargets(current.state);

    for (const target of targets) {
      if (target === to) {
        return [...current.path, target];
      }
      if (!visited.has(target)) {
        visited.add(target);
        queue.push({ state: target, path: [...current.path, target] });
      }
    }
  }

  return null;
}

/**
 * Result of running a task to a target state.
 */
export interface RunTaskToStateResult {
  /** The final status of the task. */
  readonly status: TaskStatus;
  /** The ordered list of states the task transitioned through. */
  readonly path: readonly TaskStatus[];
  /** The transition contexts used at each step. */
  readonly contexts: readonly TransitionContext[];
  /** Whether the task reached the target state. */
  readonly reached: boolean;
}

/**
 * Callback invoked at each transition step, allowing tests to perform
 * side effects (e.g., creating leases, review cycles) in response to
 * state changes.
 *
 * @param from - State being left.
 * @param to - State being entered.
 * @param context - The transition context used for this step.
 */
export type TransitionCallback = (
  from: TaskStatus,
  to: TaskStatus,
  context: TransitionContext,
) => void | Promise<void>;

/**
 * Options for {@link runTaskToState}.
 */
export interface RunTaskToStateOptions {
  /** Starting state of the task. Default: BACKLOG */
  readonly fromState?: TaskStatus;
  /** Callback invoked at each transition step. */
  readonly onTransition?: TransitionCallback;
}

/**
 * Drive a task through the lifecycle to reach a target state.
 *
 * Computes the shortest valid transition path and executes each step,
 * building the appropriate transition context for each guard. Optionally
 * invokes a callback at each step so tests can create supporting entities
 * (leases, review cycles, etc.) alongside the transitions.
 *
 * @param targetState - The desired final state.
 * @param options - Optional starting state and transition callback.
 * @returns Result containing the final state, path taken, and contexts used.
 * @throws {Error} If no valid path exists from the starting state to the target.
 *
 * @example
 * ```ts
 * // Drive a task to IN_REVIEW
 * const result = runTaskToState(TaskStatus.IN_REVIEW);
 * expect(result.reached).toBe(true);
 * expect(result.path).toEqual([
 *   "BACKLOG", "READY", "ASSIGNED", "IN_DEVELOPMENT",
 *   "DEV_COMPLETE", "IN_REVIEW",
 * ]);
 *
 * // With a callback to track transitions
 * const transitions: string[] = [];
 * runTaskToState(TaskStatus.DONE, {
 *   onTransition: (from, to) => transitions.push(`${from}→${to}`),
 * });
 * ```
 */
export async function runTaskToState(
  targetState: TaskStatus,
  options: RunTaskToStateOptions = {},
): Promise<RunTaskToStateResult> {
  const fromState = options.fromState ?? TaskStatus.BACKLOG;
  const path = findTransitionPath(fromState, targetState);

  if (!path) {
    throw new Error(`No valid transition path from ${fromState} to ${targetState}`);
  }

  const contexts: TransitionContext[] = [];
  let currentState = fromState;

  for (let i = 1; i < path.length; i++) {
    const nextState = path[i]!;
    const context = buildContextForTransition(currentState, nextState);

    // Validate the transition is legal
    const result = validateTransition(currentState, nextState, context);
    if (!result.valid) {
      return {
        status: currentState,
        path: path.slice(0, i),
        contexts,
        reached: false,
      };
    }

    contexts.push(context);

    if (options.onTransition) {
      await options.onTransition(currentState, nextState, context);
    }

    currentState = nextState;
  }

  return {
    status: currentState,
    path,
    contexts,
    reached: currentState === targetState,
  };
}
