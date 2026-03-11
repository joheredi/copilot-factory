/**
 * Tests for {@link LeadReviewDecisionPacketSchema}.
 *
 * LeadReviewDecisionPacket is the final review decision for a review cycle.
 * The orchestrator validates this packet before transitioning the review
 * cycle to its terminal state (APPROVED, REJECTED, or ESCALATED). If this
 * schema is wrong, the review cycle state machine can be corrupted.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.7
 */

import { describe, it, expect } from "vitest";

import { LeadReviewDecisionPacketSchema } from "./lead-review-decision-packet.js";
import type { LeadReviewDecisionPacket } from "./lead-review-decision-packet.js";

// ─── Spec Example ────────────────────────────────────────────────────────────

/** Canonical LeadReviewDecisionPacket example from PRD 008 §8.7.2 */
const specExample = {
  packet_type: "lead_review_decision_packet" as const,
  schema_version: "1.0" as const,
  created_at: "2026-03-10T00:25:00Z",
  task_id: "task-123",
  repository_id: "repo-1",
  review_cycle_id: "review-1",
  decision: "approved",
  summary: "No remaining blockers after consolidating specialist reviews.",
  blocking_issues: [] as Array<{
    severity: string;
    code: string;
    title: string;
    description: string;
    blocking: boolean;
  }>,
  non_blocking_suggestions: [] as string[],
  deduplication_notes: [] as string[],
  follow_up_task_refs: [] as string[],
  risks: [] as string[],
  open_questions: [] as string[],
};

// ─── Top-Level LeadReviewDecisionPacket Tests ────────────────────────────────

