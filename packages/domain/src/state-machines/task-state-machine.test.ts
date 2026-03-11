/**
 * Exhaustive tests for the Task state machine.
 *
 * These tests validate every legal transition from PRD §2.1, verify that
 * every illegal transition is rejected, and confirm guard preconditions
 * are enforced correctly. The test structure mirrors the PRD specification
 * to make it easy for future agents to verify correctness.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.1 Task State Machine
 * @see {@link file://docs/prd/010-integration-contracts.md} §10.2
 * @module @factory/domain/state-machines/task-state-machine.test
 */

import { describe, expect, it } from "vitest";
import { TaskStatus } from "../enums.js";
import {
  type TransitionContext,
  getAllValidTransitions,
  getValidTargets,
  isTerminalState,
  validateTransition,
} from "./task-state-machine.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const ALL_STATES = Object.values(TaskStatus);

/**
 * Convenience: assert a transition is valid with the given context.
 */
function expectValid(from: TaskStatus, to: TaskStatus, ctx: TransitionContext = {}): void {
  const result = validateTransition(from, to, ctx);
  expect(result.valid, `Expected ${from} → ${to} to be valid, got: ${result.reason}`).toBe(true);
  expect(result.reason).toBeUndefined();
}

/**
 * Convenience: assert a transition is rejected, optionally checking the reason.
 */
function expectRejected(
  from: TaskStatus,
  to: TaskStatus,
  ctx: TransitionContext = {},
  reasonContains?: string,
): void {
  const result = validateTransition(from, to, ctx);
  expect(result.valid, `Expected ${from} → ${to} to be rejected`).toBe(false);
  expect(result.reason).toBeDefined();
  if (reasonContains) {
    expect(result.reason).toContain(reasonContains);
  }
}

// ─── Normal Flow Transitions (PRD §2.1) ─────────────────────────────────────

