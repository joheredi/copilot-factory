/**
 * Zod schema for TaskPacket — the canonical input to planner, developer,
 * reviewer, merge-assist, and validation stages.
 *
 * The TaskPacket is assembled by the orchestrator and contains all
 * stage-relevant context: task metadata, repository info, workspace paths,
 * policies, validation requirements, stop conditions, and — on rework
 * attempts — the rejection context from the prior review cycle.
 *
 * @module @factory/schemas/task-packet
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.4 TaskPacket
 */

import { z } from "zod";

import { AgentRoleSchema, RiskLevelSchema } from "./shared.js";
import { RejectionContextSchema } from "./rejection-context.js";

// ─── Nested Object Schemas ──────────────────────────────────────────────────

/**
 * Zod schema for the `task` section of a TaskPacket.
 *
 * Contains task metadata: title, description, classification fields
 * (type, priority, severity, risk), acceptance criteria, definition of done,
 * suggested file scope, and the branch name for the task's worktree.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.4.2 task
 */
export const TaskPacketTaskSchema = z.object({
  title: z.string().min(1, "title must not be empty"),
  description: z.string().min(1, "description must not be empty"),
  task_type: z.string().min(1, "task_type must not be empty"),
  priority: z.string().min(1, "priority must not be empty"),
  severity: z.string().min(1, "severity must not be empty"),
  acceptance_criteria: z.array(z.string().min(1)),
  definition_of_done: z.array(z.string().min(1)),
  risk_level: RiskLevelSchema,
  suggested_file_scope: z.array(z.string().min(1)),
  branch_name: z.string().min(1, "branch_name must not be empty"),
});

/** Inferred TypeScript type for {@link TaskPacketTaskSchema}. */
export type TaskPacketTask = z.infer<typeof TaskPacketTaskSchema>;

/**
 * Zod schema for the `repository` section of a TaskPacket.
 *
 * Identifies the target repository by name and default branch.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.4.2 repository
 */
export const TaskPacketRepositorySchema = z.object({
  name: z.string().min(1, "name must not be empty"),
  default_branch: z.string().min(1, "default_branch must not be empty"),
});

/** Inferred TypeScript type for {@link TaskPacketRepositorySchema}. */
export type TaskPacketRepository = z.infer<typeof TaskPacketRepositorySchema>;

/**
 * Zod schema for the `workspace` section of a TaskPacket.
 *
 * Provides filesystem paths for the task's isolated git worktree and
 * artifact storage root.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.4.2 workspace
 */
export const TaskPacketWorkspaceSchema = z.object({
  worktree_path: z.string().min(1, "worktree_path must not be empty"),
  artifact_root: z.string().min(1, "artifact_root must not be empty"),
});

/** Inferred TypeScript type for {@link TaskPacketWorkspaceSchema}. */
export type TaskPacketWorkspace = z.infer<typeof TaskPacketWorkspaceSchema>;

/**
 * Zod schema for the `context` section of a TaskPacket.
 *
 * Provides relational and historical context for the task:
 * - `related_tasks` — IDs of tasks that are conceptually related
 * - `dependencies` — IDs of tasks that must complete before this one
 * - `rejection_context` — feedback from a prior review cycle (null on first attempt)
 * - `code_map_refs` — references to relevant code map entries
 * - `prior_partial_work` — reference to partial artifacts from a prior failed run (null on first attempt)
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.4.2 context
 */
export const TaskPacketContextSchema = z.object({
  related_tasks: z.array(z.string()),
  dependencies: z.array(z.string()),
  rejection_context: RejectionContextSchema.nullable(),
  code_map_refs: z.array(z.string()),
  prior_partial_work: z.unknown().nullable(),
});

/** Inferred TypeScript type for {@link TaskPacketContextSchema}. */
export type TaskPacketContext = z.infer<typeof TaskPacketContextSchema>;

/**
 * Zod schema for the `repo_policy` section of a TaskPacket.
 *
 * References the policy set governing repository-level constraints.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.4.2 repo_policy
 */
export const TaskPacketRepoPolicySchema = z.object({
  policy_set_id: z.string().min(1, "policy_set_id must not be empty"),
});

