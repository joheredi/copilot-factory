/**
 * Tests for {@link DevResultPacketSchema} and its nested sub-schemas.
 *
 * DevResultPacket is the canonical output from developer workers. The
 * orchestrator validates every result packet before committing a state
 * transition. If this schema is wrong, valid worker output gets rejected
 * or invalid output slips through, breaking the task lifecycle.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.5
 */

import { describe, it, expect } from "vitest";

import { DevResultPacketSchema, DevResultPacketResultSchema } from "./dev-result-packet.js";
import type { DevResultPacket } from "./dev-result-packet.js";

// ─── Spec Example ────────────────────────────────────────────────────────────

/** Canonical DevResultPacket example from PRD 008 §8.5.2 */
const specExample = {
  packet_type: "dev_result_packet" as const,
  schema_version: "1.0" as const,
  created_at: "2026-03-10T00:15:00Z",
  task_id: "task-123",
  repository_id: "repo-1",
  run_id: "run-456",
  status: "success",
  summary: "Implemented stale lease reconciliation and audit emission.",
  result: {
    branch_name: "factory/task-123",
    commit_sha: "abc123",
    files_changed: [
      {
        path: "apps/control-plane/src/modules/leases/reconcile.ts",
        change_type: "modified",
        summary: "Added expiry sweep and reclaim logic",
      },
    ],
    tests_added_or_updated: ["packages/testing/src/leases/reconcile.spec.ts"],
    validations_run: [
      {
        check_type: "test",
        tool_name: "pnpm",
        command: "pnpm test --filter leases",
        status: "passed",
        duration_ms: 8200,
        summary: "8 tests passed",
      },
    ],
    assumptions: ["Lease expiry uses wall-clock time from persisted timestamps"],
    risks: [] as string[],
    unresolved_issues: [] as string[],
  },
  artifact_refs: ["runs/run-456/logs/developer.log", "runs/run-456/outputs/diff.patch"],
};

// ─── Top-Level DevResultPacket Tests ─────────────────────────────────────────