describe("Task state machine — normal flow transitions", () => {
  /**
   * Tests the happy path from BACKLOG to DONE, validating that each step
   * in the primary lifecycle is accepted with correct context.
   */
  describe("BACKLOG → READY", () => {
    it("accepts when all dependencies resolved and no policy blockers", () => {
      expectValid(TaskStatus.BACKLOG, TaskStatus.READY, {
        allDependenciesResolved: true,
        hasPolicyBlockers: false,
      });
    });

    it("accepts when hasPolicyBlockers is undefined (not explicitly set)", () => {
      expectValid(TaskStatus.BACKLOG, TaskStatus.READY, {
        allDependenciesResolved: true,
      });
    });

    it("rejects when dependencies are not resolved", () => {
      expectRejected(
        TaskStatus.BACKLOG,
        TaskStatus.READY,
        { allDependenciesResolved: false },
        "not all hard-block dependencies",
      );
    });

    it("rejects when policy blockers exist", () => {
      expectRejected(
        TaskStatus.BACKLOG,
        TaskStatus.READY,
        { allDependenciesResolved: true, hasPolicyBlockers: true },
        "policy blockers remain",
      );
    });

    it("rejects with no context provided", () => {
      expectRejected(TaskStatus.BACKLOG, TaskStatus.READY, {});
    });
  });

  describe("BACKLOG → BLOCKED", () => {
    it("accepts when hard-block dependency exists", () => {
      expectValid(TaskStatus.BACKLOG, TaskStatus.BLOCKED, {
        hasBlockers: true,
      });
    });

    it("accepts when policy blockers exist", () => {
      expectValid(TaskStatus.BACKLOG, TaskStatus.BLOCKED, {
        hasPolicyBlockers: true,
      });
    });

    it("rejects when no blockers detected", () => {
      expectRejected(
        TaskStatus.BACKLOG,
        TaskStatus.BLOCKED,
        {},
        "no hard-block dependency or policy blocker",
      );
    });
  });

  describe("BLOCKED → READY", () => {
    it("accepts when all dependencies resolved and no policy blockers", () => {
      expectValid(TaskStatus.BLOCKED, TaskStatus.READY, {
        allDependenciesResolved: true,
        hasPolicyBlockers: false,
      });
    });

    it("rejects when dependencies not resolved", () => {
      expectRejected(
        TaskStatus.BLOCKED,
        TaskStatus.READY,
        { allDependenciesResolved: false },
        "not all hard-block dependencies",
      );
    });

    it("rejects when policy blockers remain", () => {
      expectRejected(
        TaskStatus.BLOCKED,
        TaskStatus.READY,
        { allDependenciesResolved: true, hasPolicyBlockers: true },
        "policy blockers remain",
      );
    });
  });

  describe("READY → ASSIGNED", () => {
    it("accepts when lease is acquired", () => {
      expectValid(TaskStatus.READY, TaskStatus.ASSIGNED, {
        leaseAcquired: true,
      });
    });

    it("rejects when lease not acquired", () => {
      expectRejected(TaskStatus.READY, TaskStatus.ASSIGNED, {}, "lease not acquired");
    });
  });

  describe("ASSIGNED → IN_DEVELOPMENT", () => {
    it("accepts when worker heartbeat received", () => {
      expectValid(TaskStatus.ASSIGNED, TaskStatus.IN_DEVELOPMENT, {
        hasHeartbeat: true,
      });
    });

    it("rejects when no heartbeat", () => {
      expectRejected(TaskStatus.ASSIGNED, TaskStatus.IN_DEVELOPMENT, {}, "no worker heartbeat");
    });
  });

  describe("IN_DEVELOPMENT → DEV_COMPLETE", () => {
    it("accepts when DevResultPacket and validations pass", () => {
      expectValid(TaskStatus.IN_DEVELOPMENT, TaskStatus.DEV_COMPLETE, {
        hasDevResultPacket: true,
        requiredValidationsPassed: true,
      });
    });

    it("rejects when no DevResultPacket", () => {
      expectRejected(
        TaskStatus.IN_DEVELOPMENT,
        TaskStatus.DEV_COMPLETE,
        { requiredValidationsPassed: true },
        "no schema-valid DevResultPacket",
      );
    });

    it("rejects when validations have not passed", () => {
      expectRejected(
        TaskStatus.IN_DEVELOPMENT,
        TaskStatus.DEV_COMPLETE,
        { hasDevResultPacket: true, requiredValidationsPassed: false },
        "required validations have not passed",
      );
    });
  });

  describe("IN_DEVELOPMENT → FAILED", () => {
    it("accepts on unrecoverable failure", () => {
      expectValid(TaskStatus.IN_DEVELOPMENT, TaskStatus.FAILED, {
        hasUnrecoverableFailure: true,
      });
    });

    it("accepts on lease timeout with no retry", () => {
      expectValid(TaskStatus.IN_DEVELOPMENT, TaskStatus.FAILED, {
        leaseTimedOutNoRetry: true,
      });
    });

    it("rejects when neither failure condition is met", () => {
      expectRejected(TaskStatus.IN_DEVELOPMENT, TaskStatus.FAILED, {}, "no unrecoverable failure");
    });
  });

  describe("DEV_COMPLETE → IN_REVIEW", () => {
    it("accepts when review routing decision exists", () => {
      expectValid(TaskStatus.DEV_COMPLETE, TaskStatus.IN_REVIEW, {
        hasReviewRoutingDecision: true,
      });
    });

    it("rejects when no routing decision", () => {
      expectRejected(
        TaskStatus.DEV_COMPLETE,
        TaskStatus.IN_REVIEW,
        {},
        "no review routing decision",
      );
    });
  });

  describe("IN_REVIEW → CHANGES_REQUESTED", () => {
    it("accepts with changes_requested decision", () => {
      expectValid(TaskStatus.IN_REVIEW, TaskStatus.CHANGES_REQUESTED, {
        leadReviewDecision: "changes_requested",
      });
    });

    it("accepts with escalated decision mapped to rework", () => {
      expectValid(TaskStatus.IN_REVIEW, TaskStatus.CHANGES_REQUESTED, {
        leadReviewDecision: "escalated",
      });
    });

    it("rejects with approved decision", () => {
      expectRejected(
        TaskStatus.IN_REVIEW,
        TaskStatus.CHANGES_REQUESTED,
        { leadReviewDecision: "approved" },
        "must be 'changes_requested' or 'escalated'",
      );
    });

    it("rejects with no decision", () => {
      expectRejected(
        TaskStatus.IN_REVIEW,
        TaskStatus.CHANGES_REQUESTED,
        {},
        "must be 'changes_requested' or 'escalated'",
      );
    });
  });

  describe("IN_REVIEW → APPROVED", () => {
    it("accepts with approved decision", () => {
      expectValid(TaskStatus.IN_REVIEW, TaskStatus.APPROVED, {
        leadReviewDecision: "approved",
      });
    });

    it("accepts with approved_with_follow_up decision", () => {
      expectValid(TaskStatus.IN_REVIEW, TaskStatus.APPROVED, {
        leadReviewDecision: "approved_with_follow_up",
      });
    });

    it("rejects with changes_requested decision", () => {
      expectRejected(
        TaskStatus.IN_REVIEW,
        TaskStatus.APPROVED,
        { leadReviewDecision: "changes_requested" },
        "must be 'approved' or 'approved_with_follow_up'",
      );
    });
  });

  describe("CHANGES_REQUESTED → ASSIGNED", () => {
    it("accepts when new lease acquired for rework", () => {
      expectValid(TaskStatus.CHANGES_REQUESTED, TaskStatus.ASSIGNED, {
        leaseAcquired: true,
      });
    });

    it("rejects when no lease acquired", () => {
      expectRejected(
        TaskStatus.CHANGES_REQUESTED,
        TaskStatus.ASSIGNED,
        {},
        "new lease not acquired for rework",
      );
    });
  });

  describe("APPROVED → QUEUED_FOR_MERGE", () => {
    it("accepts with no special context needed", () => {
      expectValid(TaskStatus.APPROVED, TaskStatus.QUEUED_FOR_MERGE, {});
    });
  });

  describe("QUEUED_FOR_MERGE → MERGING", () => {
    it("accepts when merge worker dequeues item", () => {
      expectValid(TaskStatus.QUEUED_FOR_MERGE, TaskStatus.MERGING, {});
    });
  });

  describe("MERGING → POST_MERGE_VALIDATION", () => {
    it("accepts when merge completed successfully", () => {
      expectValid(TaskStatus.MERGING, TaskStatus.POST_MERGE_VALIDATION, {
        mergeSuccessful: true,
      });
    });

    it("rejects when merge not successful", () => {
      expectRejected(
        TaskStatus.MERGING,
        TaskStatus.POST_MERGE_VALIDATION,
        { mergeSuccessful: false },
        "merge did not complete successfully",
      );
    });
  });

  describe("MERGING → CHANGES_REQUESTED", () => {
    it("accepts when conflict classified as reworkable", () => {
      expectValid(TaskStatus.MERGING, TaskStatus.CHANGES_REQUESTED, {
        mergeConflictClassification: "reworkable",
      });
    });

    it("rejects when conflict is non-reworkable", () => {
      expectRejected(
        TaskStatus.MERGING,
        TaskStatus.CHANGES_REQUESTED,
        { mergeConflictClassification: "non_reworkable" },
        "not classified as reworkable",
      );
    });
  });

  describe("MERGING → FAILED", () => {
    it("accepts when conflict classified as non-reworkable", () => {
      expectValid(TaskStatus.MERGING, TaskStatus.FAILED, {
        mergeConflictClassification: "non_reworkable",
      });
    });

    it("rejects when conflict is reworkable", () => {
      expectRejected(
        TaskStatus.MERGING,
        TaskStatus.FAILED,
        { mergeConflictClassification: "reworkable" },
        "not classified as non-reworkable",
      );
    });
  });

  describe("POST_MERGE_VALIDATION → DONE", () => {
    it("accepts when all post-merge checks pass", () => {
      expectValid(TaskStatus.POST_MERGE_VALIDATION, TaskStatus.DONE, {
        postMergeValidationPassed: true,
      });
    });

    it("rejects when validation not passed", () => {
      expectRejected(
        TaskStatus.POST_MERGE_VALIDATION,
        TaskStatus.DONE,
        { postMergeValidationPassed: false },
        "required post-merge checks have not passed",
      );
    });
  });

  describe("POST_MERGE_VALIDATION → FAILED", () => {
    it("accepts when post-merge validation explicitly fails", () => {
      expectValid(TaskStatus.POST_MERGE_VALIDATION, TaskStatus.FAILED, {
        postMergeValidationPassed: false,
      });
    });

    it("rejects when validation has not explicitly failed", () => {
      expectRejected(
        TaskStatus.POST_MERGE_VALIDATION,
        TaskStatus.FAILED,
        { postMergeValidationPassed: true },
        "post-merge validation has not explicitly failed",
      );
    });
  });
});

