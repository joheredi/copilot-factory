/**
 * Tests for retry policy model and eligibility evaluation.
 *
 * Validates that the retry evaluation follows PRD §9.6 exactly:
 * - max_attempts counts retries after the initial attempt
 * - Exponential backoff: initial × 2^(attempt − 1), capped at max
 * - Failure summary packet requirement is enforced
 * - Default policy matches the canonical shape from §9.6.1
 *
 * @see {@link file://docs/prd/009-policy-and-enforcement-spec.md} §9.6
 * @module @factory/domain/policies/retry-policy.test
 */

import { describe, it, expect } from "vitest";
import {
  BackoffStrategy,
  type RetryPolicy,
  type RetryEvaluationContext,
  DEFAULT_RETRY_POLICY,
  calculateBackoff,
  shouldRetry,
  createDefaultRetryPolicy,
} from "./retry-policy.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Policy with a single retry allowed and short backoff for testing. */
const SINGLE_RETRY_POLICY: RetryPolicy = {
  max_attempts: 1,
  backoff_strategy: BackoffStrategy.EXPONENTIAL,
  initial_backoff_seconds: 10,
  max_backoff_seconds: 100,
  reuse_same_pool: true,
  allow_pool_change_after_failure: false,
  require_failure_summary_packet: false,
};

/** Policy that requires failure summary packets. */
const SUMMARY_REQUIRED_POLICY: RetryPolicy = {
  max_attempts: 3,
  backoff_strategy: BackoffStrategy.EXPONENTIAL,
  initial_backoff_seconds: 30,
  max_backoff_seconds: 600,
  reuse_same_pool: false,
  allow_pool_change_after_failure: true,
  require_failure_summary_packet: true,
};

/** Policy with zero retries — all failures go to escalation. */
const NO_RETRY_POLICY: RetryPolicy = {
  max_attempts: 0,
  backoff_strategy: BackoffStrategy.EXPONENTIAL,
  initial_backoff_seconds: 60,
  max_backoff_seconds: 900,
  reuse_same_pool: true,
  allow_pool_change_after_failure: true,
  require_failure_summary_packet: false,
};

/** Helper to create a retry context with sensible defaults. */
function ctx(overrides?: Partial<RetryEvaluationContext>): RetryEvaluationContext {
  return {
    retry_count: 0,
    has_failure_summary: true,
    ...overrides,
  };
}

// ===========================================================================
// BackoffStrategy enum
// ===========================================================================

describe("BackoffStrategy", () => {
  /**
   * Validates that the BackoffStrategy enum contains the expected V1 value.
   * V1 only supports exponential backoff; this test ensures the enum is
   * correctly defined for type safety and runtime matching.
   */
  it("should define EXPONENTIAL value", () => {
    expect(BackoffStrategy.EXPONENTIAL).toBe("exponential");
  });
});

// ===========================================================================
// DEFAULT_RETRY_POLICY
// ===========================================================================

describe("DEFAULT_RETRY_POLICY", () => {
  /**
   * Verifies that the default policy matches the PRD §9.6.1 canonical shape.
   * This is a critical correctness test — downstream code depends on these
   * exact defaults.
   */
  it("should match PRD §9.6.1 canonical values", () => {
    expect(DEFAULT_RETRY_POLICY.max_attempts).toBe(2);
    expect(DEFAULT_RETRY_POLICY.backoff_strategy).toBe("exponential");
    expect(DEFAULT_RETRY_POLICY.initial_backoff_seconds).toBe(60);
    expect(DEFAULT_RETRY_POLICY.max_backoff_seconds).toBe(900);
    expect(DEFAULT_RETRY_POLICY.reuse_same_pool).toBe(true);
    expect(DEFAULT_RETRY_POLICY.allow_pool_change_after_failure).toBe(true);
    expect(DEFAULT_RETRY_POLICY.require_failure_summary_packet).toBe(true);
  });
});

// ===========================================================================
// createDefaultRetryPolicy
// ===========================================================================

