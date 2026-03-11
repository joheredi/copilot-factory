/**
 * Zod schema for LeadReviewDecisionPacket — the canonical output from the
 * lead reviewer after consolidating specialist reviews.
 *
 * The LeadReviewDecisionPacket is the final review decision for a review
 * cycle. It contains the consolidated decision, remaining blocking issues,
 * non-blocking suggestions, deduplication notes, and follow-up task
 * references.
 *
 * Cross-field invariants (enforced by T024):
 * - `changes_requested` requires at least one entry in `blocking_issues`
 * - `approved_with_follow_up` requires non-empty `follow_up_task_refs`
 *
 * @module @factory/schemas/lead-review-decision-packet
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.7 LeadReviewDecisionPacket
 * @see {@link file://docs/prd/004-agent-contracts.md} §4.7 Lead Reviewer Contract
 */

import { z } from "zod";

import { LeadReviewDecisionSchema as LeadReviewDecisionEnumSchema, IssueSchema } from "./shared.js";

// ─── LeadReviewDecisionPacket Top-Level Schema ──────────────────────────────

/**
 * Zod schema for LeadReviewDecisionPacket — the canonical output contract
 * for the lead reviewer.
 *
 * Produced by the lead reviewer worker after consolidating all specialist
 * review packets. Validated by the orchestrator before committing a review
 * cycle state transition.
 *
 * Required fields (§8.7.2):
 * - `packet_type` — literal `"lead_review_decision_packet"`
 * - `schema_version` — literal `"1.0"`
 * - `created_at` — ISO 8601 timestamp
 * - `task_id` — the task under review
 * - `repository_id` — the target repository
 * - `review_cycle_id` — the review cycle this decision concludes
 * - `decision` — `approved`, `approved_with_follow_up`, `changes_requested`, or `escalated`
 * - `summary` — human-readable summary of the consolidated decision
 * - `blocking_issues` — remaining blocking issues after consolidation
 * - `non_blocking_suggestions` — non-blocking improvement suggestions
 * - `deduplication_notes` — notes about issues consolidated from multiple reviewers
 * - `follow_up_task_refs` — references to recommended follow-up tasks
 * - `risks` — identified risks (always present, may be empty)
 * - `open_questions` — unresolved questions (always present, may be empty)
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.7 LeadReviewDecisionPacket
 */
export const LeadReviewDecisionPacketSchema = z
  .object({
    packet_type: z.literal("lead_review_decision_packet"),
    schema_version: z.literal("1.0"),
    created_at: z.string().datetime({ message: "created_at must be ISO 8601" }),
    task_id: z.string().min(1, "task_id must not be empty"),
    repository_id: z.string().min(1, "repository_id must not be empty"),
    review_cycle_id: z.string().min(1, "review_cycle_id must not be empty"),
    decision: LeadReviewDecisionEnumSchema,
    summary: z.string().min(1, "summary must not be empty"),
    blocking_issues: z.array(IssueSchema),
    non_blocking_suggestions: z.array(z.string()),
    deduplication_notes: z.array(z.string()),
    follow_up_task_refs: z.array(z.string().min(1)),
    risks: z.array(z.string()),
    open_questions: z.array(z.string()),
  })
  .superRefine((data, ctx) => {
    /**
     * Cross-field invariant (PRD 008 §8.13):
     * When decision is "changes_requested", blocking_issues must be non-empty.
     * A changes-requested decision without blocking issues provides no
     * actionable feedback for the developer rework loop.
     */
    if (data.decision === "changes_requested" && data.blocking_issues.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blocking_issues"],
        message:
          'blocking_issues must not be empty when decision is "changes_requested" — the developer needs actionable feedback for rework',
      });
    }

    /**
     * Cross-field invariant (PRD 008 §8.13):
     * When decision is "approved_with_follow_up", follow_up_task_refs must
     * be non-empty. An approval-with-follow-up that lists no follow-up
     * tasks is semantically identical to a plain approval.
     */
    if (data.decision === "approved_with_follow_up" && data.follow_up_task_refs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["follow_up_task_refs"],
        message:
          'follow_up_task_refs must not be empty when decision is "approved_with_follow_up" — follow-up tasks are required for this decision type',
      });
    }
  });

/** Inferred TypeScript type for {@link LeadReviewDecisionPacketSchema}. */
export type LeadReviewDecisionPacket = z.infer<typeof LeadReviewDecisionPacketSchema>;
