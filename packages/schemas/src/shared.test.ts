/**
 * Tests for shared Zod schemas used across all packet types.
 *
 * These tests validate that the three shared schemas — FileChangeSummary,
 * Issue, and ValidationCheckResult — correctly accept valid data from the
 * PRD spec examples and reject invalid data with clear error messages.
 *
 * They also verify that all domain enum re-exports produce working Zod
 * enum schemas, ensuring the integration between `@factory/domain` enums
 * and `@factory/schemas` Zod definitions is correct.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.3
 */

import { describe, it, expect } from "vitest";

import {
  FileChangeSummarySchema,
  IssueSchema,
  ValidationCheckResultSchema,
  FileChangeTypeSchema,
  IssueSeveritySchema,
  ValidationCheckTypeSchema,
  ValidationCheckStatusSchema,
  PacketTypeSchema,
  PacketStatusSchema,
  ReviewVerdictSchema,
  LeadReviewDecisionSchema,
  ConfidenceSchema,
  AgentRoleSchema,
  MergeAssistRecommendationSchema,
  PostMergeAnalysisRecommendationSchema,
  MergeStrategySchema,
} from "./shared.js";

import type { FileChangeSummary, Issue, ValidationCheckResult } from "./shared.js";

// ─── FileChangeSummary (PRD 008 §8.3.1) ─────────────────────────────────────

