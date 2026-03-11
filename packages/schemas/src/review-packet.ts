/**
 * Zod schema for ReviewPacket — the canonical output from a specialist
 * reviewer.
 *
 * The ReviewPacket is produced by specialist reviewers after examining
 * a developer's implementation from one specific perspective (e.g., security,
 * correctness, performance). It contains the verdict, blocking and
 * non-blocking issues, confidence level, and follow-up suggestions.
 *
 * Cross-field invariant (enforced by T024):
 * - `blocking_issues` must be empty when `verdict` is `approved`
 *
 * @module @factory/schemas/review-packet
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.6 ReviewPacket
 * @see {@link file://docs/prd/004-agent-contracts.md} §4.6 Specialist Reviewer Contract
 */

import { z } from "zod";

import { ReviewVerdictSchema, ConfidenceSchema, IssueSchema } from "./shared.js";

// ─── ReviewPacket Top-Level Schema ──────────────────────────────────────────

/**
 * Zod schema for ReviewPacket — the canonical output contract for specialist
 * reviewers.
 *
 * Produced by the specialist reviewer worker and validated by the orchestrator
 * before being forwarded to the lead reviewer for consolidation.
 *
 * Required fields (§8.6.2):
 * - `packet_type` — literal `"review_packet"`
 * - `schema_version` — literal `"1.0"`
 * - `created_at` — ISO 8601 timestamp
 * - `task_id` — the task under review
 * - `repository_id` — the target repository
 * - `review_cycle_id` — the review cycle this packet belongs to
 * - `reviewer_pool_id` — the pool the specialist reviewer belongs to
 * - `reviewer_type` — the review perspective (e.g., `"security"`, `"correctness"`)
 * - `verdict` — `approved`, `changes_requested`, or `escalated`
 * - `summary` — human-readable summary of the review
 * - `blocking_issues` — issues that must be resolved before approval
 * - `non_blocking_issues` — suggestions that do not block approval
 * - `confidence` — `high`, `medium`, or `low`
 * - `follow_up_task_refs` — references to suggested follow-up tasks
 * - `risks` — identified risks (always present, may be empty)
 * - `open_questions` — unresolved questions (always present, may be empty)
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.6 ReviewPacket
 */
export const ReviewPacketSchema = z.object({
  packet_type: z.literal("review_packet"),
  schema_version: z.literal("1.0"),
  created_at: z.string().datetime({ message: "created_at must be ISO 8601" }),
  task_id: z.string().min(1, "task_id must not be empty"),
  repository_id: z.string().min(1, "repository_id must not be empty"),
  review_cycle_id: z.string().min(1, "review_cycle_id must not be empty"),
  reviewer_pool_id: z.string().min(1, "reviewer_pool_id must not be empty"),
  reviewer_type: z.string().min(1, "reviewer_type must not be empty"),
  verdict: ReviewVerdictSchema,
  summary: z.string().min(1, "summary must not be empty"),
  blocking_issues: z.array(IssueSchema),
  non_blocking_issues: z.array(IssueSchema),
  confidence: ConfidenceSchema,
  follow_up_task_refs: z.array(z.string().min(1)),
  risks: z.array(z.string()),
  open_questions: z.array(z.string()),
});

/** Inferred TypeScript type for {@link ReviewPacketSchema}. */
export type ReviewPacket = z.infer<typeof ReviewPacketSchema>;
