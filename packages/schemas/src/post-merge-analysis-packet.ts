/**
 * Zod schema for PostMergeAnalysisPacket — the output from the
 * Post-Merge Analysis Agent when post-merge validation fails.
 *
 * The PostMergeAnalysisPacket is produced when the post-merge analysis
 * agent is enabled and a post-merge validation fails. It contains the
 * agent's recommendation (revert, hotfix, escalate, or pre-existing),
 * confidence level, failure attribution, and suggested remediation.
 *
 * Cross-field invariants (enforced by T024):
 * - `confidence: "low"` requires `recommendation` to be `escalate`
 * - `recommendation: "revert"` requires `suggested_revert_scope` to be non-null
 * - `recommendation: "hotfix_task"` requires `follow_up_task_description` to be non-null
 *
 * @module @factory/schemas/post-merge-analysis-packet
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.11 PostMergeAnalysisPacket
 */

import { z } from "zod";

import { PostMergeAnalysisRecommendationSchema, ConfidenceSchema } from "./shared.js";

// ─── Nested Object Schemas ──────────────────────────────────────────────────

/**
 * Zod schema for the `suggested_revert_scope` section of a PostMergeAnalysisPacket.
 *
 * Describes which commits and files should be reverted when the
 * recommendation is `revert`.
 *
 * Fields:
 * - `commits` — array of commit SHAs to revert
 * - `files` — array of file paths affected by the revert
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.11.2
 */
export const SuggestedRevertScopeSchema = z.object({
  commits: z.array(z.string().min(1, "commit SHA must not be empty")),
  files: z.array(z.string().min(1, "file path must not be empty")),
});

/** Inferred TypeScript type for {@link SuggestedRevertScopeSchema}. */
export type SuggestedRevertScope = z.infer<typeof SuggestedRevertScopeSchema>;

// ─── PostMergeAnalysisPacket Top-Level Schema ───────────────────────────────

/**
 * Zod schema for PostMergeAnalysisPacket — the canonical post-merge
 * analysis output contract.
 *
 * Produced by the post-merge analysis agent and validated by the
 * orchestrator before applying the recommended remediation action.
 *
 * Required fields (§8.11.2):
 * - `packet_type` — literal `"post_merge_analysis_packet"`
 * - `schema_version` — literal `"1.0"`
 * - `created_at` — ISO 8601 timestamp
 * - `task_id` — the task this analysis belongs to
 * - `repository_id` — the target repository
 * - `merge_queue_item_id` — the merge queue item
 * - `validation_run_id` — the validation run that failed
 * - `recommendation` — `revert`, `hotfix_task`, `escalate`, or `pre_existing`
 * - `confidence` — `high`, `medium`, or `low`
 * - `summary` — human-readable summary
 * - `failure_attribution` — explanation of what caused the failure
 * - `rationale` — reasoning behind the recommendation
 * - `suggested_revert_scope` — (nullable) commits/files to revert
 * - `follow_up_task_description` — (nullable) description for a hotfix task
 * - `risks` — identified risks (always present, may be empty)
 * - `open_questions` — unresolved questions (always present, may be empty)
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.11 PostMergeAnalysisPacket
 */
export const PostMergeAnalysisPacketSchema = z
  .object({
    packet_type: z.literal("post_merge_analysis_packet"),
    schema_version: z.literal("1.0"),
    created_at: z.string().datetime({ message: "created_at must be ISO 8601" }),
    task_id: z.string().min(1, "task_id must not be empty"),
    repository_id: z.string().min(1, "repository_id must not be empty"),
    merge_queue_item_id: z.string().min(1, "merge_queue_item_id must not be empty"),
    validation_run_id: z.string().min(1, "validation_run_id must not be empty"),
    recommendation: PostMergeAnalysisRecommendationSchema,
    confidence: ConfidenceSchema,
    summary: z.string().min(1, "summary must not be empty"),
    failure_attribution: z.string().min(1, "failure_attribution must not be empty"),
    rationale: z.string().min(1, "rationale must not be empty"),
    suggested_revert_scope: SuggestedRevertScopeSchema.nullable(),
    follow_up_task_description: z.string().min(1).nullable(),
    risks: z.array(z.string()),
    open_questions: z.array(z.string()),
  })
  .superRefine((data, ctx) => {
    /**
     * Cross-field invariant (PRD 008 §8.13):
     * When confidence is "low", recommendation must be "escalate".
     * Low-confidence automated decisions (revert, hotfix) risk
     * causing more damage than the original failure.
     */
    if (data.confidence === "low" && data.recommendation !== "escalate") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recommendation"],
        message:
          'recommendation must be "escalate" when confidence is "low" — low-confidence automated remediation is not permitted',
      });
    }
  });

/** Inferred TypeScript type for {@link PostMergeAnalysisPacketSchema}. */
export type PostMergeAnalysisPacket = z.infer<typeof PostMergeAnalysisPacketSchema>;
