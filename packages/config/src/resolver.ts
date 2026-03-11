/**
 * Hierarchical configuration resolver with field-level source tracking.
 *
 * Implements the 8-layer configuration precedence model from PRD §9.12.
 * The resolver takes a set of ordered configuration layer entries and
 * merges them from lowest to highest precedence, producing a fully
 * resolved configuration where every field carries provenance information
 * identifying which layer supplied its current value.
 *
 * The resolver is a pure function with no side effects or external
 * dependencies — layer loading from databases, files, or other sources
 * is the responsibility of the caller (typically an application service).
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.12 — Configuration Precedence
 * @see {@link file://docs/prd/007-technical-architecture.md} §7.12 — Configuration Architecture
 * @module @factory/config/resolver
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

import { mergeCommandPolicies } from "./defaults/command-policy.js";
import { mergeEscalationPolicies } from "./defaults/escalation-policy.js";
import { mergeFileScopePolicies } from "./defaults/file-scope-policy.js";
import { mergeLeasePolicies } from "./defaults/lease-policy.js";
import { mergeRetentionPolicies } from "./defaults/retention-policy.js";
import { mergeRetryPolicies } from "./defaults/retry-policy.js";
import { mergeReviewPolicies } from "./defaults/review-policy.js";
import { mergeValidationPolicies } from "./defaults/validation-policy.js";
import { SYSTEM_DEFAULTS } from "./defaults/system-defaults.js";
import type {
  ConfigLayerEntry,
  ConfigLayerValue,
  FactoryConfig,
  FieldSourceMap,
  PolicyName,
  ResolvedConfig,
  ResolvedFieldSource,
} from "./types.js";
import { ConfigLayer, CONFIG_LAYER_PRECEDENCE, POLICY_NAMES } from "./types.js";

// ---------------------------------------------------------------------------
// Merge function registry
// ---------------------------------------------------------------------------

/**
 * Registry mapping each policy name to its typed merge function.
 *
 * Each merge function takes a base policy and a partial override,
 * returning a new policy with the override applied. This enables
 * the generic resolver loop to dispatch to the correct merge
 * implementation for each sub-policy.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const MERGE_FUNCTIONS: Record<PolicyName, (base: any, override: any) => any> = {
  command_policy: mergeCommandPolicies,
  file_scope_policy: mergeFileScopePolicies,
  validation_policy: mergeValidationPolicies,
  retry_policy: mergeRetryPolicies,
  escalation_policy: mergeEscalationPolicies,
  lease_policy: mergeLeasePolicies,
  retention_policy: mergeRetentionPolicies,
  review_policy: mergeReviewPolicies,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a FieldSourceMap for a policy, initializing all fields to a given source.
 */
function initFieldSources<T extends Record<string, unknown>>(
  policy: T,
  source: ResolvedFieldSource,
): FieldSourceMap<T> {
  const sources: Record<string, ResolvedFieldSource> = {};
  for (const key of Object.keys(policy)) {
    sources[key] = source;
  }
  return sources as FieldSourceMap<T>;
}

/**
 * Update field sources for fields that were overridden.
 *
 * Compares the override object against the base policy: any field
 * that is present (not undefined) in the override gets its source
 * updated to the new layer.
 */
function updateFieldSources<T extends Record<string, unknown>>(
  currentSources: FieldSourceMap<T>,
  override: Partial<T>,
  newSource: ResolvedFieldSource,
): FieldSourceMap<T> {
  const updated: Record<string, ResolvedFieldSource> = { ...currentSources };
  for (const key of Object.keys(override)) {
    if ((override as Record<string, unknown>)[key] !== undefined) {
      updated[key] = newSource;
    }
  }
  return updated as FieldSourceMap<T>;
}

/**
 * Get the precedence index for a config layer (0 = lowest, 7 = highest).
 */
function getLayerPrecedence(layer: ConfigLayerValue): number {
  const index = CONFIG_LAYER_PRECEDENCE.indexOf(layer);
  if (index === -1) {
    throw new Error(`Unknown configuration layer: ${layer}`);
  }
  return index;
}

/**
 * Validate that layer entries are in non-decreasing precedence order.
 *
 * The resolver requires layers to be provided in precedence order
 * (lowest to highest) so that higher-precedence layers are applied
 * last and win in case of conflicts.
 */
function validateLayerOrder(layers: readonly ConfigLayerEntry[]): void {
  let lastPrecedence = -1;
  for (const entry of layers) {
    const precedence = getLayerPrecedence(entry.layer);
    if (precedence < lastPrecedence) {
      throw new Error(
        `Configuration layers must be in non-decreasing precedence order. ` +
          `Layer "${entry.layer}" (precedence ${precedence}) appears after a ` +
          `layer with higher precedence (${lastPrecedence}).`,
      );
    }
    lastPrecedence = precedence;
  }
}

// ---------------------------------------------------------------------------
// Internal mutable state during resolution
// ---------------------------------------------------------------------------

/**
 * Internal mutable state for a single policy during resolution.
 * Converted to the immutable ResolvedPolicy at the end.
 */
interface MutableResolvedPolicy<T> {
  value: T;
  fieldSources: FieldSourceMap<T>;
}

/**
 * Internal mutable state for the full config during resolution.
 */
