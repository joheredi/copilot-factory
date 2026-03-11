/**
 * Worker Lease state machine — pure domain module for validating worker lease state transitions.
 *
 * Implements the worker lease lifecycle from PRD §2.2: a lease progresses from IDLE
 * through acquisition (LEASED), startup (STARTING), execution (RUNNING, HEARTBEATING),
 * and completion (COMPLETING) to a terminal state. Abnormal paths lead to TIMED_OUT,
 * CRASHED, or RECLAIMED.
 *
 * The control plane is the sole authority for committing lease state transitions.
 * Workers propose transitions via heartbeats and completion signals; this module
 * validates whether the proposed transition is legal before the orchestrator commits it.
 *
 * Design decision: Map-based transition table with guard functions,
 * matching the pattern established by the Task state machine.
 * @see {@link file://docs/prd/002-data-model.md} §2.2 Worker Lease State
 * @see {@link file://packages/domain/src/state-machines/task-state-machine.ts} — pattern reference
 *
 * @module @factory/domain/state-machines/worker-lease-state-machine
 */

import { WorkerLeaseStatus } from "../enums.js";

// ─── Transition Context ─────────────────────────────────────────────────────

/**
 * Context provided to guard functions for evaluating worker lease transition preconditions.
 *
 * Each field maps to a specific precondition in the worker lease lifecycle.
 * Callers supply only the fields relevant to the transition being validated;
 * missing fields default to `undefined` and will cause guards that require
 * them to reject the transition.
 */
export interface WorkerLeaseTransitionContext {
  /**
   * Whether the scheduler successfully acquired an exclusive lease for the worker on a task.
   * Required for: IDLE → LEASED
   */
  readonly leaseAcquired?: boolean;

  /**
   * Whether the worker process has been spawned and is initializing.
   * Required for: LEASED → STARTING
   */
  readonly workerProcessSpawned?: boolean;

  /**
   * Whether the worker has sent its first heartbeat confirming successful startup.
   * Required for: STARTING → RUNNING
   */
  readonly firstHeartbeatReceived?: boolean;

  /**
   * Whether a subsequent heartbeat has been received from the running worker.
   * Required for: RUNNING → HEARTBEATING
   */
  readonly heartbeatReceived?: boolean;

  /**
   * Whether the worker has submitted a completion signal (schema-valid result packet).
   * Required for: HEARTBEATING → COMPLETING, RUNNING → COMPLETING
   */
  readonly completionSignalReceived?: boolean;

  /**
   * Whether the heartbeat timeout has expired without receiving a new heartbeat.
   * Required for: RUNNING → TIMED_OUT, HEARTBEATING → TIMED_OUT, STARTING → TIMED_OUT
   */
  readonly heartbeatTimedOut?: boolean;

  /**
   * Whether the worker process has exited abnormally (non-zero exit code, signal).
   * Required for: STARTING → CRASHED, RUNNING → CRASHED, HEARTBEATING → CRASHED
   */
  readonly workerCrashed?: boolean;

  /**
   * Whether the orchestrator is forcibly reclaiming the lease (e.g., stale lease reclaim).
   * Required for: TIMED_OUT → RECLAIMED, CRASHED → RECLAIMED
   */
  readonly reclaimRequested?: boolean;
}

// ─── Transition Result ──────────────────────────────────────────────────────

/**
 * Result of a worker lease transition validation attempt.
 *
 * When `valid` is true, the transition may be committed. When false,
 * `reason` explains why the transition was rejected.
 */
export interface WorkerLeaseTransitionResult {
  /** Whether the proposed transition is valid. */
  readonly valid: boolean;
  /** Human-readable explanation when the transition is rejected. */
  readonly reason?: string;
}

// ─── Guard Functions ────────────────────────────────────────────────────────

type GuardFn = (ctx: WorkerLeaseTransitionContext) => WorkerLeaseTransitionResult;

/** Shorthand for a passing guard result. */
const VALID: WorkerLeaseTransitionResult = { valid: true };

/** Shorthand for creating a rejection result. */
function reject(reason: string): WorkerLeaseTransitionResult {
  return { valid: false, reason };
}

/**
 * Guard: IDLE → LEASED
 * Scheduler acquires an exclusive lease for a worker on a task.
 * @see PRD §2.2 Worker Lease State
 */
function guardIdleToLeased(ctx: WorkerLeaseTransitionContext): WorkerLeaseTransitionResult {
  if (ctx.leaseAcquired !== true) {
    return reject("Cannot transition IDLE → LEASED: lease not acquired");
  }
  return VALID;
}

/**
 * Guard: LEASED → STARTING
 * Worker process has been spawned and is initializing.
 * @see PRD §2.2 Worker Lease State
 */
function guardLeasedToStarting(ctx: WorkerLeaseTransitionContext): WorkerLeaseTransitionResult {
  if (ctx.workerProcessSpawned !== true) {
    return reject("Cannot transition LEASED → STARTING: worker process not spawned");
  }
  return VALID;
}

/**
 * Guard: STARTING → RUNNING
 * Worker sends first heartbeat confirming session start.
 * @see PRD §2.2 Worker Lease State
 */
