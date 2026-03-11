/**
 * Tests for {@link ReviewPacketSchema}.
 *
 * ReviewPacket is the canonical output from specialist reviewers. The
 * orchestrator validates every review packet before forwarding it to
 * the lead reviewer. If this schema is wrong, valid review output gets
 * rejected or invalid output reaches the lead reviewer, corrupting
 * the review consolidation process.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.6
 */

import { describe, it, expect } from "vitest";

import { ReviewPacketSchema } from "./review-packet.js";
import type { ReviewPacket } from "./review-packet.js";

// ─── Spec Example ────────────────────────────────────────────────────────────

/** Canonical ReviewPacket example from PRD 008 §8.6.2 */
const specExample = {
  packet_type: "review_packet" as const,
  schema_version: "1.0" as const,
  created_at: "2026-03-10T00:20:00Z",
  task_id: "task-123",
  repository_id: "repo-1",
  review_cycle_id: "review-1",
  reviewer_pool_id: "security-reviewers",
  reviewer_type: "security",
  verdict: "changes_requested",
  summary: "One blocking issue found.",
  blocking_issues: [
    {
      severity: "high",
      code: "unsafe-shell",
      title: "Command wrapper bypasses allowlist",
      description: "The implementation executes a raw shell string without policy validation.",
      file_path: "packages/infrastructure/src/runner/exec.ts",
      line: 61,
      blocking: true,
    },
  ],
  non_blocking_issues: [] as Array<{
    severity: string;
    code: string;
    title: string;
    description: string;
    blocking: boolean;
  }>,
  confidence: "high",
  follow_up_task_refs: [] as string[],
  risks: [] as string[],
  open_questions: [] as string[],
};

// ─── Top-Level ReviewPacket Tests ────────────────────────────────────────────

