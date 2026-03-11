/**
 * Tests for {@link TaskPacketSchema} and its nested sub-schemas.
 *
 * TaskPacket is the canonical input to ALL worker stages. If this schema
 * is wrong, the orchestrator will dispatch malformed packets and workers
 * will fail or produce incorrect results. Every field constraint is tested
 * against the spec examples and edge cases.
 *
 * @see {@link file://docs/prd/008-packet-and-schema-spec.md} §8.4
 */

import { describe, it, expect } from "vitest";

import {
  TaskPacketSchema,
  TaskPacketTaskSchema,
  TaskPacketRepositorySchema,
  TaskPacketWorkspaceSchema,
  TaskPacketContextSchema,
  TaskPacketRepoPolicySchema,
  TaskPacketToolPolicySchema,
  TaskPacketValidationRequirementsSchema,
  TaskPacketExpectedOutputSchema,
} from "./task-packet.js";
import type { TaskPacket } from "./task-packet.js";

// ─── Spec Example ────────────────────────────────────────────────────────────

/** Canonical TaskPacket example from PRD 008 §8.4.2 */
const specExample = {
  packet_type: "task_packet" as const,
  schema_version: "1.0" as const,
  created_at: "2026-03-10T00:00:00Z",
  task_id: "task-123",
  repository_id: "repo-1",
  task: {
    title: "Implement lease expiry reconciliation",
    description: "Recover stale task leases and reschedule timed-out work.",
    task_type: "backend-feature",
    priority: "high",
    severity: "medium",
    acceptance_criteria: [
      "Reclaim expired leases deterministically",
      "Emit audit events on reclaim",
    ],
    definition_of_done: ["Implementation complete", "Required validations pass"],
    risk_level: "medium",
    suggested_file_scope: [
      "apps/control-plane/src/modules/leases/**",
      "packages/domain/src/leases/**",
    ],
    branch_name: "factory/task-123",
  },
  repository: {
    name: "software-factory",
    default_branch: "main",
  },
  role: "developer",
  time_budget_seconds: 1800,
  expires_at: "2026-03-10T00:30:00Z",
  workspace: {
    worktree_path: "/workspaces/repo-1/task-123/worktree",
    artifact_root: "/artifacts/repositories/repo-1/tasks/task-123",
  },
  context: {
    related_tasks: [] as string[],
    dependencies: [] as string[],
    rejection_context: null,
    code_map_refs: [] as string[],
    prior_partial_work: null,
  },
  repo_policy: {
    policy_set_id: "policy-default",
  },
  tool_policy: {
    command_policy_id: "cmd-default",
    file_scope_policy_id: "scope-task-default",
  },
  validation_requirements: {
    profile: "default-dev",
  },
  stop_conditions: [
    "Return a schema-valid output packet",
    "Do not broaden scope outside suggested file scope without declaring it",
  ],
  expected_output: {
    packet_type: "dev_result_packet",
    schema_version: "1.0",
  },
};

// ─── Top-Level TaskPacket Tests ──────────────────────────────────────────────

