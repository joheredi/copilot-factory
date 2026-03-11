/**
 * Zod schema for DevResultPacket — the canonical output from a developer
 * worker.
 *
 * The DevResultPacket is produced by the developer agent after completing
 * (or failing) a task. It contains the implementation summary, file changes,
 * validation results, and references to persisted artifacts.
 *
 * @module @factory/schemas/dev-result-packet
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.5 DevResultPacket
 */

import { z } from "zod";

import {
  PacketStatusSchema,
  FileChangeSummarySchema,
  ValidationCheckResultSchema,
} from "./shared.js";

// ─── Nested Object Schemas ──────────────────────────────────────────────────

/**
 * Zod schema for the `result` section of a DevResultPacket.
 *
 * Contains the concrete implementation output: which branch/commit was used,
 * what files changed, what tests were added, what validations ran, and any
 * assumptions, risks, or unresolved issues the developer wants to surface.
 *
 * Required fields (§8.5.3):
 * - `branch_name` — the git branch containing the implementation
 * - `files_changed` — array of {@link FileChangeSummarySchema} items
 * - `validations_run` — array of {@link ValidationCheckResultSchema} items
 *
 * Optional/supplementary fields:
 * - `commit_sha` — the HEAD commit SHA after implementation
 * - `tests_added_or_updated` — file paths of new/modified tests
 * - `assumptions` — assumptions made during implementation
 * - `risks` — identified risks
 * - `unresolved_issues` — issues that remain open
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.5.2 result
 */
export const DevResultPacketResultSchema = z.object({
  branch_name: z.string().min(1, "branch_name must not be empty"),
  commit_sha: z.string().min(1, "commit_sha must not be empty"),
  files_changed: z.array(FileChangeSummarySchema),
  tests_added_or_updated: z.array(z.string().min(1)),
  validations_run: z.array(ValidationCheckResultSchema),
  assumptions: z.array(z.string()),
  risks: z.array(z.string()),
  unresolved_issues: z.array(z.string()),
});

/** Inferred TypeScript type for {@link DevResultPacketResultSchema}. */
export type DevResultPacketResult = z.infer<typeof DevResultPacketResultSchema>;

// ─── DevResultPacket Top-Level Schema ───────────────────────────────────────

/**
 * Zod schema for DevResultPacket — the canonical output contract for
 * developer workers.
 *
 * Produced by the worker and validated by the orchestrator before
 * committing a state transition.
 *
 * Required fields (§8.5.3):
 * - `packet_type` — literal `"dev_result_packet"`
 * - `schema_version` — literal `"1.0"`
 * - `created_at` — ISO 8601 timestamp
 * - `task_id` — the task this result belongs to
 * - `repository_id` — the target repository
 * - `run_id` — unique identifier for this worker run
 * - `status` — outcome: success, failed, partial, or blocked
 * - `summary` — human-readable summary of what was done
 * - `result` — implementation details (branch, files, validations)
 * - `artifact_refs` — references to persisted log/artifact files
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.5 DevResultPacket
 */
export const DevResultPacketSchema = z.object({
  packet_type: z.literal("dev_result_packet"),
  schema_version: z.literal("1.0"),
  created_at: z.string().datetime({ message: "created_at must be ISO 8601" }),
  task_id: z.string().min(1, "task_id must not be empty"),
  repository_id: z.string().min(1, "repository_id must not be empty"),
  run_id: z.string().min(1, "run_id must not be empty"),
  status: PacketStatusSchema,
  summary: z.string().min(1, "summary must not be empty"),
  result: DevResultPacketResultSchema,
  artifact_refs: z.array(z.string().min(1)),
});

/** Inferred TypeScript type for {@link DevResultPacketSchema}. */
export type DevResultPacket = z.infer<typeof DevResultPacketSchema>;
