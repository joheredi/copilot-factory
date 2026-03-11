/**
 * Tests for escalation policy model and trigger evaluation.
 *
 * Validates that escalation evaluation follows PRD §9.7 exactly:
 * - All seven trigger cases from §9.7.2 are supported
 * - Threshold-based triggers check context values before firing
 * - Unconditional triggers always fire when invoked
 * - Unknown triggers default to "escalate" (fail-safe)
 * - Default policy matches the canonical shape from §9.7.1
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.7
 * @module @factory/domain/policies/escalation-policy.test
 */

import { describe, it, expect } from "vitest";
import {
  EscalationTrigger,
  type EscalationPolicy,
  type EscalationEvaluationContext,
  DEFAULT_ESCALATION_POLICY,
  shouldEscalate,
  getTriggerAction,
  getConfiguredTriggers,
  createDefaultEscalationPolicy,
} from "./escalation-policy.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Custom policy with different routing for testing. */
const CUSTOM_POLICY: EscalationPolicy = {
  triggers: {
    [EscalationTrigger.MAX_RETRY_EXCEEDED]: "fail_then_escalate",
    [EscalationTrigger.MAX_REVIEW_ROUNDS_EXCEEDED]: "escalate",
    [EscalationTrigger.POLICY_VIOLATION]: "escalate",
    [EscalationTrigger.MERGE_FAILURE_AFTER_RETRIES]: "fail_then_escalate",
    [EscalationTrigger.HEARTBEAT_TIMEOUT]: "retry_or_escalate",
    [EscalationTrigger.SCHEMA_VALIDATION_FAILURE]: "fail_then_escalate",
    [EscalationTrigger.REPEATED_SCHEMA_FAILURES]: "disable_profile_and_escalate",
  },
  route_to: "custom-queue",
  require_summary: false,
};

// ===========================================================================
// EscalationTrigger enum
// ===========================================================================

describe("EscalationTrigger", () => {
  /**
   * Validates that all seven trigger types from PRD §9.7.2 are defined.
   * These are the minimum required triggers for V1. Missing triggers would
   * cause runtime failures when the orchestrator tries to evaluate them.
   */
  it("should define all seven trigger types from §9.7.2", () => {
    expect(EscalationTrigger.MAX_RETRY_EXCEEDED).toBe("max_retry_exceeded");
    expect(EscalationTrigger.MAX_REVIEW_ROUNDS_EXCEEDED).toBe("max_review_rounds_exceeded");
    expect(EscalationTrigger.POLICY_VIOLATION).toBe("policy_violation");
    expect(EscalationTrigger.MERGE_FAILURE_AFTER_RETRIES).toBe("merge_failure_after_retries");
    expect(EscalationTrigger.HEARTBEAT_TIMEOUT).toBe("heartbeat_timeout");
    expect(EscalationTrigger.SCHEMA_VALIDATION_FAILURE).toBe("schema_validation_failure");
    expect(EscalationTrigger.REPEATED_SCHEMA_FAILURES).toBe("repeated_schema_failures");
  });

  /**
   * Ensures exactly seven triggers exist — no more, no fewer.
   * Adding a trigger requires updating the PRD and policy snapshot schema.
   */
  it("should have exactly 7 trigger types", () => {
    const triggers = Object.values(EscalationTrigger);
    expect(triggers).toHaveLength(7);
  });
});

// ===========================================================================
// DEFAULT_ESCALATION_POLICY
// ===========================================================================

describe("DEFAULT_ESCALATION_POLICY", () => {
  /**
   * Verifies the default policy matches PRD §9.7.1 canonical shape.
   * This is the source of truth for escalation behavior when no
   * project-level overrides are configured.
   */
  it("should route to operator-queue", () => {
    expect(DEFAULT_ESCALATION_POLICY.route_to).toBe("operator-queue");
  });

  it("should require summary", () => {
    expect(DEFAULT_ESCALATION_POLICY.require_summary).toBe(true);
  });

  /**
   * All seven triggers must have configured actions in the default policy.
   * Missing triggers would cause undefined behavior at evaluation time.
   */
  it("should have actions for all seven triggers", () => {
    const triggers = Object.keys(DEFAULT_ESCALATION_POLICY.triggers);
    expect(triggers).toHaveLength(7);

    // Verify each trigger maps to a valid action
    for (const trigger of Object.values(EscalationTrigger)) {
      expect(DEFAULT_ESCALATION_POLICY.triggers[trigger]).toBeDefined();
    }
  });
});

