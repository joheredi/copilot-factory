/**
 * Zod schema for PolicySnapshot — the resolved effective policy snapshot
 * persisted for every run.
 *
 * The PolicySnapshot captures the complete effective policy for a worker
 * run at the time it was dispatched. It is immutable for the life of a run
 * and used for auditing and replay. Each sub-policy is optional because
 * the snapshot reflects the resolved policy — sub-policies that were not
 * applicable or had no overrides may be omitted.
 *
 * @module @factory/schemas/policy-snapshot
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.2 Effective Policy Snapshot
 */

import { z } from "zod";

// ─── Sub-Policy Schemas ─────────────────────────────────────────────────────

/**
 * Zod schema for a single allowed command in the command policy.
 *
 * Describes a command that is permitted for execution along with
 * its allowed argument prefixes.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.3.2
 */
export const AllowedCommandSchema = z.object({
  command: z.string().min(1, "command must not be empty"),
  allowed_args_prefixes: z.array(z.string()),
});

/** Inferred TypeScript type for {@link AllowedCommandSchema}. */
export type AllowedCommand = z.infer<typeof AllowedCommandSchema>;

/**
 * Zod schema for CommandPolicy — defines what a worker is allowed to execute.
 *
 * Controls command execution with an allowlist/denylist approach.
 * Default V1 behavior is deny-by-default with allowlists.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.3
 */
export const CommandPolicySchema = z.object({
  mode: z.string().min(1, "mode must not be empty"),
  allowed_commands: z.array(AllowedCommandSchema),
  denied_patterns: z.array(z.string()),
  allow_shell_compound_commands: z.boolean(),
  allow_subshells: z.boolean(),
  allow_env_expansion: z.boolean(),
  forbidden_arg_patterns: z.array(z.string()),
});

/** Inferred TypeScript type for {@link CommandPolicySchema}. */
export type CommandPolicy = z.infer<typeof CommandPolicySchema>;

/**
 * Zod schema for FileScopePolicy — defines read/write access boundaries
 * for workers.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.4
 */
export const FileScopePolicySchema = z.object({
  read_roots: z.array(z.string()),
  write_roots: z.array(z.string()),
  deny_roots: z.array(z.string()),
  allow_read_outside_scope: z.boolean(),
  allow_write_outside_scope: z.boolean(),
  on_violation: z.string().min(1, "on_violation must not be empty"),
});

/** Inferred TypeScript type for {@link FileScopePolicySchema}. */
export type FileScopePolicy = z.infer<typeof FileScopePolicySchema>;

/**
 * Zod schema for a single validation profile within the validation policy.
 *
 * Defines required/optional checks and the commands to run them.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.5
 */
export const ValidationProfileSchema = z.object({
  required_checks: z.array(z.string()),
  optional_checks: z.array(z.string()),
  commands: z.record(z.string(), z.string()),
  fail_on_skipped_required_check: z.boolean(),
});

/** Inferred TypeScript type for {@link ValidationProfileSchema}. */
export type ValidationProfile = z.infer<typeof ValidationProfileSchema>;

/**
 * Zod schema for ValidationPolicy — defines validation profiles and
 * check requirements.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.5
 */
export const ValidationPolicySchema = z.object({
  profiles: z.record(z.string(), ValidationProfileSchema),
});

/** Inferred TypeScript type for {@link ValidationPolicySchema}. */
export type ValidationPolicy = z.infer<typeof ValidationPolicySchema>;

/**
 * Zod schema for RetryPolicy — controls automatic retry behavior after
 * failures.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.6
 */
export const RetryPolicySchema = z.object({
  max_attempts: z.number().int().nonnegative(),
  backoff_strategy: z.string().min(1, "backoff_strategy must not be empty"),
  initial_backoff_seconds: z.number().int().positive(),
  max_backoff_seconds: z.number().int().positive(),
  reuse_same_pool: z.boolean(),
  allow_pool_change_after_failure: z.boolean(),
  require_failure_summary_packet: z.boolean(),
});

