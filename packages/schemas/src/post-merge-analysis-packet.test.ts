/**
 * Tests for {@link PostMergeAnalysisPacketSchema}.
 *
 * PostMergeAnalysisPacket is the output from the Post-Merge Analysis Agent
 * when post-merge validation fails. The orchestrator validates every
 * analysis packet before applying the recommended remediation. If this
 * schema is wrong, invalid remediation recommendations could be applied
 * or valid recommendations rejected, causing incorrect revert/hotfix actions.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.11
 */

import { describe, it, expect } from "vitest";

import {
  PostMergeAnalysisPacketSchema,
  SuggestedRevertScopeSchema,
} from "./post-merge-analysis-packet.js";
import type { PostMergeAnalysisPacket } from "./post-merge-analysis-packet.js";

// ─── Spec Example ────────────────────────────────────────────────────────────

/** Canonical PostMergeAnalysisPacket example from PRD 008 §8.11.2 */
const specExample = {
  packet_type: "post_merge_analysis_packet" as const,
  schema_version: "1.0" as const,
  created_at: "2026-03-10T00:35:00Z",
  task_id: "task-123",
  repository_id: "repo-1",
  merge_queue_item_id: "merge-7",
  validation_run_id: "validation-56",
  recommendation: "revert",
  confidence: "high",
  summary: "Merged change introduced a regression in lease reconciliation tests.",
  failure_attribution:
    "The merged change modified reconcile.ts which directly caused 3 test failures in reconcile.spec.ts.",
  rationale:
    "All failing tests exercise code paths modified by this merge. No other recent merges touch these files.",
  suggested_revert_scope: {
    commits: ["def456"],
    files: ["apps/control-plane/src/modules/leases/reconcile.ts"],
  },
  follow_up_task_description: null,
  risks: [] as string[],
  open_questions: [] as string[],
};

// ─── SuggestedRevertScope Schema Tests ──────────────────────────────────────

