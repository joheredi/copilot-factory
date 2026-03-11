/**
 * Tests for cross-field validation rules across all packet schemas.
 *
 * These tests verify the business invariants from PRD 008 §8.13 that span
 * multiple fields within a single packet. Cross-field validation catches
 * logically inconsistent packets that pass individual field validation
 * but violate semantic constraints.
 *
 * If these rules are not enforced:
 * - An "approved" review with blocking issues could bypass the rework loop
 * - A "changes_requested" decision with no blocking issues leaves the
 *   developer with no actionable feedback
 * - A low-confidence auto-resolve could merge bad conflict resolutions
 * - A low-confidence revert could revert the wrong commits
 *
 * Each packet type has its own describe block testing both valid and
 * invalid cross-field combinations exhaustively.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.13
 */

import { describe, it, expect } from "vitest";

import { ReviewPacketSchema } from "./review-packet.js";
import { LeadReviewDecisionPacketSchema } from "./lead-review-decision-packet.js";
import { MergeAssistPacketSchema } from "./merge-assist-packet.js";
import { PostMergeAnalysisPacketSchema } from "./post-merge-analysis-packet.js";

// ─── Test Data Factories ────────────────────────────────────────────────────

const TIMESTAMP = "2026-03-10T00:20:00Z";

const sampleIssue = {
  severity: "high",
  code: "test-issue",
  title: "Test issue",
  description: "A test issue for cross-field validation tests.",
  file_path: "src/test.ts",
  line: 1,
  blocking: true,
};

function makeReviewPacket(overrides: Record<string, unknown> = {}) {
  return {
    packet_type: "review_packet" as const,
    schema_version: "1.0" as const,
    created_at: TIMESTAMP,
    task_id: "task-1",
    repository_id: "repo-1",
    review_cycle_id: "rc-1",
    reviewer_pool_id: "pool-1",
    reviewer_type: "security",
    verdict: "changes_requested",
    summary: "Issues found.",
    blocking_issues: [sampleIssue],
    non_blocking_issues: [],
    confidence: "high",
    follow_up_task_refs: [],
    risks: [],
    open_questions: [],
    ...overrides,
  };
}

function makeLeadReviewPacket(overrides: Record<string, unknown> = {}) {
  return {
    packet_type: "lead_review_decision_packet" as const,
    schema_version: "1.0" as const,
    created_at: TIMESTAMP,
    task_id: "task-1",
    repository_id: "repo-1",
    review_cycle_id: "rc-1",
    decision: "approved",
    summary: "All clear.",
    blocking_issues: [],
    non_blocking_suggestions: [],
    deduplication_notes: [],
    follow_up_task_refs: [],
    risks: [],
    open_questions: [],
    ...overrides,
  };
}

function makeMergeAssistPacket(overrides: Record<string, unknown> = {}) {
  return {
    packet_type: "merge_assist_packet" as const,
    schema_version: "1.0" as const,
    created_at: TIMESTAMP,
    task_id: "task-1",
    repository_id: "repo-1",
    merge_queue_item_id: "mqi-1",
    recommendation: "auto_resolve",
    confidence: "high",
    summary: "Conflicts auto-resolved.",
    resolution_strategy: "Three-way merge with ours strategy.",
    files_affected: [
      { path: "src/a.ts", conflict_type: "both_modified", resolution_summary: "Merged cleanly." },
    ],
    rationale: "Simple non-overlapping changes.",
    risks: [],
    open_questions: [],
    ...overrides,
  };
}

function makePostMergePacket(overrides: Record<string, unknown> = {}) {
  return {
    packet_type: "post_merge_analysis_packet" as const,
    schema_version: "1.0" as const,
    created_at: TIMESTAMP,
    task_id: "task-1",
    repository_id: "repo-1",
    merge_queue_item_id: "mqi-1",
    validation_run_id: "vr-1",
    recommendation: "escalate",
    confidence: "high",
    summary: "Post-merge validation failed.",
    failure_attribution: "New test regression.",
    rationale: "Cannot determine root cause with confidence.",
    suggested_revert_scope: null,
    follow_up_task_description: null,
    risks: [],
    open_questions: [],
    ...overrides,
  };
}

// ─── ReviewPacket Cross-Field Validation ────────────────────────────────────

