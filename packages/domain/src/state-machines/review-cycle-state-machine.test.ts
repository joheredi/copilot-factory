/**
 * Tests for the Review Cycle state machine.
 *
 * These tests verify the complete review cycle lifecycle from PRD §2.2,
 * ensuring that:
 * - All valid transitions are accepted with correct context
 * - All invalid transitions are rejected with descriptive reasons
 * - Guard functions enforce preconditions accurately
 * - Terminal state detection works correctly
 * - Escalation paths from multiple states work correctly
 *
 * The review cycle state machine is critical for the review pipeline (E012):
 * incorrect transitions could lead to reviews being applied without proper
 * consolidation, or skipping required specialist reviews.
 *
 * @see {@link file://packages/domain/src/state-machines/review-cycle-state-machine.ts}
 * @see {@link file://docs/prd/002-data-model.md} §2.2 Review Cycle State
 */

import { describe, it, expect } from "vitest";
import { ReviewCycleStatus } from "../enums.js";
import {
  validateReviewCycleTransition,
  getValidReviewCycleTargets,
  isTerminalReviewCycleState,
  getAllValidReviewCycleTransitions,
} from "./review-cycle-state-machine.js";

// ─── Happy Path Transitions ─────────────────────────────────────────────────

describe("Review Cycle State Machine — Happy Path", () => {
  /**
   * Validates the complete happy-path lifecycle:
   * NOT_STARTED → ROUTED → IN_PROGRESS → CONSOLIDATING → APPROVED.
   * This is the path every successful review cycle follows.
   */

  it("NOT_STARTED → ROUTED: accepts when routing decision emitted", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.NOT_STARTED,
      ReviewCycleStatus.ROUTED,
      { routingDecisionEmitted: true },
    );
    expect(result.valid).toBe(true);
  });

  it("NOT_STARTED → ROUTED: rejects when routing decision not emitted", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.NOT_STARTED,
      ReviewCycleStatus.ROUTED,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("routing decision not emitted");
  });

  it("ROUTED → IN_PROGRESS: accepts when review started", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.ROUTED,
      ReviewCycleStatus.IN_PROGRESS,
      { reviewStarted: true },
    );
    expect(result.valid).toBe(true);
  });

  it("ROUTED → IN_PROGRESS: rejects when review not started", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.ROUTED,
      ReviewCycleStatus.IN_PROGRESS,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("no review has started");
  });

  it("IN_PROGRESS → CONSOLIDATING: accepts when all required reviews complete", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.IN_PROGRESS,
      ReviewCycleStatus.CONSOLIDATING,
      { allRequiredReviewsComplete: true },
    );
    expect(result.valid).toBe(true);
  });

  it("IN_PROGRESS → CONSOLIDATING: rejects when not all reviews complete", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.IN_PROGRESS,
      ReviewCycleStatus.CONSOLIDATING,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not all required reviews are complete");
  });

  it("CONSOLIDATING → APPROVED: accepts with 'approved' decision", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.CONSOLIDATING,
      ReviewCycleStatus.APPROVED,
      { leadReviewDecision: "approved" },
    );
    expect(result.valid).toBe(true);
  });

  it("CONSOLIDATING → APPROVED: accepts with 'approved_with_follow_up' decision", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.CONSOLIDATING,
      ReviewCycleStatus.APPROVED,
      { leadReviewDecision: "approved_with_follow_up" },
    );
    expect(result.valid).toBe(true);
  });

  it("CONSOLIDATING → APPROVED: rejects with 'rejected' decision", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.CONSOLIDATING,
      ReviewCycleStatus.APPROVED,
      { leadReviewDecision: "rejected" },
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("'approved' or 'approved_with_follow_up'");
  });
});

// ─── Awaiting Required Reviews Path ─────────────────────────────────────────

