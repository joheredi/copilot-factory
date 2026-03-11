/**
 * Tests for {@link RejectionContextSchema}.
 *
 * RejectionContext is embedded in TaskPacket.context.rejection_context on
 * rework attempts. Getting this schema right is critical because incorrect
 * rejection feedback causes developer agents to miss blocking issues.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.12
 */

import { describe, it, expect } from "vitest";

import { RejectionContextSchema } from "./rejection-context.js";
import type { RejectionContext } from "./rejection-context.js";

// ─── Spec Example ────────────────────────────────────────────────────────────

/** Canonical example from PRD 008 §8.12 */
const specExample = {
  prior_review_cycle_id: "review-1",
  blocking_issues: [
    {
      severity: "high",
      code: "unsafe-shell",
      title: "Command wrapper bypasses allowlist",
      description: "The implementation executes a raw shell string without policy validation.",
      blocking: true,
    },
  ],
  lead_decision_summary: "Address blocking security review issue before re-review.",
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("RejectionContextSchema (PRD 008 §8.12)", () => {
  /**
   * Validates the exact example from the PRD spec.
   * Important because TaskPacket embeds RejectionContext — if the canonical
   * example fails, rework packets cannot be assembled.
   */
  it("should accept the spec example from §8.12", () => {
    const result = RejectionContextSchema.safeParse(specExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(specExample);
    }
  });

  /**
   * Validates that the inferred TypeScript type matches the schema shape.
   * Ensures compile-time and runtime validation agree.
   */
  it("should produce a correct inferred type", () => {
    const data: RejectionContext = {
      prior_review_cycle_id: "review-2",
      blocking_issues: [
        {
          severity: "critical",
          code: "data-loss",
          title: "Migration drops column",
          description: "The migration deletes user data without backup.",
          blocking: true,
        },
      ],
      lead_decision_summary: "Rewrite migration to preserve data.",
    };
    const result = RejectionContextSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * Blocking issues with optional file_path and line fields should validate.
   * Ensures the embedded IssueSchema correctly handles optional location fields.
   */
  it("should accept blocking issues with optional file_path and line", () => {
    const data = {
      prior_review_cycle_id: "review-3",
      blocking_issues: [
        {
          severity: "medium",
          code: "missing-test",
          title: "No unit test for new function",
          description: "The new helper function lacks test coverage.",
          file_path: "src/utils.ts",
          line: 42,
          blocking: true,
        },
      ],
      lead_decision_summary: "Add tests before re-review.",
    };
    const result = RejectionContextSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * Multiple blocking issues should validate. Real rework cycles often
   * surface more than one issue.
   */
  it("should accept multiple blocking issues", () => {
    const data = {
      prior_review_cycle_id: "review-4",
      blocking_issues: [
        {
          severity: "high",
          code: "unsafe-shell",
          title: "Bypasses allowlist",
          description: "Raw shell execution.",
          blocking: true,
        },
        {
          severity: "medium",
          code: "no-error-handling",
          title: "Missing error handling",
          description: "Promise rejection not caught.",
          blocking: false,
        },
      ],
      lead_decision_summary: "Fix security issue and add error handling.",
    };
    const result = RejectionContextSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blocking_issues).toHaveLength(2);
    }
  });

  // ─── Rejection cases ────────────────────────────────────────────────────

  /**
   * Empty prior_review_cycle_id must be rejected. An empty string provides
   * no traceability back to the review that triggered rework.
   */
  it("should reject an empty prior_review_cycle_id", () => {
    const data = { ...specExample, prior_review_cycle_id: "" };
    const result = RejectionContextSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Missing prior_review_cycle_id must be rejected. It's a required field
   * for tracing rework back to the originating review.
   */
  it("should reject missing prior_review_cycle_id", () => {
    const { prior_review_cycle_id: _, ...data } = specExample;
    const result = RejectionContextSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * An empty blocking_issues array must be rejected. A RejectionContext with
   * no issues is semantically meaningless — there must be at least one reason
   * for the rejection.
   */
  it("should reject an empty blocking_issues array", () => {
    const data = { ...specExample, blocking_issues: [] };
    const result = RejectionContextSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Missing blocking_issues field must be rejected.
   */
  it("should reject missing blocking_issues", () => {
    const { blocking_issues: _, ...data } = specExample;
    const result = RejectionContextSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Empty lead_decision_summary must be rejected. The summary is how the
   * lead reviewer communicates the overall direction for rework.
   */
  it("should reject an empty lead_decision_summary", () => {
    const data = { ...specExample, lead_decision_summary: "" };
    const result = RejectionContextSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * An invalid issue inside blocking_issues must be rejected. This ensures
   * the embedded IssueSchema is applied to each array element.
   */
  it("should reject an invalid issue in blocking_issues", () => {
    const data = {
      ...specExample,
      blocking_issues: [{ severity: "invalid", code: "x" }],
    };
    const result = RejectionContextSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});