describe("ReviewPacket cross-field validation", () => {
  /**
   * An approved review with no blocking issues is the canonical success
   * path. This must always be accepted.
   */
  it("should accept approved verdict with empty blocking_issues", () => {
    const packet = makeReviewPacket({ verdict: "approved", blocking_issues: [] });
    const result = ReviewPacketSchema.safeParse(packet);
    expect(result.success).toBe(true);
  });

  /**
   * PRD §8.13: blocking_issues must be empty when verdict is "approved".
   * An approved review with blocking issues is a logical contradiction —
   * the review says "pass" but lists unresolved blockers.
   */
  it("should reject approved verdict with non-empty blocking_issues", () => {
    const packet = makeReviewPacket({ verdict: "approved", blocking_issues: [sampleIssue] });
    const result = ReviewPacketSchema.safeParse(packet);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("blocking_issues must be empty"))).toBe(true);
    }
  });

  /**
   * changes_requested with blocking issues is the expected rejection path.
   * Cross-field rule does not constrain this combination.
   */
  it("should accept changes_requested verdict with blocking_issues", () => {
    const packet = makeReviewPacket({
      verdict: "changes_requested",
      blocking_issues: [sampleIssue],
    });
    const result = ReviewPacketSchema.safeParse(packet);
    expect(result.success).toBe(true);
  });

  /**
   * changes_requested with empty blocking_issues is allowed for ReviewPacket
   * (the constraint applies only to LeadReviewDecisionPacket).
   * A specialist reviewer may request changes based on non_blocking_issues.
   */
  it("should accept changes_requested verdict with empty blocking_issues", () => {
    const packet = makeReviewPacket({
      verdict: "changes_requested",
      blocking_issues: [],
    });
    const result = ReviewPacketSchema.safeParse(packet);
    expect(result.success).toBe(true);
  });

  /**
   * escalated verdict has no cross-field constraints.
   */
  it("should accept escalated verdict regardless of blocking_issues", () => {
    const withIssues = makeReviewPacket({
      verdict: "escalated",
      blocking_issues: [sampleIssue],
    });
    const withoutIssues = makeReviewPacket({
      verdict: "escalated",
      blocking_issues: [],
    });
    expect(ReviewPacketSchema.safeParse(withIssues).success).toBe(true);
    expect(ReviewPacketSchema.safeParse(withoutIssues).success).toBe(true);
  });

  /**
   * Verify the error targets the correct path for debugging.
   */
  it("should report the error on the blocking_issues path", () => {
    const packet = makeReviewPacket({ verdict: "approved", blocking_issues: [sampleIssue] });
    const result = ReviewPacketSchema.safeParse(packet);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("blocking_issues");
    }
  });
});

// ─── LeadReviewDecisionPacket Cross-Field Validation ────────────────────────

describe("LeadReviewDecisionPacket cross-field validation", () => {
  /**
   * Plain approved decision with no blocking issues is the canonical
   * success path.
   */
  it("should accept approved decision with empty blocking_issues", () => {
    const packet = makeLeadReviewPacket({ decision: "approved", blocking_issues: [] });
    const result = LeadReviewDecisionPacketSchema.safeParse(packet);
    expect(result.success).toBe(true);
  });

  /**
   * PRD §8.13: changes_requested requires non-empty blocking_issues.
   * Without blocking issues, the developer has no actionable feedback
   * for the rework loop.
   */
  it("should reject changes_requested with empty blocking_issues", () => {
    const packet = makeLeadReviewPacket({
      decision: "changes_requested",
      blocking_issues: [],
    });
    const result = LeadReviewDecisionPacketSchema.safeParse(packet);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("blocking_issues must not be empty"))).toBe(true);
    }
  });

  /**
   * changes_requested with blocking issues is the expected rejection path.
   */
  it("should accept changes_requested with non-empty blocking_issues", () => {
    const packet = makeLeadReviewPacket({
      decision: "changes_requested",
      blocking_issues: [sampleIssue],
    });
    const result = LeadReviewDecisionPacketSchema.safeParse(packet);
    expect(result.success).toBe(true);
  });

  /**
   * PRD §8.13: approved_with_follow_up requires non-empty follow_up_task_refs.
   * An approval-with-follow-up that lists no tasks is semantically
   * identical to a plain approval and loses tracking of required follow-ups.
   */
  it("should reject approved_with_follow_up with empty follow_up_task_refs", () => {
    const packet = makeLeadReviewPacket({
      decision: "approved_with_follow_up",
      follow_up_task_refs: [],
    });
    const result = LeadReviewDecisionPacketSchema.safeParse(packet);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("follow_up_task_refs must not be empty"))).toBe(true);
    }
  });

  /**
   * approved_with_follow_up with follow-up refs is the expected path.
   */
  it("should accept approved_with_follow_up with non-empty follow_up_task_refs", () => {
    const packet = makeLeadReviewPacket({
      decision: "approved_with_follow_up",
      follow_up_task_refs: ["task-follow-1"],
    });
    const result = LeadReviewDecisionPacketSchema.safeParse(packet);
    expect(result.success).toBe(true);
  });

  /**
   * escalated decision has no cross-field constraints — the lead reviewer
   * may escalate regardless of issue state.
   */
  it("should accept escalated decision regardless of other fields", () => {
    const packet = makeLeadReviewPacket({
      decision: "escalated",
      blocking_issues: [],
      follow_up_task_refs: [],
    });
    expect(LeadReviewDecisionPacketSchema.safeParse(packet).success).toBe(true);
  });

  /**
   * Both cross-field rules can fire simultaneously when a
   * changes_requested decision also has follow_up refs that shouldn't
   * apply. Verify only the relevant rule fires.
   */
  it("should only report the changes_requested rule (not follow_up rule) for changes_requested with empty blocking", () => {
    const packet = makeLeadReviewPacket({
      decision: "changes_requested",
      blocking_issues: [],
      follow_up_task_refs: [],
    });
    const result = LeadReviewDecisionPacketSchema.safeParse(packet);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path.join(".")).toBe("blocking_issues");
    }
  });
});

