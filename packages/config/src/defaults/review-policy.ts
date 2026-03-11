/**
 * Default V1 review policy and hierarchical merge support.
 *
 * Provides the baseline review policy from PRD §9.9 governing
 * review rounds, required/optional reviewer types, and lead reviewer
 * requirements.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.9 — Review Policy
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.12 — Configuration Precedence
 * @module @factory/config/defaults/review-policy
 */

import type { ReviewPolicy } from "@factory/schemas";

// ---------------------------------------------------------------------------
// Policy override type
// ---------------------------------------------------------------------------

/**
 * Partial review policy override for hierarchical configuration resolution.
 *
 * Array fields (reviewer types) use last-writer-wins replacement semantics —
 * they are replaced wholesale, not merged with the base arrays.
 */
export interface ReviewPolicyOverride {
  readonly max_review_rounds?: ReviewPolicy["max_review_rounds"];
  readonly required_reviewer_types?: ReviewPolicy["required_reviewer_types"];
  readonly optional_reviewer_types?: ReviewPolicy["optional_reviewer_types"];
  readonly lead_reviewer_required?: ReviewPolicy["lead_reviewer_required"];
}

// ---------------------------------------------------------------------------
// Default policy
// ---------------------------------------------------------------------------

/**
 * Default V1 review policy.
 *
 * - Maximum 3 review rounds before escalation
 * - General reviewer is required
 * - Security and performance reviewers are optional (added by routing rules)
 * - Lead reviewer approval is always required for final decision
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.9.1
 */
export const DEFAULT_REVIEW_POLICY: ReviewPolicy = {
  max_review_rounds: 3,
  required_reviewer_types: ["general"],
  optional_reviewer_types: ["security", "performance"],
  lead_reviewer_required: true,
};

// ---------------------------------------------------------------------------
// Policy merging
// ---------------------------------------------------------------------------

/**
 * Merge a base review policy with an override.
 *
 * Override fields replace base fields when present (last-writer-wins).
 * Array fields (reviewer types) are replaced wholesale, not merged.
 *
 * @param base - The base policy to start from.
 * @param override - Partial override to apply on top of the base.
 * @returns A new ReviewPolicy with the override applied.
 */
export function mergeReviewPolicies(
  base: ReviewPolicy,
  override: ReviewPolicyOverride,
): ReviewPolicy {
  return {
    max_review_rounds: override.max_review_rounds ?? base.max_review_rounds,
    required_reviewer_types: override.required_reviewer_types ?? base.required_reviewer_types,
    optional_reviewer_types: override.optional_reviewer_types ?? base.optional_reviewer_types,
    lead_reviewer_required: override.lead_reviewer_required ?? base.lead_reviewer_required,
  };
}
