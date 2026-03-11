/**
 * Core types for hierarchical configuration resolution.
 *
 * Defines the 8-layer precedence model from PRD §9.12, the resolution
 * context, layer entries, and resolved configuration with field-level
 * source tracking for debugging and auditing.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.12 — Configuration Precedence
 * @see {@link file://docs/prd/007-technical-architecture.md} §7.12 — Configuration Architecture
 * @module @factory/config/types
 */

import type { CommandPolicy, FileScopePolicy } from "@factory/domain";
import type {
  EscalationPolicy,
  LeasePolicy,
  RetentionPolicy,
  RetryPolicy,
  ReviewPolicy,
  ValidationPolicy,
} from "@factory/schemas";

import type { CommandPolicyOverride } from "./defaults/command-policy.js";
import type { FileScopePolicyOverride } from "./defaults/file-scope-policy.js";
import type { EscalationPolicyOverride } from "./defaults/escalation-policy.js";
import type { LeasePolicyOverride } from "./defaults/lease-policy.js";
import type { RetentionPolicyOverride } from "./defaults/retention-policy.js";
import type { RetryPolicyOverride } from "./defaults/retry-policy.js";
import type { ReviewPolicyOverride } from "./defaults/review-policy.js";
import type { ValidationPolicyOverride } from "./defaults/validation-policy.js";

// ---------------------------------------------------------------------------
// Configuration precedence layers
// ---------------------------------------------------------------------------

/**
 * The 8 configuration precedence layers from PRD §9.12.
 *
 * Layers are listed in ascending precedence order: higher-precedence
 * layers override values from lower-precedence layers.
 *
 * 1. system — hard-coded defaults in source code
 * 2. environment — environment/profile-specific defaults (dev, staging, prod)
 * 3. organization — organization or project-level overrides from DB
 * 4. repository_workflow — repository workflow template overrides
 * 5. pool — worker pool configuration overrides
 * 6. task_type — task-type-specific overrides
 * 7. task — individual task-level overrides
 * 8. operator_override — emergency operator overrides (highest precedence)
 */
export const ConfigLayer = {
  SYSTEM: "system",
  ENVIRONMENT: "environment",
  ORGANIZATION: "organization",
  REPOSITORY_WORKFLOW: "repository_workflow",
  POOL: "pool",
  TASK_TYPE: "task_type",
  TASK: "task",
  OPERATOR_OVERRIDE: "operator_override",
} as const;

export type ConfigLayerValue = (typeof ConfigLayer)[keyof typeof ConfigLayer];

/**
 * Precedence order array for validating layer ordering.
 * Index 0 is lowest precedence, index 7 is highest.
 */
export const CONFIG_LAYER_PRECEDENCE: readonly ConfigLayerValue[] = [
  ConfigLayer.SYSTEM,
  ConfigLayer.ENVIRONMENT,
  ConfigLayer.ORGANIZATION,
  ConfigLayer.REPOSITORY_WORKFLOW,
  ConfigLayer.POOL,
  ConfigLayer.TASK_TYPE,
  ConfigLayer.TASK,
  ConfigLayer.OPERATOR_OVERRIDE,
] as const;

// ---------------------------------------------------------------------------
// Resolution context
// ---------------------------------------------------------------------------

/**
 * Context that identifies what configuration is being resolved for.
 *
 * The resolver uses this context to select which layers apply.
 * Not all fields need to be provided — missing fields mean the
 * corresponding layer is skipped during resolution.
 */
export interface ConfigContext {
  /** Project identifier — used to load organization/project-level overrides. */
  readonly projectId?: string;
  /** Repository identifier — used to load repository workflow template overrides. */
  readonly repositoryId?: string;
  /** Workflow template identifier — used to load template-specific policy overrides. */
  readonly workflowTemplateId?: string;
  /** Worker pool identifier — used to load pool-level overrides. */
  readonly poolId?: string;
  /** Task type (e.g., "FEATURE", "BUG_FIX") — used to load task-type overrides. */
  readonly taskType?: string;
  /** Task identifier — used to load task-specific overrides. */
  readonly taskId?: string;
  /** Environment name (e.g., "development", "staging") — used to load env-level defaults. */
  readonly environment?: string;
  /** Operator emergency overrides — highest precedence, applied last. */
  readonly operatorOverrides?: PartialFactoryConfig;
}

// ---------------------------------------------------------------------------
// Factory configuration shape
// ---------------------------------------------------------------------------

/**
 * The full factory configuration containing all 8 sub-policies.
 *
 * This represents a fully resolved configuration where every policy
 * has a concrete value. System defaults provide the baseline, and
 * each layer can override individual policies or fields within them.
 */