// ─── MergeAssistPacket Cross-Field Validation ───────────────────────────────

describe("MergeAssistPacket cross-field validation", () => {
  /**
   * High-confidence auto_resolve is the happy path — conflicts were
   * safely resolved with high certainty.
   */
  it("should accept high confidence with auto_resolve", () => {
    const packet = makeMergeAssistPacket({ confidence: "high", recommendation: "auto_resolve" });
    expect(MergeAssistPacketSchema.safeParse(packet).success).toBe(true);
  });

  /**
   * Medium confidence with auto_resolve is also valid — the §8.13 rule
   * only constrains "low" confidence.
   */
  it("should accept medium confidence with auto_resolve", () => {
    const packet = makeMergeAssistPacket({ confidence: "medium", recommendation: "auto_resolve" });
    expect(MergeAssistPacketSchema.safeParse(packet).success).toBe(true);
  });

  /**
   * PRD §8.13: low confidence requires reject_to_dev or escalate.
   * A low-confidence auto-resolve risks merging bad conflict resolutions.
   */
  it("should reject low confidence with auto_resolve", () => {
    const packet = makeMergeAssistPacket({ confidence: "low", recommendation: "auto_resolve" });
    const result = MergeAssistPacketSchema.safeParse(packet);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("reject_to_dev") && m.includes("escalate"))).toBe(
        true,
      );
    }
  });

  /**
   * Low confidence with reject_to_dev is the safe fallback — sends
   * conflicts back to the developer for manual resolution.
   */
  it("should accept low confidence with reject_to_dev", () => {
    const packet = makeMergeAssistPacket({ confidence: "low", recommendation: "reject_to_dev" });
    expect(MergeAssistPacketSchema.safeParse(packet).success).toBe(true);
  });

  /**
   * Low confidence with escalate is the other safe option — flags
   * the conflict for operator intervention.
   */
  it("should accept low confidence with escalate", () => {
    const packet = makeMergeAssistPacket({ confidence: "low", recommendation: "escalate" });
    expect(MergeAssistPacketSchema.safeParse(packet).success).toBe(true);
  });

  /**
   * Exhaustive confidence × recommendation matrix to verify the rule
   * only fires for the exact combination it should.
   */
  describe("confidence × recommendation matrix", () => {
    const confidenceLevels = ["high", "medium", "low"] as const;
    const recommendations = ["auto_resolve", "reject_to_dev", "escalate"] as const;

    for (const confidence of confidenceLevels) {
      for (const recommendation of recommendations) {
        const shouldPass = confidence !== "low" || recommendation !== "auto_resolve";
        const label = shouldPass ? "accepts" : "rejects";

        it(`${label} confidence=${confidence} + recommendation=${recommendation}`, () => {
          const packet = makeMergeAssistPacket({ confidence, recommendation });
          const result = MergeAssistPacketSchema.safeParse(packet);
          expect(result.success).toBe(shouldPass);
        });
      }
    }
  });

  /**
   * Verify the error targets the recommendation field, not confidence.
   * The recommendation is what needs to change to fix the violation.
   */
  it("should report the error on the recommendation path", () => {
    const packet = makeMergeAssistPacket({ confidence: "low", recommendation: "auto_resolve" });
    const result = MergeAssistPacketSchema.safeParse(packet);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("recommendation");
    }
  });
});

// ─── PostMergeAnalysisPacket Cross-Field Validation ─────────────────────────

