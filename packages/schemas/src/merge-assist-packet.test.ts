/**
 * Tests for {@link MergeAssistPacketSchema}.
 *
 * MergeAssistPacket is the output from the optional Merge Assist Agent
 * when AI-assisted conflict resolution is invoked. The orchestrator
 * validates every merge assist packet before applying the recommendation.
 * If this schema is wrong, invalid conflict resolutions could be applied
 * or valid resolutions rejected, breaking the merge pipeline.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.9
 */

import { describe, it, expect } from "vitest";

import { MergeAssistPacketSchema, MergeAssistFileAffectedSchema } from "./merge-assist-packet.js";
import type { MergeAssistPacket } from "./merge-assist-packet.js";

// ─── Spec Example ────────────────────────────────────────────────────────────

/** Canonical MergeAssistPacket example from PRD 008 §8.9.2 */
const specExample = {
  packet_type: "merge_assist_packet" as const,
  schema_version: "1.0" as const,
  created_at: "2026-03-10T00:28:00Z",
  task_id: "task-123",
  repository_id: "repo-1",
  merge_queue_item_id: "merge-7",
  recommendation: "auto_resolve",
  confidence: "high",
  summary: "Single conflict in imports resolved by combining both additions.",
  resolution_strategy: "Combined import statements from both branches preserving all additions.",
  files_affected: [
    {
      path: "apps/control-plane/src/modules/leases/index.ts",
      conflict_type: "both_modified",
      resolution_summary: "Merged import lists from both branches",
    },
  ],
  rationale: "Conflict is limited to additive import changes with no semantic overlap.",
  risks: [] as string[],
  open_questions: [] as string[],
};

// ─── FileAffected Schema Tests ──────────────────────────────────────────────

