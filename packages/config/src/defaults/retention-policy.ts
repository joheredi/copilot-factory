/**
 * Default V1 retention policy and hierarchical merge support.
 *
 * Provides the baseline retention policy from PRD §9.10 governing
 * workspace and artifact retention after task completion.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.10 — Retention and Cleanup Policy
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.12 — Configuration Precedence
 * @module @factory/config/defaults/retention-policy
 */

import type { RetentionPolicy } from "@factory/schemas";

// ---------------------------------------------------------------------------
// Policy override type
// ---------------------------------------------------------------------------

/**
 * Partial retention policy override for hierarchical configuration resolution.
 */
export interface RetentionPolicyOverride {
  readonly workspace_retention_hours?: RetentionPolicy["workspace_retention_hours"];
  readonly artifact_retention_days?: RetentionPolicy["artifact_retention_days"];
  readonly retain_failed_workspaces?: RetentionPolicy["retain_failed_workspaces"];
  readonly retain_escalated_workspaces?: RetentionPolicy["retain_escalated_workspaces"];
}

// ---------------------------------------------------------------------------
// Default policy
// ---------------------------------------------------------------------------

/**
 * Default V1 retention policy.
 *
 * - 24-hour workspace retention after terminal state
 * - 30-day artifact retention
 * - Failed and escalated workspaces are retained for debugging
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.10.2
 */
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  workspace_retention_hours: 24,
  artifact_retention_days: 30,
  retain_failed_workspaces: true,
  retain_escalated_workspaces: true,
};

// ---------------------------------------------------------------------------
// Policy merging
// ---------------------------------------------------------------------------

/**
 * Merge a base retention policy with an override.
 *
 * Override fields replace base fields when present (last-writer-wins).
 *
 * @param base - The base policy to start from.
 * @param override - Partial override to apply on top of the base.
 * @returns A new RetentionPolicy with the override applied.
 */
export function mergeRetentionPolicies(
  base: RetentionPolicy,
  override: RetentionPolicyOverride,
): RetentionPolicy {
  return {
    workspace_retention_hours: override.workspace_retention_hours ?? base.workspace_retention_hours,
    artifact_retention_days: override.artifact_retention_days ?? base.artifact_retention_days,
    retain_failed_workspaces: override.retain_failed_workspaces ?? base.retain_failed_workspaces,
    retain_escalated_workspaces:
      override.retain_escalated_workspaces ?? base.retain_escalated_workspaces,
  };
}
