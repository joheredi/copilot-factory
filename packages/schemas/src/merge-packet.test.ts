/**
 * Tests for {@link MergePacketSchema}.
 *
 * MergePacket is the canonical result of merge preparation and integration.
 * The orchestrator validates every merge packet before committing the merge
 * state transition. If this schema is wrong, valid merge results get rejected
 * or invalid results are accepted, corrupting the merge queue state.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.8
 */

import { describe, it, expect } from "vitest";

import { MergePacketSchema, MergePacketDetailsSchema } from "./merge-packet.js";
import type { MergePacket } from "./merge-packet.js";

// ─── Spec Example ────────────────────────────────────────────────────────────

/** Canonical MergePacket example from PRD 008 §8.8.2 */
const specExample = {
  packet_type: "merge_packet" as const,
  schema_version: "1.0" as const,
  created_at: "2026-03-10T00:30:00Z",
  task_id: "task-123",
  repository_id: "repo-1",
  merge_queue_item_id: "merge-7",
  status: "success",
  summary: "Rebased on main and merged cleanly.",
  details: {
    source_branch: "factory/task-123",
    target_branch: "main",
    approved_commit_sha: "abc123",
    merged_commit_sha: "def456",
    merge_strategy: "rebase-and-merge",
    rebase_performed: true,
    validation_results: [] as Array<{
      check_type: string;
      tool_name: string;
      command: string;
      status: string;
      duration_ms: number;
      summary: string;
    }>,
  },
  artifact_refs: ["merges/merge-7/merge.log"],
};

// ─── Details Schema Tests ───────────────────────────────────────────────────

