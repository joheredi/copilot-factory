/**
 * Tests for the Merge Queue Item state machine.
 *
 * These tests verify the complete merge queue item lifecycle from PRD §2.2,
 * ensuring that:
 * - All valid transitions are accepted with correct context
 * - All invalid transitions are rejected with descriptive reasons
 * - Guard functions enforce preconditions accurately
 * - Terminal state detection works correctly
 * - The REQUEUED → ENQUEUED cycle works correctly
 *
 * The merge queue item state machine is critical for the merge pipeline (E013):
 * incorrect transitions could lead to merging un-validated code, skipping
 * rebase steps, or failing to requeue items that need retry.
 *
 * @see {@link file://packages/domain/src/state-machines/merge-queue-item-state-machine.ts}
 * @see {@link file://docs/prd/002-data-model.md} §2.2 Merge Queue Item State
 */

import { describe, it, expect } from "vitest";
import { MergeQueueItemStatus } from "../enums.js";
import {
  validateMergeQueueItemTransition,
  getValidMergeQueueItemTargets,
  isTerminalMergeQueueItemState,
  getAllValidMergeQueueItemTransitions,
} from "./merge-queue-item-state-machine.js";

// ─── Happy Path Transitions ─────────────────────────────────────────────────

describe("Merge Queue Item State Machine — Happy Path", () => {
  /**
   * Validates the complete happy-path lifecycle:
   * ENQUEUED → PREPARING → REBASING → VALIDATING → MERGING → MERGED.
   * This is the path every successful merge follows.
   */

  it("ENQUEUED → PREPARING: accepts when preparation started", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.ENQUEUED,
      MergeQueueItemStatus.PREPARING,
      { preparationStarted: true },
    );
    expect(result.valid).toBe(true);
  });

  it("ENQUEUED → PREPARING: rejects when preparation not started", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.ENQUEUED,
      MergeQueueItemStatus.PREPARING,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("preparation not started");
  });

  it("PREPARING → REBASING: accepts when workspace ready", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.PREPARING,
      MergeQueueItemStatus.REBASING,
      { workspaceReady: true },
    );
    expect(result.valid).toBe(true);
  });

  it("PREPARING → REBASING: rejects when workspace not ready", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.PREPARING,
      MergeQueueItemStatus.REBASING,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("workspace not ready");
  });

  it("REBASING → VALIDATING: accepts when rebase successful", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.REBASING,
      MergeQueueItemStatus.VALIDATING,
      { rebaseSuccessful: true },
    );
    expect(result.valid).toBe(true);
  });

  it("REBASING → VALIDATING: rejects when rebase not successful", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.REBASING,
      MergeQueueItemStatus.VALIDATING,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("rebase not successful");
  });

  it("VALIDATING → MERGING: accepts when validation passed", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.VALIDATING,
      MergeQueueItemStatus.MERGING,
      { validationPassed: true },
    );
    expect(result.valid).toBe(true);
  });

  it("VALIDATING → MERGING: rejects when validation not passed", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.VALIDATING,
      MergeQueueItemStatus.MERGING,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("validation not passed");
  });

  it("MERGING → MERGED: accepts when merge successful", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.MERGING,
      MergeQueueItemStatus.MERGED,
      { mergeSuccessful: true },
    );
    expect(result.valid).toBe(true);
  });

  it("MERGING → MERGED: rejects when merge not successful", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.MERGING,
      MergeQueueItemStatus.MERGED,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("merge not successful");
  });
});

// ─── Rebase Failure Paths ───────────────────────────────────────────────────

describe("Merge Queue Item State Machine — Rebase Failure Paths", () => {
  /**
   * Validates rebase failure handling. Rebase can fail with:
   * - Non-reworkable conflicts → FAILED (terminal)
   * - Reworkable conflicts → REQUEUED (can retry)
   * This is critical for merge conflict classification (T066).
   */

  it("REBASING → FAILED: accepts when rebase failed", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.REBASING,
      MergeQueueItemStatus.FAILED,
      { rebaseFailed: true },
    );
    expect(result.valid).toBe(true);
  });

  it("REBASING → FAILED: rejects when rebase has not failed", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.REBASING,
      MergeQueueItemStatus.FAILED,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("rebase has not failed");
  });

  it("REBASING → REQUEUED: accepts when rebase failed with reworkable conflict", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.REBASING,
      MergeQueueItemStatus.REQUEUED,
      { rebaseFailed: true, conflictReworkable: true },
    );
    expect(result.valid).toBe(true);
  });

  it("REBASING → REQUEUED: rejects when conflict not reworkable", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.REBASING,
      MergeQueueItemStatus.REQUEUED,
      { rebaseFailed: true, conflictReworkable: false },
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("conflict is not reworkable");
  });

  it("REBASING → REQUEUED: rejects when rebase has not failed", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.REBASING,
      MergeQueueItemStatus.REQUEUED,
      { conflictReworkable: true },
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("rebase has not failed");
  });
});