interface MutableResolvedConfig {
  command_policy: MutableResolvedPolicy<CommandPolicy>;
  file_scope_policy: MutableResolvedPolicy<FileScopePolicy>;
  validation_policy: MutableResolvedPolicy<ValidationPolicy>;
  retry_policy: MutableResolvedPolicy<RetryPolicy>;
  escalation_policy: MutableResolvedPolicy<EscalationPolicy>;
  lease_policy: MutableResolvedPolicy<LeasePolicy>;
  retention_policy: MutableResolvedPolicy<RetentionPolicy>;
  review_policy: MutableResolvedPolicy<ReviewPolicy>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a full factory configuration from ordered layer entries.
 *
 * Starting from system defaults, applies each layer's partial overrides
 * in precedence order (lowest to highest). Each resolved field tracks
 * which layer supplied its current value for auditing and debugging.
 *
 * Layers must be provided in non-decreasing precedence order. The
 * system defaults layer is always applied first (it does not need to
 * be included in the layers array).
 *
 * @param layers - Ordered configuration layer entries (lowest precedence first).
 *                 The system defaults layer is applied automatically and should
 *                 NOT be included in this array.
 * @param systemDefaults - Optional custom system defaults. If not provided,
 *                         the built-in SYSTEM_DEFAULTS are used.
 * @returns The fully resolved configuration with field-level source tracking.
 *
 * @throws Error if layers are not in non-decreasing precedence order.
 * @throws Error if an unknown layer name is encountered.
 *
 * @example
 * ```ts
 * const resolved = resolveConfig([
 *   {
 *     layer: ConfigLayer.ORGANIZATION,
 *     source: "project:my-project",
 *     config: {
 *       command_policy: { allow_shell_operators: true },
 *       lease_policy: { lease_ttl_seconds: 3600 },
 *     },
 *   },
 *   {
 *     layer: ConfigLayer.TASK,
 *     source: "task:task-42",
 *     config: {
 *       retry_policy: { max_attempts: 3 },
 *     },
 *   },
 * ]);
 *
 * // resolved.lease_policy.value.lease_ttl_seconds === 3600
 * // resolved.lease_policy.fieldSources.lease_ttl_seconds.layer === "organization"
 * // resolved.retry_policy.value.max_attempts === 3
 * // resolved.retry_policy.fieldSources.max_attempts.layer === "task"
 * ```
 */
export function resolveConfig(
  layers: readonly ConfigLayerEntry[],
  systemDefaults: FactoryConfig = SYSTEM_DEFAULTS,
): ResolvedConfig {
  validateLayerOrder(layers);

  const systemSource: ResolvedFieldSource = {
    layer: ConfigLayer.SYSTEM,
    source: "system-defaults",
  };

  // Initialize mutable state from system defaults
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const state: MutableResolvedConfig = {} as MutableResolvedConfig;
  for (const policyName of POLICY_NAMES) {
    const defaultValue = systemDefaults[policyName];
    (state as any)[policyName] = {
      value: defaultValue,
      fieldSources: initFieldSources(defaultValue as Record<string, unknown>, systemSource),
    };
  }

  // Apply each layer in precedence order
  for (const entry of layers) {
    const layerSource: ResolvedFieldSource = {
      layer: entry.layer,
      source: entry.source,
    };

    for (const policyName of POLICY_NAMES) {
      const override = entry.config[policyName];
      if (override === undefined) {
        continue;
      }

      const current = (state as any)[policyName] as MutableResolvedPolicy<unknown>;
      const mergeFn = MERGE_FUNCTIONS[policyName];

      // Merge the policy values
      current.value = mergeFn(current.value, override);

      // Update field sources for overridden fields
      current.fieldSources = updateFieldSources(
        current.fieldSources as FieldSourceMap<Record<string, unknown>>,
        override as Record<string, unknown>,
        layerSource,
      );
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Convert to immutable ResolvedConfig
  return state as unknown as ResolvedConfig;
}

/**
 * Extract just the policy values from a ResolvedConfig, discarding source tracking.
 *
 * Useful when you need a plain FactoryConfig without provenance information,
 * for example when generating a PolicySnapshot for worker dispatch.
 *
 * @param resolved - The resolved configuration with source tracking.
 * @returns A plain FactoryConfig with just the policy values.
 */
export function extractValues(resolved: ResolvedConfig): FactoryConfig {
  return {
    command_policy: resolved.command_policy.value,
    file_scope_policy: resolved.file_scope_policy.value,
    validation_policy: resolved.validation_policy.value,
    retry_policy: resolved.retry_policy.value,
    escalation_policy: resolved.escalation_policy.value,
    lease_policy: resolved.lease_policy.value,
    retention_policy: resolved.retention_policy.value,
    review_policy: resolved.review_policy.value,
  };
}

/**
 * Extract source tracking information from a ResolvedConfig.
 *
 * Returns a record mapping each policy name to its field source map.
 * Useful for auditing and debugging to understand which layers
 * contributed which settings.
 *
 * @param resolved - The resolved configuration with source tracking.
 * @returns A record of policy name → field source map.
 */
export function extractSources(
  resolved: ResolvedConfig,
): Record<PolicyName, FieldSourceMap<Record<string, unknown>>> {
  const sources: Record<string, FieldSourceMap<Record<string, unknown>>> = {};
  for (const policyName of POLICY_NAMES) {
    sources[policyName] = resolved[policyName].fieldSources as FieldSourceMap<
      Record<string, unknown>
    >;
  }
  return sources as Record<PolicyName, FieldSourceMap<Record<string, unknown>>>;
}
