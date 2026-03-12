/**
 * Tests for the result packet validator adapter.
 *
 * These tests validate the infrastructure adapter that determines whether
 * filesystem-persisted content is a valid DevResultPacket. The validator must:
 *
 * 1. Accept valid DevResultPacket JSON and return parsed data
 * 2. Reject non-JSON content with a clear reason
 * 3. Reject JSON that doesn't match the DevResultPacket schema
 * 4. Provide descriptive error messages for schema validation failures
 *
 * This is a critical safety check: if a valid result packet is found on
 * the filesystem, the lease reclaim can be avoided entirely (§9.8.2).
 * False positives would cause the system to process garbage as a result.
 *
 * @see docs/prd/009-policy-and-enforcement-spec.md §9.8.2 — Network Partition Handling
 * @see docs/backlog/tasks/T072-partial-work-snapshot.md
 * @module @factory/infrastructure/crash-recovery/result-packet-validator.test
 */

import { describe, it, expect } from "vitest";

import { createResultPacketValidator } from "./result-packet-validator.js";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

/**
 * A minimal valid DevResultPacket for testing positive validation.
 * All required fields are present with valid values per §8.5.
 */
const VALID_DEV_RESULT_PACKET = {
  packet_type: "dev_result_packet",
  schema_version: "1.0",
  created_at: "2025-01-15T10:30:00.000Z",
  task_id: "task-42",
  repository_id: "repo-abc",
  run_id: "run-001",
  status: "success",
  summary: "Implemented the feature successfully.",
  result: {
    branch_name: "factory/task-42",
    commit_sha: "abc123def456",
    files_changed: [
      {
        path: "src/index.ts",
        change_type: "modified",
        summary: "Added main function",
      },
    ],
    tests_added_or_updated: ["src/index.test.ts"],
    validations_run: [
      {
        check_type: "build",
        tool_name: "tsc",
        command: "tsc --noEmit",
        status: "passed",
        duration_ms: 1200,
        summary: "Build succeeded with no errors",
      },
    ],
    assumptions: [],
    risks: [],
    unresolved_issues: [],
  },
  artifact_refs: ["runs/run-001/logs/execution.log"],
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ResultPacketValidator", () => {
  const validator = createResultPacketValidator();

  describe("valid packets", () => {
    /**
     * Validates that a well-formed DevResultPacket is accepted and its
     * parsed data is returned. This is the happy path where a worker wrote
     * a valid result to disk before losing connectivity.
     */
    it("accepts a valid DevResultPacket", () => {
      const content = JSON.stringify(VALID_DEV_RESULT_PACKET);

      const result = validator.validate(content);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data).toEqual(VALID_DEV_RESULT_PACKET);
      }
    });

    /**
     * Validates that pretty-printed JSON (with whitespace) is also accepted.
     * Workers may write formatted JSON for debuggability.
     */
    it("accepts pretty-printed JSON", () => {
      const content = JSON.stringify(VALID_DEV_RESULT_PACKET, null, 2);

      const result = validator.validate(content);

      expect(result.valid).toBe(true);
    });
  });

  describe("invalid content", () => {
    /**
     * Validates that non-JSON content is rejected with a clear message.
     * A crashed worker might leave partial/truncated content on disk.
     */
    it("rejects non-JSON content", () => {
      const result = validator.validate("this is not json at all");

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain("not valid JSON");
      }
    });

    /**
     * Validates that truncated JSON (partial write before crash) is rejected.
     */
    it("rejects truncated JSON", () => {
      const result = validator.validate('{"packet_type":"dev_result_packet","schema_');

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain("not valid JSON");
      }
    });

    /**
     * Validates that empty content is rejected.
     */
    it("rejects empty content", () => {
      const result = validator.validate("");

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain("not valid JSON");
      }
    });
  });

  describe("schema validation failures", () => {
    /**
     * Validates that JSON with wrong packet_type is rejected.
     * This prevents processing a review packet as a dev result.
     */
    it("rejects JSON with wrong packet_type", () => {
      const content = JSON.stringify({
        ...VALID_DEV_RESULT_PACKET,
        packet_type: "review_packet",
      });

      const result = validator.validate(content);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain("Schema validation failed");
      }
    });

    /**
     * Validates that JSON missing required fields is rejected with
     * a descriptive message identifying the missing field.
     */
    it("rejects JSON missing required fields", () => {
      const { task_id: _, ...incomplete } = VALID_DEV_RESULT_PACKET;
      const content = JSON.stringify(incomplete);

      const result = validator.validate(content);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain("Schema validation failed");
      }
    });

    /**
     * Validates that valid JSON that is not a DevResultPacket at all
     * (e.g., a random object) is rejected.
     */
    it("rejects arbitrary JSON objects", () => {
      const content = JSON.stringify({ foo: "bar", count: 42 });

      const result = validator.validate(content);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain("Schema validation failed");
      }
    });

    /**
     * Validates that a JSON array (instead of object) is rejected.
     */
    it("rejects JSON arrays", () => {
      const content = JSON.stringify([1, 2, 3]);

      const result = validator.validate(content);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain("Schema validation failed");
      }
    });

    /**
     * Validates that wrong schema_version is rejected, preventing
     * incompatible packet versions from being processed.
     */
    it("rejects wrong schema_version", () => {
      const content = JSON.stringify({
        ...VALID_DEV_RESULT_PACKET,
        schema_version: "2.0",
      });

      const result = validator.validate(content);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain("Schema validation failed");
      }
    });

    /**
     * Validates that invalid created_at format is rejected.
     * Must be ISO 8601.
     */
    it("rejects invalid timestamp format", () => {
      const content = JSON.stringify({
        ...VALID_DEV_RESULT_PACKET,
        created_at: "not-a-timestamp",
      });

      const result = validator.validate(content);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain("Schema validation failed");
      }
    });
  });
});
