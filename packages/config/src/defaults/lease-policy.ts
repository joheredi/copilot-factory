/**
 * Default V1 lease policy and hierarchical merge support.
 *
 * Provides the baseline lease and heartbeat policy from PRD §9.8.
 * The lease policy governs TTL, heartbeat intervals, staleness
 * detection, and reclaim behavior for worker leases.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.8 — Lease and Heartbeat Policy
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.12 — Configuration Precedence
 * @module @factory/config/defaults/lease-policy
 */

import type { LeasePolicy } from "@factory/schemas";

// ---------------------------------------------------------------------------
// Policy override type
// ---------------------------------------------------------------------------

/**
 * Partial lease policy override for hierarchical configuration resolution.
 *
 * Each level in the configuration hierarchy can provide a partial override
 * that is merged with the base policy. Only present fields are applied;
 * absent fields retain their base values.
 */
export interface LeasePolicyOverride {
  readonly lease_ttl_seconds?: LeasePolicy["lease_ttl_seconds"];
  readonly heartbeat_interval_seconds?: LeasePolicy["heartbeat_interval_seconds"];
  readonly missed_heartbeat_threshold?: LeasePolicy["missed_heartbeat_threshold"];
  readonly grace_period_seconds?: LeasePolicy["grace_period_seconds"];
  readonly reclaim_action?: LeasePolicy["reclaim_action"];
}

// ---------------------------------------------------------------------------
// Default policy
// ---------------------------------------------------------------------------

/**
 * Default V1 lease policy.
 *
 * - 30-minute lease TTL (sufficient for most development tasks)
 * - 30-second heartbeat interval
 * - 2 missed heartbeats before staleness detection
 * - 15-second grace period for graceful completion protocol
 * - Stale leases are marked timed out and requeued for retry
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.8.3 — Default Values
 */
export const DEFAULT_LEASE_POLICY: LeasePolicy = {
  lease_ttl_seconds: 1800,
  heartbeat_interval_seconds: 30,
  missed_heartbeat_threshold: 2,
  grace_period_seconds: 15,
  reclaim_action: "mark_timed_out_and_requeue",
};

// ---------------------------------------------------------------------------
// Policy merging
// ---------------------------------------------------------------------------

/**
 * Merge a base lease policy with an override.
 *
 * Override fields replace base fields when present (last-writer-wins).
 * This follows the hierarchical configuration merge semantics from §9.12.
 *
 * @param base - The base policy to start from.
 * @param override - Partial override to apply on top of the base.
 * @returns A new LeasePolicy with the override applied.
 */
export function mergeLeasePolicies(base: LeasePolicy, override: LeasePolicyOverride): LeasePolicy {
  return {
    lease_ttl_seconds: override.lease_ttl_seconds ?? base.lease_ttl_seconds,
    heartbeat_interval_seconds:
      override.heartbeat_interval_seconds ?? base.heartbeat_interval_seconds,
    missed_heartbeat_threshold:
      override.missed_heartbeat_threshold ?? base.missed_heartbeat_threshold,
    grace_period_seconds: override.grace_period_seconds ?? base.grace_period_seconds,
    reclaim_action: override.reclaim_action ?? base.reclaim_action,
  };
}
