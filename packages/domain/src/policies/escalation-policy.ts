/**
 * Escalation policy model and trigger evaluation for the Autonomous Software Factory.
 *
 * Implements the escalation governance from PRD §9.7 (Escalation Policy).
 * Determines whether a failure condition should trigger escalation to the
 * operator queue, and what action to take (escalate immediately, or fail
 * first then escalate).
 *
 * Key design decisions:
 * - All seven trigger cases from §9.7.2 are explicitly modelled
 * - The `EscalationAction` enum is defined in `enums.ts` (ESCALATE, FAIL_THEN_ESCALATE)
 * - Trigger evaluation is purely deterministic — no AI judgment
 * - Unknown trigger types are treated as escalation-worthy (fail-safe)
 * - The `route_to` field defaults to "operator-queue" per spec
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.7 — Escalation Policy
 * @module @factory/domain/policies/escalation-policy
 */

import type { EscalationAction } from "../enums.js";

// ---------------------------------------------------------------------------
// Escalation trigger types
// ---------------------------------------------------------------------------

/**
 * The set of conditions that may trigger escalation.
 *
 * Each trigger maps to a policy-defined action from `EscalationAction`.
 * V1 requires support for all seven triggers from PRD §9.7.2.
 */
export const EscalationTrigger = {
  /** Automatic retries exceeded `max_attempts`. */
  MAX_RETRY_EXCEEDED: "max_retry_exceeded",
  /** Review rounds exceeded `max_review_rounds`. */
  MAX_REVIEW_ROUNDS_EXCEEDED: "max_review_rounds_exceeded",
  /** A security-sensitive policy was violated. */
  POLICY_VIOLATION: "policy_violation",
  /** Merge failed after exhausting retries. */
  MERGE_FAILURE_AFTER_RETRIES: "merge_failure_after_retries",
  /** Worker missed heartbeat threshold and timed out. */
  HEARTBEAT_TIMEOUT: "heartbeat_timeout",
  /** A structured output packet failed schema validation. */
  SCHEMA_VALIDATION_FAILURE: "schema_validation_failure",
  /** Schema validation failed repeatedly for the same agent profile. */
  REPEATED_SCHEMA_FAILURES: "repeated_schema_failures",
} as const;

/** Union of all valid escalation trigger values. */
export type EscalationTrigger = (typeof EscalationTrigger)[keyof typeof EscalationTrigger];

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/**
 * Maps each escalation trigger to the action the orchestrator should take.
 *
 * Uses `EscalationAction` values from `enums.ts`:
 * - `"escalate"` — move directly to ESCALATED state and route to operator queue
 * - `"fail_then_escalate"` — transition to FAILED first, then create escalation
 * - `"retry_or_escalate"` — retry if eligible, otherwise escalate (special for heartbeat)
 *
 * The `retry_or_escalate` value is unique to the `heartbeat_timeout` trigger and
 * is handled as a string literal here since it combines retry + escalation logic
 * that does not map to a single `EscalationAction` enum value.
 */
export type EscalationTriggerAction =
  | EscalationAction
  | "retry_or_escalate"
  | "disable_profile_and_escalate";

/**
 * Configuration for escalation behavior.
 *
 * Stored in the effective policy snapshot under the `escalation_policy` key.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.7.1
 */
export interface EscalationPolicy {
  /**
   * Maps each trigger type to the action to take when the trigger fires.
   * All triggers from §9.7.2 must be present. Unknown triggers default
   * to `"escalate"` at evaluation time.
   */
  readonly triggers: Readonly<Record<EscalationTrigger, EscalationTriggerAction>>;

  /** The queue or destination for escalated items. Defaults to "operator-queue". */
  readonly route_to: string;

  /** Whether a summary of the failure context is required when escalating. */
  readonly require_summary: boolean;
}

/**
 * Context required to evaluate whether an escalation trigger should fire.
 *
 * Not all fields are relevant for every trigger — callers supply the
 * fields they have and the evaluator uses what is needed.
 */
export interface EscalationEvaluationContext {
  /** The specific trigger condition being evaluated. */
  readonly trigger: EscalationTrigger;

  /** Current retry count for the task (for max_retry_exceeded). */
  readonly retry_count?: number;

  /** Maximum retry attempts from the retry policy (for max_retry_exceeded). */
  readonly max_attempts?: number;

  /** Current review round number (for max_review_rounds_exceeded). */
  readonly review_round?: number;

  /** Maximum review rounds from the review policy (for max_review_rounds_exceeded). */
  readonly max_review_rounds?: number;

  /** Number of consecutive schema validation failures (for repeated_schema_failures). */
  readonly schema_failure_count?: number;

  /** Threshold for repeated schema failures before escalation. */
  readonly schema_failure_threshold?: number;
}

