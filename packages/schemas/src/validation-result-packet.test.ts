/**
 * Tests for {@link ValidationResultPacketSchema}.
 *
 * ValidationResultPacket is the canonical output from deterministic validation.
 * The orchestrator validates every validation result packet before gating
 * state transitions. If this schema is wrong, valid validation results get
 * rejected or invalid results allow unsafe transitions.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.10
 */

import { describe, it, expect } from "vitest";

import {
  ValidationResultPacketSchema,
  ValidationResultPacketDetailsSchema,
} from "./validation-result-packet.js";
import type { ValidationResultPacket } from "./validation-result-packet.js";

// ─── Spec Example ────────────────────────────────────────────────────────────

/** Canonical ValidationResultPacket example from PRD 008 §8.10.2 */
const specExample = {
  packet_type: "validation_result_packet" as const,
  schema_version: "1.0" as const,
  created_at: "2026-03-10T00:18:00Z",
  task_id: "task-123",
  repository_id: "repo-1",
  validation_run_id: "validation-55",
  status: "success",
  summary: "Required test and lint checks passed.",
  details: {
    run_scope: "pre-review",
    checks: [
      {
        check_type: "test",
        tool_name: "pnpm",
        command: "pnpm test --filter control-plane",
        status: "passed",
        duration_ms: 6400,
        summary: "42 tests passed",
      },
      {
        check_type: "lint",
        tool_name: "pnpm",
        command: "pnpm lint",
        status: "passed",
        duration_ms: 2200,
        summary: "No lint errors",
      },
    ],
  },
};

// ─── Details Schema Tests ───────────────────────────────────────────────────

