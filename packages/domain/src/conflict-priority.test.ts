/**
 * Tests for conflict resolution priority logic.
 *
 * These tests verify the priority classification, retry decisions, and
 * grace period checks defined by PRD §10.2.3. They ensure that when
 * multiple actors race to transition the same task:
 *
 * - Operator actions always have highest priority and retry on conflict.
 * - Lease expiry has medium priority and retries over automated transitions.
 * - Automated transitions (workers, scheduler) yield on conflict.
 * - Worker results within the grace period after lease timeout are accepted.
 *
 * @see docs/prd/010-integration-contracts.md §10.2.3
 */

import { describe, it, expect } from "vitest";

import { TaskStatus } from "./enums.js";
import {
  ConflictPriority,
  getConflictPriority,
  shouldRetryOnConflict,
  isWithinGracePeriod,
} from "./conflict-priority.js";

// ---------------------------------------------------------------------------
// getConflictPriority
// ---------------------------------------------------------------------------

describe("getConflictPriority", () => {
  /**
   * Validates that operator actors always receive the highest priority,
   * regardless of the target status. This is critical because operators
   * are the ultimate authority and must be able to override any automated
   * transition (§10.2.3 rule 1).
   */
  describe("operator priority", () => {
    it("assigns OPERATOR priority to 'operator' actor type for any target status", () => {
      const statuses: TaskStatus[] = [
        TaskStatus.ESCALATED,
        TaskStatus.CANCELLED,
        TaskStatus.READY,
        TaskStatus.ASSIGNED,
        TaskStatus.FAILED,
        TaskStatus.DONE,
      ];

      for (const status of statuses) {
        expect(getConflictPriority("operator", status)).toBe(ConflictPriority.OPERATOR);
      }
    });

    it("assigns OPERATOR priority to 'admin' actor type", () => {
      expect(getConflictPriority("admin", TaskStatus.CANCELLED)).toBe(ConflictPriority.OPERATOR);
      expect(getConflictPriority("admin", TaskStatus.READY)).toBe(ConflictPriority.OPERATOR);
    });

    it("assigns OPERATOR priority to 'system' actor targeting ESCALATED", () => {
      expect(getConflictPriority("system", TaskStatus.ESCALATED)).toBe(ConflictPriority.OPERATOR);
    });

    it("assigns OPERATOR priority to 'system' actor targeting CANCELLED", () => {
      expect(getConflictPriority("system", TaskStatus.CANCELLED)).toBe(ConflictPriority.OPERATOR);
    });
  });

  /**
   * Validates that lease monitor actors targeting FAILED receive LEASE_EXPIRY
   * priority. This is the safety mechanism that ensures stale worker results
   * cannot prevent lease timeout from being processed (§10.2.3 rule 2).
   */
  describe("lease expiry priority", () => {
    it("assigns LEASE_EXPIRY priority to 'lease-monitor' targeting FAILED", () => {
      expect(getConflictPriority("lease-monitor", TaskStatus.FAILED)).toBe(
        ConflictPriority.LEASE_EXPIRY,
      );
    });

    it("assigns LEASE_EXPIRY priority to 'reconciliation' targeting FAILED", () => {
      expect(getConflictPriority("reconciliation", TaskStatus.FAILED)).toBe(
        ConflictPriority.LEASE_EXPIRY,
      );
    });

    it("assigns AUTOMATED priority to 'lease-monitor' targeting non-FAILED status", () => {
      expect(getConflictPriority("lease-monitor", TaskStatus.READY)).toBe(
        ConflictPriority.AUTOMATED,
      );
      expect(getConflictPriority("lease-monitor", TaskStatus.ASSIGNED)).toBe(
        ConflictPriority.AUTOMATED,
      );
    });
  });

  /**
   * Validates that standard automated actors (worker, scheduler, review-router,
   * merge-module) always receive the lowest priority. These actors should
   * yield on conflict because first-writer-wins is the correct policy for
   * same-priority races.
   */
  describe("automated priority", () => {
    it("assigns AUTOMATED priority to 'worker' actor", () => {
      expect(getConflictPriority("worker", TaskStatus.DEV_COMPLETE)).toBe(
        ConflictPriority.AUTOMATED,
      );
      expect(getConflictPriority("worker", TaskStatus.IN_DEVELOPMENT)).toBe(
        ConflictPriority.AUTOMATED,
      );
    });

    it("assigns AUTOMATED priority to 'scheduler' actor", () => {
      expect(getConflictPriority("scheduler", TaskStatus.ASSIGNED)).toBe(
        ConflictPriority.AUTOMATED,
      );
    });

    it("assigns AUTOMATED priority to 'review-router' actor", () => {
      expect(getConflictPriority("review-router", TaskStatus.IN_REVIEW)).toBe(
        ConflictPriority.AUTOMATED,
      );
    });

    it("assigns AUTOMATED priority to 'merge-module' actor", () => {
      expect(getConflictPriority("merge-module", TaskStatus.MERGING)).toBe(
        ConflictPriority.AUTOMATED,
      );
    });

    it("assigns AUTOMATED priority to 'system' actor for non-operator targets", () => {
      expect(getConflictPriority("system", TaskStatus.READY)).toBe(ConflictPriority.AUTOMATED);
      expect(getConflictPriority("system", TaskStatus.ASSIGNED)).toBe(ConflictPriority.AUTOMATED);
      expect(getConflictPriority("system", TaskStatus.FAILED)).toBe(ConflictPriority.AUTOMATED);
    });
  });

  /**
   * Validates the strict ordering: OPERATOR > LEASE_EXPIRY > AUTOMATED.
   * This ordering ensures deterministic conflict resolution.
   */
  describe("priority ordering", () => {
    it("OPERATOR > LEASE_EXPIRY > AUTOMATED (numeric ordering)", () => {
      expect(ConflictPriority.OPERATOR).toBeGreaterThan(ConflictPriority.LEASE_EXPIRY);
      expect(ConflictPriority.LEASE_EXPIRY).toBeGreaterThan(ConflictPriority.AUTOMATED);
    });
  });
});