// ─── Wildcard Transitions (* → ESCALATED, * → CANCELLED) ───────────────────

describe("Task state machine — wildcard transitions", () => {
  /**
   * Tests that every non-terminal state can transition to ESCALATED
   * via operator or escalation trigger, per PRD §2.1 wildcard rules.
   */
  describe("* → ESCALATED", () => {
    const nonTerminalNonEscalated = ALL_STATES.filter(
      (s) =>
        s !== TaskStatus.DONE &&
        s !== TaskStatus.FAILED &&
        s !== TaskStatus.CANCELLED &&
        s !== TaskStatus.ESCALATED,
    );

    it.each(nonTerminalNonEscalated)("accepts %s → ESCALATED with operator action", (state) => {
      expectValid(state, TaskStatus.ESCALATED, { isOperator: true });
    });

    it.each(nonTerminalNonEscalated)("accepts %s → ESCALATED with escalation trigger", (state) => {
      expectValid(state, TaskStatus.ESCALATED, {
        hasEscalationTrigger: true,
      });
    });

    it.each(nonTerminalNonEscalated)(
      "rejects %s → ESCALATED without operator or trigger",
      (state) => {
        expectRejected(
          state,
          TaskStatus.ESCALATED,
          {},
          "requires operator action or escalation trigger",
        );
      },
    );

    it("rejects DONE → ESCALATED (terminal state)", () => {
      expectRejected(TaskStatus.DONE, TaskStatus.ESCALATED, { isOperator: true }, "terminal state");
    });

    it("rejects FAILED → ESCALATED (terminal state)", () => {
      expectRejected(
        TaskStatus.FAILED,
        TaskStatus.ESCALATED,
        { isOperator: true },
        "terminal state",
      );
    });

    it("rejects CANCELLED → ESCALATED (terminal state)", () => {
      expectRejected(
        TaskStatus.CANCELLED,
        TaskStatus.ESCALATED,
        { isOperator: true },
        "terminal state",
      );
    });

    it("rejects ESCALATED → ESCALATED (self-transition)", () => {
      expectRejected(
        TaskStatus.ESCALATED,
        TaskStatus.ESCALATED,
        { isOperator: true },
        "Cannot transition from ESCALATED to itself",
      );
    });
  });

  /**
   * Tests that every non-terminal state can transition to CANCELLED
   * via operator action, per PRD §2.1 wildcard rules.
   */
  describe("* → CANCELLED", () => {
    const nonTerminal = ALL_STATES.filter(
      (s) => s !== TaskStatus.DONE && s !== TaskStatus.FAILED && s !== TaskStatus.CANCELLED,
    );

    it.each(nonTerminal)("accepts %s → CANCELLED with operator action", (state) => {
      expectValid(state, TaskStatus.CANCELLED, { isOperator: true });
    });

    it.each(nonTerminal)("rejects %s → CANCELLED without operator action", (state) => {
      expectRejected(state, TaskStatus.CANCELLED, {}, "requires operator action");
    });

    it("rejects DONE → CANCELLED (terminal state)", () => {
      expectRejected(TaskStatus.DONE, TaskStatus.CANCELLED, { isOperator: true }, "terminal state");
    });

    it("rejects FAILED → CANCELLED (terminal state)", () => {
      expectRejected(
        TaskStatus.FAILED,
        TaskStatus.CANCELLED,
        { isOperator: true },
        "terminal state",
      );
    });
  });
});

