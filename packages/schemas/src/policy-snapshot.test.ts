/**
 * Tests for {@link PolicySnapshotSchema} and all sub-policy schemas.
 *
 * PolicySnapshot is the resolved effective policy persisted for every run.
 * The orchestrator generates it at dispatch time and the worker receives it
 * as immutable configuration. If this schema is wrong, workers receive
 * malformed policy that could bypass security controls or misconfigure
 * validation/retry/escalation behavior.
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.2
 */

import { describe, it, expect } from "vitest";

import {
  PolicySnapshotSchema,
  CommandPolicySchema,
  FileScopePolicySchema,
  ValidationPolicySchema,
  RetryPolicySchema,
  EscalationPolicySchema,
  LeasePolicySchema,
  RetentionPolicySchema,
  ReviewPolicySchema,
  AllowedCommandSchema,
  ValidationProfileSchema,
} from "./policy-snapshot.js";
import type { PolicySnapshot } from "./policy-snapshot.js";

// ─── Spec Examples ───────────────────────────────────────────────────────────

/** Canonical CommandPolicy example from PRD 009 §9.3.2 */
const commandPolicyExample = {
  mode: "allowlist",
  allowed_commands: [
    {
      command: "pnpm",
      allowed_args_prefixes: ["install", "test", "lint", "build"],
    },
    {
      command: "git",
      allowed_args_prefixes: ["status", "diff", "show", "checkout"],
    },
  ],
  denied_patterns: ["rm -rf /", "curl * | sh", "sudo *"],
  allow_shell_compound_commands: false,
  allow_subshells: false,
  allow_env_expansion: false,
  forbidden_arg_patterns: ["git push --force", "git reset --hard"],
};

/** Canonical FileScopePolicy example from PRD 009 §9.4.1 */
const fileScopePolicyExample = {
  read_roots: ["apps/control-plane/", "packages/domain/", "docs/"],
  write_roots: ["apps/control-plane/", "packages/domain/"],
  deny_roots: [".github/workflows/", "secrets/"],
  allow_read_outside_scope: true,
  allow_write_outside_scope: false,
  on_violation: "fail_run",
};

/** Canonical ValidationPolicy example from PRD 009 §9.5.1 */
const validationPolicyExample = {
  profiles: {
    "default-dev": {
      required_checks: ["test", "lint"],
      optional_checks: ["build"],
      commands: {
        test: "pnpm test",
        lint: "pnpm lint",
        build: "pnpm build",
      },
      fail_on_skipped_required_check: true,
    },
    "merge-gate": {
      required_checks: ["test", "build"],
      optional_checks: ["lint"],
      commands: {
        test: "pnpm test",
        build: "pnpm build",
        lint: "pnpm lint",
      },
      fail_on_skipped_required_check: true,
    },
  },
};

/** Canonical RetryPolicy example from PRD 009 §9.6.1 */
const retryPolicyExample = {
  max_attempts: 2,
  backoff_strategy: "exponential",
  initial_backoff_seconds: 60,
  max_backoff_seconds: 900,
  reuse_same_pool: true,
  allow_pool_change_after_failure: true,
  require_failure_summary_packet: true,
};

/** Canonical EscalationPolicy example from PRD 009 §9.7.1 */
const escalationPolicyExample = {
  triggers: {
    max_retry_exceeded: "escalate",
    max_review_rounds_exceeded: "escalate",
    policy_violation: "escalate",
    heartbeat_timeout: "retry_or_escalate",
  },
  route_to: "operator-queue",
  require_summary: true,
};

/** Canonical LeasePolicy example from PRD 009 §9.8.1 */
const leasePolicyExample = {
  lease_ttl_seconds: 1800,
  heartbeat_interval_seconds: 30,
  missed_heartbeat_threshold: 2,
  grace_period_seconds: 15,
  reclaim_action: "mark_timed_out_and_requeue",
};

/** Canonical RetentionPolicy example from PRD 009 §9.10.1 */
const retentionPolicyExample = {
  workspace_retention_hours: 24,
  artifact_retention_days: 30,
  retain_failed_workspaces: true,
  retain_escalated_workspaces: true,
};

/** Canonical ReviewPolicy example from PRD 009 §9.9.1 */
const reviewPolicyExample = {
  max_review_rounds: 3,
  required_reviewer_types: ["general"],
  optional_reviewer_types: ["security", "performance"],
  lead_reviewer_required: true,
};

/** Full PolicySnapshot with all sub-policies populated */
const fullSnapshotExample = {
  policy_snapshot_version: "1.0" as const,
  policy_set_id: "policy-default",
  command_policy: commandPolicyExample,
  file_scope_policy: fileScopePolicyExample,
  validation_policy: validationPolicyExample,
  retry_policy: retryPolicyExample,
  escalation_policy: escalationPolicyExample,
  lease_policy: leasePolicyExample,
  retention_policy: retentionPolicyExample,
  review_policy: reviewPolicyExample,
};

