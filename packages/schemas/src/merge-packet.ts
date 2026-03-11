/**
 * Zod schema for MergePacket — the machine-readable result of merge
 * preparation and integration.
 *
 * The MergePacket is produced by the merge module after performing the
 * actual merge operation (rebase-and-merge, squash, or merge-commit).
 * It captures the source/target branches, commit SHAs, merge strategy,
 * and any post-merge validation results.
 *
 * @module @factory/schemas/merge-packet
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.8 MergePacket
 */

import { z } from "zod";

import { PacketStatusSchema, MergeStrategySchema, ValidationCheckResultSchema } from "./shared.js";

// ─── Nested Object Schemas ──────────────────────────────────────────────────

/**
 * Zod schema for the `details` section of a MergePacket.
 *
 * Contains the concrete merge output: which branches were involved,
 * the approved and merged commit SHAs, the merge strategy used,
 * whether a rebase was performed, and any validation results run
 * during the merge process.
 *
 * Required fields:
 * - `source_branch` — the branch being merged
 * - `target_branch` — the branch being merged into
 * - `approved_commit_sha` — the commit SHA that was approved for merge
 * - `merged_commit_sha` — the resulting commit SHA after merge
 * - `merge_strategy` — the merge strategy used (rebase-and-merge, squash, merge-commit)
 * - `rebase_performed` — whether a rebase was performed before merge
 * - `validation_results` — array of validation checks run during merge
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.8.2 details
 */
export const MergePacketDetailsSchema = z.object({
  source_branch: z.string().min(1, "source_branch must not be empty"),
  target_branch: z.string().min(1, "target_branch must not be empty"),
  approved_commit_sha: z.string().min(1, "approved_commit_sha must not be empty"),
  merged_commit_sha: z.string().min(1, "merged_commit_sha must not be empty"),
  merge_strategy: MergeStrategySchema,
  rebase_performed: z.boolean(),
  validation_results: z.array(ValidationCheckResultSchema),
});

/** Inferred TypeScript type for {@link MergePacketDetailsSchema}. */
export type MergePacketDetails = z.infer<typeof MergePacketDetailsSchema>;

// ─── MergePacket Top-Level Schema ───────────────────────────────────────────

/**
 * Zod schema for MergePacket — the canonical merge result contract.
 *
 * Produced by the merge module and validated by the orchestrator before
 * committing the merge state transition.
 *
 * Required fields (§8.8.2):
 * - `packet_type` — literal `"merge_packet"`
 * - `schema_version` — literal `"1.0"`
 * - `created_at` — ISO 8601 timestamp
 * - `task_id` — the task this merge belongs to
 * - `repository_id` — the target repository
 * - `merge_queue_item_id` — the merge queue item this packet belongs to
 * - `status` — outcome: success, failed, partial, or blocked
 * - `summary` — human-readable summary of the merge
 * - `details` — merge details (branches, commits, strategy, validations)
 * - `artifact_refs` — references to persisted log/artifact files
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.8 MergePacket
 */
export const MergePacketSchema = z.object({
  packet_type: z.literal("merge_packet"),
  schema_version: z.literal("1.0"),
  created_at: z.string().datetime({ message: "created_at must be ISO 8601" }),
  task_id: z.string().min(1, "task_id must not be empty"),
  repository_id: z.string().min(1, "repository_id must not be empty"),
  merge_queue_item_id: z.string().min(1, "merge_queue_item_id must not be empty"),
  status: PacketStatusSchema,
  summary: z.string().min(1, "summary must not be empty"),
  details: MergePacketDetailsSchema,
  artifact_refs: z.array(z.string().min(1)),
});

/** Inferred TypeScript type for {@link MergePacketSchema}. */
export type MergePacket = z.infer<typeof MergePacketSchema>;