describe("createDefaultRetryPolicy", () => {
  /**
   * Ensures the factory returns a fresh copy to prevent cross-test or
   * cross-module mutation of the default constant.
   */
  it("should return a copy of DEFAULT_RETRY_POLICY", () => {
    const policy = createDefaultRetryPolicy();
    expect(policy).toEqual(DEFAULT_RETRY_POLICY);
    expect(policy).not.toBe(DEFAULT_RETRY_POLICY);
  });
});

// ===========================================================================
// calculateBackoff
// ===========================================================================

describe("calculateBackoff", () => {
  /**
   * The first retry attempt should use the initial backoff value directly.
   * Formula: initial × 2^(1 − 1) = initial × 1 = initial.
   */
  it("should return initial_backoff_seconds for attempt 1", () => {
    expect(calculateBackoff(1, DEFAULT_RETRY_POLICY)).toBe(60);
  });

  /**
   * Second attempt doubles the initial value.
   * Formula: 60 × 2^(2 − 1) = 60 × 2 = 120.
   */
  it("should double backoff for attempt 2", () => {
    expect(calculateBackoff(2, DEFAULT_RETRY_POLICY)).toBe(120);
  });

  /**
   * Third attempt quadruples the initial value.
   * Formula: 60 × 2^(3 − 1) = 60 × 4 = 240.
   */
  it("should quadruple backoff for attempt 3", () => {
    expect(calculateBackoff(3, DEFAULT_RETRY_POLICY)).toBe(240);
  });

  /**
   * The backoff must never exceed max_backoff_seconds.
   * With initial=60 and max=900, attempt 5 would be 60 × 16 = 960,
   * which should be capped at 900.
   */
  it("should cap backoff at max_backoff_seconds", () => {
    expect(calculateBackoff(5, DEFAULT_RETRY_POLICY)).toBe(900);
  });

  /**
   * Very large attempt numbers must still be capped at max.
   * This prevents overflow-related bugs.
   */
  it("should cap backoff for very large attempt numbers", () => {
    expect(calculateBackoff(100, DEFAULT_RETRY_POLICY)).toBe(900);
  });

  /**
   * Attempt ≤ 0 should return 0 as a defensive measure.
   * This handles edge cases where attempt tracking has errors.
   */
  it("should return 0 for attempt <= 0", () => {
    expect(calculateBackoff(0, DEFAULT_RETRY_POLICY)).toBe(0);
    expect(calculateBackoff(-1, DEFAULT_RETRY_POLICY)).toBe(0);
  });

  /**
   * Verify with a different policy to ensure the formula uses
   * the policy's parameters, not hardcoded values.
   */
  it("should use the policy's initial and max values", () => {
    // initial=10, max=100
    expect(calculateBackoff(1, SINGLE_RETRY_POLICY)).toBe(10);
    expect(calculateBackoff(2, SINGLE_RETRY_POLICY)).toBe(20);
    expect(calculateBackoff(3, SINGLE_RETRY_POLICY)).toBe(40);
    expect(calculateBackoff(4, SINGLE_RETRY_POLICY)).toBe(80);
    expect(calculateBackoff(5, SINGLE_RETRY_POLICY)).toBe(100); // capped
  });
});

// ===========================================================================
// shouldRetry
// ===========================================================================