// ===========================================================================
// createDefaultEscalationPolicy
// ===========================================================================

describe("createDefaultEscalationPolicy", () => {
  /**
   * Ensures the factory returns a deep enough copy to prevent mutation
   * of the shared default constant. The triggers map must also be copied.
   */
  it("should return a copy of DEFAULT_ESCALATION_POLICY", () => {
    const policy = createDefaultEscalationPolicy();
    expect(policy).toEqual(DEFAULT_ESCALATION_POLICY);
    expect(policy).not.toBe(DEFAULT_ESCALATION_POLICY);
    expect(policy.triggers).not.toBe(DEFAULT_ESCALATION_POLICY.triggers);
  });
});

// ===========================================================================
// shouldEscalate — threshold-based triggers
// ===========================================================================

describe("shouldEscalate", () => {
  // -------------------------------------------------------------------------
  // max_retry_exceeded
  // -------------------------------------------------------------------------

  describe("MAX_RETRY_EXCEEDED trigger", () => {
    /**
     * When retry_count equals max_attempts, retries are exhausted and
     * escalation should fire. This is the primary entry point into
     * escalation after repeated failures.
     */
    it("should escalate when retry_count equals max_attempts", () => {
      const result = shouldEscalate(
        { trigger: EscalationTrigger.MAX_RETRY_EXCEEDED, retry_count: 2, max_attempts: 2 },
        DEFAULT_ESCALATION_POLICY,
      );
      expect(result.should_escalate).toBe(true);
      expect(result.action).toBe("escalate");
      expect(result.route_to).toBe("operator-queue");
      expect(result.require_summary).toBe(true);
    });

    /**
     * When retry_count exceeds max_attempts (defensive case), should
     * still escalate.
     */
    it("should escalate when retry_count exceeds max_attempts", () => {
      const result = shouldEscalate(
        { trigger: EscalationTrigger.MAX_RETRY_EXCEEDED, retry_count: 5, max_attempts: 2 },
        DEFAULT_ESCALATION_POLICY,
      );
      expect(result.should_escalate).toBe(true);
    });

    /**
     * When retries are NOT exhausted, escalation should not fire.
     * The task should be retried instead.
     */
    it("should not escalate when retries remain", () => {
      const result = shouldEscalate(
        { trigger: EscalationTrigger.MAX_RETRY_EXCEEDED, retry_count: 0, max_attempts: 2 },
        DEFAULT_ESCALATION_POLICY,
      );
      expect(result.should_escalate).toBe(false);
      expect(result.reason).toContain("has not reached");
    });

    /**
     * Fail-safe: when context is missing retry_count or max_attempts,
     * should escalate rather than silently skip.
     */
    it("should escalate when context is missing retry data (fail-safe)", () => {
      const result = shouldEscalate(
        { trigger: EscalationTrigger.MAX_RETRY_EXCEEDED },
        DEFAULT_ESCALATION_POLICY,
      );
      expect(result.should_escalate).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // max_review_rounds_exceeded
  // -------------------------------------------------------------------------

  describe("MAX_REVIEW_ROUNDS_EXCEEDED trigger", () => {
    /**
     * When review rounds are exhausted, the task is stuck in a review
     * loop and must be escalated to a human.
     */
    it("should escalate when review_round equals max_review_rounds", () => {
      const result = shouldEscalate(
        {
          trigger: EscalationTrigger.MAX_REVIEW_ROUNDS_EXCEEDED,
          review_round: 3,
          max_review_rounds: 3,
        },
        DEFAULT_ESCALATION_POLICY,
      );
      expect(result.should_escalate).toBe(true);
      expect(result.action).toBe("escalate");
    });

    /**
     * When review rounds remain, should not escalate.
     */
    it("should not escalate when review rounds remain", () => {
      const result = shouldEscalate(
        {
          trigger: EscalationTrigger.MAX_REVIEW_ROUNDS_EXCEEDED,
          review_round: 1,
          max_review_rounds: 3,
        },
        DEFAULT_ESCALATION_POLICY,
      );
      expect(result.should_escalate).toBe(false);
    });

    /**
     * Fail-safe: missing review round data triggers escalation.
     */
    it("should escalate when context is missing review data (fail-safe)", () => {
      const result = shouldEscalate(
        { trigger: EscalationTrigger.MAX_REVIEW_ROUNDS_EXCEEDED },
        DEFAULT_ESCALATION_POLICY,
      );
      expect(result.should_escalate).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // repeated_schema_failures
  // -------------------------------------------------------------------------

  describe("REPEATED_SCHEMA_FAILURES trigger", () => {
    /**
     * When schema failures reach the threshold, the agent profile is
     * presumably broken and should be disabled + escalated.
     */
    it("should escalate when schema_failure_count reaches threshold", () => {
      const result = shouldEscalate(
        {
          trigger: EscalationTrigger.REPEATED_SCHEMA_FAILURES,
          schema_failure_count: 3,
          schema_failure_threshold: 3,
        },
        DEFAULT_ESCALATION_POLICY,
      );
      expect(result.should_escalate).toBe(true);
      expect(result.action).toBe("disable_profile_and_escalate");
    });

    /**
     * Below threshold, do not escalate — allow more attempts.
     */
    it("should not escalate when below threshold", () => {
      const result = shouldEscalate(
        {
          trigger: EscalationTrigger.REPEATED_SCHEMA_FAILURES,
          schema_failure_count: 1,
          schema_failure_threshold: 3,
        },
        DEFAULT_ESCALATION_POLICY,
      );
      expect(result.should_escalate).toBe(false);
    });

    /**
     * Fail-safe: missing schema failure data triggers escalation.
     */
    it("should escalate when context is missing schema data (fail-safe)", () => {
      const result = shouldEscalate(
        { trigger: EscalationTrigger.REPEATED_SCHEMA_FAILURES },
        DEFAULT_ESCALATION_POLICY,
      );
      expect(result.should_escalate).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Unconditional triggers
  // -------------------------------------------------------------------------

  describe("unconditional triggers", () => {
    /**
     * POLICY_VIOLATION always fires — the caller has already determined
     * a security-sensitive policy was violated.
     */
    it("should always escalate on POLICY_VIOLATION", () => {
      const result = shouldEscalate(
        { trigger: EscalationTrigger.POLICY_VIOLATION },
        DEFAULT_ESCALATION_POLICY,
      );
      expect(result.should_escalate).toBe(true);
      expect(result.action).toBe("escalate");
      expect(result.reason).toContain("policy violation");
    });

    /**
     * MERGE_FAILURE_AFTER_RETRIES always fires — merges have already
     * been retried and failed.
     */
    it("should always escalate on MERGE_FAILURE_AFTER_RETRIES", () => {
      const result = shouldEscalate(
        { trigger: EscalationTrigger.MERGE_FAILURE_AFTER_RETRIES },
        DEFAULT_ESCALATION_POLICY,
      );
      expect(result.should_escalate).toBe(true);
      expect(result.reason).toContain("Merge failed");
    });

    /**
     * HEARTBEAT_TIMEOUT always fires — the worker is unresponsive.
     * The action is "retry_or_escalate" by default, meaning the
     * orchestrator should check retry eligibility first.
     */
    it("should always escalate on HEARTBEAT_TIMEOUT with retry_or_escalate action", () => {
      const result = shouldEscalate(
        { trigger: EscalationTrigger.HEARTBEAT_TIMEOUT },
        DEFAULT_ESCALATION_POLICY,
      );
      expect(result.should_escalate).toBe(true);
      expect(result.action).toBe("retry_or_escalate");
      expect(result.reason).toContain("heartbeat timeout");
    });

    /**
     * SCHEMA_VALIDATION_FAILURE always fires for a single occurrence.
     * This differs from REPEATED_SCHEMA_FAILURES which has a threshold.
     */
    it("should always escalate on SCHEMA_VALIDATION_FAILURE", () => {
      const result = shouldEscalate(
        { trigger: EscalationTrigger.SCHEMA_VALIDATION_FAILURE },
        DEFAULT_ESCALATION_POLICY,
      );
      expect(result.should_escalate).toBe(true);
      expect(result.reason).toContain("schema validation");
    });
  });

  // -------------------------------------------------------------------------
  // Custom policy routing
  // -------------------------------------------------------------------------

  describe("custom policy", () => {
    /**
     * Verifies that custom policies override the default routing and
     * action settings. This ensures the hierarchical config resolution
     * from §9.12 can customize escalation behavior.
     */
    it("should use custom route_to and require_summary", () => {
      const result = shouldEscalate({ trigger: EscalationTrigger.POLICY_VIOLATION }, CUSTOM_POLICY);
      expect(result.route_to).toBe("custom-queue");
      expect(result.require_summary).toBe(false);
    });

    /**
     * Custom policies can map triggers to different actions.
     * MAX_RETRY_EXCEEDED → fail_then_escalate in custom policy
     * (vs "escalate" in default).
     */
    it("should use custom trigger action mapping", () => {
      const result = shouldEscalate(
        { trigger: EscalationTrigger.MAX_RETRY_EXCEEDED, retry_count: 2, max_attempts: 2 },
        CUSTOM_POLICY,
      );
      expect(result.should_escalate).toBe(true);
      expect(result.action).toBe("fail_then_escalate");
    });
  });

  // -------------------------------------------------------------------------
  // Reason messages
  // -------------------------------------------------------------------------

  describe("reason messages", () => {
    /**
     * Every evaluation result must include a human-readable reason.
     * This is used in audit events and operator dashboards.
     */
    it("should always include a reason string", () => {
      for (const trigger of Object.values(EscalationTrigger)) {
        const result = shouldEscalate(
          { trigger } as EscalationEvaluationContext,
          DEFAULT_ESCALATION_POLICY,
        );
        expect(result.reason).toBeDefined();
        expect(result.reason.length).toBeGreaterThan(0);
      }
    });
  });
});

// ===========================================================================
// getTriggerAction
// ===========================================================================

describe("getTriggerAction", () => {
  /**
   * Should return the configured action for known triggers.
   */
  it("should return configured action for known triggers", () => {
    expect(getTriggerAction(EscalationTrigger.MAX_RETRY_EXCEEDED, DEFAULT_ESCALATION_POLICY)).toBe(
      "escalate",
    );
    expect(getTriggerAction(EscalationTrigger.HEARTBEAT_TIMEOUT, DEFAULT_ESCALATION_POLICY)).toBe(
      "retry_or_escalate",
    );
  });

  /**
   * Should default to "escalate" for unknown trigger types.
   * This is the fail-safe behavior.
   */
  it("should default to escalate for unknown triggers", () => {
    const action = getTriggerAction(
      "unknown_trigger" as EscalationTrigger,
      DEFAULT_ESCALATION_POLICY,
    );
    expect(action).toBe("escalate");
  });
});

// ===========================================================================
// getConfiguredTriggers
// ===========================================================================

describe("getConfiguredTriggers", () => {
  /**
   * Should return all trigger types configured in the policy.
   * The default policy has all seven triggers.
   */
  it("should return all seven triggers from default policy", () => {
    const triggers = getConfiguredTriggers(DEFAULT_ESCALATION_POLICY);
    expect(triggers).toHaveLength(7);
    for (const trigger of Object.values(EscalationTrigger)) {
      expect(triggers).toContain(trigger);
    }
  });
});
