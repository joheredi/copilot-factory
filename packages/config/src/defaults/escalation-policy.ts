/**
 * Escalation policy override type and hierarchical merge support.
 *
 * The default escalation policy values come from PRD §9.7. This module
 * provides the override type and merge function for hierarchical
 * configuration resolution.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.7 — Escalation Policy
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.12 — Configuration Precedence
 * @module @factory/config/defaults/escalation-policy
 */

import type { EscalationPolicy } from "@factory/schemas";

// ---------------------------------------------------------------------------
// Policy override type
// ---------------------------------------------------------------------------

/**
 * Partial escalation policy override for hierarchical configuration resolution.
 *
 * The triggers field is a record mapping trigger names to actions. When
 * overridden, the entire triggers record is replaced wholesale (individual
 * triggers are not merged across layers).
 */
export interface EscalationPolicyOverride {
  readonly triggers?: EscalationPolicy["triggers"];
  readonly route_to?: EscalationPolicy["route_to"];
  readonly require_summary?: EscalationPolicy["require_summary"];
}

// ---------------------------------------------------------------------------
// Default policy
// ---------------------------------------------------------------------------

/**
 * Default V1 escalation policy.
 *
 * Covers the required trigger cases from §9.7.2:
 * - max_retry_exceeded → escalate to operator
 * - max_review_rounds_exceeded → escalate to operator
 * - policy_violation → escalate to operator
 * - merge_failure_after_retries → escalate to operator
 * - heartbeat_timeout → retry first, then escalate
 * - schema_validation_failure → fail and escalate
 * - repeated_schema_failures → disable profile and escalate
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.7.1
 */
export const DEFAULT_ESCALATION_POLICY: EscalationPolicy = {
  triggers: {
    max_retry_exceeded: "escalate",
    max_review_rounds_exceeded: "escalate",
    policy_violation: "escalate",
    merge_failure_after_retries: "escalate",
    heartbeat_timeout: "retry_or_escalate",
    schema_validation_failure: "fail_and_escalate",
    repeated_schema_failures: "disable_profile_and_escalate",
  },
  route_to: "operator-queue",
  require_summary: true,
};

// ---------------------------------------------------------------------------
// Policy merging
// ---------------------------------------------------------------------------

/**
 * Merge a base escalation policy with an override.
 *
 * Override fields replace base fields when present (last-writer-wins).
 * The triggers record is replaced wholesale when overridden.
 *
 * @param base - The base policy to start from.
 * @param override - Partial override to apply on top of the base.
 * @returns A new EscalationPolicy with the override applied.
 */
export function mergeEscalationPolicies(
  base: EscalationPolicy,
  override: EscalationPolicyOverride,
): EscalationPolicy {
  return {
    triggers: override.triggers ?? base.triggers,
    route_to: override.route_to ?? base.route_to,
    require_summary: override.require_summary ?? base.require_summary,
  };
}