describe("LeadReviewDecisionPacketSchema (PRD 008 §8.7)", () => {
  /**
   * Validates the exact canonical example from §8.7.2.
   * This is the primary correctness test — the spec example MUST parse.
   */
  it("should accept the spec example from §8.7.2", () => {
    const result = LeadReviewDecisionPacketSchema.safeParse(specExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.packet_type).toBe("lead_review_decision_packet");
      expect(result.data.task_id).toBe("task-123");
      expect(result.data.decision).toBe("approved");
      expect(result.data.blocking_issues).toHaveLength(0);
    }
  });

  /**
   * Validates that the inferred TypeScript type matches the schema shape.
   * If this compiles, the type inference is correct.
   */
  it("should produce a correct inferred type", () => {
    const data: LeadReviewDecisionPacket = { ...specExample };
    const result = LeadReviewDecisionPacketSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * approved_with_follow_up is used when the change is acceptable but
   * follow-up work is recommended. The follow_up_task_refs array
   * carries the suggested follow-up task references.
   */
  it("should accept approved_with_follow_up decision", () => {
    const withFollowUp = {
      ...specExample,
      decision: "approved_with_follow_up",
      summary: "Approved but recommend follow-up for performance tuning.",
      follow_up_task_refs: ["task-300"],
    };
    const result = LeadReviewDecisionPacketSchema.safeParse(withFollowUp);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decision).toBe("approved_with_follow_up");
      expect(result.data.follow_up_task_refs).toEqual(["task-300"]);
    }
  });

  /**
   * changes_requested is used when blocking issues remain after
   * consolidation. The task goes back to the developer for rework.
   */
  it("should accept changes_requested decision with blocking issues", () => {
    const changesRequested = {
      ...specExample,
      decision: "changes_requested",
      summary: "Security issue must be addressed before approval.",
      blocking_issues: [
        {
          severity: "high" as const,
          code: "unsafe-shell",
          title: "Command wrapper bypasses allowlist",
          description: "Raw shell execution without policy validation.",
          file_path: "packages/infrastructure/src/runner/exec.ts",
          line: 61,
          blocking: true,
        },
      ],
    };
    const result = LeadReviewDecisionPacketSchema.safeParse(changesRequested);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decision).toBe("changes_requested");
      expect(result.data.blocking_issues).toHaveLength(1);
    }
  });

  /**
   * escalated is used when the lead reviewer cannot make a determination
   * and the decision must be escalated to a human operator.
   */
  it("should accept escalated decision", () => {
    const escalated = {
      ...specExample,
      decision: "escalated",
      summary: "Conflicting specialist reviews — requires human judgment.",
    };
    const result = LeadReviewDecisionPacketSchema.safeParse(escalated);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decision).toBe("escalated");
    }
  });

  /**
   * Deduplication notes document how the lead reviewer consolidated
   * overlapping issues from multiple specialist reviewers.
   */
  it("should accept non-empty deduplication notes", () => {
    const withNotes = {
      ...specExample,
      deduplication_notes: [
        "Security and correctness reviewers both flagged the same shell exec issue — consolidated into one blocking issue.",
      ],
    };
    const result = LeadReviewDecisionPacketSchema.safeParse(withNotes);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deduplication_notes).toHaveLength(1);
    }
  });

  /**
   * Non-blocking suggestions are improvement ideas that don't block
   * approval. They may become follow-up tasks.
   */
  it("should accept non-blocking suggestions", () => {
    const withSuggestions = {
      ...specExample,
      non_blocking_suggestions: [
        "Consider adding structured logging for better observability.",
        "The error messages could be more descriptive.",
      ],
    };
    const result = LeadReviewDecisionPacketSchema.safeParse(withSuggestions);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.non_blocking_suggestions).toHaveLength(2);
    }
  });

  /**
   * Risks and open_questions must always be present per §4.3 of the agent
   * contracts. These fields surface uncertainty for operator awareness.
   */
  it("should accept non-empty risks and open_questions", () => {
    const withRisks = {
      ...specExample,
      risks: ["Merged code may have performance implications at scale"],
      open_questions: ["Should we enforce stricter rate limits?"],
    };
    const result = LeadReviewDecisionPacketSchema.safeParse(withRisks);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.risks).toHaveLength(1);
      expect(result.data.open_questions).toHaveLength(1);
    }
  });

  // ─── Rejection tests ────────────────────────────────────────────────────

  /**
   * packet_type must be exactly "lead_review_decision_packet". Wrong
   * packet types indicate a routing error in the orchestrator.
   */
  it("should reject wrong packet_type", () => {
    const wrong = { ...specExample, packet_type: "review_packet" };
    const result = LeadReviewDecisionPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * schema_version must be exactly "1.0" for V1.
   */
  it("should reject wrong schema_version", () => {
    const wrong = { ...specExample, schema_version: "2.0" };
    const result = LeadReviewDecisionPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * created_at must be a valid ISO 8601 datetime string.
   */
  it("should reject non-ISO-8601 created_at", () => {
    const wrong = { ...specExample, created_at: "yesterday" };
    const result = LeadReviewDecisionPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * An invalid decision enum value must be rejected. The decision drives
   * the review cycle state machine — invalid values would corrupt
   * state transitions.
   */
  it("should reject invalid decision", () => {
    const wrong = { ...specExample, decision: "maybe_approved" };
    const result = LeadReviewDecisionPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * All required top-level fields must be present. Missing fields
   * indicate an incomplete or malformed worker output.
   */
  it("should reject missing required fields", () => {
    const requiredFields = [
      "packet_type",
      "schema_version",
      "created_at",
      "task_id",
      "repository_id",
      "review_cycle_id",
      "decision",
      "summary",
      "blocking_issues",
      "non_blocking_suggestions",
      "deduplication_notes",
      "follow_up_task_refs",
      "risks",
      "open_questions",
    ];

    for (const field of requiredFields) {
      const incomplete = { ...specExample };
      delete (incomplete as Record<string, unknown>)[field];
      const result = LeadReviewDecisionPacketSchema.safeParse(incomplete);
      expect(result.success, `should reject missing ${field}`).toBe(false);
    }
  });

  /**
   * Empty string IDs must be rejected.
   */
  it("should reject empty string task_id", () => {
    const wrong = { ...specExample, task_id: "" };
    const result = LeadReviewDecisionPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string review_cycle_id must be rejected.
   */
  it("should reject empty string review_cycle_id", () => {
    const wrong = { ...specExample, review_cycle_id: "" };
    const result = LeadReviewDecisionPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string summary must be rejected.
   */
  it("should reject empty string summary", () => {
    const wrong = { ...specExample, summary: "" };
    const result = LeadReviewDecisionPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Issues in blocking_issues must be valid IssueSchema objects.
   * Malformed issues would break rework context generation.
   */
  it("should reject malformed blocking issues", () => {
    const wrong = {
      ...specExample,
      blocking_issues: [{ severity: "critical" }],
    };
    const result = LeadReviewDecisionPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * follow_up_task_refs must contain non-empty strings.
   */
  it("should reject empty strings in follow_up_task_refs", () => {
    const wrong = { ...specExample, follow_up_task_refs: [""] };
    const result = LeadReviewDecisionPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});
