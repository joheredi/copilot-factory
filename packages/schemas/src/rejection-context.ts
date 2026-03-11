/**
 * Zod schema for RejectionContext — the feedback payload attached to a
 * TaskPacket when a task is reworked after a {@code CHANGES_REQUESTED}
 * decision from a lead reviewer.
 *
 * RejectionContext conveys blocking issues from the prior review cycle and the
 * lead reviewer's summary so the next developer attempt has precise feedback
 * on what must change.
 *
 * Rules:
 * - On initial task attempts, {@code context.rejection_context} must be `null`.
 * - On rework attempts (after CHANGES_REQUESTED → ASSIGNED),
 *   {@code context.rejection_context} must be a valid RejectionContext object.
 * - On retry attempts (after FAILED with retry eligible),
 *   {@code context.rejection_context} remains `null`.
 *
 * @module @factory/schemas/rejection-context
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.12 RejectionContext
 */

import { z } from "zod";

import { IssueSchema } from "./shared.js";

/**
 * Zod schema for RejectionContext.
 *
 * Fields:
 * - `prior_review_cycle_id` — identifier of the review cycle that produced the rejection
 * - `blocking_issues` — array of {@link IssueSchema} items that blocked approval
 * - `lead_decision_summary` — human-readable summary from the lead reviewer
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.12 RejectionContext
 */
export const RejectionContextSchema = z.object({
  prior_review_cycle_id: z.string().min(1, "prior_review_cycle_id must not be empty"),
  blocking_issues: z.array(IssueSchema).min(1, "blocking_issues must contain at least one issue"),
  lead_decision_summary: z.string().min(1, "lead_decision_summary must not be empty"),
});

/** Inferred TypeScript type for {@link RejectionContextSchema}. */
export type RejectionContext = z.infer<typeof RejectionContextSchema>;