// ─── ESCALATED Resolution Transitions ───────────────────────────────────────

describe("Task state machine — ESCALATED resolution", () => {
  /**
   * Tests the three resolution paths from ESCALATED, all requiring operator action.
   * @see PRD §2.1 — ESCALATED → ASSIGNED, ESCALATED → CANCELLED, ESCALATED → DONE
   */
  describe("ESCALATED → ASSIGNED", () => {
    it("accepts with operator action and lease acquired", () => {
      expectValid(TaskStatus.ESCALATED, TaskStatus.ASSIGNED, {
        isOperator: true,
        leaseAcquired: true,
      });
    });

    it("rejects without operator action", () => {
      expectRejected(
        TaskStatus.ESCALATED,
        TaskStatus.ASSIGNED,
        { leaseAcquired: true },
        "requires operator action",
      );
    });

    it("rejects without lease acquired", () => {
      expectRejected(
        TaskStatus.ESCALATED,
        TaskStatus.ASSIGNED,
        { isOperator: true },
        "new lease not acquired",
      );
    });
  });

  describe("ESCALATED → CANCELLED", () => {
    it("accepts with operator action", () => {
      expectValid(TaskStatus.ESCALATED, TaskStatus.CANCELLED, {
        isOperator: true,
      });
    });

    it("rejects without operator action", () => {
      expectRejected(TaskStatus.ESCALATED, TaskStatus.CANCELLED, {}, "requires operator action");
    });
  });

  describe("ESCALATED → DONE", () => {
    it("accepts with operator action", () => {
      expectValid(TaskStatus.ESCALATED, TaskStatus.DONE, {
        isOperator: true,
      });
    });

    it("rejects without operator action", () => {
      expectRejected(TaskStatus.ESCALATED, TaskStatus.DONE, {}, "requires operator action");
    });
  });
});