describe("ValidationResultPacketDetailsSchema (PRD 008 §8.10.2)", () => {
  /**
   * Validates that the details section from the spec example parses correctly.
   * The details section contains the run scope and check results.
   */
  it("should accept the spec example details", () => {
    const result = ValidationResultPacketDetailsSchema.safeParse(specExample.details);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.run_scope).toBe("pre-review");
      expect(result.data.checks).toHaveLength(2);
    }
  });

  /**
   * All five run_scope values must be accepted. The run_scope determines
   * at which workflow stage the validation was triggered.
   */
  it("should accept all run_scope values", () => {
    for (const scope of ["pre-dev", "during-dev", "pre-review", "pre-merge", "post-merge"]) {
      const details = { ...specExample.details, run_scope: scope };
      const result = ValidationResultPacketDetailsSchema.safeParse(details);
      expect(result.success, `should accept run_scope ${scope}`).toBe(true);
    }
  });

  /**
   * Invalid run_scope must be rejected. The scope drives validation
   * profile selection logic.
   */
  it("should reject invalid run_scope", () => {
    const wrong = { ...specExample.details, run_scope: "during-merge" };
    const result = ValidationResultPacketDetailsSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty checks array is valid — a validation run with no checks
   * may occur if the profile has no required/optional checks configured.
   */
  it("should accept empty checks array", () => {
    const details = { ...specExample.details, checks: [] };
    const result = ValidationResultPacketDetailsSchema.safeParse(details);
    expect(result.success).toBe(true);
  });

  /**
   * Malformed check entries must be rejected. Each check must be a
   * valid ValidationCheckResult.
   */
  it("should reject malformed check entries", () => {
    const wrong = {
      ...specExample.details,
      checks: [{ check_type: "test" }],
    };
    const result = ValidationResultPacketDetailsSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});

// ─── Top-Level ValidationResultPacket Tests ─────────────────────────────────

describe("ValidationResultPacketSchema (PRD 008 §8.10)", () => {
  /**
   * Validates the exact canonical example from §8.10.2.
   * This is the primary correctness test — the spec example MUST parse.
   */
  it("should accept the spec example from §8.10.2", () => {
    const result = ValidationResultPacketSchema.safeParse(specExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.packet_type).toBe("validation_result_packet");
      expect(result.data.task_id).toBe("task-123");
      expect(result.data.validation_run_id).toBe("validation-55");
      expect(result.data.status).toBe("success");
      expect(result.data.details.run_scope).toBe("pre-review");
      expect(result.data.details.checks).toHaveLength(2);
    }
  });

  /**
   * Validates that the inferred TypeScript type matches the schema shape.
   * If this compiles, the type inference is correct.
   */
  it("should produce a correct inferred type", () => {
    const data: ValidationResultPacket = { ...specExample };
    const result = ValidationResultPacketSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * A failed validation is a valid outcome. The orchestrator uses
   * failed validations to block state transitions.
   */
  it("should accept a failed validation", () => {
    const failed = {
      ...specExample,
      status: "failed",
      summary: "Lint check failed with 3 errors.",
      details: {
        run_scope: "pre-merge",
        checks: [
          {
            check_type: "lint",
            tool_name: "pnpm",
            command: "pnpm lint",
            status: "failed",
            duration_ms: 1500,
            summary: "3 lint errors found",
          },
        ],
      },
    };
    const result = ValidationResultPacketSchema.safeParse(failed);
    expect(result.success).toBe(true);
  });

  /**
   * All packet status values must be accepted.
   */
  it("should accept all packet status values", () => {
    for (const status of ["success", "failed", "partial", "blocked"]) {
      const packet = { ...specExample, status };
      const result = ValidationResultPacketSchema.safeParse(packet);
      expect(result.success, `should accept status ${status}`).toBe(true);
    }
  });

  /**
   * A post-merge validation run is crucial for detecting regressions
   * introduced by a merge.
   */
  it("should accept a post-merge validation run", () => {
    const postMerge = {
      ...specExample,
      details: {
        run_scope: "post-merge",
        checks: [
          {
            check_type: "test",
            tool_name: "pnpm",
            command: "pnpm test",
            status: "passed",
            duration_ms: 10000,
            summary: "100 tests passed",
          },
          {
            check_type: "build",
            tool_name: "pnpm",
            command: "pnpm build",
            status: "passed",
            duration_ms: 5000,
            summary: "Build succeeded",
          },
        ],
      },
    };
    const result = ValidationResultPacketSchema.safeParse(postMerge);
    expect(result.success).toBe(true);
  });

  // ─── Rejection tests ────────────────────────────────────────────────────

  /**
   * packet_type must be exactly "validation_result_packet". Wrong packet
   * types indicate a routing error in the orchestrator.
   */
  it("should reject wrong packet_type", () => {
    const wrong = { ...specExample, packet_type: "dev_result_packet" };
    const result = ValidationResultPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * schema_version must be exactly "1.0" for V1.
   */
  it("should reject wrong schema_version", () => {
    const wrong = { ...specExample, schema_version: "2.0" };
    const result = ValidationResultPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * created_at must be a valid ISO 8601 datetime string.
   */
  it("should reject non-ISO-8601 created_at", () => {
    const wrong = { ...specExample, created_at: "not-a-date" };
    const result = ValidationResultPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * An invalid packet status must be rejected.
   */
  it("should reject invalid status", () => {
    const wrong = { ...specExample, status: "unknown" };
    const result = ValidationResultPacketSchema.safeParse(wrong);
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
      "validation_run_id",
      "status",
      "summary",
      "details",
    ];

    for (const field of requiredFields) {
      const incomplete = { ...specExample };
      delete (incomplete as Record<string, unknown>)[field];
      const result = ValidationResultPacketSchema.safeParse(incomplete);
      expect(result.success, `should reject missing ${field}`).toBe(false);
    }
  });

  /**
   * Empty string IDs must be rejected.
   */
  it("should reject empty string task_id", () => {
    const wrong = { ...specExample, task_id: "" };
    const result = ValidationResultPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string validation_run_id must be rejected. This ID links
   * the validation result to its run for tracking and audit.
   */
  it("should reject empty string validation_run_id", () => {
    const wrong = { ...specExample, validation_run_id: "" };
    const result = ValidationResultPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string summary must be rejected.
   */
  it("should reject empty string summary", () => {
    const wrong = { ...specExample, summary: "" };
    const result = ValidationResultPacketSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});
