/**
 * Retry policy model and evaluation for the Autonomous Software Factory.
 *
 * Implements the retry governance from PRD §9.6 (Retry Policy).
 * Determines whether a failed task should be automatically retried and
 * computes the backoff delay before the next attempt.
 *
 * Key design decisions:
 * - `max_attempts` counts retries *after* the initial attempt (§9.6.2)
 * - Rework after CHANGES_REQUESTED is not counted as an automatic retry
 * - Backoff uses exponential formula: initial × 2^(attempt − 1), capped at max
 * - Pool affinity is configurable: same pool preferred, fallback allowed
 * - A failure summary packet may be required before a retry is permitted
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.6 — Retry Policy
 * @module @factory/domain/policies/retry-policy
 */

// ---------------------------------------------------------------------------
// Backoff strategy
// ---------------------------------------------------------------------------

/**
 * Supported backoff strategies for retry delays.
 *
 * V1 supports only `exponential`. The enum is provided so that future
 * strategies (e.g. `linear`, `constant`) can be added without breaking
 * the type contract.
 */
export const BackoffStrategy = {
  /** Exponential backoff: initial × 2^(attempt − 1), capped at max. */
  EXPONENTIAL: "exponential",
} as const;

/** Union of all valid backoff strategy values. */
export type BackoffStrategy = (typeof BackoffStrategy)[keyof typeof BackoffStrategy];

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/**
 * Configuration for automatic retry behavior.
 *
 * Stored in the effective policy snapshot under the `retry_policy` key.
 * All timing values are in seconds.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.6.1
 */
export interface RetryPolicy {
  /**
   * Maximum number of automatic retries after the initial attempt.
   * When a task's `retry_count` reaches this value, retries are exhausted
   * and escalation policy takes over.
   */
  readonly max_attempts: number;

  /** Backoff algorithm to use between retries. */
  readonly backoff_strategy: BackoffStrategy;

  /** Base delay in seconds for the first retry. */
  readonly initial_backoff_seconds: number;

  /** Upper bound on the computed backoff in seconds. */
  readonly max_backoff_seconds: number;

  /** Whether to prefer reassignment to the same worker pool. */
  readonly reuse_same_pool: boolean;

  /** Whether the scheduler may assign to a different pool after failure. */
  readonly allow_pool_change_after_failure: boolean;

  /**
   * Whether a failure summary packet must be persisted before the
   * orchestrator permits a retry. Ensures context is available for the
   * next attempt.
   */
  readonly require_failure_summary_packet: boolean;
}

/**
 * Context required to evaluate retry eligibility.
 *
 * Callers must supply the current retry count and — if
 * `require_failure_summary_packet` is true — confirm that a summary
 * packet has been persisted.
 */
export interface RetryEvaluationContext {
  /** Number of retries already consumed (0 on first failure). */
  readonly retry_count: number;

  /**
   * Whether a failure summary packet exists for this run.
   * Only relevant when the policy requires one.
   */
  readonly has_failure_summary: boolean;
}

/**
 * Outcome of retry eligibility evaluation.
 *
 * When `eligible` is true, `backoff_seconds` contains the computed
 * delay before the next attempt. When false, `reason` explains why.
 */
export interface RetryEvaluation {
  /** Whether the task may be automatically retried. */
  readonly eligible: boolean;

  /**
   * Delay in seconds before the next retry attempt.
   * Only meaningful when `eligible` is true.
   */
  readonly backoff_seconds: number;

  /**
   * The retry attempt number this evaluation corresponds to.
   * Equal to `retry_count + 1` (the upcoming attempt).
   */
  readonly next_attempt: number;

