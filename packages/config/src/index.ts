/** @module @factory/config — Hierarchical config resolution, policy loading, and effective snapshot generation. */

// --- Resolver (core public API) ---
export { resolveConfig, extractValues, extractSources } from "./resolver.js";

// --- Types ---
export type {
  ConfigContext,
  ConfigLayerEntry,
  ConfigLayerValue,
  FactoryConfig,
  FieldSourceMap,
  PartialFactoryConfig,
  PolicyName,
  ResolvedConfig,
  ResolvedFieldSource,
  ResolvedPolicy,
} from "./types.js";
export { ConfigLayer, CONFIG_LAYER_PRECEDENCE, POLICY_NAMES } from "./types.js";

// --- Command policy defaults ---
export { DEFAULT_COMMAND_POLICY, mergeCommandPolicies } from "./defaults/command-policy.js";
export type { CommandPolicyOverride } from "./defaults/command-policy.js";

// --- File scope policy defaults ---
export { DEFAULT_FILE_SCOPE_POLICY, mergeFileScopePolicies } from "./defaults/file-scope-policy.js";
export type { FileScopePolicyOverride } from "./defaults/file-scope-policy.js";

// --- Validation policy defaults ---
export {
  DEFAULT_VALIDATION_POLICY,
  mergeValidationPolicies,
} from "./defaults/validation-policy.js";
export type { ValidationPolicyOverride } from "./defaults/validation-policy.js";

// --- Retry policy defaults ---
export { DEFAULT_RETRY_POLICY, mergeRetryPolicies } from "./defaults/retry-policy.js";
export type { RetryPolicyOverride } from "./defaults/retry-policy.js";

// --- Escalation policy defaults ---
export {
  DEFAULT_ESCALATION_POLICY,
  mergeEscalationPolicies,
} from "./defaults/escalation-policy.js";
export type { EscalationPolicyOverride } from "./defaults/escalation-policy.js";

// --- Lease policy defaults ---
export { DEFAULT_LEASE_POLICY, mergeLeasePolicies } from "./defaults/lease-policy.js";
export type { LeasePolicyOverride } from "./defaults/lease-policy.js";

// --- Retention policy defaults ---
export { DEFAULT_RETENTION_POLICY, mergeRetentionPolicies } from "./defaults/retention-policy.js";
export type { RetentionPolicyOverride } from "./defaults/retention-policy.js";

// --- Review policy defaults ---
export { DEFAULT_REVIEW_POLICY, mergeReviewPolicies } from "./defaults/review-policy.js";
export type { ReviewPolicyOverride } from "./defaults/review-policy.js";

// --- System defaults ---
export { SYSTEM_DEFAULTS } from "./defaults/system-defaults.js";