describe("Review Cycle State Machine — Awaiting Required Reviews", () => {
  /**
   * Validates the path through AWAITING_REQUIRED_REVIEWS, which occurs when
   * some specialist reviews are complete but the minimum required threshold
   * has not been met. This is important for ensuring review quality gates
   * are respected.
   */

  it("IN_PROGRESS → AWAITING_REQUIRED_REVIEWS: accepts when awaiting", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.IN_PROGRESS,
      ReviewCycleStatus.AWAITING_REQUIRED_REVIEWS,
      { awaitingRequiredReviews: true },
    );
    expect(result.valid).toBe(true);
  });

  it("IN_PROGRESS → AWAITING_REQUIRED_REVIEWS: rejects when not awaiting", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.IN_PROGRESS,
      ReviewCycleStatus.AWAITING_REQUIRED_REVIEWS,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not awaiting required reviews");
  });

  it("AWAITING_REQUIRED_REVIEWS → CONSOLIDATING: accepts when all complete", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.AWAITING_REQUIRED_REVIEWS,
      ReviewCycleStatus.CONSOLIDATING,
      { allRequiredReviewsComplete: true },
    );
    expect(result.valid).toBe(true);
  });

  it("AWAITING_REQUIRED_REVIEWS → CONSOLIDATING: rejects when not all complete", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.AWAITING_REQUIRED_REVIEWS,
      ReviewCycleStatus.CONSOLIDATING,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not all required reviews are complete");
  });
});

// ─── Rejection Path ─────────────────────────────────────────────────────────

describe("Review Cycle State Machine — Rejection Path", () => {
  /**
   * Validates the rejection path. When the lead reviewer decides the work
   * needs changes, the review cycle enters REJECTED. A new ReviewCycle
   * is created for the rework — this one is terminal.
   */

  it("CONSOLIDATING → REJECTED: accepts with 'rejected' decision", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.CONSOLIDATING,
      ReviewCycleStatus.REJECTED,
      { leadReviewDecision: "rejected" },
    );
    expect(result.valid).toBe(true);
  });

  it("CONSOLIDATING → REJECTED: rejects with 'approved' decision", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.CONSOLIDATING,
      ReviewCycleStatus.REJECTED,
      { leadReviewDecision: "approved" },
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("'rejected'");
  });

  it("CONSOLIDATING → REJECTED: rejects without decision", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.CONSOLIDATING,
      ReviewCycleStatus.REJECTED,
    );
    expect(result.valid).toBe(false);
  });
});

// ─── Escalation Paths ───────────────────────────────────────────────────────

describe("Review Cycle State Machine — Escalation Paths", () => {
  /**
   * Validates escalation from multiple states. Escalation can happen:
   * - During consolidation (lead reviewer decision)
   * - During active review (timeout, policy violation)
   * - While waiting for required reviews (timeout)
   * This is critical for the escalation resolution flow (T103).
   */

  it("CONSOLIDATING → ESCALATED: accepts with 'escalated' decision", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.CONSOLIDATING,
      ReviewCycleStatus.ESCALATED,
      { leadReviewDecision: "escalated" },
    );
    expect(result.valid).toBe(true);
  });

  it("CONSOLIDATING → ESCALATED: accepts with escalation trigger", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.CONSOLIDATING,
      ReviewCycleStatus.ESCALATED,
      { hasEscalationTrigger: true },
    );
    expect(result.valid).toBe(true);
  });

  it("CONSOLIDATING → ESCALATED: rejects without decision or trigger", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.CONSOLIDATING,
      ReviewCycleStatus.ESCALATED,
    );
    expect(result.valid).toBe(false);
  });

  it("IN_PROGRESS → ESCALATED: accepts with escalation trigger", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.IN_PROGRESS,
      ReviewCycleStatus.ESCALATED,
      { hasEscalationTrigger: true },
    );
    expect(result.valid).toBe(true);
  });

  it("IN_PROGRESS → ESCALATED: rejects without trigger", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.IN_PROGRESS,
      ReviewCycleStatus.ESCALATED,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("no escalation trigger");
  });

  it("AWAITING_REQUIRED_REVIEWS → ESCALATED: accepts with trigger", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.AWAITING_REQUIRED_REVIEWS,
      ReviewCycleStatus.ESCALATED,
      { hasEscalationTrigger: true },
    );
    expect(result.valid).toBe(true);
  });

  it("AWAITING_REQUIRED_REVIEWS → ESCALATED: rejects without trigger", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.AWAITING_REQUIRED_REVIEWS,
      ReviewCycleStatus.ESCALATED,
    );
    expect(result.valid).toBe(false);
  });
});

// ─── Invalid Transitions ────────────────────────────────────────────────────