// ---------------------------------------------------------------------------
// shouldRetryOnConflict
// ---------------------------------------------------------------------------

describe("shouldRetryOnConflict", () => {
  /**
   * Validates that only higher-priority actors retry on conflict.
   * AUTOMATED actors must yield (return false) to prevent infinite
   * retry loops between equal-priority competitors.
   */
  describe("retry decisions", () => {
    it("returns true for operator actors (should retry)", () => {
      expect(shouldRetryOnConflict("operator", TaskStatus.ESCALATED)).toBe(true);
      expect(shouldRetryOnConflict("operator", TaskStatus.CANCELLED)).toBe(true);
      expect(shouldRetryOnConflict("admin", TaskStatus.CANCELLED)).toBe(true);
    });

    it("returns true for lease-monitor targeting FAILED (should retry)", () => {
      expect(shouldRetryOnConflict("lease-monitor", TaskStatus.FAILED)).toBe(true);
    });

    it("returns true for reconciliation targeting FAILED (should retry)", () => {
      expect(shouldRetryOnConflict("reconciliation", TaskStatus.FAILED)).toBe(true);
    });

    it("returns false for worker actors (should yield)", () => {
      expect(shouldRetryOnConflict("worker", TaskStatus.DEV_COMPLETE)).toBe(false);
      expect(shouldRetryOnConflict("worker", TaskStatus.IN_DEVELOPMENT)).toBe(false);
    });

    it("returns false for scheduler actors (should yield)", () => {
      expect(shouldRetryOnConflict("scheduler", TaskStatus.ASSIGNED)).toBe(false);
    });

    it("returns false for review-router actors (should yield)", () => {
      expect(shouldRetryOnConflict("review-router", TaskStatus.IN_REVIEW)).toBe(false);
    });

    it("returns false for lease-monitor targeting non-FAILED (should yield)", () => {
      expect(shouldRetryOnConflict("lease-monitor", TaskStatus.READY)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// isWithinGracePeriod
// ---------------------------------------------------------------------------

describe("isWithinGracePeriod", () => {
  const baseTime = new Date("2024-01-01T12:00:00Z");

  /**
   * Validates the core grace period rule: a worker result received
   * within grace_period_seconds after lease expiry must be accepted.
   * This is the exception to lease-expiry-wins-over-worker-results.
   */
  describe("within grace period", () => {
    it("returns true when result arrives exactly at expiry time", () => {
      expect(isWithinGracePeriod(baseTime, baseTime, 30)).toBe(true);
    });

    it("returns true when result arrives within the grace window", () => {
      const resultAt = new Date(baseTime.getTime() + 15_000); // 15s after expiry
      expect(isWithinGracePeriod(baseTime, resultAt, 30)).toBe(true);
    });

    it("returns true when result arrives exactly at grace window boundary", () => {
      const resultAt = new Date(baseTime.getTime() + 30_000); // exactly 30s
      expect(isWithinGracePeriod(baseTime, resultAt, 30)).toBe(true);
    });
  });

  /**
   * Validates that results outside the grace window are rejected.
   * After the grace period, lease expiry takes precedence and the
   * worker result must be discarded.
   */
  describe("outside grace period", () => {
    it("returns false when result arrives after the grace window", () => {
      const resultAt = new Date(baseTime.getTime() + 31_000); // 31s after expiry
      expect(isWithinGracePeriod(baseTime, resultAt, 30)).toBe(false);
    });

    it("returns false when result arrives well after the grace window", () => {
      const resultAt = new Date(baseTime.getTime() + 120_000); // 2 min after
      expect(isWithinGracePeriod(baseTime, resultAt, 30)).toBe(false);
    });
  });

  /**
   * Validates edge cases: results before expiry, zero/negative grace periods.
   */
  describe("edge cases", () => {
    it("returns false when result arrives before expiry", () => {
      const resultAt = new Date(baseTime.getTime() - 1_000); // 1s before expiry
      expect(isWithinGracePeriod(baseTime, resultAt, 30)).toBe(false);
    });

    it("returns false when grace period is zero", () => {
      expect(isWithinGracePeriod(baseTime, baseTime, 0)).toBe(false);
    });

    it("returns false when grace period is negative", () => {
      expect(isWithinGracePeriod(baseTime, baseTime, -10)).toBe(false);
    });

    it("handles sub-second precision correctly", () => {
      const resultAt = new Date(baseTime.getTime() + 500); // 0.5s after expiry
      expect(isWithinGracePeriod(baseTime, resultAt, 1)).toBe(true);
    });

    it("handles very small grace periods", () => {
      const resultAt = new Date(baseTime.getTime() + 100); // 100ms after expiry
      expect(isWithinGracePeriod(baseTime, resultAt, 0.1)).toBe(true);
    });

    it("rejects when just barely outside small grace period", () => {
      const resultAt = new Date(baseTime.getTime() + 200); // 200ms after expiry
      expect(isWithinGracePeriod(baseTime, resultAt, 0.1)).toBe(false);
    });
  });
});