describe("SuggestedRevertScopeSchema (PRD 008 §8.11.2)", () => {
  /**
   * Validates the revert scope from the spec example.
   * The revert scope identifies which commits and files to revert.
   */
  it("should accept a valid revert scope", () => {
    const result = SuggestedRevertScopeSchema.safeParse(specExample.suggested_revert_scope);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.commits).toEqual(["def456"]);
      expect(result.data.files).toHaveLength(1);
    }
  });

  /**
   * Multiple commits and files are valid — a merge may span
   * multiple commits affecting many files.
   */
  it("should accept multiple commits and files", () => {
    const scope = {
      commits: ["abc123", "def456"],
      files: ["src/a.ts", "src/b.ts", "src/c.ts"],
    };
    const result = SuggestedRevertScopeSchema.safeParse(scope);
    expect(result.success).toBe(true);
  });

  /**
   * Empty commit SHA strings must be rejected.
   */
  it("should reject empty commit SHA", () => {
    const wrong = { commits: [""], files: ["src/a.ts"] };
    const result = SuggestedRevertScopeSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty file path strings must be rejected.
   */
  it("should reject empty file path", () => {
    const wrong = { commits: ["abc123"], files: [""] };
    const result = SuggestedRevertScopeSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});

// ─── Top-Level PostMergeAnalysisPacket Tests ────────────────────────────────

describe("PostMergeAnalysisPacketSchema (PRD 008 §8.11)", () => {
  /**
   * Validates the exact canonical example from §8.11.2.
   * This is the primary correctness test — the spec example MUST parse.
   */
  it("should accept the spec example from §8.11.2", () => {
    const result = PostMergeAnalysisPacketSchema.safeParse(specExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.packet_type).toBe("post_merge_analysis_packet");
      expect(result.data.recommendation).toBe("revert");
      expect(result.data.confidence).toBe("high");
      expect(result.data.suggested_revert_scope).not.toBeNull();
      expect(result.data.follow_up_task_description).toBeNull();
    }
  });

  /**
   * Validates that the inferred TypeScript type matches the schema shape.
   * If this compiles, the type inference is correct.
   */
  it("should produce a correct inferred type", () => {
    const data: PostMergeAnalysisPacket = { ...specExample };
    const result = PostMergeAnalysisPacketSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * A hotfix_task recommendation requires follow_up_task_description to
   * be non-null. This variant creates a follow-up task instead of reverting.
   */
  it("should accept hotfix_task recommendation with follow_up_task_description", () => {
    const hotfix = {
      ...specExample,
      recommendation: "hotfix_task",
      confidence: "high",
      summary: "Minor regression can be hotfixed.",
      suggested_revert_scope: null,
      follow_up_task_description: "Fix the lease reconciliation edge case for concurrent updates.",
    };
    const result = PostMergeAnalysisPacketSchema.safeParse(hotfix);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.follow_up_task_description).not.toBeNull();
      expect(result.data.suggested_revert_scope).toBeNull();
    }
  });

  /**
   * An escalate recommendation routes to the human operator queue.
   * Both nullable fields can be null.
   */
  it("should accept escalate recommendation", () => {
    const escalated = {
      ...specExample,
      recommendation: "escalate",
      confidence: "low",
      summary: "Cannot determine root cause with available data.",
      suggested_revert_scope: null,
      follow_up_task_description: null,
    };
    const result = PostMergeAnalysisPacketSchema.safeParse(escalated);
    expect(result.success).toBe(true);
  });

  /**
   * A pre_existing recommendation means the failure was not caused by
   * the merge. The orchestrator should not revert but may create a
   * diagnostic task.
   */
  it("should accept pre_existing recommendation", () => {
    const preExisting = {
      ...specExample,
      recommendation: "pre_existing",
      confidence: "medium",
      summary: "Failure existed before this merge.",
      suggested_revert_scope: null,
      follow_up_task_description: null,
    };
    const result = PostMergeAnalysisPacketSchema.safeParse(preExisting);
    expect(result.success).toBe(true);
  });

  /**
   * All four recommendation values must be accepted.
   */
  it("should accept all recommendation values", () => {
    for (const recommendation of ["revert", "hotfix_task", "escalate", "pre_existing"]) {
      const packet = {
        ...specExample,
        recommendation,
        suggested_revert_scope:
          recommendation === "revert" ? specExample.suggested_revert_scope : null,
        follow_up_task_description: recommendation === "hotfix_task" ? "Fix the issue." : null,
      };
      const result = PostMergeAnalysisPacketSchema.safeParse(packet);
      expect(result.success, `should accept recommendation ${recommendation}`).toBe(true);
    }
  });

  /**
   * All three confidence levels must be accepted.
   */
  it("should accept all confidence levels", () => {
    for (const confidence of ["high", "medium", "low"]) {
      const packet = { ...specExample, confidence };
      const result = PostMergeAnalysisPacketSchema.safeParse(packet);
      expect(result.success, `should accept confidence ${confidence}`).toBe(true);
    }
  });

  /**
   * Risks and open_questions arrays should accept non-empty values.
   */
  it("should accept non-empty risks and open_questions", () => {
    const withRisks = {
      ...specExample,
      risks: ["Reverting may break other in-flight work"],
      open_questions: ["Were there other merges between the failing commit and now?"],
    };
    const result = PostMergeAnalysisPacketSchema.safeParse(withRisks);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.risks).toHaveLength(1);
      expect(result.data.open_questions).toHaveLength(1);
    }
  });

  // ─── Rejection tests ────────────────────────────────────────────────────

  /**
   * packet_type must be exactly "post_merge_analysis_packet".
   */
  it("should reject wrong packet_type", () => {
    const wrong = { ...specExample, packet_type: "merge_packet" };
    const result = PostMergeAnalysisPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * schema_version must be exactly "1.0" for V1.
   */
  it("should reject wrong schema_version", () => {
    const wrong = { ...specExample, schema_version: "2.0" };
    const result = PostMergeAnalysisPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * created_at must be a valid ISO 8601 datetime string.
   */
  it("should reject non-ISO-8601 created_at", () => {
    const wrong = { ...specExample, created_at: "not-a-date" };
    const result = PostMergeAnalysisPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * An invalid recommendation value must be rejected.
   */
  it("should reject invalid recommendation", () => {
    const wrong = { ...specExample, recommendation: "ignore" };
    const result = PostMergeAnalysisPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * An invalid confidence value must be rejected.
   */
  it("should reject invalid confidence", () => {
    const wrong = { ...specExample, confidence: "very_high" };
    const result = PostMergeAnalysisPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * All required top-level fields must be present.
   */
  it("should reject missing required fields", () => {
    const requiredFields = [
      "packet_type",
      "schema_version",
      "created_at",
      "task_id",
      "repository_id",
      "merge_queue_item_id",
      "validation_run_id",
      "recommendation",
      "confidence",
      "summary",
      "failure_attribution",
      "rationale",
      "suggested_revert_scope",
      "follow_up_task_description",
      "risks",
      "open_questions",
    ];

    for (const field of requiredFields) {
      const incomplete = { ...specExample };
      delete (incomplete as Record<string, unknown>)[field];
      const result = PostMergeAnalysisPacketSchema.safeParse(incomplete);
      expect(result.success, `should reject missing ${field}`).toBe(false);
    }
  });

  /**
   * Empty string IDs must be rejected.
   */
  it("should reject empty string task_id", () => {
    const wrong = { ...specExample, task_id: "" };
    const result = PostMergeAnalysisPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string merge_queue_item_id must be rejected.
   */
  it("should reject empty string merge_queue_item_id", () => {
    const wrong = { ...specExample, merge_queue_item_id: "" };
    const result = PostMergeAnalysisPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string validation_run_id must be rejected.
   */
  it("should reject empty string validation_run_id", () => {
    const wrong = { ...specExample, validation_run_id: "" };
    const result = PostMergeAnalysisPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string summary must be rejected.
   */
  it("should reject empty string summary", () => {
    const wrong = { ...specExample, summary: "" };
    const result = PostMergeAnalysisPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string failure_attribution must be rejected. Attribution
   * is essential for the orchestrator to decide remediation.
   */
  it("should reject empty string failure_attribution", () => {
    const wrong = { ...specExample, failure_attribution: "" };
    const result = PostMergeAnalysisPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string rationale must be rejected.
   */
  it("should reject empty string rationale", () => {
    const wrong = { ...specExample, rationale: "" };
    const result = PostMergeAnalysisPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});