describe("Review Cycle State Machine — Invalid Transitions", () => {
  /**
   * Validates that structurally invalid transitions are rejected.
   * These represent impossible state changes in the review cycle.
   */

  it("rejects self-transitions", () => {
    for (const state of Object.values(ReviewCycleStatus)) {
      const result = validateReviewCycleTransition(state, state);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("to itself");
    }
  });

  it("rejects backward transitions (IN_PROGRESS → NOT_STARTED)", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.IN_PROGRESS,
      ReviewCycleStatus.NOT_STARTED,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not a valid review cycle state transition");
  });

  it("rejects skipping states (NOT_STARTED → CONSOLIDATING)", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.NOT_STARTED,
      ReviewCycleStatus.CONSOLIDATING,
    );
    expect(result.valid).toBe(false);
  });

  it("rejects transitions from terminal APPROVED state", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.APPROVED,
      ReviewCycleStatus.NOT_STARTED,
    );
    expect(result.valid).toBe(false);
  });

  it("rejects transitions from terminal REJECTED state", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.REJECTED,
      ReviewCycleStatus.NOT_STARTED,
    );
    expect(result.valid).toBe(false);
  });

  it("rejects transitions from terminal ESCALATED state", () => {
    const result = validateReviewCycleTransition(
      ReviewCycleStatus.ESCALATED,
      ReviewCycleStatus.NOT_STARTED,
    );
    expect(result.valid).toBe(false);
  });
});

// ─── Utility Functions ──────────────────────────────────────────────────────

describe("Review Cycle State Machine — Utility Functions", () => {
  /**
   * Validates the helper functions that support UI display, testing,
   * and documentation generation.
   */

  describe("getValidReviewCycleTargets", () => {
    it("returns correct targets for NOT_STARTED", () => {
      const targets = getValidReviewCycleTargets(ReviewCycleStatus.NOT_STARTED);
      expect(targets).toEqual([ReviewCycleStatus.ROUTED]);
    });

    it("returns correct targets for IN_PROGRESS (multiple paths)", () => {
      const targets = getValidReviewCycleTargets(ReviewCycleStatus.IN_PROGRESS);
      expect(targets).toContain(ReviewCycleStatus.CONSOLIDATING);
      expect(targets).toContain(ReviewCycleStatus.AWAITING_REQUIRED_REVIEWS);
      expect(targets).toContain(ReviewCycleStatus.ESCALATED);
      expect(targets).toHaveLength(3);
    });

    it("returns correct targets for CONSOLIDATING", () => {
      const targets = getValidReviewCycleTargets(ReviewCycleStatus.CONSOLIDATING);
      expect(targets).toContain(ReviewCycleStatus.APPROVED);
      expect(targets).toContain(ReviewCycleStatus.REJECTED);
      expect(targets).toContain(ReviewCycleStatus.ESCALATED);
      expect(targets).toHaveLength(3);
    });

    it("returns empty array for terminal states", () => {
      expect(getValidReviewCycleTargets(ReviewCycleStatus.APPROVED)).toEqual([]);
      expect(getValidReviewCycleTargets(ReviewCycleStatus.REJECTED)).toEqual([]);
      expect(getValidReviewCycleTargets(ReviewCycleStatus.ESCALATED)).toEqual([]);
    });
  });

  describe("isTerminalReviewCycleState", () => {
    it("identifies APPROVED as terminal", () => {
      expect(isTerminalReviewCycleState(ReviewCycleStatus.APPROVED)).toBe(true);
    });

    it("identifies REJECTED as terminal", () => {
      expect(isTerminalReviewCycleState(ReviewCycleStatus.REJECTED)).toBe(true);
    });

    it("identifies ESCALATED as terminal", () => {
      expect(isTerminalReviewCycleState(ReviewCycleStatus.ESCALATED)).toBe(true);
    });

    it("identifies NOT_STARTED as non-terminal", () => {
      expect(isTerminalReviewCycleState(ReviewCycleStatus.NOT_STARTED)).toBe(false);
    });

    it("identifies CONSOLIDATING as non-terminal", () => {
      expect(isTerminalReviewCycleState(ReviewCycleStatus.CONSOLIDATING)).toBe(false);
    });
  });

  describe("getAllValidReviewCycleTransitions", () => {
    it("returns correct number of transitions", () => {
      const transitions = getAllValidReviewCycleTransitions();
      // 4 happy + 2 awaiting + 1 rejection + 3 escalation = 10
      expect(transitions.length).toBe(10);
    });

    it("every transition is validated as structurally valid", () => {
      const transitions = getAllValidReviewCycleTransitions();
      for (const [from, to] of transitions) {
        const result = validateReviewCycleTransition(from, to);
        if (!result.valid) {
          expect(result.reason).not.toContain("not a valid review cycle state transition");
        }
      }
    });
  });
});