/** Inferred TypeScript type for {@link RetryPolicySchema}. */
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

/**
 * Zod schema for EscalationPolicy — defines escalation triggers and routing.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.7
 */
export const EscalationPolicySchema = z.object({
  triggers: z.record(z.string(), z.string()),
  route_to: z.string().min(1, "route_to must not be empty"),
  require_summary: z.boolean(),
});

/** Inferred TypeScript type for {@link EscalationPolicySchema}. */
export type EscalationPolicy = z.infer<typeof EscalationPolicySchema>;

/**
 * Zod schema for LeasPolicy — defines lease TTL, heartbeat intervals,
 * and staleness detection parameters.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.8
 */
export const LeasePolicySchema = z.object({
  lease_ttl_seconds: z.number().int().positive(),
  heartbeat_interval_seconds: z.number().int().positive(),
  missed_heartbeat_threshold: z.number().int().positive(),
  grace_period_seconds: z.number().int().nonnegative(),
  reclaim_action: z.string().min(1, "reclaim_action must not be empty"),
});

/** Inferred TypeScript type for {@link LeasePolicySchema}. */
export type LeasePolicy = z.infer<typeof LeasePolicySchema>;

/**
 * Zod schema for RetentionPolicy — defines workspace and artifact
 * retention periods.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.10
 */
export const RetentionPolicySchema = z.object({
  workspace_retention_hours: z.number().int().nonnegative(),
  artifact_retention_days: z.number().int().nonnegative(),
  retain_failed_workspaces: z.boolean(),
  retain_escalated_workspaces: z.boolean(),
});

/** Inferred TypeScript type for {@link RetentionPolicySchema}. */
export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>;

/**
 * Zod schema for ReviewPolicy — defines review round limits and
 * reviewer requirements.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.9
 */
export const ReviewPolicySchema = z.object({
  max_review_rounds: z.number().int().positive(),
  required_reviewer_types: z.array(z.string().min(1)),
  optional_reviewer_types: z.array(z.string()),
  lead_reviewer_required: z.boolean(),
});

/** Inferred TypeScript type for {@link ReviewPolicySchema}. */
export type ReviewPolicy = z.infer<typeof ReviewPolicySchema>;

// ─── PolicySnapshot Top-Level Schema ────────────────────────────────────────

/**
 * Zod schema for PolicySnapshot — the resolved effective policy snapshot
 * that is persisted for every run.
 *
 * This snapshot is immutable for the life of a run. It captures the
 * complete resolved policy at dispatch time so that the run's behavior
 * is fully reproducible and auditable.
 *
 * Required fields:
 * - `policy_snapshot_version` — literal `"1.0"`
 * - `policy_set_id` — the policy set this snapshot was resolved from
 *
 * Optional sub-policy fields (present when applicable):
 * - `command_policy` — command execution restrictions
 * - `file_scope_policy` — file read/write boundaries
 * - `validation_policy` — validation profiles and checks
 * - `retry_policy` — automatic retry configuration
 * - `escalation_policy` — escalation triggers and routing
 * - `lease_policy` — lease TTL and heartbeat parameters
 * - `retention_policy` — artifact/workspace retention
 * - `review_policy` — review round limits and reviewer requirements
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.2 Effective Policy Snapshot
 */
export const PolicySnapshotSchema = z.object({
  policy_snapshot_version: z.literal("1.0"),
  policy_set_id: z.string().min(1, "policy_set_id must not be empty"),
  command_policy: CommandPolicySchema.optional(),
  file_scope_policy: FileScopePolicySchema.optional(),
  validation_policy: ValidationPolicySchema.optional(),
  retry_policy: RetryPolicySchema.optional(),
  escalation_policy: EscalationPolicySchema.optional(),
  lease_policy: LeasePolicySchema.optional(),
  retention_policy: RetentionPolicySchema.optional(),
  review_policy: ReviewPolicySchema.optional(),
});

/** Inferred TypeScript type for {@link PolicySnapshotSchema}. */
export type PolicySnapshot = z.infer<typeof PolicySnapshotSchema>;
