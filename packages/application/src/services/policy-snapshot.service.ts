/**
 * Policy snapshot generation service.
 *
 * Orchestrates the end-to-end generation of an effective policy snapshot
 * for a worker run. The snapshot captures the fully resolved configuration
 * at dispatch time and is immutable for the life of the run — ensuring
 * reproducibility and auditability.
 *
 * The service follows this pipeline:
 * 1. Load configuration layers from infrastructure via {@link ConfigLayerLoaderPort}
 * 2. Resolve layers through the hierarchical config resolver
 * 3. Extract resolved values and source tracking
 * 4. Assemble and validate the {@link PolicySnapshot} against its Zod schema
 * 5. Persist the snapshot as a run-level artifact via {@link PolicySnapshotArtifactPort}
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.2 — Effective Policy Snapshot
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.12 — Configuration Precedence
 * @module @factory/application/services/policy-snapshot
 */

import { resolveConfig, extractValues, extractSources } from "@factory/config";
import type {
  ConfigLayerEntry,
  FactoryConfig,
  FieldSourceMap,
  PolicyName,
  ResolvedConfig,
} from "@factory/config";
import { PolicySnapshotSchema } from "@factory/schemas";
import type { PolicySnapshot } from "@factory/schemas";

import type {
  ConfigLayerLoaderPort,
  PolicySnapshotArtifactPort,
  PolicySnapshotContext,
} from "../ports/policy-snapshot.ports.js";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Error thrown when the generated policy snapshot fails Zod schema validation.
 *
 * This should never happen if the resolver and sub-policy schemas are
 * consistent, but serves as a safety net to catch structural mismatches
 * before a malformed snapshot reaches a worker.
 */
export class PolicySnapshotValidationError extends Error {
  /** The Zod validation issues that caused the failure. */
  readonly issues: readonly { path: (string | number)[]; message: string }[];

  constructor(issues: readonly { path: (string | number)[]; message: string }[]) {
    const summary = issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    super(`Policy snapshot failed schema validation:\n${summary}`);
    this.name = "PolicySnapshotValidationError";
    this.issues = issues;
  }
}

/**
 * Error thrown when the config layer loader fails to provide layers.
 */
export class ConfigLayerLoadError extends Error {
  /** The context that was being loaded when the error occurred. */
  readonly context: PolicySnapshotContext;
  /** The underlying cause of the failure. */
  readonly cause: unknown;