/**
 * Outcome of escalation trigger evaluation.
 *
 * When `should_escalate` is true, `action` indicates what to do and
 * `route_to` specifies the destination queue.
 */
export interface EscalationEvaluation {
  /** Whether the trigger condition warrants escalation. */
  readonly should_escalate: boolean;

  /**
   * The action to take when escalating.
   * Only meaningful when `should_escalate` is true.
   */
  readonly action: EscalationTriggerAction;

  /** Destination queue for the escalation. */
  readonly route_to: string;

  /** Whether a summary must accompany the escalation. */
  readonly require_summary: boolean;

  /**
   * Human-readable description of why escalation was or was not triggered.
   */
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Default V1 escalation policy
// ---------------------------------------------------------------------------

/**
 * Default V1 escalation policy matching PRD §9.7.1 canonical shape.
 *
 * All seven trigger cases are configured with appropriate actions.
 * Routes to "operator-queue" and requires a summary.
 */
export const DEFAULT_ESCALATION_POLICY: EscalationPolicy = {
  triggers: {
    [EscalationTrigger.MAX_RETRY_EXCEEDED]: "escalate",
    [EscalationTrigger.MAX_REVIEW_ROUNDS_EXCEEDED]: "escalate",
    [EscalationTrigger.POLICY_VIOLATION]: "escalate",
    [EscalationTrigger.MERGE_FAILURE_AFTER_RETRIES]: "escalate",
    [EscalationTrigger.HEARTBEAT_TIMEOUT]: "retry_or_escalate",
    [EscalationTrigger.SCHEMA_VALIDATION_FAILURE]: "fail_and_escalate" as EscalationTriggerAction,
    [EscalationTrigger.REPEATED_SCHEMA_FAILURES]: "disable_profile_and_escalate",
  },
  route_to: "operator-queue",
  require_summary: true,
};

// ---------------------------------------------------------------------------
// Trigger evaluation helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the `max_retry_exceeded` trigger condition is met.
 *
 * @param context - Must include `retry_count` and `max_attempts`.
 * @returns true if retries are exhausted.
 */
function isMaxRetryExceeded(context: EscalationEvaluationContext): boolean {
  if (context.retry_count === undefined || context.max_attempts === undefined) {
    return true; // Fail-safe: escalate when information is missing
  }
  return context.retry_count >= context.max_attempts;
}

/**
 * Check whether the `max_review_rounds_exceeded` trigger condition is met.
 *
 * @param context - Must include `review_round` and `max_review_rounds`.
 * @returns true if review rounds are exhausted.
 */
function isMaxReviewRoundsExceeded(context: EscalationEvaluationContext): boolean {
  if (context.review_round === undefined || context.max_review_rounds === undefined) {
    return true; // Fail-safe: escalate when information is missing
  }
  return context.review_round >= context.max_review_rounds;
}

/**
 * Check whether the `repeated_schema_failures` trigger condition is met.
 *
 * @param context - Must include `schema_failure_count` and `schema_failure_threshold`.
 * @returns true if the threshold has been reached.
 */
function isRepeatedSchemaFailure(context: EscalationEvaluationContext): boolean {
  if (
    context.schema_failure_count === undefined ||
    context.schema_failure_threshold === undefined
  ) {
    return true; // Fail-safe: escalate when information is missing
  }
  return context.schema_failure_count >= context.schema_failure_threshold;
}

// ---------------------------------------------------------------------------
// Main evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate whether an escalation trigger should fire and what action to take.
 *
 * Trigger-specific context validation:
 * - `max_retry_exceeded`: checks `retry_count >= max_attempts`
 * - `max_review_rounds_exceeded`: checks `review_round >= max_review_rounds`
 * - `repeated_schema_failures`: checks `schema_failure_count >= schema_failure_threshold`
 * - `policy_violation`, `merge_failure_after_retries`, `heartbeat_timeout`,
 *   `schema_validation_failure`: always fire when invoked (the caller has
 *   already determined the condition is present)
 *
 * Unknown trigger types default to `"escalate"` as a fail-safe.
 *
 * @param context - The trigger condition and associated state.
 * @param policy  - The effective escalation policy for this run.
 * @returns An {@link EscalationEvaluation} with the decision and routing info.
 *
 * @example
 * ```ts
 * const result = shouldEscalate(
 *   { trigger: EscalationTrigger.MAX_RETRY_EXCEEDED, retry_count: 2, max_attempts: 2 },
 *   DEFAULT_ESCALATION_POLICY,
 * );
 * // result.should_escalate === true
 * // result.action === "escalate"
 * ```
 */
export function shouldEscalate(
  context: EscalationEvaluationContext,
  policy: EscalationPolicy,
): EscalationEvaluation {
  const triggerAction = policy.triggers[context.trigger] ?? ("escalate" as EscalationTriggerAction);

  // For threshold-based triggers, validate that the condition is actually met
  switch (context.trigger) {
    case EscalationTrigger.MAX_RETRY_EXCEEDED: {
      if (!isMaxRetryExceeded(context)) {
        return {
          should_escalate: false,
          action: triggerAction,
          route_to: policy.route_to,
          require_summary: policy.require_summary,
          reason: `Retry count ${context.retry_count} has not reached max_attempts ${context.max_attempts}`,
        };
      }
      return {
        should_escalate: true,
        action: triggerAction,
        route_to: policy.route_to,
        require_summary: policy.require_summary,
        reason: `Retry count ${context.retry_count} reached max_attempts ${context.max_attempts}`,
      };
    }

    case EscalationTrigger.MAX_REVIEW_ROUNDS_EXCEEDED: {
      if (!isMaxReviewRoundsExceeded(context)) {
        return {
          should_escalate: false,
          action: triggerAction,
          route_to: policy.route_to,
          require_summary: policy.require_summary,
          reason: `Review round ${context.review_round} has not reached max_review_rounds ${context.max_review_rounds}`,
        };
      }
      return {
        should_escalate: true,
        action: triggerAction,
        route_to: policy.route_to,
        require_summary: policy.require_summary,
        reason: `Review round ${context.review_round} reached max_review_rounds ${context.max_review_rounds}`,
      };
    }

    case EscalationTrigger.REPEATED_SCHEMA_FAILURES: {
      if (!isRepeatedSchemaFailure(context)) {
        return {
          should_escalate: false,
          action: triggerAction,
          route_to: policy.route_to,
          require_summary: policy.require_summary,
          reason: `Schema failure count ${context.schema_failure_count} has not reached threshold ${context.schema_failure_threshold}`,
        };
      }
      return {
        should_escalate: true,
        action: triggerAction,
        route_to: policy.route_to,
        require_summary: policy.require_summary,
        reason: `Schema failure count ${context.schema_failure_count} reached threshold ${context.schema_failure_threshold}`,
      };
    }

    // Unconditional triggers — the caller has already determined the condition
    case EscalationTrigger.POLICY_VIOLATION:
      return {
        should_escalate: true,
        action: triggerAction,
        route_to: policy.route_to,
        require_summary: policy.require_summary,
        reason: "Security-sensitive policy violation detected",
      };

    case EscalationTrigger.MERGE_FAILURE_AFTER_RETRIES:
      return {
        should_escalate: true,
        action: triggerAction,
        route_to: policy.route_to,
        require_summary: policy.require_summary,
        reason: "Merge failed after exhausting retries",
      };

    case EscalationTrigger.HEARTBEAT_TIMEOUT:
      return {
        should_escalate: true,
        action: triggerAction,
        route_to: policy.route_to,
        require_summary: policy.require_summary,
        reason: "Worker heartbeat timeout detected",
      };

    case EscalationTrigger.SCHEMA_VALIDATION_FAILURE:
      return {
        should_escalate: true,
        action: triggerAction,
        route_to: policy.route_to,
        require_summary: policy.require_summary,
        reason: "Structured output packet failed schema validation",
      };

    default: {
      // Fail-safe: unknown triggers always escalate
      return {
        should_escalate: true,
        action: "escalate" as EscalationTriggerAction,
        route_to: policy.route_to,
        require_summary: policy.require_summary,
        reason: `Unknown escalation trigger: ${context.trigger as string}`,
      };
    }
  }
}

/**
 * Retrieve the configured action for a specific trigger type.
 *
 * Returns the action from the policy's trigger map, or `"escalate"` as
 * a fail-safe default if the trigger is not configured.
 *
 * @param trigger - The escalation trigger to look up.
 * @param policy  - The effective escalation policy.
 * @returns The configured {@link EscalationTriggerAction} for the trigger.
 */
export function getTriggerAction(
  trigger: EscalationTrigger,
  policy: EscalationPolicy,
): EscalationTriggerAction {
  return policy.triggers[trigger] ?? ("escalate" as EscalationTriggerAction);
}

/**
 * Get all escalation triggers that are configured in a policy.
 *
 * @param policy - The escalation policy to inspect.
 * @returns Array of configured trigger types.
 */
export function getConfiguredTriggers(policy: EscalationPolicy): readonly EscalationTrigger[] {
  return Object.keys(policy.triggers) as EscalationTrigger[];
}

/**
 * Create a default V1 escalation policy.
 *
 * Returns a fresh copy of {@link DEFAULT_ESCALATION_POLICY} to avoid
 * accidental mutation of the shared constant.
 *
 * @returns A new EscalationPolicy instance with V1 defaults.
 */
export function createDefaultEscalationPolicy(): EscalationPolicy {
  return {
    ...DEFAULT_ESCALATION_POLICY,
    triggers: { ...DEFAULT_ESCALATION_POLICY.triggers },
  };
}