describe("MergePacketDetailsSchema (PRD 008 §8.8.2)", () => {
  /**
   * Validates that the details section from the spec example parses correctly.
   * The details section contains the core merge information.
   */
  it("should accept the spec example details", () => {
    const result = MergePacketDetailsSchema.safeParse(specExample.details);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source_branch).toBe("factory/task-123");
      expect(result.data.merge_strategy).toBe("rebase-and-merge");
      expect(result.data.rebase_performed).toBe(true);
    }
  });

  /**
   * Validates details with validation results from a merge that ran
   * post-merge checks. This is the typical production scenario.
   */
  it("should accept details with validation results", () => {
    const detailsWithValidation = {
      ...specExample.details,
      validation_results: [
        {
          check_type: "test",
          tool_name: "pnpm",
          command: "pnpm test",
          status: "passed",
          duration_ms: 5000,
          summary: "All tests passed",
        },
      ],
    };
    const result = MergePacketDetailsSchema.safeParse(detailsWithValidation);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.validation_results).toHaveLength(1);
    }
  });

  /**
   * All three merge strategies must be accepted. The merge module
   * selects from configured allowed strategies.
   */
  it("should accept all merge strategies", () => {
    for (const strategy of ["rebase-and-merge", "squash", "merge-commit"]) {
      const details = { ...specExample.details, merge_strategy: strategy };
      const result = MergePacketDetailsSchema.safeParse(details);
      expect(result.success, `should accept strategy ${strategy}`).toBe(true);
    }
  });

  /**
   * Invalid merge strategy must be rejected. Strategy drives the
   * merge execution path.
   */
  it("should reject invalid merge strategy", () => {
    const wrong = { ...specExample.details, merge_strategy: "fast-forward" };
    const result = MergePacketDetailsSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty source_branch must be rejected. Branch names are used to
   * locate the code to merge.
   */
  it("should reject empty source_branch", () => {
    const wrong = { ...specExample.details, source_branch: "" };
    const result = MergePacketDetailsSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});

// ─── Top-Level MergePacket Tests ────────────────────────────────────────────

describe("MergePacketSchema (PRD 008 §8.8)", () => {
  /**
   * Validates the exact canonical example from §8.8.2.
   * This is the primary correctness test — the spec example MUST parse.
   */
  it("should accept the spec example from §8.8.2", () => {
    const result = MergePacketSchema.safeParse(specExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.packet_type).toBe("merge_packet");
      expect(result.data.task_id).toBe("task-123");
      expect(result.data.merge_queue_item_id).toBe("merge-7");
      expect(result.data.status).toBe("success");
      expect(result.data.details.merge_strategy).toBe("rebase-and-merge");
    }
  });

  /**
   * Validates that the inferred TypeScript type matches the schema shape.
   * If this compiles, the type inference is correct.
   */
  it("should produce a correct inferred type", () => {
    const data: MergePacket = { ...specExample };
    const result = MergePacketSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * A failed merge is a valid outcome. The orchestrator needs to
   * distinguish success from failure to route accordingly.
   */
  it("should accept a failed merge", () => {
    const failed = {
      ...specExample,
      status: "failed",
      summary: "Merge conflicts detected.",
    };
    const result = MergePacketSchema.safeParse(failed);
    expect(result.success).toBe(true);
  });

  /**
   * All packet status values must be accepted.
   */
  it("should accept all packet status values", () => {
    for (const status of ["success", "failed", "partial", "blocked"]) {
      const packet = { ...specExample, status };
      const result = MergePacketSchema.safeParse(packet);
      expect(result.success, `should accept status ${status}`).toBe(true);
    }
  });

  // ─── Rejection tests ────────────────────────────────────────────────────

  /**
   * packet_type must be exactly "merge_packet". Wrong packet types
   * indicate a routing error in the orchestrator.
   */
  it("should reject wrong packet_type", () => {
    const wrong = { ...specExample, packet_type: "dev_result_packet" };
    const result = MergePacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * schema_version must be exactly "1.0" for V1.
   * Other versions require a separate schema definition.
   */
  it("should reject wrong schema_version", () => {
    const wrong = { ...specExample, schema_version: "2.0" };
    const result = MergePacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * created_at must be a valid ISO 8601 datetime string. Freeform
   * strings would break timestamp-based ordering and audit trails.
   */
  it("should reject non-ISO-8601 created_at", () => {
    const wrong = { ...specExample, created_at: "not-a-date" };
    const result = MergePacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * An invalid packet status must be rejected. The status drives
   * post-merge decision logic.
   */
  it("should reject invalid status", () => {
    const wrong = { ...specExample, status: "unknown" };
    const result = MergePacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * All required top-level fields must be present. Missing fields
   * indicate an incomplete or malformed merge output.
   */
  it("should reject missing required fields", () => {
    const requiredFields = [
      "packet_type",
      "schema_version",
      "created_at",
      "task_id",
      "repository_id",
      "merge_queue_item_id",
      "status",
      "summary",
      "details",
      "artifact_refs",
    ];

    for (const field of requiredFields) {
      const incomplete = { ...specExample };
      delete (incomplete as Record<string, unknown>)[field];
      const result = MergePacketSchema.safeParse(incomplete);
      expect(result.success, `should reject missing ${field}`).toBe(false);
    }
  });

  /**
   * Empty string IDs must be rejected. The orchestrator uses these IDs
   * to correlate packets with database entities.
   */
  it("should reject empty string task_id", () => {
    const wrong = { ...specExample, task_id: "" };
    const result = MergePacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string merge_queue_item_id must be rejected. This ID links
   * the merge packet to its queue item for ordering.
   */
  it("should reject empty string merge_queue_item_id", () => {
    const wrong = { ...specExample, merge_queue_item_id: "" };
    const result = MergePacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string summary must be rejected. Summaries are used in
   * audit trails and operator notifications.
   */
  it("should reject empty string summary", () => {
    const wrong = { ...specExample, summary: "" };
    const result = MergePacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * artifact_refs must contain non-empty strings.
   * Empty strings would create invalid artifact references.
   */
  it("should reject empty strings in artifact_refs", () => {
    const wrong = { ...specExample, artifact_refs: [""] };
    const result = MergePacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});