describe("ReviewPacketSchema (PRD 008 §8.6)", () => {
  /**
   * Validates the exact canonical example from §8.6.2.
   * This is the primary correctness test — the spec example MUST parse.
   */
  it("should accept the spec example from §8.6.2", () => {
    const result = ReviewPacketSchema.safeParse(specExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.packet_type).toBe("review_packet");
      expect(result.data.task_id).toBe("task-123");
      expect(result.data.verdict).toBe("changes_requested");
      expect(result.data.blocking_issues).toHaveLength(1);
      expect(result.data.blocking_issues[0].code).toBe("unsafe-shell");
      expect(result.data.confidence).toBe("high");
    }
  });

  /**
   * Validates that the inferred TypeScript type matches the schema shape.
   * If this compiles, the type inference is correct.
   */
  it("should produce a correct inferred type", () => {
    const data: ReviewPacket = { ...specExample };
    const result = ReviewPacketSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * An approved review with no blocking issues is the happy-path case.
   * The orchestrator must accept this to allow the review cycle to proceed.
   */
  it("should accept an approved review with no blocking issues", () => {
    const approved = {
      ...specExample,
      verdict: "approved",
      summary: "Implementation looks correct.",
      blocking_issues: [],
    };
    const result = ReviewPacketSchema.safeParse(approved);
    expect(result.success).toBe(true);
  });

  /**
   * An escalated review with no blocking issues is valid — escalation
   * indicates the reviewer cannot make a determination, not necessarily
   * that issues exist.
   */
  it("should accept an escalated review", () => {
    const escalated = {
      ...specExample,
      verdict: "escalated",
      summary: "Cannot evaluate — outside area of expertise.",
      blocking_issues: [],
    };
    const result = ReviewPacketSchema.safeParse(escalated);
    expect(result.success).toBe(true);
  });

  /**
   * A review with both blocking and non-blocking issues is the typical
   * changes_requested scenario. Both arrays must be validated.
   */
  it("should accept a review with both blocking and non-blocking issues", () => {
    const mixed = {
      ...specExample,
      non_blocking_issues: [
        {
          severity: "low",
          code: "naming-convention",
          title: "Variable naming inconsistency",
          description: "Consider using camelCase for local variables.",
          blocking: false,
        },
      ],
    };
    const result = ReviewPacketSchema.safeParse(mixed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blocking_issues).toHaveLength(1);
      expect(result.data.non_blocking_issues).toHaveLength(1);
    }
  });

  /**
   * Follow-up task refs allow reviewers to suggest future work.
   * The array elements must be non-empty strings.
   */
  it("should accept follow-up task refs", () => {
    const withFollowUp = {
      ...specExample,
      follow_up_task_refs: ["task-200", "task-201"],
    };
    const result = ReviewPacketSchema.safeParse(withFollowUp);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.follow_up_task_refs).toEqual(["task-200", "task-201"]);
    }
  });

  /**
   * Risks and open_questions must always be present per §4.3 of the agent
   * contracts. The orchestrator uses risks with severity "critical" as an
   * automatic escalation trigger.
   */
  it("should accept non-empty risks and open_questions", () => {
    const withRisks = {
      ...specExample,
      risks: ["Potential race condition in concurrent access"],
      open_questions: ["Should we add rate limiting here?"],
    };
    const result = ReviewPacketSchema.safeParse(withRisks);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.risks).toHaveLength(1);
      expect(result.data.open_questions).toHaveLength(1);
    }
  });

  // ─── Rejection tests ────────────────────────────────────────────────────

  /**
   * packet_type must be exactly "review_packet". Wrong packet types
   * indicate a routing error in the orchestrator.
   */
  it("should reject wrong packet_type", () => {
    const wrong = { ...specExample, packet_type: "dev_result_packet" };
    const result = ReviewPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * schema_version must be exactly "1.0" for V1.
   * Other versions require a separate schema definition.
   */
  it("should reject wrong schema_version", () => {
    const wrong = { ...specExample, schema_version: "2.0" };
    const result = ReviewPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * created_at must be a valid ISO 8601 datetime string. Freeform
   * strings would break timestamp-based ordering and audit trails.
   */
  it("should reject non-ISO-8601 created_at", () => {
    const wrong = { ...specExample, created_at: "not-a-date" };
    const result = ReviewPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * An invalid verdict enum value must be rejected. The verdict drives
   * the review cycle state machine — invalid values would corrupt
   * state transitions.
   */
  it("should reject invalid verdict", () => {
    const wrong = { ...specExample, verdict: "maybe" };
    const result = ReviewPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * An invalid confidence value must be rejected. Confidence is used
   * by the lead reviewer to weight specialist feedback.
   */
  it("should reject invalid confidence", () => {
    const wrong = { ...specExample, confidence: "very_high" };
    const result = ReviewPacketSchema.safeParse(wrong);
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
      "reviewer_pool_id",
      "reviewer_type",
      "verdict",
      "summary",
      "blocking_issues",
      "non_blocking_issues",
      "confidence",
      "follow_up_task_refs",
      "risks",
      "open_questions",
    ];

    for (const field of requiredFields) {
      const incomplete = { ...specExample };
      delete (incomplete as Record<string, unknown>)[field];
      const result = ReviewPacketSchema.safeParse(incomplete);
      expect(result.success, `should reject missing ${field}`).toBe(false);
    }
  });

  /**
   * Empty string IDs must be rejected. The orchestrator uses these IDs
   * to correlate packets with database entities.
   */
  it("should reject empty string task_id", () => {
    const wrong = { ...specExample, task_id: "" };
    const result = ReviewPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string review_cycle_id must be rejected. This ID links the
   * review packet to its review cycle for consolidation.
   */
  it("should reject empty string review_cycle_id", () => {
    const wrong = { ...specExample, review_cycle_id: "" };
    const result = ReviewPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string reviewer_pool_id must be rejected. This ID identifies
   * which pool the specialist belongs to.
   */
  it("should reject empty string reviewer_pool_id", () => {
    const wrong = { ...specExample, reviewer_pool_id: "" };
    const result = ReviewPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string reviewer_type must be rejected. This field identifies
   * the review perspective (e.g., "security", "correctness").
   */
  it("should reject empty string reviewer_type", () => {
    const wrong = { ...specExample, reviewer_type: "" };
    const result = ReviewPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string summary must be rejected. Summaries are used in the
   * review consolidation and audit trail.
   */
  it("should reject empty string summary", () => {
    const wrong = { ...specExample, summary: "" };
    const result = ReviewPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Issues in blocking_issues must be valid IssueSchema objects.
   * Malformed issues would break the lead reviewer's consolidation.
   */
  it("should reject malformed blocking issues", () => {
    const wrong = {
      ...specExample,
      blocking_issues: [{ severity: "high" }],
    };
    const result = ReviewPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Issues in non_blocking_issues must also be valid IssueSchema objects.
   */
  it("should reject malformed non-blocking issues", () => {
    const wrong = {
      ...specExample,
      non_blocking_issues: [{ title: "foo" }],
    };
    const result = ReviewPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * follow_up_task_refs must contain non-empty strings.
   * Empty strings would create invalid task references.
   */
  it("should reject empty strings in follow_up_task_refs", () => {
    const wrong = { ...specExample, follow_up_task_refs: [""] };
    const result = ReviewPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});