describe("DevResultPacketSchema (PRD 008 §8.5)", () => {
  /**
   * Validates the exact canonical example from §8.5.2.
   * This is the primary correctness test — the spec example MUST parse.
   */
  it("should accept the spec example from §8.5.2", () => {
    const result = DevResultPacketSchema.safeParse(specExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.packet_type).toBe("dev_result_packet");
      expect(result.data.task_id).toBe("task-123");
      expect(result.data.status).toBe("success");
      expect(result.data.result.files_changed).toHaveLength(1);
    }
  });

  /**
   * Validates that the inferred TypeScript type matches the schema shape.
   */
  it("should produce a correct inferred type", () => {
    const data: DevResultPacket = { ...specExample };
    const result = DevResultPacketSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * All four status values must be accepted. Each represents a distinct
   * outcome that drives different state transitions in the lifecycle.
   */
  it.each(["success", "failed", "partial", "blocked"] as const)(
    "should accept status '%s'",
    (status) => {
      const data = { ...specExample, status };
      const result = DevResultPacketSchema.safeParse(data);
      expect(result.success).toBe(true);
    },
  );

  /**
   * Invalid status values must be rejected. An unknown status would leave
   * the state machine in an undefined state.
   */
  it("should reject an invalid status", () => {
    const data = { ...specExample, status: "timeout" };
    const result = DevResultPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("status");
    }
  });

  /**
   * packet_type must be the literal "dev_result_packet".
   */
  it("should reject a wrong packet_type", () => {
    const data = { ...specExample, packet_type: "task_packet" };
    const result = DevResultPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * schema_version must be the literal "1.0".
   */
  it("should reject a wrong schema_version", () => {
    const data = { ...specExample, schema_version: "2.0" };
    const result = DevResultPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * created_at must be valid ISO 8601. Malformed timestamps break
   * audit trail ordering and expiry checks.
   */
  it("should reject a non-ISO-8601 created_at", () => {
    const data = { ...specExample, created_at: "yesterday" };
    const result = DevResultPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string identifiers must be rejected.
   */
  it("should reject an empty task_id", () => {
    const data = { ...specExample, task_id: "" };
    const result = DevResultPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject an empty repository_id", () => {
    const data = { ...specExample, repository_id: "" };
    const result = DevResultPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject an empty run_id", () => {
    const data = { ...specExample, run_id: "" };
    const result = DevResultPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject an empty summary", () => {
    const data = { ...specExample, summary: "" };
    const result = DevResultPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Missing required fields must be rejected.
   */
  it("should reject missing run_id", () => {
    const { run_id: _, ...data } = specExample;
    const result = DevResultPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject missing result", () => {
    const { result: _, ...data } = specExample;
    const result = DevResultPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * An empty artifact_refs array should be accepted. Not all runs produce
   * artifacts (e.g. blocked runs may have nothing to persist).
   */
  it("should accept an empty artifact_refs array", () => {
    const data = { ...specExample, artifact_refs: [] };
    const result = DevResultPacketSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * Empty strings inside artifact_refs must be rejected. Each ref should
   * be a meaningful path.
   */
  it("should reject empty strings in artifact_refs", () => {
    const data = { ...specExample, artifact_refs: [""] };
    const result = DevResultPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

// ─── Result Sub-Schema Tests ─────────────────────────────────────────────────

describe("DevResultPacketResultSchema (PRD 008 §8.5.2 result)", () => {
  const resultData = specExample.result;

  /**
   * The spec's result section must parse.
   */
  it("should accept the spec example result section", () => {
    const result = DevResultPacketResultSchema.safeParse(resultData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.branch_name).toBe("factory/task-123");
      expect(result.data.commit_sha).toBe("abc123");
    }
  });

  /**
   * Empty branch_name must be rejected. The branch is required for
   * merge queue processing.
   */
  it("should reject an empty branch_name", () => {
    const data = { ...resultData, branch_name: "" };
    const result = DevResultPacketResultSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Empty commit_sha must be rejected. The SHA is required for
   * artifact traceability.
   */
  it("should reject an empty commit_sha", () => {
    const data = { ...resultData, commit_sha: "" };
    const result = DevResultPacketResultSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * An empty files_changed array should be accepted. Some blocked or
   * failed runs may not produce file changes.
   */
  it("should accept an empty files_changed array", () => {
    const data = { ...resultData, files_changed: [] };
    const result = DevResultPacketResultSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * An invalid file change entry must be rejected. Validates that the
   * embedded FileChangeSummarySchema is enforced on array elements.
   */
  it("should reject an invalid file change entry", () => {
    const data = {
      ...resultData,
      files_changed: [{ path: "", change_type: "modified", summary: "x" }],
    };
    const result = DevResultPacketResultSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Multiple file changes should parse. Real implementations typically
   * touch multiple files.
   */
  it("should accept multiple file changes", () => {
    const data = {
      ...resultData,
      files_changed: [
        { path: "src/a.ts", change_type: "added", summary: "New file" },
        { path: "src/b.ts", change_type: "modified", summary: "Updated" },
        { path: "src/c.ts", change_type: "deleted", summary: "Removed" },
      ],
    };
    const result = DevResultPacketResultSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.files_changed).toHaveLength(3);
    }
  });

  /**
   * An empty validations_run array should be accepted. Blocked runs
   * may not execute any validations.
   */
  it("should accept an empty validations_run array", () => {
    const data = { ...resultData, validations_run: [] };
    const result = DevResultPacketResultSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * An invalid validation entry must be rejected.
   */
  it("should reject an invalid validation entry", () => {
    const data = {
      ...resultData,
      validations_run: [{ check_type: "unknown" }],
    };
    const result = DevResultPacketResultSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * An empty tests_added_or_updated array should be accepted.
   */
  it("should accept an empty tests_added_or_updated array", () => {
    const data = { ...resultData, tests_added_or_updated: [] };
    const result = DevResultPacketResultSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * Non-empty assumptions and risks should parse.
   */
  it("should accept populated assumptions and risks", () => {
    const data = {
      ...resultData,
      assumptions: ["Uses UTC timestamps"],
      risks: ["May need index for large tables"],
      unresolved_issues: ["Error message formatting TBD"],
    };
    const result = DevResultPacketResultSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assumptions).toHaveLength(1);
      expect(result.data.risks).toHaveLength(1);
      expect(result.data.unresolved_issues).toHaveLength(1);
    }
  });
});