function guardStartingToRunning(ctx: WorkerLeaseTransitionContext): WorkerLeaseTransitionResult {
  if (ctx.firstHeartbeatReceived !== true) {
    return reject("Cannot transition STARTING → RUNNING: first heartbeat not received");
  }
  return VALID;
}

/**
 * Guard: RUNNING → HEARTBEATING
 * A subsequent heartbeat has been received from the running worker.
 * @see PRD §2.2 Worker Lease State
 */
function guardRunningToHeartbeating(
  ctx: WorkerLeaseTransitionContext,
): WorkerLeaseTransitionResult {
  if (ctx.heartbeatReceived !== true) {
    return reject("Cannot transition RUNNING → HEARTBEATING: heartbeat not received");
  }
  return VALID;
}

/**
 * Guard: HEARTBEATING → HEARTBEATING
 * Another heartbeat received while already in heartbeating state (self-loop).
 * @see PRD §2.2 Worker Lease State
 */
function guardHeartbeatingToHeartbeating(
  ctx: WorkerLeaseTransitionContext,
): WorkerLeaseTransitionResult {
  if (ctx.heartbeatReceived !== true) {
    return reject("Cannot transition HEARTBEATING → HEARTBEATING: heartbeat not received");
  }
  return VALID;
}

/**
 * Guard: RUNNING → COMPLETING or HEARTBEATING → COMPLETING
 * Worker submits a completion signal (schema-valid result packet).
 * @see PRD §2.2 Worker Lease State
 */
function guardToCompleting(ctx: WorkerLeaseTransitionContext): WorkerLeaseTransitionResult {
  if (ctx.completionSignalReceived !== true) {
    return reject("Cannot transition to COMPLETING: no completion signal received");
  }
  return VALID;
}

/**
 * Guard: → TIMED_OUT
 * Heartbeat timeout expired without receiving a new heartbeat.
 * Applies from STARTING, RUNNING, or HEARTBEATING.
 * @see PRD §2.2 Worker Lease State
 */
function guardToTimedOut(ctx: WorkerLeaseTransitionContext): WorkerLeaseTransitionResult {
  if (ctx.heartbeatTimedOut !== true) {
    return reject("Cannot transition to TIMED_OUT: heartbeat timeout not expired");
  }
  return VALID;
}

/**
 * Guard: → CRASHED
 * Worker process exited abnormally.
 * Applies from STARTING, RUNNING, or HEARTBEATING.
 * @see PRD §2.2 Worker Lease State
 */
function guardToCrashed(ctx: WorkerLeaseTransitionContext): WorkerLeaseTransitionResult {
  if (ctx.workerCrashed !== true) {
    return reject("Cannot transition to CRASHED: worker has not crashed");
  }
  return VALID;
}

/**
 * Guard: TIMED_OUT → RECLAIMED or CRASHED → RECLAIMED
 * Orchestrator forcibly reclaims the lease for reassignment or retry.
 * @see PRD §2.2 Worker Lease State
 */
function guardToReclaimed(ctx: WorkerLeaseTransitionContext): WorkerLeaseTransitionResult {
  if (ctx.reclaimRequested !== true) {
    return reject("Cannot transition to RECLAIMED: reclaim not requested");
  }
  return VALID;
}

// ─── Transition Map ─────────────────────────────────────────────────────────

/**
 * Key for the transition map: "fromState→toState".
 */
type TransitionKey = `${WorkerLeaseStatus}→${WorkerLeaseStatus}`;

/**
 * Complete transition map for the Worker Lease state machine.
 *
 * The happy path is: IDLE → LEASED → STARTING → RUNNING → HEARTBEATING → COMPLETING.
 * Abnormal paths branch to TIMED_OUT, CRASHED, or RECLAIMED.
 *
 * HEARTBEATING → HEARTBEATING is a self-loop representing continuous heartbeats.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.2 Worker Lease State
 */