/** Inferred TypeScript type for {@link TaskPacketRepoPolicySchema}. */
export type TaskPacketRepoPolicy = z.infer<typeof TaskPacketRepoPolicySchema>;

/**
 * Zod schema for the `tool_policy` section of a TaskPacket.
 *
 * References the command and file-scope policies governing what tools
 * and files the worker is allowed to interact with.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.4.2 tool_policy
 */
export const TaskPacketToolPolicySchema = z.object({
  command_policy_id: z.string().min(1, "command_policy_id must not be empty"),
  file_scope_policy_id: z.string().min(1, "file_scope_policy_id must not be empty"),
});

/** Inferred TypeScript type for {@link TaskPacketToolPolicySchema}. */
export type TaskPacketToolPolicy = z.infer<typeof TaskPacketToolPolicySchema>;

/**
 * Zod schema for the `validation_requirements` section of a TaskPacket.
 *
 * Specifies which validation profile to apply during the validation gate.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.4.2 validation_requirements
 */
export const TaskPacketValidationRequirementsSchema = z.object({
  profile: z.string().min(1, "profile must not be empty"),
});

/** Inferred TypeScript type for {@link TaskPacketValidationRequirementsSchema}. */
export type TaskPacketValidationRequirements = z.infer<
  typeof TaskPacketValidationRequirementsSchema
>;

/**
 * Zod schema for the `expected_output` section of a TaskPacket.
 *
 * Declares the packet type and schema version the worker is expected
 * to produce as its output.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.4.2 expected_output
 */
export const TaskPacketExpectedOutputSchema = z.object({
  packet_type: z.string().min(1, "packet_type must not be empty"),
  schema_version: z.string().min(1, "schema_version must not be empty"),
});

/** Inferred TypeScript type for {@link TaskPacketExpectedOutputSchema}. */
export type TaskPacketExpectedOutput = z.infer<typeof TaskPacketExpectedOutputSchema>;

// ─── TaskPacket Top-Level Schema ────────────────────────────────────────────

/**
 * Zod schema for TaskPacket — the canonical input contract for all worker
 * stages (planner, developer, reviewer, lead-reviewer, merge-assist,
 * post-merge-analysis).
 *
 * Assembled by the deterministic orchestrator and validated before dispatch.
 *
 * Required top-level fields (§8.4.3):
 * - `packet_type` — literal `"task_packet"`
 * - `schema_version` — literal `"1.0"`
 * - `created_at` — ISO 8601 timestamp
 * - `task_id` — unique task identifier
 * - `repository_id` — target repository identifier
 * - `role` — worker role (planner, developer, reviewer, etc.)
 * - `time_budget_seconds` — maximum wall-clock time for the worker
 * - `expires_at` — absolute expiry timestamp
 * - `task` — task metadata
 * - `repository` — repository info
 * - `workspace` — filesystem paths
 * - `context` — relational / historical context
 * - `repo_policy` — repository-level policy reference
 * - `tool_policy` — command and file-scope policy references
 * - `validation_requirements` — validation profile reference
 * - `stop_conditions` — worker stop instructions
 * - `expected_output` — expected output packet descriptor
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.4 TaskPacket
 */
export const TaskPacketSchema = z.object({
  packet_type: z.literal("task_packet"),
  schema_version: z.literal("1.0"),
  created_at: z.string().datetime({ message: "created_at must be ISO 8601" }),
  task_id: z.string().min(1, "task_id must not be empty"),
  repository_id: z.string().min(1, "repository_id must not be empty"),
  role: AgentRoleSchema,
  time_budget_seconds: z.number().int().positive(),
  expires_at: z.string().datetime({ message: "expires_at must be ISO 8601" }),
  task: TaskPacketTaskSchema,
  repository: TaskPacketRepositorySchema,
  workspace: TaskPacketWorkspaceSchema,
  context: TaskPacketContextSchema,
  repo_policy: TaskPacketRepoPolicySchema,
  tool_policy: TaskPacketToolPolicySchema,
  validation_requirements: TaskPacketValidationRequirementsSchema,
  stop_conditions: z.array(z.string().min(1)).min(1),
  expected_output: TaskPacketExpectedOutputSchema,
});

/** Inferred TypeScript type for {@link TaskPacketSchema}. */
export type TaskPacket = z.infer<typeof TaskPacketSchema>;