  constructor(context: PolicySnapshotContext, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `Failed to load config layers for task=${context.taskId}, ` +
        `pool=${context.poolId}, run=${context.runId}: ${causeMessage}`,
    );
    this.name = "ConfigLayerLoadError";
    this.context = context;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Snapshot generation result
// ---------------------------------------------------------------------------

/**
 * Result of a successful policy snapshot generation.
 *
 * Contains the validated snapshot, its storage path, the full resolved
 * config with source tracking, and metadata about the generation.
 */
export interface GeneratePolicySnapshotResult {
  /** The validated, immutable policy snapshot. */
  readonly snapshot: PolicySnapshot;
  /** The path or identifier where the snapshot was persisted. */
  readonly artifactPath: string;
  /** The full resolved configuration with field-level source tracking. */
  readonly resolvedConfig: ResolvedConfig;
  /** Source tracking map for each policy field — useful for audit logging. */
  readonly fieldSources: Record<PolicyName, FieldSourceMap<Record<string, unknown>>>;
  /** Number of configuration layers that were applied (excluding system defaults). */
  readonly layerCount: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Service for generating effective policy snapshots for worker runs.
 *
 * Each call to {@link generatePolicySnapshot} produces a new immutable
 * snapshot that captures the fully resolved configuration at the time
 * of generation. The snapshot is validated against the Zod schema and
 * persisted as a run-level artifact.
 */
export interface PolicySnapshotService {
  /**
   * Generate, validate, and persist an effective policy snapshot for a run.
   *
   * @param taskId - The task being executed.
   * @param poolId - The worker pool assigned to the task.
   * @param runId - The unique run identifier.
   * @returns The generation result with snapshot, artifact path, and metadata.
   *
   * @throws {ConfigLayerLoadError} If config layer loading fails.
   * @throws {PolicySnapshotValidationError} If the assembled snapshot fails schema validation.
   * @throws {Error} If artifact persistence fails.
   */
  generatePolicySnapshot(
    taskId: string,
    poolId: string,
    runId: string,
  ): Promise<GeneratePolicySnapshotResult>;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies injected into the policy snapshot service.
 */
export interface PolicySnapshotServiceDependencies {
  /** Port for loading configuration layers from infrastructure. */
  readonly configLayerLoader: ConfigLayerLoaderPort;
  /** Port for persisting the snapshot as a run-level artifact. */
  readonly artifactStore: PolicySnapshotArtifactPort;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Derive a policy_set_id from the loaded configuration layers.
 *
 * The policy_set_id identifies the "policy set" that the snapshot was
 * resolved from. When layers include an organization or project source,
 * that becomes the policy set ID. Otherwise, falls back to "system-defaults".
 *
 * @param layers - The loaded configuration layers.
 * @returns A human-readable policy set identifier.
 */
function derivePolicySetId(layers: readonly ConfigLayerEntry[]): string {
  // Walk layers from highest to lowest precedence, pick the first
  // meaningful source identifier we find.
  for (let i = layers.length - 1; i >= 0; i--) {
    const entry = layers[i]!;
    if (entry.source && entry.source !== "system-defaults") {
      return entry.source;
    }
  }
  return "system-defaults";
}

/**
 * Assemble a PolicySnapshot from resolved configuration values.
 *
 * All 8 sub-policies are included in the snapshot (they are never omitted
 * because the resolver always produces fully-resolved values starting
 * from system defaults).
 *
 * @param values - The fully resolved policy values.
 * @param policySetId - The identifier for the policy set.
 * @returns An unvalidated PolicySnapshot object.
 */
function assembleSnapshot(values: FactoryConfig, policySetId: string): PolicySnapshot {
  return {
    policy_snapshot_version: "1.0",
    policy_set_id: policySetId,
    command_policy: {
      mode: values.command_policy.mode,
      allowed_commands: values.command_policy.allowed_commands.map((cmd) => ({
        command: cmd.command,
        allowed_args_prefixes: [...cmd.arg_prefixes],
      })),
      denied_patterns: values.command_policy.denied_patterns.map((d) => d.pattern),
      allow_shell_compound_commands: values.command_policy.allow_shell_operators,
      allow_subshells: false,
      allow_env_expansion: false,
      forbidden_arg_patterns: values.command_policy.forbidden_arg_patterns.map((f) => f.pattern),
    },
    file_scope_policy: {
      read_roots: [...values.file_scope_policy.read_roots],
      write_roots: [...values.file_scope_policy.write_roots],
      deny_roots: [...values.file_scope_policy.deny_roots],
      allow_read_outside_scope: values.file_scope_policy.allow_read_outside_scope,
      allow_write_outside_scope: values.file_scope_policy.allow_write_outside_scope,
      on_violation: values.file_scope_policy.on_violation,
    },
    validation_policy: {
      profiles: Object.fromEntries(
        Object.entries(values.validation_policy.profiles).map(([name, profile]) => [
          name,
          {
            required_checks: [...profile.required_checks],
            optional_checks: [...profile.optional_checks],
            commands: { ...profile.commands },
            fail_on_skipped_required_check: profile.fail_on_skipped_required_check,
          },
        ]),
      ),
    },
    retry_policy: { ...values.retry_policy },
    escalation_policy: {
      triggers: { ...values.escalation_policy.triggers },
      route_to: values.escalation_policy.route_to,
      require_summary: values.escalation_policy.require_summary,
    },
    lease_policy: { ...values.lease_policy },
    retention_policy: { ...values.retention_policy },
    review_policy: {
      max_review_rounds: values.review_policy.max_review_rounds,
      required_reviewer_types: [...values.review_policy.required_reviewer_types],
      optional_reviewer_types: [...values.review_policy.optional_reviewer_types],
      lead_reviewer_required: values.review_policy.lead_reviewer_required,
    },
  };
}

/**
 * Validate a PolicySnapshot against the Zod schema.
 *
 * @param snapshot - The assembled snapshot to validate.
 * @returns The validated snapshot (same value, schema-verified).
 * @throws {PolicySnapshotValidationError} If validation fails.
 */
function validateSnapshot(snapshot: PolicySnapshot): PolicySnapshot {
  const result = PolicySnapshotSchema.safeParse(snapshot);
  if (!result.success) {
    throw new PolicySnapshotValidationError(
      result.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a new policy snapshot service.
 *
 * The service is stateless — all state comes from the injected ports.
 * Each call to generatePolicySnapshot produces a fresh snapshot from
 * the current configuration state.
 *
 * @param deps - The injected dependencies (config layer loader, artifact store).
 * @returns A new {@link PolicySnapshotService} instance.
 *
 * @example
 * ```ts
 * const service = createPolicySnapshotService({
 *   configLayerLoader: myDbLayerLoader,
 *   artifactStore: myFilesystemArtifactStore,
 * });
 *
 * const result = await service.generatePolicySnapshot(
 *   "task-42",
 *   "pool-default",
 *   "run-abc123",
 * );
 * // result.snapshot — the validated PolicySnapshot
 * // result.artifactPath — where it was persisted
 * // result.fieldSources — provenance for every field
 * ```
 */
export function createPolicySnapshotService(
  deps: PolicySnapshotServiceDependencies,
): PolicySnapshotService {
  return {
    async generatePolicySnapshot(
      taskId: string,
      poolId: string,
      runId: string,
    ): Promise<GeneratePolicySnapshotResult> {
      const context: PolicySnapshotContext = { taskId, poolId, runId };

      // Step 1: Load configuration layers from infrastructure
      let layers: readonly ConfigLayerEntry[];
      try {
        layers = await deps.configLayerLoader.loadLayers(context);
      } catch (err: unknown) {
        throw new ConfigLayerLoadError(context, err);
      }

      // Step 2: Resolve the hierarchical configuration
      const resolvedConfig = resolveConfig(layers);

      // Step 3: Extract plain values and source tracking
      const values = extractValues(resolvedConfig);
      const fieldSources = extractSources(resolvedConfig);

      // Step 4: Derive policy set ID from loaded layers
      const policySetId = derivePolicySetId(layers);

      // Step 5: Assemble the snapshot structure
      const rawSnapshot = assembleSnapshot(values, policySetId);

      // Step 6: Validate against Zod schema
      const snapshot = validateSnapshot(rawSnapshot);

      // Step 7: Persist as immutable run-level artifact
      const artifactPath = await deps.artifactStore.persist(runId, snapshot);

      // Step 8: Return the complete result
      return {
        snapshot,
        artifactPath,
        resolvedConfig,
        fieldSources,
        layerCount: layers.length,
      };
    },
  };
}
