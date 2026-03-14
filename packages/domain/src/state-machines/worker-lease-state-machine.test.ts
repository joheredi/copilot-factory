/**
 * Tests for the Worker Lease state machine.
 *
 * These tests verify the complete worker lease lifecycle from PRD §2.2,
 * ensuring that:
 * - All valid transitions are accepted with correct context
 * - All invalid transitions are rejected with descriptive reasons
 * - Guard functions enforce preconditions accurately
 * - Terminal state detection works correctly
 * - The HEARTBEATING self-loop is handled correctly
 *
 * The worker lease state machine is critical for lease management (E006):
 * incorrect transitions could lead to orphaned workers, zombie leases,
 * or concurrent execution on the same task.
 *
 * @see {@link file://packages/domain/src/state-machines/worker-lease-state-machine.ts}
 * @see {@link file://docs/prd/002-data-model.md} §2.2 Worker Lease State
 */

import { describe, it, expect } from "vitest";
import { WorkerLeaseStatus } from "../enums.js";
import {
  validateWorkerLeaseTransition,
  getValidWorkerLeaseTargets,
  isTerminalWorkerLeaseState,
  getAllValidWorkerLeaseTransitions,
} from "./worker-lease-state-machine.js";

// ─── Happy Path Transitions ─────────────────────────────────────────────────