describe("PostMergeAnalysisPacket cross-field validation", () => {
  /**
   * High-confidence escalate is valid — no constraint on high confidence.
   */
  it("should accept high confidence with escalate", () => {
    const packet = makePostMergePacket({ confidence: "high", recommendation: "escalate" });
    expect(PostMergeAnalysisPacketSchema.safeParse(packet).success).toBe(true);
  });

  /**
   * High-confidence revert is valid — the agent is confident the merged
   * change should be reverted.
   */
  it("should accept high confidence with revert", () => {
    const packet = makePostMergePacket({
      confidence: "high",
      recommendation: "revert",
      suggested_revert_scope: { commits: ["abc123"], files: ["src/a.ts"] },
    });
    expect(PostMergeAnalysisPacketSchema.safeParse(packet).success).toBe(true);
  });

  /**
   * PRD §8.13: low confidence requires recommendation to be "escalate".
   * Low-confidence automated revert could revert the wrong commits.
   */
  it("should reject low confidence with revert", () => {
    const packet = makePostMergePacket({
      confidence: "low",
      recommendation: "revert",
      suggested_revert_scope: { commits: ["abc123"], files: ["src/a.ts"] },
    });
    const result = PostMergeAnalysisPacketSchema.safeParse(packet);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('"escalate"'))).toBe(true);
    }
  });

  /**
   * Low confidence with hotfix_task is also rejected — same risk as revert.
   */
  it("should reject low confidence with hotfix_task", () => {
    const packet = makePostMergePacket({
      confidence: "low",
      recommendation: "hotfix_task",
      follow_up_task_description: "Fix the regression in auth module.",
    });
    const result = PostMergeAnalysisPacketSchema.safeParse(packet);
    expect(result.success).toBe(false);
  });

  /**
   * Low confidence with pre_existing is rejected — even attributing
   * failures to pre-existing causes requires confidence.
   */
  it("should reject low confidence with pre_existing", () => {
    const packet = makePostMergePacket({
      confidence: "low",
      recommendation: "pre_existing",
    });
    const result = PostMergeAnalysisPacketSchema.safeParse(packet);
    expect(result.success).toBe(false);
  });

  /**
   * Low confidence with escalate is the only valid low-confidence option.
   */
  it("should accept low confidence with escalate", () => {
    const packet = makePostMergePacket({ confidence: "low", recommendation: "escalate" });
    expect(PostMergeAnalysisPacketSchema.safeParse(packet).success).toBe(true);
  });

  /**
   * Medium confidence has no constraints — all recommendations valid.
   */
  describe("medium confidence accepts all recommendations", () => {
    const recommendations = ["revert", "hotfix_task", "escalate", "pre_existing"] as const;

    for (const recommendation of recommendations) {
      it(`accepts medium + ${recommendation}`, () => {
        const overrides: Record<string, unknown> = { confidence: "medium", recommendation };
        if (recommendation === "revert") {
          overrides.suggested_revert_scope = { commits: ["abc123"], files: ["src/a.ts"] };
        }
        if (recommendation === "hotfix_task") {
          overrides.follow_up_task_description = "Fix the issue.";
        }
        const packet = makePostMergePacket(overrides);
        expect(PostMergeAnalysisPacketSchema.safeParse(packet).success).toBe(true);
      });
    }
  });

  /**
   * Exhaustive confidence × recommendation matrix for completeness.
   */
  describe("confidence × recommendation matrix", () => {
    const confidenceLevels = ["high", "medium", "low"] as const;
    const recommendations = ["revert", "hotfix_task", "escalate", "pre_existing"] as const;

    for (const confidence of confidenceLevels) {
      for (const recommendation of recommendations) {
        const shouldPass = confidence !== "low" || recommendation === "escalate";
        const label = shouldPass ? "accepts" : "rejects";

        it(`${label} confidence=${confidence} + recommendation=${recommendation}`, () => {
          const overrides: Record<string, unknown> = { confidence, recommendation };
          if (recommendation === "revert") {
            overrides.suggested_revert_scope = { commits: ["abc123"], files: ["src/a.ts"] };
          }
          if (recommendation === "hotfix_task") {
            overrides.follow_up_task_description = "Fix the issue.";
          }
          const packet = makePostMergePacket(overrides);
          const result = PostMergeAnalysisPacketSchema.safeParse(packet);
          expect(result.success).toBe(shouldPass);
        });
      }
    }
  });

  /**
   * Verify the error targets the recommendation field.
   */
  it("should report the error on the recommendation path", () => {
    const packet = makePostMergePacket({
      confidence: "low",
      recommendation: "revert",
      suggested_revert_scope: { commits: ["abc123"], files: ["src/a.ts"] },
    });
    const result = PostMergeAnalysisPacketSchema.safeParse(packet);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("recommendation");
    }
  });
});