// ─── Sub-Policy Schema Tests ────────────────────────────────────────────────

describe("AllowedCommandSchema (PRD 009 §9.3.2)", () => {
  /**
   * Validates a single allowed command entry. Each entry pairs a command
   * name with permitted argument prefixes.
   */
  it("should accept a valid allowed command", () => {
    const result = AllowedCommandSchema.safeParse(commandPolicyExample.allowed_commands[0]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.command).toBe("pnpm");
      expect(result.data.allowed_args_prefixes).toContain("test");
    }
  });

  /**
   * Empty command name must be rejected. The command is the executable
   * being allowed.
   */
  it("should reject empty command", () => {
    const wrong = { command: "", allowed_args_prefixes: [] };
    const result = AllowedCommandSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});

describe("CommandPolicySchema (PRD 009 §9.3)", () => {
  /**
   * Validates the canonical command policy from §9.3.2.
   */
  it("should accept the spec example from §9.3.2", () => {
    const result = CommandPolicySchema.safeParse(commandPolicyExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("allowlist");
      expect(result.data.allowed_commands).toHaveLength(2);
      expect(result.data.allow_shell_compound_commands).toBe(false);
    }
  });
});

describe("FileScopePolicySchema (PRD 009 §9.4)", () => {
  /**
   * Validates the canonical file scope policy from §9.4.1.
   */
  it("should accept the spec example from §9.4.1", () => {
    const result = FileScopePolicySchema.safeParse(fileScopePolicyExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.read_roots).toContain("docs/");
      expect(result.data.allow_write_outside_scope).toBe(false);
      expect(result.data.on_violation).toBe("fail_run");
    }
  });

  /**
   * Empty on_violation must be rejected. The violation action
   * determines what happens when a worker breaches file scope.
   */
  it("should reject empty on_violation", () => {
    const wrong = { ...fileScopePolicyExample, on_violation: "" };
    const result = FileScopePolicySchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});

describe("ValidationProfileSchema (PRD 009 §9.5.1)", () => {
  /**
   * Validates a single validation profile.
   */
  it("should accept a valid profile", () => {
    const result = ValidationProfileSchema.safeParse(
      validationPolicyExample.profiles["default-dev"],
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.required_checks).toContain("test");
      expect(result.data.fail_on_skipped_required_check).toBe(true);
    }
  });
});

describe("ValidationPolicySchema (PRD 009 §9.5)", () => {
  /**
   * Validates the canonical validation policy with multiple profiles.
   */
  it("should accept the spec example from §9.5.1", () => {
    const result = ValidationPolicySchema.safeParse(validationPolicyExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data.profiles)).toHaveLength(2);
    }
  });
});