describe("TaskPacketSchema (PRD 008 §8.4)", () => {
  /**
   * Validates the exact canonical example from §8.4.2.
   * This is the most critical test — if the spec example doesn't parse,
   * the schema is fundamentally wrong.
   */
  it("should accept the spec example from §8.4.2", () => {
    const result = TaskPacketSchema.safeParse(specExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.packet_type).toBe("task_packet");
      expect(result.data.task_id).toBe("task-123");
      expect(result.data.role).toBe("developer");
    }
  });

  /**
   * Validates that the inferred TypeScript type matches the schema shape.
   * Catches type-level regressions that runtime tests miss.
   */
  it("should produce a correct inferred type", () => {
    const data: TaskPacket = { ...specExample };
    const result = TaskPacketSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * All six agent roles must be accepted. Each role receives a TaskPacket,
   * so every valid role value must parse.
   */
  it.each([
    "planner",
    "developer",
    "reviewer",
    "lead-reviewer",
    "merge-assist",
    "post-merge-analysis",
  ] as const)("should accept role '%s'", (role) => {
    const data = { ...specExample, role };
    const result = TaskPacketSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * Invalid roles must be rejected. Dispatching to an unknown role would
   * leave the task in limbo.
   */
  it("should reject an invalid role", () => {
    const data = { ...specExample, role: "tester" };
    const result = TaskPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("role");
    }
  });

  /**
   * packet_type must be the literal "task_packet". Any other value indicates
   * the wrong packet type was dispatched.
   */
  it("should reject a wrong packet_type", () => {
    const data = { ...specExample, packet_type: "dev_result_packet" };
    const result = TaskPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * schema_version must be the literal "1.0". Rejecting other versions
   * prevents silent misinterpretation of newer schemas.
   */
  it("should reject a wrong schema_version", () => {
    const data = { ...specExample, schema_version: "2.0" };
    const result = TaskPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * created_at must be a valid ISO 8601 datetime. Malformed timestamps
   * break sorting, expiry comparison, and audit trails.
   */
  it("should reject a non-ISO-8601 created_at", () => {
    const data = { ...specExample, created_at: "not-a-date" };
    const result = TaskPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * expires_at must be a valid ISO 8601 datetime.
   */
  it("should reject a non-ISO-8601 expires_at", () => {
    const data = { ...specExample, expires_at: "tomorrow" };
    const result = TaskPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * time_budget_seconds must be a positive integer. Zero or negative
   * budgets are nonsensical for worker dispatch.
   */
  it("should reject zero time_budget_seconds", () => {
    const data = { ...specExample, time_budget_seconds: 0 };
    const result = TaskPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject negative time_budget_seconds", () => {
    const data = { ...specExample, time_budget_seconds: -100 };
    const result = TaskPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject fractional time_budget_seconds", () => {
    const data = { ...specExample, time_budget_seconds: 1800.5 };
    const result = TaskPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Empty task_id must be rejected. Task identity is required for
   * all state machine transitions.
   */
  it("should reject an empty task_id", () => {
    const data = { ...specExample, task_id: "" };
    const result = TaskPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Empty repository_id must be rejected.
   */
  it("should reject an empty repository_id", () => {
    const data = { ...specExample, repository_id: "" };
    const result = TaskPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * stop_conditions must have at least one entry. Workers without stop
   * conditions have no defined termination criteria.
   */
  it("should reject an empty stop_conditions array", () => {
    const data = { ...specExample, stop_conditions: [] };
    const result = TaskPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Missing required top-level fields must be rejected.
   */
  it("should reject missing task_id", () => {
    const { task_id: _, ...data } = specExample;
    const result = TaskPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject missing role", () => {
    const { role: _, ...data } = specExample;
    const result = TaskPacketSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * A TaskPacket with rejection_context for a rework attempt must validate.
   * This proves the nullable RejectionContext integration works end-to-end.
   */
  it("should accept a rework packet with rejection_context", () => {
    const data = {
      ...specExample,
      context: {
        ...specExample.context,
        rejection_context: {
          prior_review_cycle_id: "review-1",
          blocking_issues: [
            {
              severity: "high",
              code: "unsafe-shell",
              title: "Bypasses allowlist",
              description: "Raw shell execution.",
              blocking: true,
            },
          ],
          lead_decision_summary: "Fix security issue.",
        },
      },
    };
    const result = TaskPacketSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * Context with populated related_tasks and dependencies should validate.
   */
  it("should accept context with related_tasks and dependencies", () => {
    const data = {
      ...specExample,
      context: {
        ...specExample.context,
        related_tasks: ["task-100", "task-101"],
        dependencies: ["task-50"],
        code_map_refs: ["maps/module-a.json"],
      },
    };
    const result = TaskPacketSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

// ─── Nested Schema Tests ─────────────────────────────────────────────────────

describe("TaskPacketTaskSchema (PRD 008 §8.4.2 task)", () => {
  const taskData = specExample.task;

  /**
   * The spec's task section must parse. This sub-schema is reused across
   * all six role variants of TaskPacket.
   */
  it("should accept the spec example task section", () => {
    const result = TaskPacketTaskSchema.safeParse(taskData);
    expect(result.success).toBe(true);
  });

  /**
   * All seven domain task types should be accepted as valid strings.
   */
  it.each([
    "feature",
    "bug_fix",
    "refactor",
    "chore",
    "documentation",
    "test",
    "spike",
    "backend-feature",
  ] as const)("should accept task_type '%s'", (taskType) => {
    const data = { ...taskData, task_type: taskType };
    const result = TaskPacketTaskSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("should reject an empty task_type", () => {
    const data = { ...taskData, task_type: "" };
    const result = TaskPacketTaskSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Common priority values should be accepted as free-form strings.
   */
  it.each(["critical", "high", "medium", "low"] as const)(
    "should accept priority '%s'",
    (priority) => {
      const data = { ...taskData, priority };
      const result = TaskPacketTaskSchema.safeParse(data);
      expect(result.success).toBe(true);
    },
  );

  it("should reject an empty priority", () => {
    const data = { ...taskData, priority: "" };
    const result = TaskPacketTaskSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  /**
   * Common severity values should be accepted as free-form strings.
   */
  it.each(["critical", "high", "medium", "low"] as const)(
    "should accept severity '%s'",
    (severity) => {
      const data = { ...taskData, severity };
      const result = TaskPacketTaskSchema.safeParse(data);
      expect(result.success).toBe(true);
    },
  );

  /**
   * All three risk levels must be accepted.
   */
  it.each(["high", "medium", "low"] as const)("should accept risk_level '%s'", (riskLevel) => {
    const data = { ...taskData, risk_level: riskLevel };
    const result = TaskPacketTaskSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("should reject an empty title", () => {
    const data = { ...taskData, title: "" };
    const result = TaskPacketTaskSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject an empty description", () => {
    const data = { ...taskData, description: "" };
    const result = TaskPacketTaskSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject an empty branch_name", () => {
    const data = { ...taskData, branch_name: "" };
    const result = TaskPacketTaskSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should accept empty acceptance_criteria and definition_of_done arrays", () => {
    const data = {
      ...taskData,
      acceptance_criteria: [],
      definition_of_done: [],
    };
    const result = TaskPacketTaskSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe("TaskPacketRepositorySchema (PRD 008 §8.4.2 repository)", () => {
  const repoData = specExample.repository;

  it("should accept the spec example repository section", () => {
    const result = TaskPacketRepositorySchema.safeParse(repoData);
    expect(result.success).toBe(true);
  });

  it("should reject an empty name", () => {
    const data = { ...repoData, name: "" };
    const result = TaskPacketRepositorySchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject an empty default_branch", () => {
    const data = { ...repoData, default_branch: "" };
    const result = TaskPacketRepositorySchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("TaskPacketWorkspaceSchema (PRD 008 §8.4.2 workspace)", () => {
  const wsData = specExample.workspace;

  it("should accept the spec example workspace section", () => {
    const result = TaskPacketWorkspaceSchema.safeParse(wsData);
    expect(result.success).toBe(true);
  });

  it("should reject an empty worktree_path", () => {
    const data = { ...wsData, worktree_path: "" };
    const result = TaskPacketWorkspaceSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject an empty artifact_root", () => {
    const data = { ...wsData, artifact_root: "" };
    const result = TaskPacketWorkspaceSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("TaskPacketContextSchema (PRD 008 §8.4.2 context)", () => {
  const ctxData = specExample.context;

  it("should accept the spec example context section (null rejection_context)", () => {
    const result = TaskPacketContextSchema.safeParse(ctxData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rejection_context).toBeNull();
      expect(result.data.prior_partial_work).toBeNull();
    }
  });

  /**
   * A context with a valid RejectionContext must parse. This tests the
   * nullable integration between the two schemas.
   */
  it("should accept context with a valid rejection_context", () => {
    const data = {
      ...ctxData,
      rejection_context: {
        prior_review_cycle_id: "review-1",
        blocking_issues: [
          {
            severity: "high",
            code: "x",
            title: "T",
            description: "D",
            blocking: true,
          },
        ],
        lead_decision_summary: "Fix it.",
      },
    };
    const result = TaskPacketContextSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * An invalid rejection_context must be rejected even though the field
   * is nullable — null is valid, but a malformed object is not.
   */
  it("should reject an invalid rejection_context object", () => {
    const data = {
      ...ctxData,
      rejection_context: { prior_review_cycle_id: "" },
    };
    const result = TaskPacketContextSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("TaskPacketRepoPolicySchema (PRD 008 §8.4.2 repo_policy)", () => {
  it("should accept the spec example", () => {
    const result = TaskPacketRepoPolicySchema.safeParse(specExample.repo_policy);
    expect(result.success).toBe(true);
  });

  it("should reject an empty policy_set_id", () => {
    const result = TaskPacketRepoPolicySchema.safeParse({ policy_set_id: "" });
    expect(result.success).toBe(false);
  });
});

describe("TaskPacketToolPolicySchema (PRD 008 §8.4.2 tool_policy)", () => {
  it("should accept the spec example", () => {
    const result = TaskPacketToolPolicySchema.safeParse(specExample.tool_policy);
    expect(result.success).toBe(true);
  });

  it("should reject an empty command_policy_id", () => {
    const data = { ...specExample.tool_policy, command_policy_id: "" };
    const result = TaskPacketToolPolicySchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("should reject an empty file_scope_policy_id", () => {
    const data = { ...specExample.tool_policy, file_scope_policy_id: "" };
    const result = TaskPacketToolPolicySchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("TaskPacketValidationRequirementsSchema (PRD 008 §8.4.2 validation_requirements)", () => {
  it("should accept the spec example", () => {
    const result = TaskPacketValidationRequirementsSchema.safeParse(
      specExample.validation_requirements,
    );
    expect(result.success).toBe(true);
  });

  it("should reject an empty profile", () => {
    const result = TaskPacketValidationRequirementsSchema.safeParse({
      profile: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("TaskPacketExpectedOutputSchema (PRD 008 §8.4.2 expected_output)", () => {
  it("should accept the spec example", () => {
    const result = TaskPacketExpectedOutputSchema.safeParse(specExample.expected_output);
    expect(result.success).toBe(true);
  });

  it("should reject an empty packet_type", () => {
    const result = TaskPacketExpectedOutputSchema.safeParse({
      packet_type: "",
      schema_version: "1.0",
    });
    expect(result.success).toBe(false);
  });

  it("should reject an empty schema_version", () => {
    const result = TaskPacketExpectedOutputSchema.safeParse({
      packet_type: "dev_result_packet",
      schema_version: "",
    });
    expect(result.success).toBe(false);
  });
});
