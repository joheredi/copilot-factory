/**
 * Zod schema for MergeAssistPacket — the output from the optional Merge
 * Assist Agent when AI-assisted conflict resolution is invoked.
 *
 * The MergeAssistPacket is produced when the merge module encounters
 * conflicts and invokes the merge assist agent. It contains the agent's
 * recommendation, confidence level, affected files, and rationale.
 *
 * Cross-field invariant (enforced by T024):
 * - `confidence: "low"` requires `recommendation` to be `reject_to_dev` or `escalate`
 *
 * @module @factory/schemas/merge-assist-packet
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.9 MergeAssistPacket
 */

import { z } from "zod";

import { MergeAssistRecommendationSchema, ConfidenceSchema } from "./shared.js";

// ─── Nested Object Schemas ──────────────────────────────────────────────────

/**
 * Zod schema for an individual file affected by a merge conflict.
 *
 * Describes a single file involved in a merge conflict, including
 * the type of conflict and a summary of how it was resolved.
 *
 * Fields:
 * - `path` — repository-relative file path
 * - `conflict_type` — description of the conflict (e.g., `"both_modified"`)
 * - `resolution_summary` — human-readable summary of the resolution
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.9.2
 */
export const MergeAssistFileAffectedSchema = z.object({
  path: z.string().min(1, "path must not be empty"),
  conflict_type: z.string().min(1, "conflict_type must not be empty"),
  resolution_summary: z.string().min(1, "resolution_summary must not be empty"),
});

/** Inferred TypeScript type for {@link MergeAssistFileAffectedSchema}. */
export type MergeAssistFileAffected = z.infer<typeof MergeAssistFileAffectedSchema>;

// ─── MergeAssistPacket Top-Level Schema ─────────────────────────────────────

/**
 * Zod schema for MergeAssistPacket — the canonical merge assist output
 * contract.
 *
 * Produced by the merge assist agent and validated by the orchestrator
 * before applying the conflict resolution recommendation.
 *
 * Required fields (§8.9.2):
 * - `packet_type` — literal `"merge_assist_packet"`
 * - `schema_version` — literal `"1.0"`
 * - `created_at` — ISO 8601 timestamp
 * - `task_id` — the task this merge assist belongs to
 * - `repository_id` — the target repository
 * - `merge_queue_item_id` — the merge queue item
 * - `recommendation` — `auto_resolve`, `reject_to_dev`, or `escalate`
 * - `confidence` — `high`, `medium`, or `low`
 * - `summary` — human-readable summary
 * - `resolution_strategy` — description of the resolution approach
 * - `files_affected` — array of files with conflict details
 * - `rationale` — explanation for the recommendation
 * - `risks` — identified risks (always present, may be empty)
 * - `open_questions` — unresolved questions (always present, may be empty)
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.9 MergeAssistPacket
 */
export const MergeAssistPacketSchema = z.object({
  packet_type: z.literal("merge_assist_packet"),
  schema_version: z.literal("1.0"),
  created_at: z.string().datetime({ message: "created_at must be ISO 8601" }),
  task_id: z.string().min(1, "task_id must not be empty"),
  repository_id: z.string().min(1, "repository_id must not be empty"),
  merge_queue_item_id: z.string().min(1, "merge_queue_item_id must not be empty"),
  recommendation: MergeAssistRecommendationSchema,
  confidence: ConfidenceSchema,
  summary: z.string().min(1, "summary must not be empty"),
  resolution_strategy: z.string().min(1, "resolution_strategy must not be empty"),
  files_affected: z.array(MergeAssistFileAffectedSchema),
  rationale: z.string().min(1, "rationale must not be empty"),
  risks: z.array(z.string()),
  open_questions: z.array(z.string()),
});

/** Inferred TypeScript type for {@link MergeAssistPacketSchema}. */
export type MergeAssistPacket = z.infer<typeof MergeAssistPacketSchema>;