  /**
   * Human-readable explanation for ineligibility.
   * Only present when `eligible` is false.
   */
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Default V1 retry policy
// ---------------------------------------------------------------------------

/**
 * Default V1 retry policy matching PRD §9.6.1 canonical shape.
 *
 * - 2 automatic retries after the initial attempt
 * - Exponential backoff from 60 s to 900 s
 * - Same pool preferred, fallback to other pools allowed
 * - Failure summary required before retry
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  max_attempts: 2,
  backoff_strategy: BackoffStrategy.EXPONENTIAL,
  initial_backoff_seconds: 60,
  max_backoff_seconds: 900,
  reuse_same_pool: true,
  allow_pool_change_after_failure: true,
  require_failure_summary_packet: true,
};

// ---------------------------------------------------------------------------
// Backoff calculation
// ---------------------------------------------------------------------------

/**
 * Compute the backoff delay for the given retry attempt number.
 *
 * Uses the formula: `initial × 2^(attempt − 1)`, capped at
 * `max_backoff_seconds`.
 *
 * @param attempt - The 1-based attempt number (1 = first retry).
 * @param policy  - The retry policy providing timing parameters.
 * @returns Backoff delay in seconds (always ≥ 0).
 *
 * @example
 * ```ts
 * calculateBackoff(1, DEFAULT_RETRY_POLICY); // 60
 * calculateBackoff(2, DEFAULT_RETRY_POLICY); // 120
 * calculateBackoff(5, DEFAULT_RETRY_POLICY); // 900 (capped)
 * ```
 */
export function calculateBackoff(attempt: number, policy: RetryPolicy): number {
  if (attempt <= 0) {
    return 0;
  }
  const raw = policy.initial_backoff_seconds * Math.pow(2, attempt - 1);
  return Math.min(raw, policy.max_backoff_seconds);
}

// ---------------------------------------------------------------------------
// Retry eligibility evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a task is eligible for automatic retry.
 *
 * The evaluation checks:
 * 1. Whether `retry_count` is below `max_attempts`
 * 2. Whether a failure summary packet exists (if required by policy)
 *
 * When eligible, the result includes the computed backoff delay for the
 * next attempt. When ineligible, `reason` describes why.
 *
 * Rework after `CHANGES_REQUESTED` is **not** an automatic retry and
 * should not be evaluated through this function (§9.6.2).
 *
 * @param context - Current retry state of the task.
 * @param policy  - The effective retry policy for this run.
 * @returns A {@link RetryEvaluation} indicating eligibility and backoff.
 *
 * @example
 * ```ts
 * const result = shouldRetry(
 *   { retry_count: 0, has_failure_summary: true },
 *   DEFAULT_RETRY_POLICY,
 * );
 * // result.eligible === true
 * // result.backoff_seconds === 60
 * ```
 */
export function shouldRetry(context: RetryEvaluationContext, policy: RetryPolicy): RetryEvaluation {
  const nextAttempt = context.retry_count + 1;

  // Check retry count against max_attempts
  if (context.retry_count >= policy.max_attempts) {
    return {
      eligible: false,
      backoff_seconds: 0,
      next_attempt: nextAttempt,
      reason: `Retry count ${context.retry_count} has reached max_attempts ${policy.max_attempts}`,
    };
  }

  // Check failure summary requirement
  if (policy.require_failure_summary_packet && !context.has_failure_summary) {
    return {
      eligible: false,
      backoff_seconds: 0,
      next_attempt: nextAttempt,
      reason: "Failure summary packet is required but not present",
    };
  }

  // Eligible — compute backoff for the next attempt
  const backoff = calculateBackoff(nextAttempt, policy);

  return {
    eligible: true,
    backoff_seconds: backoff,
    next_attempt: nextAttempt,
  };
}

/**
 * Create a default V1 retry policy.
 *
 * Returns a fresh copy of {@link DEFAULT_RETRY_POLICY} to avoid
 * accidental mutation of the shared constant.
 *
 * @returns A new RetryPolicy instance with V1 defaults.
 */
export function createDefaultRetryPolicy(): RetryPolicy {
  return { ...DEFAULT_RETRY_POLICY };
}