// ─── Invalid Transitions (Exhaustive) ───────────────────────────────────────

describe("Task state machine — invalid transitions", () => {
  /**
   * Validates that EVERY invalid transition pair is properly rejected.
   * This is the most critical safety test: the state machine MUST NOT
   * allow any transition not explicitly defined in PRD §2.1.
   */
  const allValidTransitions = getAllValidTransitions();
  const validSet = new Set(allValidTransitions.map(([from, to]) => `${from}→${to}`));

  // Generate all possible (from, to) pairs
  const allPairs: Array<[TaskStatus, TaskStatus]> = [];
  for (const from of ALL_STATES) {
    for (const to of ALL_STATES) {
      if (from !== to && !validSet.has(`${from}→${to}`)) {
        allPairs.push([from, to]);
      }
    }
  }

  it("has a non-trivial number of invalid transitions to test", () => {
    // 16 states × 15 targets = 240 possible non-self pairs
    // minus valid transitions should leave a significant number
    expect(allPairs.length).toBeGreaterThan(100);
  });

  it.each(allPairs)("rejects %s → %s", (from, to) => {
    // Provide a maximally permissive context to ensure the rejection is structural
    const ctx: TransitionContext = {
      allDependenciesResolved: true,
      hasPolicyBlockers: false,
      hasBlockers: true,
      leaseAcquired: true,
      hasHeartbeat: true,
      hasDevResultPacket: true,
      requiredValidationsPassed: true,
      hasReviewRoutingDecision: true,
      leadReviewDecision: "approved",
      mergeSuccessful: true,
      mergeConflictClassification: "reworkable",
      postMergeValidationPassed: true,
      hasUnrecoverableFailure: true,
      leaseTimedOutNoRetry: true,
      isOperator: true,
      hasEscalationTrigger: true,
    };
    expectRejected(from, to, ctx);
  });
});

// ─── Self-Transition Rejection ──────────────────────────────────────────────

describe("Task state machine — self-transitions", () => {
  /**
   * Validates that no state can transition to itself.
   * Self-transitions are never valid per the state machine semantics.
   */
  it.each(ALL_STATES)("rejects %s → %s (self-transition)", (state) => {
    expectRejected(state, state, {}, "Cannot transition from");
  });
});

// ─── Terminal State Invariants ──────────────────────────────────────────────

describe("Task state machine — terminal states", () => {
  /**
   * Validates that terminal states (DONE, FAILED, CANCELLED) cannot
   * transition to any other state. This is a core invariant.
   * @see PRD §2.1 Global Invariants: "a task in DONE is immutable except via reopen operation"
   */
  const terminalStates = [TaskStatus.DONE, TaskStatus.FAILED, TaskStatus.CANCELLED];

  for (const terminal of terminalStates) {
    describe(`${terminal} is terminal`, () => {
      it("isTerminalState returns true", () => {
        expect(isTerminalState(terminal)).toBe(true);
      });

      it("has no valid targets", () => {
        expect(getValidTargets(terminal)).toEqual([]);
      });

      it.each(ALL_STATES.filter((s) => s !== terminal))(`rejects ${terminal} → %s`, (target) => {
        expectRejected(terminal, target, { isOperator: true });
      });
    });
  }

  it("ESCALATED is NOT terminal (it has resolution paths)", () => {
    expect(isTerminalState(TaskStatus.ESCALATED)).toBe(false);
  });
});

// ─── getValidTargets ────────────────────────────────────────────────────────