export interface FactoryConfig {
  readonly command_policy: CommandPolicy;
  readonly file_scope_policy: FileScopePolicy;
  readonly validation_policy: ValidationPolicy;
  readonly retry_policy: RetryPolicy;
  readonly escalation_policy: EscalationPolicy;
  readonly lease_policy: LeasePolicy;
  readonly retention_policy: RetentionPolicy;
  readonly review_policy: ReviewPolicy;
}

/**
 * A partial factory configuration where each policy is optional and
 * each field within a policy can be partially overridden.
 *
 * Used in ConfigLayerEntry to represent what a single layer contributes.
 */
export interface PartialFactoryConfig {
  readonly command_policy?: CommandPolicyOverride;
  readonly file_scope_policy?: FileScopePolicyOverride;
  readonly validation_policy?: ValidationPolicyOverride;
  readonly retry_policy?: RetryPolicyOverride;
  readonly escalation_policy?: EscalationPolicyOverride;
  readonly lease_policy?: LeasePolicyOverride;
  readonly retention_policy?: RetentionPolicyOverride;
  readonly review_policy?: ReviewPolicyOverride;
}

// ---------------------------------------------------------------------------
// Layer entries
// ---------------------------------------------------------------------------

/**
 * A single configuration layer entry.
 *
 * Represents one layer in the precedence hierarchy with its partial
 * overrides. The resolver processes these in precedence order to
 * produce the final resolved configuration.
 */
export interface ConfigLayerEntry {
  /** Which precedence layer this entry belongs to. */
  readonly layer: ConfigLayerValue;
  /** Human-readable source description for auditing (e.g., "project:proj-123", "pool:gpu-pool"). */
  readonly source: string;
  /** The partial configuration overrides this layer provides. */
  readonly config: PartialFactoryConfig;
}

// ---------------------------------------------------------------------------
// Source tracking
// ---------------------------------------------------------------------------

/**
 * Identifies which configuration layer provided a resolved value.
 *
 * Every field in the resolved configuration carries this provenance
 * information so operators can trace exactly where each setting
 * came from during debugging or auditing.
 */
export interface ResolvedFieldSource {
  /** The precedence layer that supplied this value. */
  readonly layer: ConfigLayerValue;
  /** Human-readable source description (e.g., "system-defaults", "project:proj-123"). */
  readonly source: string;
}

/**
 * Maps each field in a policy to the layer that supplied its value.
 *
 * For a policy type T with fields {a, b, c}, this produces
 * { a: ResolvedFieldSource, b: ResolvedFieldSource, c: ResolvedFieldSource }.
 */
export type FieldSourceMap<T> = {
  readonly [K in keyof T]: ResolvedFieldSource;
};

/**
 * A resolved policy with its concrete value and field-level source tracking.
 *
 * The value is the fully merged policy, and fieldSources maps each
 * field to the layer that last wrote it. This enables operators to
 * understand why a specific setting is in effect.
 */
export interface ResolvedPolicy<T> {
  /** The fully merged policy value. */
  readonly value: T;
  /** Maps each field to the layer that provided its current value. */
  readonly fieldSources: FieldSourceMap<T>;
}

// ---------------------------------------------------------------------------
// Resolved configuration
// ---------------------------------------------------------------------------

/**
 * The fully resolved factory configuration with source tracking.
 *
 * Every sub-policy is fully resolved (no optional fields) and every
 * field carries provenance information identifying which configuration
 * layer supplied its value. This is the output of resolveConfig().
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.2 — Effective Policy Snapshot
 */
export interface ResolvedConfig {
  readonly command_policy: ResolvedPolicy<CommandPolicy>;
  readonly file_scope_policy: ResolvedPolicy<FileScopePolicy>;
  readonly validation_policy: ResolvedPolicy<ValidationPolicy>;
  readonly retry_policy: ResolvedPolicy<RetryPolicy>;
  readonly escalation_policy: ResolvedPolicy<EscalationPolicy>;
  readonly lease_policy: ResolvedPolicy<LeasePolicy>;
  readonly retention_policy: ResolvedPolicy<RetentionPolicy>;
  readonly review_policy: ResolvedPolicy<ReviewPolicy>;
}

/**
 * Names of the 8 sub-policies in FactoryConfig / ResolvedConfig.
 * Used for iterating over policies generically in the resolver.
 */
export type PolicyName = keyof FactoryConfig;

/**
 * All 8 policy names as a constant array for iteration.
 */
export const POLICY_NAMES: readonly PolicyName[] = [
  "command_policy",
  "file_scope_policy",
  "validation_policy",
  "retry_policy",
  "escalation_policy",
  "lease_policy",
  "retention_policy",
  "review_policy",
] as const;