describe("RetryPolicySchema (PRD 009 §9.6)", () => {
  /**
   * Validates the canonical retry policy from §9.6.1.
   */
  it("should accept the spec example from §9.6.1", () => {
    const result = RetryPolicySchema.safeParse(retryPolicyExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_attempts).toBe(2);
      expect(result.data.backoff_strategy).toBe("exponential");
    }
  });

  /**
   * Negative max_attempts must be rejected.
   */
  it("should reject negative max_attempts", () => {
    const wrong = { ...retryPolicyExample, max_attempts: -1 };
    const result = RetryPolicySchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});

describe("EscalationPolicySchema (PRD 009 §9.7)", () => {
  /**
   * Validates the canonical escalation policy from §9.7.1.
   */
  it("should accept the spec example from §9.7.1", () => {
    const result = EscalationPolicySchema.safeParse(escalationPolicyExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.route_to).toBe("operator-queue");
      expect(result.data.require_summary).toBe(true);
    }
  });

  /**
   * Empty route_to must be rejected. The route determines where
   * escalations are sent.
   */
  it("should reject empty route_to", () => {
    const wrong = { ...escalationPolicyExample, route_to: "" };
    const result = EscalationPolicySchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});

describe("LeasePolicySchema (PRD 009 §9.8)", () => {
  /**
   * Validates the canonical lease policy from §9.8.1.
   */
  it("should accept the spec example from §9.8.1", () => {
    const result = LeasePolicySchema.safeParse(leasePolicyExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lease_ttl_seconds).toBe(1800);
      expect(result.data.heartbeat_interval_seconds).toBe(30);
    }
  });

  /**
   * Zero or negative lease_ttl_seconds must be rejected.
   */
  it("should reject zero lease_ttl_seconds", () => {
    const wrong = { ...leasePolicyExample, lease_ttl_seconds: 0 };
    const result = LeasePolicySchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});

describe("RetentionPolicySchema (PRD 009 §9.10)", () => {
  /**
   * Validates the canonical retention policy from §9.10.1.
   */
  it("should accept the spec example from §9.10.1", () => {
    const result = RetentionPolicySchema.safeParse(retentionPolicyExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.workspace_retention_hours).toBe(24);
      expect(result.data.retain_failed_workspaces).toBe(true);
    }
  });
});

describe("ReviewPolicySchema (PRD 009 §9.9)", () => {
  /**
   * Validates the canonical review policy from §9.9.1.
   */
  it("should accept the spec example from §9.9.1", () => {
    const result = ReviewPolicySchema.safeParse(reviewPolicyExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_review_rounds).toBe(3);
      expect(result.data.lead_reviewer_required).toBe(true);
    }
  });

  /**
   * Zero max_review_rounds must be rejected — at least one round
   * is needed.
   */
  it("should reject zero max_review_rounds", () => {
    const wrong = { ...reviewPolicyExample, max_review_rounds: 0 };
    const result = ReviewPolicySchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});

// ─── Top-Level PolicySnapshot Tests ─────────────────────────────────────────

describe("PolicySnapshotSchema (PRD 009 §9.2)", () => {
  /**
   * Validates a full policy snapshot with all sub-policies populated.
   * This is the primary correctness test — a fully-populated snapshot
   * MUST parse.
   */
  it("should accept a full snapshot with all sub-policies", () => {
    const result = PolicySnapshotSchema.safeParse(fullSnapshotExample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.policy_snapshot_version).toBe("1.0");
      expect(result.data.policy_set_id).toBe("policy-default");
      expect(result.data.command_policy).toBeDefined();
      expect(result.data.file_scope_policy).toBeDefined();
      expect(result.data.validation_policy).toBeDefined();
      expect(result.data.retry_policy).toBeDefined();
      expect(result.data.escalation_policy).toBeDefined();
      expect(result.data.lease_policy).toBeDefined();
      expect(result.data.retention_policy).toBeDefined();
      expect(result.data.review_policy).toBeDefined();
    }
  });

  /**
   * Validates that the inferred TypeScript type matches the schema shape.
   * If this compiles, the type inference is correct.
   */
  it("should produce a correct inferred type", () => {
    const data: PolicySnapshot = { ...fullSnapshotExample };
    const result = PolicySnapshotSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  /**
   * A minimal snapshot with only required fields and no sub-policies
   * is valid. Sub-policies are optional because the snapshot reflects
   * the resolved policy — only applicable policies are included.
   */
  it("should accept a minimal snapshot with no sub-policies", () => {
    const minimal = {
      policy_snapshot_version: "1.0" as const,
      policy_set_id: "policy-minimal",
    };
    const result = PolicySnapshotSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.command_policy).toBeUndefined();
      expect(result.data.file_scope_policy).toBeUndefined();
    }
  });

  /**
   * A snapshot with only some sub-policies is valid. Not all policy
   * dimensions need to be populated.
   */
  it("should accept a snapshot with partial sub-policies", () => {
    const partial = {
      policy_snapshot_version: "1.0" as const,
      policy_set_id: "policy-partial",
      command_policy: commandPolicyExample,
      lease_policy: leasePolicyExample,
    };
    const result = PolicySnapshotSchema.safeParse(partial);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.command_policy).toBeDefined();
      expect(result.data.lease_policy).toBeDefined();
      expect(result.data.validation_policy).toBeUndefined();
    }
  });

  // ─── Rejection tests ────────────────────────────────────────────────────

  /**
   * policy_snapshot_version must be exactly "1.0" for V1.
   */
  it("should reject wrong policy_snapshot_version", () => {
    const wrong = { ...fullSnapshotExample, policy_snapshot_version: "2.0" };
    const result = PolicySnapshotSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Empty string policy_set_id must be rejected. This ID links the
   * snapshot to the policy set it was resolved from.
   */
  it("should reject empty string policy_set_id", () => {
    const wrong = { ...fullSnapshotExample, policy_set_id: "" };
    const result = PolicySnapshotSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Missing policy_snapshot_version must be rejected.
   */
  it("should reject missing policy_snapshot_version", () => {
    const { policy_snapshot_version: _, ...incomplete } = fullSnapshotExample;
    const result = PolicySnapshotSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  /**
   * Missing policy_set_id must be rejected.
   */
  it("should reject missing policy_set_id", () => {
    const { policy_set_id: _, ...incomplete } = fullSnapshotExample;
    const result = PolicySnapshotSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  /**
   * Malformed sub-policies must be rejected. Each sub-policy has its
   * own required structure.
   */
  it("should reject malformed command_policy", () => {
    const wrong = {
      ...fullSnapshotExample,
      command_policy: { mode: "allowlist" },
    };
    const result = PolicySnapshotSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  /**
   * Malformed validation_policy must be rejected.
   */
  it("should reject malformed validation_policy", () => {
    const wrong = {
      ...fullSnapshotExample,
      validation_policy: { profiles: "not-an-object" },
    };
    const result = PolicySnapshotSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});