describe("getValidTargets", () => {
  /**
   * Validates that getValidTargets returns the correct set of reachable
   * states for key states in the lifecycle.
   */
  it("BACKLOG can reach READY, BLOCKED, ESCALATED, CANCELLED", () => {
    const targets = getValidTargets(TaskStatus.BACKLOG);
    expect(targets).toContain(TaskStatus.READY);
    expect(targets).toContain(TaskStatus.BLOCKED);
    expect(targets).toContain(TaskStatus.ESCALATED);
    expect(targets).toContain(TaskStatus.CANCELLED);
    expect(targets).toHaveLength(4);
  });

  it("IN_DEVELOPMENT can reach DEV_COMPLETE, FAILED, READY, ESCALATED, CANCELLED", () => {
    const targets = getValidTargets(TaskStatus.IN_DEVELOPMENT);
    expect(targets).toContain(TaskStatus.DEV_COMPLETE);
    expect(targets).toContain(TaskStatus.FAILED);
    expect(targets).toContain(TaskStatus.READY);
    expect(targets).toContain(TaskStatus.ESCALATED);
    expect(targets).toContain(TaskStatus.CANCELLED);
    expect(targets).toHaveLength(5);
  });

  it("IN_REVIEW can reach CHANGES_REQUESTED, APPROVED, ESCALATED, CANCELLED", () => {
    const targets = getValidTargets(TaskStatus.IN_REVIEW);
    expect(targets).toContain(TaskStatus.CHANGES_REQUESTED);
    expect(targets).toContain(TaskStatus.APPROVED);
    expect(targets).toContain(TaskStatus.ESCALATED);
    expect(targets).toContain(TaskStatus.CANCELLED);
    expect(targets).toHaveLength(4);
  });

  it("MERGING can reach POST_MERGE_VALIDATION, CHANGES_REQUESTED, FAILED, ESCALATED, CANCELLED", () => {
    const targets = getValidTargets(TaskStatus.MERGING);
    expect(targets).toContain(TaskStatus.POST_MERGE_VALIDATION);
    expect(targets).toContain(TaskStatus.CHANGES_REQUESTED);
    expect(targets).toContain(TaskStatus.FAILED);
    expect(targets).toContain(TaskStatus.ESCALATED);
    expect(targets).toContain(TaskStatus.CANCELLED);
    expect(targets).toHaveLength(5);
  });

  it("ESCALATED can reach ASSIGNED, CANCELLED, DONE", () => {
    const targets = getValidTargets(TaskStatus.ESCALATED);
    expect(targets).toContain(TaskStatus.ASSIGNED);
    expect(targets).toContain(TaskStatus.CANCELLED);
    expect(targets).toContain(TaskStatus.DONE);
    expect(targets).toHaveLength(3);
  });
});

// ─── getAllValidTransitions ──────────────────────────────────────────────────

