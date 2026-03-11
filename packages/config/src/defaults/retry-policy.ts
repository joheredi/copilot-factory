/**
 * Retry policy override type and hierarchical merge support.
 *
 * The default retry policy values come from PRD §9.6. This module
 * provides the override type and merge function for hierarchical
 * configuration resolution.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.6 — Retry Policy
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.12 — Configuration Precedence
 * @module @factory/config/defaults/retry-policy
 */

import type { RetryPolicy } from "@factory/schemas";

// ---------------------------------------------------------------------------
// Policy override type
// ---------------------------------------------------------------------------

/**
 * Partial retry policy override for hierarchical configuration resolution.
 */
export interface RetryPolicyOverride {
  readonly max_attempts?: RetryPolicy["max_attempts"];
  readonly backoff_strategy?: RetryPolicy["backoff_strategy"];
  readonly initial_backoff_seconds?: RetryPolicy["initial_backoff_seconds"];
  readonly max_backoff_seconds?: RetryPolicy["max_backoff_seconds"];
  readonly reuse_same_pool?: RetryPolicy["reuse_same_pool"];
  readonly allow_pool_change_after_failure?: RetryPolicy["allow_pool_change_after_failure"];
  readonly require_failure_summary_packet?: RetryPolicy["require_failure_summary_packet"];
}

// ---------------------------------------------------------------------------
// Default policy
// ---------------------------------------------------------------------------

/**
 * Default V1 retry policy.
 *
 * - 2 retry attempts after the initial attempt
 * - Exponential backoff starting at 60 seconds, capped at 900 seconds
 * - Same pool is reused for retries, with pool change allowed after failure
 * - Failure summary packet is required for context propagation
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.6.1
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  max_attempts: 2,
  backoff_strategy: "exponential",
  initial_backoff_seconds: 60,
  max_backoff_seconds: 900,
  reuse_same_pool: true,
  allow_pool_change_after_failure: true,
  require_failure_summary_packet: true,
};

// ---------------------------------------------------------------------------
// Policy merging
// ---------------------------------------------------------------------------

/**
 * Merge a base retry policy with an override.
 *
 * Override fields replace base fields when present (last-writer-wins).
 *
 * @param base - The base policy to start from.
 * @param override - Partial override to apply on top of the base.
 * @returns A new RetryPolicy with the override applied.
 */
export function mergeRetryPolicies(base: RetryPolicy, override: RetryPolicyOverride): RetryPolicy {
  return {
    max_attempts: override.max_attempts ?? base.max_attempts,
    backoff_strategy: override.backoff_strategy ?? base.backoff_strategy,
    initial_backoff_seconds: override.initial_backoff_seconds ?? base.initial_backoff_seconds,
    max_backoff_seconds: override.max_backoff_seconds ?? base.max_backoff_seconds,
    reuse_same_pool: override.reuse_same_pool ?? base.reuse_same_pool,
    allow_pool_change_after_failure:
      override.allow_pool_change_after_failure ?? base.allow_pool_change_after_failure,
    require_failure_summary_packet:
      override.require_failure_summary_packet ?? base.require_failure_summary_packet,
  };
}