describe("Worker Lease State Machine — Happy Path", () => {
  /**
   * Validates the complete happy-path lifecycle: IDLE → LEASED → STARTING → RUNNING →
   * HEARTBEATING → COMPLETING. This is the critical path that every successful worker
   * execution follows.
   */

  it("IDLE → LEASED: accepts when lease is acquired", () => {
    const result = validateWorkerLeaseTransition(WorkerLeaseStatus.IDLE, WorkerLeaseStatus.LEASED, {
      leaseAcquired: true,
    });
    expect(result.valid).toBe(true);
  });

  it("IDLE → LEASED: rejects when lease is not acquired", () => {
    const result = validateWorkerLeaseTransition(WorkerLeaseStatus.IDLE, WorkerLeaseStatus.LEASED);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("lease not acquired");
  });

  it("LEASED → STARTING: accepts when worker process is spawned", () => {
    const result = validateWorkerLeaseTransition(
      WorkerLeaseStatus.LEASED,
      WorkerLeaseStatus.STARTING,
      { workerProcessSpawned: true },
    );
    expect(result.valid).toBe(true);
  });

  it("LEASED → STARTING: rejects when worker process not spawned", () => {
    const result = validateWorkerLeaseTransition(
      WorkerLeaseStatus.LEASED,
      WorkerLeaseStatus.STARTING,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("worker process not spawned");
  });

  it("STARTING → RUNNING: accepts when first heartbeat received", () => {
    const result = validateWorkerLeaseTransition(
      WorkerLeaseStatus.STARTING,
      WorkerLeaseStatus.RUNNING,
      { firstHeartbeatReceived: true },
    );
    expect(result.valid).toBe(true);
  });

  it("STARTING → RUNNING: rejects when first heartbeat not received", () => {
    const result = validateWorkerLeaseTransition(
      WorkerLeaseStatus.STARTING,
      WorkerLeaseStatus.RUNNING,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("first heartbeat not received");
  });

  it("RUNNING → HEARTBEATING: accepts when heartbeat received", () => {
    const result = validateWorkerLeaseTransition(
      WorkerLeaseStatus.RUNNING,
      WorkerLeaseStatus.HEARTBEATING,
      { heartbeatReceived: true },
    );
    expect(result.valid).toBe(true);
  });

  it("RUNNING → HEARTBEATING: rejects when heartbeat not received", () => {
    const result = validateWorkerLeaseTransition(
      WorkerLeaseStatus.RUNNING,
      WorkerLeaseStatus.HEARTBEATING,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("heartbeat not received");
  });

  it("RUNNING → COMPLETING: accepts when completion signal received", () => {
    const result = validateWorkerLeaseTransition(
      WorkerLeaseStatus.RUNNING,
      WorkerLeaseStatus.COMPLETING,
      { completionSignalReceived: true },
    );
    expect(result.valid).toBe(true);
  });

  it("HEARTBEATING → COMPLETING: accepts when completion signal received", () => {
    const result = validateWorkerLeaseTransition(
      WorkerLeaseStatus.HEARTBEATING,
      WorkerLeaseStatus.COMPLETING,
      { completionSignalReceived: true },
    );
    expect(result.valid).toBe(true);
  });

  it("STARTING → COMPLETING: accepts for fast-completing workers", () => {
    const result = validateWorkerLeaseTransition(
      WorkerLeaseStatus.STARTING,
      WorkerLeaseStatus.COMPLETING,
      { completionSignalReceived: true },
    );
    expect(result.valid).toBe(true);
  });

  it("→ COMPLETING: rejects when completion signal not received", () => {
    const result = validateWorkerLeaseTransition(
      WorkerLeaseStatus.RUNNING,
      WorkerLeaseStatus.COMPLETING,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("no completion signal received");
  });
});

// ─── HEARTBEATING Self-Loop ─────────────────────────────────────────────────

describe("Worker Lease State Machine — Heartbeat Self-Loop", () => {
  /**
   * The HEARTBEATING state has a unique self-loop: HEARTBEATING → HEARTBEATING.
   * This represents continuous heartbeats from the worker. No other state
   * allows self-transitions.
   */

  it("HEARTBEATING → HEARTBEATING: accepts when heartbeat received (self-loop)", () => {
    const result = validateWorkerLeaseTransition(
      WorkerLeaseStatus.HEARTBEATING,
      WorkerLeaseStatus.HEARTBEATING,
      { heartbeatReceived: true },
    );
    expect(result.valid).toBe(true);
  });

  it("HEARTBEATING → HEARTBEATING: rejects when heartbeat not received", () => {
    const result = validateWorkerLeaseTransition(
      WorkerLeaseStatus.HEARTBEATING,
      WorkerLeaseStatus.HEARTBEATING,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("heartbeat not received");
  });

  it("rejects self-transitions for non-HEARTBEATING states", () => {
    const nonHeartbeatingStates = Object.values(WorkerLeaseStatus).filter(
      (s) => s !== WorkerLeaseStatus.HEARTBEATING,
    );

    for (const state of nonHeartbeatingStates) {
      const result = validateWorkerLeaseTransition(state, state);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("to itself");
    }
  });
});

// ─── Timeout Paths ──────────────────────────────────────────────────────────

describe("Worker Lease State Machine — Timeout Paths", () => {
  /**
   * Validates that timeout transitions are correctly guarded. Workers that
   * stop sending heartbeats must be detected and transitioned to TIMED_OUT.
   * This is critical for lease staleness detection (T031).
   */

  it.each([WorkerLeaseStatus.STARTING, WorkerLeaseStatus.RUNNING, WorkerLeaseStatus.HEARTBEATING])(
    "%s → TIMED_OUT: accepts when heartbeat timed out",
    (from) => {
      const result = validateWorkerLeaseTransition(from, WorkerLeaseStatus.TIMED_OUT, {
        heartbeatTimedOut: true,
      });
      expect(result.valid).toBe(true);
    },
  );

  it.each([WorkerLeaseStatus.STARTING, WorkerLeaseStatus.RUNNING, WorkerLeaseStatus.HEARTBEATING])(
    "%s → TIMED_OUT: rejects when heartbeat not timed out",
    (from) => {
      const result = validateWorkerLeaseTransition(from, WorkerLeaseStatus.TIMED_OUT);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("heartbeat timeout not expired");
    },
  );
});

// ─── Crash Paths ────────────────────────────────────────────────────────────

describe("Worker Lease State Machine — Crash Paths", () => {
  /**
   * Validates that crash transitions are correctly guarded. Workers that
   * exit abnormally must be detected and transitioned to CRASHED.
   * This feeds into crash recovery (T034).
   */

  it.each([WorkerLeaseStatus.STARTING, WorkerLeaseStatus.RUNNING, WorkerLeaseStatus.HEARTBEATING])(
    "%s → CRASHED: accepts when worker crashed",
    (from) => {
      const result = validateWorkerLeaseTransition(from, WorkerLeaseStatus.CRASHED, {
        workerCrashed: true,
      });
      expect(result.valid).toBe(true);
    },
  );

  it.each([WorkerLeaseStatus.STARTING, WorkerLeaseStatus.RUNNING, WorkerLeaseStatus.HEARTBEATING])(
    "%s → CRASHED: rejects when worker has not crashed",
    (from) => {
      const result = validateWorkerLeaseTransition(from, WorkerLeaseStatus.CRASHED);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("worker has not crashed");
    },
  );
});

// ─── Reclaim Paths ──────────────────────────────────────────────────────────

describe("Worker Lease State Machine — Reclaim Paths", () => {
  /**
   * Validates that reclaim transitions are correctly guarded. Only TIMED_OUT
   * and CRASHED leases can be reclaimed by the orchestrator. This is critical
   * for stale lease reclaim (T033).
   */

  it.each([WorkerLeaseStatus.TIMED_OUT, WorkerLeaseStatus.CRASHED])(
    "%s → RECLAIMED: accepts when reclaim requested",
    (from) => {
      const result = validateWorkerLeaseTransition(from, WorkerLeaseStatus.RECLAIMED, {
        reclaimRequested: true,
      });
      expect(result.valid).toBe(true);
    },
  );

  it.each([WorkerLeaseStatus.TIMED_OUT, WorkerLeaseStatus.CRASHED])(
    "%s → RECLAIMED: rejects when reclaim not requested",
    (from) => {
      const result = validateWorkerLeaseTransition(from, WorkerLeaseStatus.RECLAIMED);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("reclaim not requested");
    },
  );
});

// ─── Invalid Transitions ────────────────────────────────────────────────────

describe("Worker Lease State Machine — Invalid Transitions", () => {
  /**
   * Validates that structurally invalid transitions are rejected.
   * These represent impossible state changes that should never occur
   * (e.g., going backward, skipping states).
   */

  it("rejects backward transitions (RUNNING → IDLE)", () => {
    const result = validateWorkerLeaseTransition(WorkerLeaseStatus.RUNNING, WorkerLeaseStatus.IDLE);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not a valid worker lease state transition");
  });

  it("rejects skipping states (IDLE → RUNNING)", () => {
    const result = validateWorkerLeaseTransition(WorkerLeaseStatus.IDLE, WorkerLeaseStatus.RUNNING);
    expect(result.valid).toBe(false);
  });

  it("rejects transitions from terminal COMPLETING state", () => {
    const result = validateWorkerLeaseTransition(
      WorkerLeaseStatus.COMPLETING,
      WorkerLeaseStatus.IDLE,
    );
    expect(result.valid).toBe(false);
  });

  it("rejects transitions from terminal RECLAIMED state", () => {
    const result = validateWorkerLeaseTransition(
      WorkerLeaseStatus.RECLAIMED,
      WorkerLeaseStatus.IDLE,
    );
    expect(result.valid).toBe(false);
  });
});

// ─── Utility Functions ──────────────────────────────────────────────────────

describe("Worker Lease State Machine — Utility Functions", () => {
  /**
   * Validates the helper functions that support UI display, testing,
   * and documentation generation.
   */

  describe("getValidWorkerLeaseTargets", () => {
    it("returns correct targets for IDLE", () => {
      const targets = getValidWorkerLeaseTargets(WorkerLeaseStatus.IDLE);
      expect(targets).toEqual([WorkerLeaseStatus.LEASED]);
    });

    it("returns correct targets for RUNNING (multiple paths)", () => {
      const targets = getValidWorkerLeaseTargets(WorkerLeaseStatus.RUNNING);
      expect(targets).toContain(WorkerLeaseStatus.HEARTBEATING);
      expect(targets).toContain(WorkerLeaseStatus.COMPLETING);
      expect(targets).toContain(WorkerLeaseStatus.TIMED_OUT);
      expect(targets).toContain(WorkerLeaseStatus.CRASHED);
      expect(targets).toHaveLength(4);
    });

    it("returns correct targets for HEARTBEATING (includes self-loop)", () => {
      const targets = getValidWorkerLeaseTargets(WorkerLeaseStatus.HEARTBEATING);
      expect(targets).toContain(WorkerLeaseStatus.HEARTBEATING);
      expect(targets).toContain(WorkerLeaseStatus.COMPLETING);
      expect(targets).toContain(WorkerLeaseStatus.TIMED_OUT);
      expect(targets).toContain(WorkerLeaseStatus.CRASHED);
      expect(targets).toHaveLength(4);
    });

    it("returns empty array for terminal state COMPLETING", () => {
      const targets = getValidWorkerLeaseTargets(WorkerLeaseStatus.COMPLETING);
      expect(targets).toEqual([]);
    });

    it("returns empty array for terminal state RECLAIMED", () => {
      const targets = getValidWorkerLeaseTargets(WorkerLeaseStatus.RECLAIMED);
      expect(targets).toEqual([]);
    });
  });

  describe("isTerminalWorkerLeaseState", () => {
    it("identifies COMPLETING as terminal", () => {
      expect(isTerminalWorkerLeaseState(WorkerLeaseStatus.COMPLETING)).toBe(true);
    });

    it("identifies RECLAIMED as terminal", () => {
      expect(isTerminalWorkerLeaseState(WorkerLeaseStatus.RECLAIMED)).toBe(true);
    });

    it("identifies TIMED_OUT as non-terminal (can be reclaimed)", () => {
      expect(isTerminalWorkerLeaseState(WorkerLeaseStatus.TIMED_OUT)).toBe(false);
    });

    it("identifies CRASHED as non-terminal (can be reclaimed)", () => {
      expect(isTerminalWorkerLeaseState(WorkerLeaseStatus.CRASHED)).toBe(false);
    });

    it("identifies IDLE as non-terminal", () => {
      expect(isTerminalWorkerLeaseState(WorkerLeaseStatus.IDLE)).toBe(false);
    });
  });

  describe("getAllValidWorkerLeaseTransitions", () => {
    it("returns all transitions including the self-loop", () => {
      const transitions = getAllValidWorkerLeaseTransitions();
      // Happy path: IDLE→LEASED, LEASED→STARTING, STARTING→RUNNING, RUNNING→HEARTBEATING,
      //   HEARTBEATING→HEARTBEATING (self-loop), RUNNING→COMPLETING, HEARTBEATING→COMPLETING,
      //   STARTING→COMPLETING (fast worker) = 8
      // Timeout: STARTING→TIMED_OUT, RUNNING→TIMED_OUT, HEARTBEATING→TIMED_OUT = 3
      // Crash: STARTING→CRASHED, RUNNING→CRASHED, HEARTBEATING→CRASHED = 3
      // Reclaim: TIMED_OUT→RECLAIMED, CRASHED→RECLAIMED = 2
      // Total = 16
      expect(transitions.length).toBe(16);
    });

    it("includes HEARTBEATING self-loop", () => {
      const transitions = getAllValidWorkerLeaseTransitions();
      const selfLoop = transitions.find(
        ([from, to]) =>
          from === WorkerLeaseStatus.HEARTBEATING && to === WorkerLeaseStatus.HEARTBEATING,
      );
      expect(selfLoop).toBeDefined();
    });

    it("every transition is validated as structurally valid", () => {
      const transitions = getAllValidWorkerLeaseTransitions();
      for (const [from, to] of transitions) {
        // We just check structurally — guards may reject without context
        const result = validateWorkerLeaseTransition(from, to);
        // If valid, guard passed. If invalid, it should be due to missing context, not structure.
        if (!result.valid) {
          expect(result.reason).not.toContain("not a valid worker lease state transition");
        }
      }
    });
  });
});