describe("FileChangeSummarySchema (PRD 008 §8.3.1)", () => {
  /**
   * Validates the exact example from the PRD spec.
   * Important because downstream packet schemas embed FileChangeSummary arrays,
   * so the canonical example MUST parse without error.
   */
  it("should accept the spec example from §8.3.1", () => {
    const specExample = {
      path: "apps/control-plane/src/modules/tasks/service.ts",
      change_type: "modified",
      summary: "Added readiness recomputation after dependency resolution",
    };

    const result = FileChangeSummarySchema.safeParse(specExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(specExample);
    }
  });

  /**
   * Validates each change_type enum value individually.
   * Important because DevResultPacket uses all four change types, and a
   * misconfigured enum would silently drop valid file changes.
   */
  it.each(["added", "modified", "deleted", "renamed"] as const)(
    "should accept change_type '%s'",
    (changeType) => {
      const data = {
        path: "src/test.ts",
        change_type: changeType,
        summary: "Test change",
      };
      const result = FileChangeSummarySchema.safeParse(data);
      expect(result.success).toBe(true);
    },
  );

  /**
   * Verifies that unknown change_type values are rejected.
   * Prevents silent acceptance of typos or unsupported change types that
   * could corrupt packet data.
   */
  it("should reject an invalid change_type", () => {
    const data = {
      path: "src/test.ts",
      change_type: "moved",
      summary: "Test",
    };
    const result = FileChangeSummarySchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("change_type");
    }
  });

  /**
   * Verifies that the path field cannot be empty.
   * An empty path would make the file change impossible to locate.
   */
  it("should reject an empty path", () => {
    const data = {
      path: "",
      change_type: "added",
      summary: "Test",
    };
    const result = FileChangeSummarySchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Verifies that the summary field cannot be empty.
   * Summaries are displayed to operators and must carry meaningful content.
   */
  it("should reject an empty summary", () => {
    const data = {
      path: "src/test.ts",
      change_type: "added",
      summary: "",
    };
    const result = FileChangeSummarySchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Verifies that all required fields must be present.
   * Missing fields would cause downstream packet validation to fail
   * with confusing nested errors instead of clear top-level ones.
   */
  it("should reject when required fields are missing", () => {
    const result = FileChangeSummarySchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * Verifies that the inferred TypeScript type matches the schema shape.
   * This is a compile-time guarantee backed by a runtime assertion.
   */
  it("should produce a correct inferred type", () => {
    const data: FileChangeSummary = {
      path: "src/index.ts",
      change_type: "added",
      summary: "Initial file",
    };
    const result = FileChangeSummarySchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

// ─── Issue (PRD 008 §8.3.2) ─────────────────────────────────────────────────

describe("IssueSchema (PRD 008 §8.3.2)", () => {
  const specExample = {
    severity: "high",
    code: "missing-validation",
    title: "Validation runner result not persisted",
    description:
      "The implementation finishes the run but drops machine-readable validation output.",
    file_path: "packages/application/src/validation/run.ts",
    line: 84,
    blocking: true,
  };

  /**
   * Validates the exact example from the PRD spec.
   * This is the canonical Issue shape; all review packets embed Issue arrays.
   */
  it("should accept the spec example from §8.3.2", () => {
    const result = IssueSchema.safeParse(specExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(specExample);
    }
  });

  /**
   * Validates each severity level individually.
   * Important because review routing and approval logic depend on severity
   * levels to decide whether an issue is blocking.
   */
  it.each(["critical", "high", "medium", "low"] as const)(
    "should accept severity '%s'",
    (severity) => {
      const data = { ...specExample, severity };
      const result = IssueSchema.safeParse(data);
      expect(result.success).toBe(true);
    },
  );

  /**
   * Verifies that file_path and line are truly optional.
   * Issues found during policy checks or high-level reviews may not have
   * file locations, so these fields must be omittable.
   */
  it("should accept an issue without optional file_path and line", () => {
    const data = {
      severity: "medium",
      code: "style-violation",
      title: "Inconsistent naming",
      description: "Variable names do not follow project conventions.",
      blocking: false,
    };
    const result = IssueSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.file_path).toBeUndefined();
      expect(result.data.line).toBeUndefined();
    }
  });

  /**
   * Verifies rejection of unknown severity values.
   * An invalid severity would bypass review routing rules.
   */
  it("should reject an invalid severity", () => {
    const data = { ...specExample, severity: "urgent" };
    const result = IssueSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Verifies that line must be a positive integer.
   * Line numbers are 1-based; zero or negative values indicate data corruption.
   */
  it("should reject a non-positive line number", () => {
    const data = { ...specExample, line: 0 };
    const result = IssueSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Verifies that line must be an integer (not a float).
   * Fractional line numbers are meaningless in source files.
   */
  it("should reject a fractional line number", () => {
    const data = { ...specExample, line: 84.5 };
    const result = IssueSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Verifies that negative line numbers are rejected.
   */
  it("should reject a negative line number", () => {
    const data = { ...specExample, line: -1 };
    const result = IssueSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Verifies that the blocking field is required and must be boolean.
   * Blocking status drives the approval/rejection decision in review packets.
   */
  it("should reject when blocking is missing", () => {
    const { blocking: _, ...noBlocking } = specExample;
    const result = IssueSchema.safeParse(noBlocking);
    expect(result.success).toBe(false);
  });

  /**
   * Verifies that required string fields cannot be empty.
   */
  it("should reject empty code", () => {
    const data = { ...specExample, code: "" };
    const result = IssueSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject empty title", () => {
    const data = { ...specExample, title: "" };
    const result = IssueSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject empty description", () => {
    const data = { ...specExample, description: "" };
    const result = IssueSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Verifies the inferred TypeScript type compiles correctly.
   */
  it("should produce a correct inferred type", () => {
    const data: Issue = {
      severity: "low",
      code: "test-code",
      title: "Test",
      description: "Test description",
      blocking: false,
    };
    const result = IssueSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

// ─── ValidationCheckResult (PRD 008 §8.3.3) ─────────────────────────────────

describe("ValidationCheckResultSchema (PRD 008 §8.3.3)", () => {
  const specExample = {
    check_type: "test",
    tool_name: "pnpm",
    command: "pnpm test --filter control-plane",
    status: "passed",
    duration_ms: 12450,
    summary: "42 tests passed",
  };

  /**
   * Validates the exact example from the PRD spec.
   * ValidationResultPacket embeds arrays of these; the canonical shape must parse.
   */
  it("should accept the spec example from §8.3.3", () => {
    const result = ValidationCheckResultSchema.safeParse(specExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(specExample);
    }
  });

  /**
   * Validates each check_type enum value individually.
   * The validation pipeline runs checks of all these types; each must be
   * representable in the schema.
   */
  it.each(["test", "lint", "build", "typecheck", "policy", "schema", "security"] as const)(
    "should accept check_type '%s'",
    (checkType) => {
      const data = { ...specExample, check_type: checkType };
      const result = ValidationCheckResultSchema.safeParse(data);
      expect(result.success).toBe(true);
    },
  );

  /**
   * Validates each check status value.
   */
  it.each(["passed", "failed", "skipped"] as const)("should accept status '%s'", (status) => {
    const data = { ...specExample, status };
    const result = ValidationCheckResultSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * Verifies that artifact_refs is optional and accepts string arrays.
   * Artifact references point to log files for failed checks; they are not
   * always present (e.g., skipped checks have no artifacts).
   */
  it("should accept with artifact_refs", () => {
    const data = {
      ...specExample,
      artifact_refs: ["runs/run-456/logs/test.log"],
    };
    const result = ValidationCheckResultSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.artifact_refs).toEqual(["runs/run-456/logs/test.log"]);
    }
  });

  /**
   * Verifies that artifact_refs is truly optional.
   */
  it("should accept without artifact_refs", () => {
    const result = ValidationCheckResultSchema.safeParse(specExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.artifact_refs).toBeUndefined();
    }
  });

  /**
   * Verifies that empty strings in artifact_refs are rejected.
   * An empty artifact ref would cause a broken link when trying to load the artifact.
   */
  it("should reject empty strings in artifact_refs", () => {
    const data = { ...specExample, artifact_refs: [""] };
    const result = ValidationCheckResultSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Verifies that duration_ms must be non-negative.
   * Negative durations indicate data corruption or clock skew.
   */
  it("should reject negative duration_ms", () => {
    const data = { ...specExample, duration_ms: -1 };
    const result = ValidationCheckResultSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Verifies that duration_ms accepts zero (instantaneous checks).
   */
  it("should accept zero duration_ms", () => {
    const data = { ...specExample, duration_ms: 0 };
    const result = ValidationCheckResultSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * Verifies that duration_ms must be an integer.
   * Millisecond precision is sufficient; fractional ms are not meaningful.
   */
  it("should reject fractional duration_ms", () => {
    const data = { ...specExample, duration_ms: 12.5 };
    const result = ValidationCheckResultSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Verifies rejection of invalid check_type values.
   */
  it("should reject an invalid check_type", () => {
    const data = { ...specExample, check_type: "format" };
    const result = ValidationCheckResultSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Verifies that required string fields cannot be empty.
   */
  it("should reject empty tool_name", () => {
    const data = { ...specExample, tool_name: "" };
    const result = ValidationCheckResultSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject empty command", () => {
    const data = { ...specExample, command: "" };
    const result = ValidationCheckResultSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject empty summary", () => {
    const data = { ...specExample, summary: "" };
    const result = ValidationCheckResultSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Verifies the inferred TypeScript type compiles correctly.
   */
  it("should produce a correct inferred type", () => {
    const data: ValidationCheckResult = {
      check_type: "lint",
      tool_name: "eslint",
      command: "eslint .",
      status: "passed",
      duration_ms: 500,
      summary: "No issues found",
    };
    const result = ValidationCheckResultSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

// ─── Enum Schemas ────────────────────────────────────────────────────────────

describe("Enum Schemas", () => {
  /**
   * Validates that all domain enum const-objects are correctly converted to
   * Zod enum schemas. This ensures the integration between @factory/domain
   * and @factory/schemas works for every enum used in packet definitions.
   *
   * Each test verifies that every value in the domain const-object is accepted
   * by the corresponding Zod enum schema, and that an invalid value is rejected.
   */

  const enumCases: Array<{
    name: string;
    schema: ReturnType<typeof import("zod").z.enum>;
    validValues: string[];
  }> = [
    {
      name: "FileChangeTypeSchema",
      schema: FileChangeTypeSchema,
      validValues: ["added", "modified", "deleted", "renamed"],
    },
    {
      name: "IssueSeveritySchema",
      schema: IssueSeveritySchema,
      validValues: ["critical", "high", "medium", "low"],
    },
    {
      name: "ValidationCheckTypeSchema",
      schema: ValidationCheckTypeSchema,
      validValues: ["test", "lint", "build", "typecheck", "policy", "schema", "security"],
    },
    {
      name: "ValidationCheckStatusSchema",
      schema: ValidationCheckStatusSchema,
      validValues: ["passed", "failed", "skipped"],
    },
    {
      name: "PacketTypeSchema",
      schema: PacketTypeSchema,
      validValues: [
        "task_packet",
        "dev_result_packet",
        "review_packet",
        "lead_review_decision_packet",
        "merge_packet",
        "merge_assist_packet",
        "validation_result_packet",
        "post_merge_analysis_packet",
      ],
    },
    {
      name: "PacketStatusSchema",
      schema: PacketStatusSchema,
      validValues: ["success", "failed", "partial", "blocked"],
    },
    {
      name: "ReviewVerdictSchema",
      schema: ReviewVerdictSchema,
      validValues: ["approved", "changes_requested", "escalated"],
    },
    {
      name: "LeadReviewDecisionSchema",
      schema: LeadReviewDecisionSchema,
      validValues: ["approved", "approved_with_follow_up", "changes_requested", "escalated"],
    },
    {
      name: "ConfidenceSchema",
      schema: ConfidenceSchema,
      validValues: ["high", "medium", "low"],
    },
    {
      name: "AgentRoleSchema",
      schema: AgentRoleSchema,
      validValues: [
        "planner",
        "developer",
        "reviewer",
        "lead-reviewer",
        "merge-assist",
        "post-merge-analysis",
      ],
    },
    {
      name: "MergeAssistRecommendationSchema",
      schema: MergeAssistRecommendationSchema,
      validValues: ["auto_resolve", "reject_to_dev", "escalate"],
    },
    {
      name: "PostMergeAnalysisRecommendationSchema",
      schema: PostMergeAnalysisRecommendationSchema,
      validValues: ["revert", "hotfix_task", "escalate", "pre_existing"],
    },
    {
      name: "MergeStrategySchema",
      schema: MergeStrategySchema,
      validValues: ["rebase-and-merge", "squash", "merge-commit"],
    },
  ];

  for (const { name, schema, validValues } of enumCases) {
    describe(name, () => {
      /**
       * Every value from the domain const-object must be accepted.
       * Failure here means the Zod enum is missing a value that the
       * domain layer considers valid, which would cause runtime rejections.
       */
      it.each(validValues)("should accept '%s'", (value) => {
        const result = schema.safeParse(value);
        expect(result.success).toBe(true);
      });

      /**
       * Values not in the enum must be rejected.
       * This prevents accepting arbitrary strings that could bypass
       * downstream business logic.
       */
      it("should reject an invalid value", () => {
        const result = schema.safeParse("__invalid__");
        expect(result.success).toBe(false);
      });
    });
  }
});