// ─── Validation Failure Paths ───────────────────────────────────────────────

describe("Merge Queue Item State Machine — Validation Failure Paths", () => {
  /**
   * Validates pre-merge validation failure handling. Validation can fail with:
   * - Permanent failure → FAILED (terminal)
   * - Transient failure → REQUEUED (can retry)
   * - Preemption by higher-priority item → REQUEUED
   * This feeds into the validation runner (E011).
   */

  it("VALIDATING → FAILED: accepts when validation failed", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.VALIDATING,
      MergeQueueItemStatus.FAILED,
      { validationFailed: true },
    );
    expect(result.valid).toBe(true);
  });

  it("VALIDATING → FAILED: rejects when validation has not failed", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.VALIDATING,
      MergeQueueItemStatus.FAILED,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("validation has not failed");
  });

  it("VALIDATING → REQUEUED: accepts with transient validation failure", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.VALIDATING,
      MergeQueueItemStatus.REQUEUED,
      { validationFailed: true, failureTransient: true },
    );
    expect(result.valid).toBe(true);
  });

  it("VALIDATING → REQUEUED: accepts when preempted", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.VALIDATING,
      MergeQueueItemStatus.REQUEUED,
      { preempted: true },
    );
    expect(result.valid).toBe(true);
  });

  it("VALIDATING → REQUEUED: rejects without transient failure or preemption", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.VALIDATING,
      MergeQueueItemStatus.REQUEUED,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("transient validation failure or preemption");
  });

  it("VALIDATING → REQUEUED: rejects with non-transient validation failure", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.VALIDATING,
      MergeQueueItemStatus.REQUEUED,
      { validationFailed: true, failureTransient: false },
    );
    expect(result.valid).toBe(false);
  });
});

// ─── Merge Failure Paths ────────────────────────────────────────────────────

describe("Merge Queue Item State Machine — Merge Failure Paths", () => {
  /**
   * Validates merge execution failure handling. The merge itself can fail:
   * - Irrecoverable failure → FAILED (terminal)
   * - Transient failure (e.g., git error) → REQUEUED (can retry)
   */

  it("MERGING → FAILED: accepts when merge failed", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.MERGING,
      MergeQueueItemStatus.FAILED,
      { mergeFailed: true },
    );
    expect(result.valid).toBe(true);
  });

  it("MERGING → FAILED: rejects when merge has not failed", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.MERGING,
      MergeQueueItemStatus.FAILED,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("merge has not failed");
  });

  it("MERGING → REQUEUED: accepts with transient merge failure", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.MERGING,
      MergeQueueItemStatus.REQUEUED,
      { mergeFailed: true, failureTransient: true },
    );
    expect(result.valid).toBe(true);
  });

  it("MERGING → REQUEUED: rejects when merge has not failed", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.MERGING,
      MergeQueueItemStatus.REQUEUED,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("merge has not failed");
  });

  it("MERGING → REQUEUED: rejects with non-transient failure", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.MERGING,
      MergeQueueItemStatus.REQUEUED,
      { mergeFailed: true, failureTransient: false },
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("failure is not transient");
  });
});

// ─── Requeue Cycle ──────────────────────────────────────────────────────────

describe("Merge Queue Item State Machine — Requeue Cycle", () => {
  /**
   * Validates the REQUEUED → ENQUEUED transition, which allows items
   * to re-enter the merge queue for another attempt. This is important
   * for transient failures and preemption recovery.
   */

  it("REQUEUED → ENQUEUED: accepts unconditionally", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.REQUEUED,
      MergeQueueItemStatus.ENQUEUED,
    );
    expect(result.valid).toBe(true);
  });
});

// ─── Invalid Transitions ────────────────────────────────────────────────────