describe("shouldRetry", () => {
  // -------------------------------------------------------------------------
  // Basic eligibility
  // -------------------------------------------------------------------------

  describe("basic eligibility", () => {
    /**
     * A task that has never been retried (retry_count=0) with a policy
     * allowing 2 retries should be eligible. This is the most common
     * first-failure case.
     */
    it("should be eligible when retry_count is 0 and max_attempts is 2", () => {
      const result = shouldRetry(ctx({ retry_count: 0 }), DEFAULT_RETRY_POLICY);
      expect(result.eligible).toBe(true);
      expect(result.backoff_seconds).toBe(60);
      expect(result.next_attempt).toBe(1);
      expect(result.reason).toBeUndefined();
    });

    /**
     * A task on its second retry (retry_count=1) with max_attempts=2
     * should still be eligible for one more retry.
     */
    it("should be eligible when retry_count is 1 and max_attempts is 2", () => {
      const result = shouldRetry(ctx({ retry_count: 1 }), DEFAULT_RETRY_POLICY);
      expect(result.eligible).toBe(true);
      expect(result.backoff_seconds).toBe(120);
      expect(result.next_attempt).toBe(2);
    });

    /**
     * When retry_count equals max_attempts, all retries are exhausted.
     * The task must move to escalation, not retry again.
     */
    it("should be ineligible when retry_count equals max_attempts", () => {
      const result = shouldRetry(ctx({ retry_count: 2 }), DEFAULT_RETRY_POLICY);
      expect(result.eligible).toBe(false);
      expect(result.backoff_seconds).toBe(0);
      expect(result.next_attempt).toBe(3);
      expect(result.reason).toContain("max_attempts");
    });

    /**
     * When retry_count exceeds max_attempts (shouldn't happen normally
     * but must be handled defensively), still ineligible.
     */
    it("should be ineligible when retry_count exceeds max_attempts", () => {
      const result = shouldRetry(ctx({ retry_count: 5 }), DEFAULT_RETRY_POLICY);
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("max_attempts");
    });
  });

  // -------------------------------------------------------------------------
  // Zero-retry policy
  // -------------------------------------------------------------------------

  describe("zero-retry policy", () => {
    /**
     * A policy with max_attempts=0 means no retries allowed at all.
     * Even on the very first failure, the task should not be retried.
     */
    it("should be ineligible on first failure when max_attempts is 0", () => {
      const result = shouldRetry(ctx({ retry_count: 0 }), NO_RETRY_POLICY);
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("max_attempts");
    });
  });

  // -------------------------------------------------------------------------
  // Failure summary requirement
  // -------------------------------------------------------------------------

  describe("failure summary requirement", () => {
    /**
     * When policy requires a failure summary packet and one exists,
     * the retry should be allowed (assuming count is within bounds).
     */
    it("should be eligible when summary is required and present", () => {
      const result = shouldRetry(
        ctx({ retry_count: 0, has_failure_summary: true }),
        SUMMARY_REQUIRED_POLICY,
      );
      expect(result.eligible).toBe(true);
    });

    /**
     * When policy requires a failure summary but none exists,
     * the retry must be denied. This ensures the next attempt has
     * context about what went wrong.
     */
    it("should be ineligible when summary is required but missing", () => {
      const result = shouldRetry(
        ctx({ retry_count: 0, has_failure_summary: false }),
        SUMMARY_REQUIRED_POLICY,
      );
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("Failure summary packet");
    });

    /**
     * When policy does NOT require a summary, absence of one should
     * not block the retry.
     */
    it("should be eligible without summary when not required by policy", () => {
      const result = shouldRetry(
        ctx({ retry_count: 0, has_failure_summary: false }),
        SINGLE_RETRY_POLICY,
      );
      expect(result.eligible).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Backoff correctness
  // -------------------------------------------------------------------------

  describe("backoff computation", () => {
    /**
     * Validates that shouldRetry returns the correct backoff for
     * multiple consecutive retries, matching the exponential formula.
     */
    it("should compute correct exponential backoff across retries", () => {
      const r0 = shouldRetry(ctx({ retry_count: 0 }), SUMMARY_REQUIRED_POLICY);
      expect(r0.backoff_seconds).toBe(30); // 30 × 2^0 = 30

      const r1 = shouldRetry(ctx({ retry_count: 1 }), SUMMARY_REQUIRED_POLICY);
      expect(r1.backoff_seconds).toBe(60); // 30 × 2^1 = 60

      const r2 = shouldRetry(ctx({ retry_count: 2 }), SUMMARY_REQUIRED_POLICY);
      expect(r2.backoff_seconds).toBe(120); // 30 × 2^2 = 120
    });
  });

  // -------------------------------------------------------------------------
  // Priority of checks
  // -------------------------------------------------------------------------

  describe("check priority", () => {
    /**
     * Max attempts check should take precedence over the failure summary
     * check. If retries are exhausted, the summary requirement is moot.
     */
    it("should check max_attempts before failure summary", () => {
      const result = shouldRetry(
        ctx({ retry_count: 3, has_failure_summary: false }),
        SUMMARY_REQUIRED_POLICY,
      );
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("max_attempts");
    });
  });
});
