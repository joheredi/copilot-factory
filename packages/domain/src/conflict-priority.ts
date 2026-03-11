/**
 * Conflict resolution priority for optimistic concurrency control.
 *
 * When multiple actors race to transition the same task, this module
 * determines which actor should win based on priority rules from
 * PRD §10.2.3 (Integration Contracts — Concurrency Control):
 *
 * 1. Operator actions (ESCALATED, CANCELLED) take precedence over all.
 * 2. Lease expiry takes precedence over worker result submissions after expiry.
 * 3. A result packet within `grace_period_seconds` after lease timeout
 *    must still be accepted if schema-valid and IDs match.
 *
 * The underlying mechanism is optimistic concurrency: `Task.version` is
 * checked and incremented atomically on every committed state change.
 * When a conflict is detected (`VersionConflictError`), callers use these
 * functions to decide whether to retry or yield.
 *
 * @see docs/prd/010-integration-contracts.md §10.2.3 — Concurrency Control
 * @module @factory/domain/conflict-priority
 */

import { TaskStatus } from "./enums.js";

// ---------------------------------------------------------------------------
// Priority enum
// ---------------------------------------------------------------------------

/**
 * Priority levels for conflict resolution.
 * Higher numeric value = higher priority = wins conflicts.
 *
 * When two actors race to transition the same task and one receives a
 * VersionConflictError, the actor with higher priority should re-read
 * and retry while the lower-priority actor yields.
 */
export enum ConflictPriority {
  /**
   * Standard automated transitions (scheduler, worker, review, merge).
   * These actors yield on conflict — they do not retry.
   */
  AUTOMATED = 1,

  /**
   * Lease expiry / timeout monitoring.
   * Wins over automated transitions because lease timeout is a safety
   * mechanism that must not be blocked by a stale worker result.
   */
  LEASE_EXPIRY = 2,

  /**
   * Operator manual actions (ESCALATED, CANCELLED).
   * Always wins — operators are the ultimate authority.
   */
  OPERATOR = 3,
}

// ---------------------------------------------------------------------------
// Priority classification
// ---------------------------------------------------------------------------

/**
 * Operator actor types that receive OPERATOR priority.
 * These represent human operators or admin-level system actions.
 */
const OPERATOR_ACTOR_TYPES = new Set(["operator", "admin"]);

/**
 * Task statuses that indicate operator-initiated transitions.
 * These are the wildcard transitions that operators can trigger
 * from any non-terminal state.
 */
const OPERATOR_TARGET_STATUSES = new Set<TaskStatus>([TaskStatus.ESCALATED, TaskStatus.CANCELLED]);

/**
 * Actor types that perform lease monitoring/expiry transitions.
 */
const LEASE_MONITOR_ACTOR_TYPES = new Set(["lease-monitor", "reconciliation"]);

/**
 * Determine the conflict priority for a transition attempt.
 *
 * Priority classification per §10.2.3:
 * - Operator actors or operator-target statuses → OPERATOR priority
 * - Lease monitor actors targeting FAILED → LEASE_EXPIRY priority
 * - Everything else → AUTOMATED priority
 *
 * @param actorType - The type of actor proposing the transition
 *   (e.g., 'operator', 'worker', 'system', 'lease-monitor', 'scheduler').
 * @param targetStatus - The target task status being requested.
 * @returns The conflict priority level for this transition attempt.
 */
export function getConflictPriority(actorType: string, targetStatus: TaskStatus): ConflictPriority {
  // Operator actors always have highest priority, regardless of target
  if (OPERATOR_ACTOR_TYPES.has(actorType)) {
    return ConflictPriority.OPERATOR;
  }

  // Operator-target statuses (ESCALATED, CANCELLED) from any actor type
  // that signals operator intent also get operator priority
  if (OPERATOR_TARGET_STATUSES.has(targetStatus) && actorType === "system") {
    return ConflictPriority.OPERATOR;
  }

  // Lease expiry transitions: lease monitor targeting FAILED
  // (lease timeout with no retry remaining → task fails)
  if (LEASE_MONITOR_ACTOR_TYPES.has(actorType) && targetStatus === TaskStatus.FAILED) {
    return ConflictPriority.LEASE_EXPIRY;
  }

  // All other automated transitions
  return ConflictPriority.AUTOMATED;
}

// ---------------------------------------------------------------------------
// Retry decision
// ---------------------------------------------------------------------------

/**
 * Determine whether a transition attempt should retry after a version conflict.
 *
 * An actor should retry when its priority is strictly higher than AUTOMATED,
 * because lower-priority transitions that won the race should be superseded
 * by higher-priority actions (e.g., operator cancellation should win over
 * a concurrent worker result submission).
 *
 * AUTOMATED-priority actors never retry — they yield to whoever won the
 * race, since all automated actors have equal priority and first-writer-wins
 * is the correct behavior.
 *
 * @param actorType - The type of actor proposing the transition.
 * @param targetStatus - The target task status being requested.
 * @returns true if the actor should re-read the task and retry.
 */
export function shouldRetryOnConflict(actorType: string, targetStatus: TaskStatus): boolean {
  return getConflictPriority(actorType, targetStatus) > ConflictPriority.AUTOMATED;
}

// ---------------------------------------------------------------------------
// Grace period
// ---------------------------------------------------------------------------

/**
 * Check whether a worker result falls within the grace period after lease timeout.
 *
 * Per §10.2.3, a result packet received within `grace_period_seconds` after
 * the lease timeout must still be accepted if schema-valid and IDs match.
 * This is the exception to the rule that lease expiry wins over worker results.
 *
 * @param leaseExpiredAt - When the lease expired.
 * @param resultReceivedAt - When the worker result was received.
 * @param gracePeriodSeconds - The configured grace period in seconds.
 *   Must be positive; zero or negative disables grace period.
 * @returns true if the result is within the grace window and should be accepted.
 */
export function isWithinGracePeriod(
  leaseExpiredAt: Date,
  resultReceivedAt: Date,
  gracePeriodSeconds: number,
): boolean {
  if (gracePeriodSeconds <= 0) {
    return false;
  }

  const elapsedMs = resultReceivedAt.getTime() - leaseExpiredAt.getTime();

  // Result must be received after (or exactly at) expiry and within the window
  return elapsedMs >= 0 && elapsedMs <= gracePeriodSeconds * 1000;
}