describe("getAllValidTransitions", () => {
  /**
   * Validates the total count of valid transitions matches expected count.
   * 21 explicit normal-flow (18 original + 3 reclaim transitions)
   * + 3 ESCALATED resolutions
   * + 12 wildcard ESCALATED (from non-terminal, non-ESCALATED states)
   * + 12 wildcard CANCELLED (from non-terminal, non-ESCALATED states; ESCALATED → CANCELLED is explicit)
   * = 48 total
   */
  it("returns the expected number of valid transitions", () => {
    const transitions = getAllValidTransitions();
    // 21 normal + 3 escalated resolutions + 12 wildcard→ESCALATED + 12 wildcard→CANCELLED
    expect(transitions.length).toBe(48);
  });

  it("contains no duplicate transitions", () => {
    const transitions = getAllValidTransitions();
    const keys = transitions.map(([from, to]) => `${from}→${to}`);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it("contains no self-transitions", () => {
    const transitions = getAllValidTransitions();
    for (const [from, to] of transitions) {
      expect(from).not.toBe(to);
    }
  });
});

// ─── Complete Lifecycle Scenario ────────────────────────────────────────────

describe("Task state machine — full lifecycle scenario", () => {
  /**
   * Simulates a complete happy-path task lifecycle from BACKLOG to DONE,
   * validating each transition along the way. This serves as a smoke test
   * for the entire state machine.
   */
  it("completes BACKLOG → READY → ASSIGNED → IN_DEVELOPMENT → DEV_COMPLETE → IN_REVIEW → APPROVED → QUEUED_FOR_MERGE → MERGING → POST_MERGE_VALIDATION → DONE", () => {
    const steps: Array<{ from: TaskStatus; to: TaskStatus; ctx: TransitionContext }> = [
      {
        from: TaskStatus.BACKLOG,
        to: TaskStatus.READY,
        ctx: { allDependenciesResolved: true, hasPolicyBlockers: false },
      },
      {
        from: TaskStatus.READY,
        to: TaskStatus.ASSIGNED,
        ctx: { leaseAcquired: true },
      },
      {
        from: TaskStatus.ASSIGNED,
        to: TaskStatus.IN_DEVELOPMENT,
        ctx: { hasHeartbeat: true },
      },
      {
        from: TaskStatus.IN_DEVELOPMENT,
        to: TaskStatus.DEV_COMPLETE,
        ctx: { hasDevResultPacket: true, requiredValidationsPassed: true },
      },
      {
        from: TaskStatus.DEV_COMPLETE,
        to: TaskStatus.IN_REVIEW,
        ctx: { hasReviewRoutingDecision: true },
      },
      {
        from: TaskStatus.IN_REVIEW,
        to: TaskStatus.APPROVED,
        ctx: { leadReviewDecision: "approved" },
      },
      {
        from: TaskStatus.APPROVED,
        to: TaskStatus.QUEUED_FOR_MERGE,
        ctx: {},
      },
      {
        from: TaskStatus.QUEUED_FOR_MERGE,
        to: TaskStatus.MERGING,
        ctx: {},
      },
      {
        from: TaskStatus.MERGING,
        to: TaskStatus.POST_MERGE_VALIDATION,
        ctx: { mergeSuccessful: true },
      },
      {
        from: TaskStatus.POST_MERGE_VALIDATION,
        to: TaskStatus.DONE,
        ctx: { postMergeValidationPassed: true },
      },
    ];

    for (const step of steps) {
      expectValid(step.from, step.to, step.ctx);
    }
  });

  /**
   * Simulates a rework cycle: dev completes, review rejects, task is
   * rescheduled, then approved on second pass.
   */
  it("handles rework cycle: IN_REVIEW → CHANGES_REQUESTED → ASSIGNED → ... → APPROVED", () => {
    expectValid(TaskStatus.IN_REVIEW, TaskStatus.CHANGES_REQUESTED, {
      leadReviewDecision: "changes_requested",
    });
    expectValid(TaskStatus.CHANGES_REQUESTED, TaskStatus.ASSIGNED, {
      leaseAcquired: true,
    });
    // Back through development
    expectValid(TaskStatus.ASSIGNED, TaskStatus.IN_DEVELOPMENT, {
      hasHeartbeat: true,
    });
    expectValid(TaskStatus.IN_DEVELOPMENT, TaskStatus.DEV_COMPLETE, {
      hasDevResultPacket: true,
      requiredValidationsPassed: true,
    });
    expectValid(TaskStatus.DEV_COMPLETE, TaskStatus.IN_REVIEW, {
      hasReviewRoutingDecision: true,
    });
    expectValid(TaskStatus.IN_REVIEW, TaskStatus.APPROVED, {
      leadReviewDecision: "approved",
    });
  });

  /**
   * Simulates merge conflict rework: merge fails with reworkable conflict,
   * task goes back through development and review.
   */
  it("handles merge conflict rework: MERGING → CHANGES_REQUESTED → ASSIGNED", () => {
    expectValid(TaskStatus.MERGING, TaskStatus.CHANGES_REQUESTED, {
      mergeConflictClassification: "reworkable",
    });
    expectValid(TaskStatus.CHANGES_REQUESTED, TaskStatus.ASSIGNED, {
      leaseAcquired: true,
    });
  });

  /**
   * Simulates operator escalation and resolution: task is escalated
   * from IN_DEVELOPMENT, then operator resolves by retrying.
   */
  it("handles escalation and resolution: IN_DEVELOPMENT → ESCALATED → ASSIGNED", () => {
    expectValid(TaskStatus.IN_DEVELOPMENT, TaskStatus.ESCALATED, {
      isOperator: true,
    });
    expectValid(TaskStatus.ESCALATED, TaskStatus.ASSIGNED, {
      isOperator: true,
      leaseAcquired: true,
    });
  });
});