describe("MergeAssistFileAffectedSchema (PRD 008 §8.9.2)", () => {
  /**
   * Validates the file affected entry from the spec example.
   * Each entry describes a single conflicted file and its resolution.
   */
  it("should accept a valid file affected entry", () => {
    const result = MergeAssistFileAffectedSchema.safeParse(specExample.files_affected[0]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.conflict_type).toBe("both_modified");
    }
  });

  /**
   * Empty path must be rejected. File paths identify which files
   * the conflict resolution applies to.
   */
  it("should reject empty path", () => {
    const wrong = { ...specExample.files_affected[0], path: "" };
    const result = MergeAssistFileAffectedSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty conflict_type must be rejected. The conflict type helps
   * the merge module understand the nature of the conflict.
   */
  it("should reject empty conflict_type", () => {
    const wrong = { ...specExample.files_affected[0], conflict_type: "" };
    const result = MergeAssistFileAffectedSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});

// ─── Top-Level MergeAssistPacket Tests ──────────────────────────────────────

describe("MergeAssistPacketSchema (PRD 008 §8.9)", () => {
  /**
   * Validates the exact canonical example from §8.9.2.
   * This is the primary correctness test — the spec example MUST parse.
   */
  it("should accept the spec example from §8.9.2", () => {
    const result = MergeAssistPacketSchema.safeParse(specExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.packet_type).toBe("merge_assist_packet");
      expect(result.data.recommendation).toBe("auto_resolve");
      expect(result.data.confidence).toBe("high");
      expect(result.data.files_affected).toHaveLength(1);
    }
  });

  /**
   * Validates that the inferred TypeScript type matches the schema shape.
   * If this compiles, the type inference is correct.
   */
  it("should produce a correct inferred type", () => {
    const data: MergeAssistPacket = { ...specExample };
    const result = MergeAssistPacketSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * The reject_to_dev recommendation is used when the agent can't
   * resolve the conflict and it should go back to the developer.
   */
  it("should accept reject_to_dev recommendation", () => {
    const rejectToDev = {
      ...specExample,
      recommendation: "reject_to_dev",
      confidence: "medium",
      summary: "Complex conflict requires developer attention.",
      resolution_strategy: "N/A — conflict too complex for auto-resolution.",
      files_affected: [],
    };
    const result = MergeAssistPacketSchema.safeParse(rejectToDev);
    expect(result.success).toBe(true);
  });

  /**
   * The escalate recommendation is used when the agent cannot determine
   * the right course of action and needs human intervention.
   */
  it("should accept escalate recommendation", () => {
    const escalated = {
      ...specExample,
      recommendation: "escalate",
      confidence: "low",
      summary: "Cannot determine safe resolution.",
    };
    const result = MergeAssistPacketSchema.safeParse(escalated);
    expect(result.success).toBe(true);
  });

  /**
   * All three recommendation values must be accepted.
   */
  it("should accept all recommendation values", () => {
    for (const recommendation of ["auto_resolve", "reject_to_dev", "escalate"]) {
      const packet = { ...specExample, recommendation };
      const result = MergeAssistPacketSchema.safeParse(packet);
      expect(result.success, `should accept recommendation ${recommendation}`).toBe(true);
    }
  });

  /**
   * All three confidence levels must be accepted.
   */
  it("should accept all confidence levels", () => {
    for (const confidence of ["high", "medium", "low"]) {
      const packet = { ...specExample, confidence };
      const result = MergeAssistPacketSchema.safeParse(packet);
      expect(result.success, `should accept confidence ${confidence}`).toBe(true);
    }
  });

  /**
   * Risks and open_questions arrays should accept non-empty values.
   */
  it("should accept non-empty risks and open_questions", () => {
    const withRisks = {
      ...specExample,
      risks: ["Merged imports may cause runtime conflict"],
      open_questions: ["Should we validate import order?"],
    };
    const result = MergeAssistPacketSchema.safeParse(withRisks);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.risks).toHaveLength(1);
      expect(result.data.open_questions).toHaveLength(1);
    }
  });

  // ─── Rejection tests ────────────────────────────────────────────────────

  /**
   * packet_type must be exactly "merge_assist_packet". Wrong packet types
   * indicate a routing error in the orchestrator.
   */
  it("should reject wrong packet_type", () => {
    const wrong = { ...specExample, packet_type: "merge_packet" };
    const result = MergeAssistPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * schema_version must be exactly "1.0" for V1.
   */
  it("should reject wrong schema_version", () => {
    const wrong = { ...specExample, schema_version: "2.0" };
    const result = MergeAssistPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * created_at must be a valid ISO 8601 datetime string.
   */
  it("should reject non-ISO-8601 created_at", () => {
    const wrong = { ...specExample, created_at: "not-a-date" };
    const result = MergeAssistPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * An invalid recommendation value must be rejected. The recommendation
   * drives the merge module's conflict resolution behavior.
   */
  it("should reject invalid recommendation", () => {
    const wrong = { ...specExample, recommendation: "auto_merge" };
    const result = MergeAssistPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * An invalid confidence value must be rejected. Confidence is used
   * to gate whether the recommendation is applied.
   */
  it("should reject invalid confidence", () => {
    const wrong = { ...specExample, confidence: "very_high" };
    const result = MergeAssistPacketSchema.safeParse(wrong);
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
      "recommendation",
      "confidence",
      "summary",
      "resolution_strategy",
      "files_affected",
      "rationale",
      "risks",
      "open_questions",
    ];

    for (const field of requiredFields) {
      const incomplete = { ...specExample };
      delete (incomplete as Record<string, unknown>)[field];
      const result = MergeAssistPacketSchema.safeParse(incomplete);
      expect(result.success, `should reject missing ${field}`).toBe(false);
    }
  });

  /**
   * Empty string IDs must be rejected.
   */
  it("should reject empty string task_id", () => {
    const wrong = { ...specExample, task_id: "" };
    const result = MergeAssistPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string merge_queue_item_id must be rejected.
   */
  it("should reject empty string merge_queue_item_id", () => {
    const wrong = { ...specExample, merge_queue_item_id: "" };
    const result = MergeAssistPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string summary must be rejected.
   */
  it("should reject empty string summary", () => {
    const wrong = { ...specExample, summary: "" };
    const result = MergeAssistPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string resolution_strategy must be rejected. The strategy
   * describes how the conflict was or should be resolved.
   */
  it("should reject empty string resolution_strategy", () => {
    const wrong = { ...specExample, resolution_strategy: "" };
    const result = MergeAssistPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Malformed file affected entries must be rejected.
   */
  it("should reject malformed files_affected", () => {
    const wrong = {
      ...specExample,
      files_affected: [{ path: "foo.ts" }],
    };
    const result = MergeAssistPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});
