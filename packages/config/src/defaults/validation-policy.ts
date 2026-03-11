/**
 * Validation policy override type and hierarchical merge support.
 *
 * The default validation policy is created by the domain layer's
 * createDefaultValidationPolicy(). This module provides the override
 * type and merge function for hierarchical configuration resolution.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.5 — Validation Policy
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.12 — Configuration Precedence
 * @module @factory/config/defaults/validation-policy
 */

import type { ValidationPolicy } from "@factory/schemas";

// ---------------------------------------------------------------------------
// Policy override type
// ---------------------------------------------------------------------------

/**
 * Partial validation policy override for hierarchical configuration resolution.
 *
 * The profiles field is a record of profile name → profile definition.
 * When overridden, the entire profiles record is replaced wholesale
 * (individual profiles are not merged across layers).
 */
export interface ValidationPolicyOverride {
  readonly profiles?: ValidationPolicy["profiles"];
}

// ---------------------------------------------------------------------------
// Default policy
// ---------------------------------------------------------------------------

/**
 * Default V1 validation policy with standard development and merge-gate profiles.
 *
 * - `default-dev`: requires test + lint, build is optional
 * - `merge-gate`: requires test + build, lint is optional
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.5.1
 */
export const DEFAULT_VALIDATION_POLICY: ValidationPolicy = {
  profiles: {
    "default-dev": {
      required_checks: ["test", "lint"],
      optional_checks: ["build"],
      commands: {
        test: "pnpm test",
        lint: "pnpm lint",
        build: "pnpm build",
      },
      fail_on_skipped_required_check: true,
    },
    "merge-gate": {
      required_checks: ["test", "build"],
      optional_checks: ["lint"],
      commands: {
        test: "pnpm test",
        build: "pnpm build",
        lint: "pnpm lint",
      },
      fail_on_skipped_required_check: true,
    },
  },
};

// ---------------------------------------------------------------------------
// Policy merging
// ---------------------------------------------------------------------------

/**
 * Merge a base validation policy with an override.
 *
 * The profiles record is replaced wholesale when overridden.
 * Individual profiles are NOT merged across layers — if a layer
 * provides profiles, it replaces all profiles from lower layers.
 *
 * @param base - The base policy to start from.
 * @param override - Partial override to apply on top of the base.
 * @returns A new ValidationPolicy with the override applied.
 */
export function mergeValidationPolicies(
  base: ValidationPolicy,
  override: ValidationPolicyOverride,
): ValidationPolicy {
  return {
    profiles: override.profiles ?? base.profiles,
  };
}