const TRANSITION_GUARDS: ReadonlyMap<TransitionKey, GuardFn> = new Map<TransitionKey, GuardFn>([
  // Happy path
  [`${WorkerLeaseStatus.IDLE}→${WorkerLeaseStatus.LEASED}`, guardIdleToLeased],
  [`${WorkerLeaseStatus.LEASED}→${WorkerLeaseStatus.STARTING}`, guardLeasedToStarting],
  [`${WorkerLeaseStatus.STARTING}→${WorkerLeaseStatus.RUNNING}`, guardStartingToRunning],
  [`${WorkerLeaseStatus.RUNNING}→${WorkerLeaseStatus.HEARTBEATING}`, guardRunningToHeartbeating],
  [
    `${WorkerLeaseStatus.HEARTBEATING}→${WorkerLeaseStatus.HEARTBEATING}`,
    guardHeartbeatingToHeartbeating,
  ],
  [`${WorkerLeaseStatus.RUNNING}→${WorkerLeaseStatus.COMPLETING}`, guardToCompleting],
  [`${WorkerLeaseStatus.HEARTBEATING}→${WorkerLeaseStatus.COMPLETING}`, guardToCompleting],

  // Timeout paths
  [`${WorkerLeaseStatus.STARTING}→${WorkerLeaseStatus.TIMED_OUT}`, guardToTimedOut],
  [`${WorkerLeaseStatus.RUNNING}→${WorkerLeaseStatus.TIMED_OUT}`, guardToTimedOut],
  [`${WorkerLeaseStatus.HEARTBEATING}→${WorkerLeaseStatus.TIMED_OUT}`, guardToTimedOut],

  // Crash paths
  [`${WorkerLeaseStatus.STARTING}→${WorkerLeaseStatus.CRASHED}`, guardToCrashed],
  [`${WorkerLeaseStatus.RUNNING}→${WorkerLeaseStatus.CRASHED}`, guardToCrashed],
  [`${WorkerLeaseStatus.HEARTBEATING}→${WorkerLeaseStatus.CRASHED}`, guardToCrashed],

  // Reclaim paths
  [`${WorkerLeaseStatus.TIMED_OUT}→${WorkerLeaseStatus.RECLAIMED}`, guardToReclaimed],
  [`${WorkerLeaseStatus.CRASHED}→${WorkerLeaseStatus.RECLAIMED}`, guardToReclaimed],
]);

// ─── Terminal States ────────────────────────────────────────────────────────

/**
 * Terminal states from which no further transitions are possible.
 * COMPLETING means the worker has finished successfully.
 * RECLAIMED means the orchestrator has reclaimed the lease after failure.
 *
 * @see PRD §2.2 Worker Lease State
 */
const TERMINAL_STATES: ReadonlySet<WorkerLeaseStatus> = new Set([
  WorkerLeaseStatus.COMPLETING,
  WorkerLeaseStatus.RECLAIMED,
]);

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Validates whether a proposed worker lease state transition is legal.
 *
 * Checks two layers:
 * 1. Is the transition structurally valid (in the transition map)?
 * 2. Does the guard function accept the provided context?
 *
 * Self-transitions are only valid for HEARTBEATING → HEARTBEATING.
 *
 * @param current - The lease's current state
 * @param target - The proposed target state
 * @param context - Contextual information for guard evaluation
 * @returns A WorkerLeaseTransitionResult indicating validity and reason for rejection
 *
 * @see PRD §2.2 Worker Lease State
 *
 * @example
 * ```ts
 * const result = validateWorkerLeaseTransition(
 *   WorkerLeaseStatus.IDLE,
 *   WorkerLeaseStatus.LEASED,
 *   { leaseAcquired: true },
 * );
 * // result.valid === true
 * ```
 */
export function validateWorkerLeaseTransition(
  current: WorkerLeaseStatus,
  target: WorkerLeaseStatus,
  context: WorkerLeaseTransitionContext = {},
): WorkerLeaseTransitionResult {
  // Same-state transitions are only valid for HEARTBEATING self-loop
  if (current === target && current !== WorkerLeaseStatus.HEARTBEATING) {
    return reject(`Cannot transition from ${current} to itself`);
  }

  const key: TransitionKey = `${current}→${target}`;
  const guard = TRANSITION_GUARDS.get(key);

  if (guard) {
    return guard(context);
  }

  return reject(
    `Invalid transition: ${current} → ${target} is not a valid worker lease state transition`,
  );
}

/**
 * Returns the set of all states reachable from the given state.
 *
 * Useful for UI display and testing that the transition map is complete.
 *
 * @param current - The lease's current state
 * @returns Array of WorkerLeaseStatus values that are valid targets from the current state
 */
export function getValidWorkerLeaseTargets(
  current: WorkerLeaseStatus,
): readonly WorkerLeaseStatus[] {
  const targets: WorkerLeaseStatus[] = [];

  for (const [key] of TRANSITION_GUARDS) {
    const [from, to] = key.split("→") as [WorkerLeaseStatus, WorkerLeaseStatus];
    if (from === current) {
      targets.push(to);
    }
  }

  return targets;
}

/**
 * Returns whether a given worker lease state is terminal
 * (no further transitions possible).
 *
 * Terminal states: COMPLETING, RECLAIMED.
 * Note: TIMED_OUT and CRASHED are NOT terminal — they can transition to RECLAIMED.
 *
 * @param state - The state to check
 * @returns true if the state is terminal
 */
export function isTerminalWorkerLeaseState(state: WorkerLeaseStatus): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Returns the complete set of all valid (from, to) transition pairs.
 *
 * Useful for exhaustive testing and documentation generation.
 *
 * @returns Array of [from, to] tuples representing all valid transitions
 */
export function getAllValidWorkerLeaseTransitions(): ReadonlyArray<
  readonly [WorkerLeaseStatus, WorkerLeaseStatus]
> {
  const transitions: Array<[WorkerLeaseStatus, WorkerLeaseStatus]> = [];

  for (const [key] of TRANSITION_GUARDS) {
    const [from, to] = key.split("→") as [WorkerLeaseStatus, WorkerLeaseStatus];
    transitions.push([from, to]);
  }

  return transitions;
}