describe("Merge Queue Item State Machine — Invalid Transitions", () => {
  /**
   * Validates that structurally invalid transitions are rejected.
   * These represent impossible state changes in the merge queue lifecycle.
   */

  it("rejects self-transitions", () => {
    for (const state of Object.values(MergeQueueItemStatus)) {
      const result = validateMergeQueueItemTransition(state, state);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("to itself");
    }
  });

  it("rejects backward transitions (MERGING → ENQUEUED)", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.MERGING,
      MergeQueueItemStatus.ENQUEUED,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not a valid merge queue item state transition");
  });

  it("rejects skipping states (ENQUEUED → MERGING)", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.ENQUEUED,
      MergeQueueItemStatus.MERGING,
    );
    expect(result.valid).toBe(false);
  });

  it("rejects transitions from terminal MERGED state", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.MERGED,
      MergeQueueItemStatus.ENQUEUED,
    );
    expect(result.valid).toBe(false);
  });

  it("rejects transitions from terminal FAILED state", () => {
    const result = validateMergeQueueItemTransition(
      MergeQueueItemStatus.FAILED,
      MergeQueueItemStatus.ENQUEUED,
    );
    expect(result.valid).toBe(false);
  });
});

// ─── Utility Functions ──────────────────────────────────────────────────────

describe("Merge Queue Item State Machine — Utility Functions", () => {
  /**
   * Validates the helper functions that support UI display, testing,
   * and documentation generation.
   */

  describe("getValidMergeQueueItemTargets", () => {
    it("returns correct targets for ENQUEUED", () => {
      const targets = getValidMergeQueueItemTargets(MergeQueueItemStatus.ENQUEUED);
      expect(targets).toEqual([MergeQueueItemStatus.PREPARING]);
    });

    it("returns correct targets for REBASING (multiple paths)", () => {
      const targets = getValidMergeQueueItemTargets(MergeQueueItemStatus.REBASING);
      expect(targets).toContain(MergeQueueItemStatus.VALIDATING);
      expect(targets).toContain(MergeQueueItemStatus.FAILED);
      expect(targets).toContain(MergeQueueItemStatus.REQUEUED);
      expect(targets).toHaveLength(3);
    });

    it("returns correct targets for MERGING (multiple paths)", () => {
      const targets = getValidMergeQueueItemTargets(MergeQueueItemStatus.MERGING);
      expect(targets).toContain(MergeQueueItemStatus.MERGED);
      expect(targets).toContain(MergeQueueItemStatus.FAILED);
      expect(targets).toContain(MergeQueueItemStatus.REQUEUED);
      expect(targets).toHaveLength(3);
    });

    it("returns correct targets for REQUEUED (re-enters queue)", () => {
      const targets = getValidMergeQueueItemTargets(MergeQueueItemStatus.REQUEUED);
      expect(targets).toEqual([MergeQueueItemStatus.ENQUEUED]);
    });

    it("returns empty array for terminal states", () => {
      expect(getValidMergeQueueItemTargets(MergeQueueItemStatus.MERGED)).toEqual([]);
      expect(getValidMergeQueueItemTargets(MergeQueueItemStatus.FAILED)).toEqual([]);
    });
  });

  describe("isTerminalMergeQueueItemState", () => {
    it("identifies MERGED as terminal", () => {
      expect(isTerminalMergeQueueItemState(MergeQueueItemStatus.MERGED)).toBe(true);
    });

    it("identifies FAILED as terminal", () => {
      expect(isTerminalMergeQueueItemState(MergeQueueItemStatus.FAILED)).toBe(true);
    });

    it("identifies REQUEUED as non-terminal", () => {
      expect(isTerminalMergeQueueItemState(MergeQueueItemStatus.REQUEUED)).toBe(false);
    });

    it("identifies ENQUEUED as non-terminal", () => {
      expect(isTerminalMergeQueueItemState(MergeQueueItemStatus.ENQUEUED)).toBe(false);
    });
  });

  describe("getAllValidMergeQueueItemTransitions", () => {
    it("returns correct number of transitions", () => {
      const transitions = getAllValidMergeQueueItemTransitions();
      // 5 happy + 2 rebase failure + 2 validation failure + 2 merge failure + 1 requeue = 12
      expect(transitions.length).toBe(12);
    });

    it("includes the REQUEUED → ENQUEUED cycle", () => {
      const transitions = getAllValidMergeQueueItemTransitions();
      const requeue = transitions.find(
        ([from, to]) =>
          from === MergeQueueItemStatus.REQUEUED && to === MergeQueueItemStatus.ENQUEUED,
      );
      expect(requeue).toBeDefined();
    });

    it("every transition is validated as structurally valid", () => {
      const transitions = getAllValidMergeQueueItemTransitions();
      for (const [from, to] of transitions) {
        const result = validateMergeQueueItemTransition(from, to);
        if (!result.valid) {
          expect(result.reason).not.toContain("not a valid merge queue item state transition");
        }
      }
    });
  });
});
