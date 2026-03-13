/**
 * Tests for the two-phase shutdown module.
 *
 * These tests validate the graceful drain, force-kill, and signal handler
 * wiring logic without triggering real process signals or exits. All
 * side-effectful operations are injected via dependency parameters.
 *
 * Why these tests matter:
 * - Incorrect shutdown ordering can cause data loss (unflushed telemetry),
 *   orphaned child processes, or database corruption.
 * - The two-phase signal handling has subtle state (draining flag) that
 *   must transition correctly between first and second signal.
 * - The drain polling loop must respect timeouts and not hang indefinitely.
 * - Force-kill must be resilient to already-dead processes (ESRCH errors).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { unlinkSync } from "node:fs";
import Database from "better-sqlite3";

import {
  countActiveLeases,
  drain,
  forceKillChildren,
  setupShutdownHandlers,
  childPids,
} from "./shutdown.js";
import type { ProcessHandle } from "./shutdown.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Creates a temporary SQLite database with a task_lease table
 * matching the production schema for lease status queries.
 */
function createTestDb(): { dbPath: string; db: InstanceType<typeof Database> } {
  const dbPath = `/tmp/factory-shutdown-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE task_lease (
      lease_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      pool_id TEXT NOT NULL,
      leased_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL,
      heartbeat_at INTEGER,
      status TEXT NOT NULL,
      reclaim_reason TEXT,
      partial_result_artifact_refs TEXT
    )
  `);
  return { dbPath, db };
}

/**
 * Inserts a lease row with the given status into the test database.
 */
function insertLease(db: InstanceType<typeof Database>, id: string, status: string): void {
  db.prepare(
    `INSERT INTO task_lease (lease_id, task_id, worker_id, pool_id, expires_at, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, `task-${id}`, `worker-${id}`, "pool-1", Math.floor(Date.now() / 1000) + 3600, status);
}

/**
 * Creates a fake ProcessHandle that records signal handlers and exit calls
 * for assertion in tests.
 */
function createFakeProcess(): ProcessHandle & {
  handlers: Map<string, (() => void)[]>;
  exitCalls: number[];
  emit: (signal: string) => void;
} {
  const handlers = new Map<string, (() => void)[]>();
  const exitCalls: number[] = [];

  return {
    handlers,
    exitCalls,
    on(signal: string, handler: () => void): void {
      const list = handlers.get(signal) ?? [];
      list.push(handler);
      handlers.set(signal, list);
    },
    exit(code: number): never {
      exitCalls.push(code);
      // Return instead of throwing to avoid unhandled promise rejections
      // in async shutdown chains. The `never` type is intentionally violated
      // here because the real `process.exit` never returns either.
      return undefined as never;
    },
    emit(signal: string): void {
      const list = handlers.get(signal) ?? [];
      for (const handler of list) {
        handler();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// countActiveLeases
// ---------------------------------------------------------------------------

describe("countActiveLeases", () => {
  let dbPath: string;
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    ({ dbPath, db } = createTestDb());
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  /**
   * Validates that an empty lease table returns zero. This is the steady-state
   * case when no workers are active and the factory is idle.
   */
  it("returns 0 when no leases exist", () => {
    db.close();
    expect(countActiveLeases(dbPath)).toBe(0);
  });

  /**
   * Validates that leases in active states (STARTING, RUNNING, HEARTBEATING,
   * COMPLETING) are counted. These represent workers that are actively doing
   * work and should prevent immediate shutdown.
   */
  it("counts leases in active states", () => {
    insertLease(db, "l1", "STARTING");
    insertLease(db, "l2", "RUNNING");
    insertLease(db, "l3", "HEARTBEATING");
    insertLease(db, "l4", "COMPLETING");
    db.close();

    expect(countActiveLeases(dbPath)).toBe(4);
  });

  /**
   * Validates that leases in terminal states (TIMED_OUT, CRASHED, RECLAIMED)
   * are NOT counted. These workers have already stopped and should not delay
   * shutdown.
   */
  it("ignores leases in terminal states", () => {
    insertLease(db, "l1", "TIMED_OUT");
    insertLease(db, "l2", "CRASHED");
    insertLease(db, "l3", "RECLAIMED");
    db.close();

    expect(countActiveLeases(dbPath)).toBe(0);
  });

  /**
   * Validates mixed active and terminal lease counting. In production, the
   * lease table will contain leases in various states from prior runs.
   */
  it("counts only active leases in mixed states", () => {
    insertLease(db, "l1", "RUNNING");
    insertLease(db, "l2", "HEARTBEATING");
    insertLease(db, "l3", "CRASHED");
    insertLease(db, "l4", "TIMED_OUT");
    insertLease(db, "l5", "COMPLETING");
    db.close();

    expect(countActiveLeases(dbPath)).toBe(3);
  });

  /**
   * Validates that IDLE and LEASED states (pre-dispatch) are not counted
   * as active. These represent leases that haven't started execution yet.
   */
  it("does not count IDLE or LEASED as active", () => {
    insertLease(db, "l1", "IDLE");
    insertLease(db, "l2", "LEASED");
    db.close();

    expect(countActiveLeases(dbPath)).toBe(0);
  });

  /**
   * Validates that querying a non-existent database returns 0 rather than
   * throwing. This handles the edge case where the DB file was deleted
   * between startup and shutdown.
   */
  it("returns 0 when database does not exist", () => {
    db.close();
    expect(countActiveLeases("/tmp/nonexistent-" + Date.now() + ".db")).toBe(0);
  });

  /**
   * Validates that querying a database without the task_lease table returns 0.
   * Handles the case where migrations haven't run but the DB file exists.
   */
  it("returns 0 when task_lease table does not exist", () => {
    db.close();
    const bareDbPath = `/tmp/factory-shutdown-bare-${Date.now()}.db`;
    const bareDb = new Database(bareDbPath);
    bareDb.exec("CREATE TABLE other (id TEXT)");
    bareDb.close();

    expect(countActiveLeases(bareDbPath)).toBe(0);

    try {
      unlinkSync(bareDbPath);
    } catch {
      /* ignore */
    }
  });
});

// ---------------------------------------------------------------------------
// drain
// ---------------------------------------------------------------------------

describe("drain", () => {
  /**
   * Validates that drain resolves immediately when no active leases exist.
   * This is the common case — most shutdowns happen when no workers are
   * running, and the drain should complete instantly.
   */
  it("resolves immediately when no active leases", async () => {
    const result = await drain("/tmp/nonexistent.db", 5_000, {
      countLeases: () => 0,
      sleep: vi.fn(),
    });

    expect(result.drained).toBe(true);
    expect(result.remainingLeases).toBe(0);
  });

  /**
   * Validates that drain polls and resolves when leases complete during
   * the polling window. Simulates workers finishing: first poll shows 2
   * active, second shows 1, third shows 0.
   */
  it("polls until leases drain to zero", async () => {
    let callCount = 0;
    const countLeases = (): number => {
      callCount++;
      if (callCount <= 1) return 2;
      if (callCount === 2) return 1;
      return 0;
    };
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    const result = await drain("/tmp/test.db", 10_000, {
      countLeases,
      sleep: sleepFn,
      pollIntervalMs: 100,
    });

    expect(result.drained).toBe(true);
    expect(result.remainingLeases).toBe(0);
    expect(sleepFn).toHaveBeenCalledWith(100);
  });

  /**
   * Validates that drain respects the timeout and returns a non-drained
   * result when leases don't complete in time. The DrainResult must
   * accurately report the remaining lease count for logging.
   */
  it("returns non-drained result when timeout expires", async () => {
    const countLeases = (): number => 3;
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    // Mock Date.now to simulate time passing
    const realNow = Date.now;
    let mockTime = realNow();
    vi.spyOn(Date, "now").mockImplementation(() => {
      const time = mockTime;
      mockTime += 2100; // Each call advances 2.1 seconds
      return time;
    });

    try {
      const result = await drain("/tmp/test.db", 5_000, {
        countLeases,
        sleep: sleepFn,
        pollIntervalMs: 2_000,
      });

      expect(result.drained).toBe(false);
      expect(result.remainingLeases).toBe(3);
    } finally {
      vi.spyOn(Date, "now").mockRestore();
    }
  });

  /**
   * Validates that drain uses the default poll interval (2s) when no
   * override is provided. This ensures the default behavior matches
   * the specification.
   */
  it("uses default poll interval of 2000ms", async () => {
    let calls = 0;
    const countLeases = (): number => {
      calls++;
      return calls <= 1 ? 1 : 0;
    };
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    await drain("/tmp/test.db", 30_000, {
      countLeases,
      sleep: sleepFn,
    });

    expect(sleepFn).toHaveBeenCalledWith(2_000);
  });
});

// ---------------------------------------------------------------------------
// forceKillChildren
// ---------------------------------------------------------------------------

describe("forceKillChildren", () => {
  /**
   * Validates that forceKillChildren returns 0 when the PID set is empty.
   * This is the common case when no workers have been spawned.
   */
  it("returns 0 when no PIDs are tracked", () => {
    const pids = new Set<number>();
    expect(forceKillChildren(pids)).toBe(0);
  });

  /**
   * Validates that forceKillChildren sends SIGKILL to each tracked PID.
   * Uses a spy to verify the signal without actually killing processes.
   */
  it("calls process.kill with SIGKILL for each PID", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const pids = new Set([111, 222, 333]);
    const killed = forceKillChildren(pids);

    expect(killed).toBe(3);
    expect(killSpy).toHaveBeenCalledWith(111, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(222, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(333, "SIGKILL");

    killSpy.mockRestore();
  });

  /**
   * Validates that forceKillChildren handles already-dead processes
   * gracefully by catching ESRCH errors. After a forced shutdown, some
   * worker processes may have already exited.
   */
  it("handles already-dead processes without throwing", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === 222) {
        throw new Error("ESRCH");
      }
      return true;
    });

    const pids = new Set([111, 222, 333]);
    const killed = forceKillChildren(pids);

    expect(killed).toBe(2); // 111 and 333 succeeded
    killSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// setupShutdownHandlers
// ---------------------------------------------------------------------------

describe("setupShutdownHandlers", () => {
  beforeEach(() => {
    childPids.clear();
  });

  /**
   * Validates that setupShutdownHandlers registers handlers for both
   * SIGINT and SIGTERM signals. Both signals must be handled to support
   * both Ctrl+C (SIGINT) and container orchestrator stop signals (SIGTERM).
   */
  it("registers handlers for SIGINT and SIGTERM", () => {
    const proc = createFakeProcess();

    setupShutdownHandlers({
      shutdown: vi.fn().mockResolvedValue(undefined),
      dbPath: "/tmp/test.db",
      childPids: new Set(),
      processHandle: proc,
    });

    expect(proc.handlers.get("SIGINT")).toHaveLength(1);
    expect(proc.handlers.get("SIGTERM")).toHaveLength(1);
  });

  /**
   * Validates that the first SIGINT triggers a graceful drain followed
   * by the shutdown function and exits with code 0. This is the happy
   * path for operator-initiated shutdown.
   */
  it("first SIGINT triggers graceful shutdown with exit code 0", async () => {
    const proc = createFakeProcess();
    const shutdownFn = vi.fn().mockResolvedValue(undefined);

    setupShutdownHandlers({
      shutdown: shutdownFn,
      dbPath: "/tmp/nonexistent.db",
      childPids: new Set(),
      drainTimeoutMs: 100,
      processHandle: proc,
    });

    // Emit SIGINT — the handler starts the drain asynchronously
    proc.emit("SIGINT");

    // Wait for the async drain + shutdown chain to complete
    await vi.waitFor(() => {
      expect(proc.exitCalls).toContain(0);
    });

    expect(shutdownFn).toHaveBeenCalledOnce();
  });

  /**
   * Validates that SIGTERM triggers the same graceful shutdown as the
   * first SIGINT. Container orchestrators (Docker, Kubernetes) send
   * SIGTERM to stop processes gracefully.
   */
  it("SIGTERM triggers same graceful shutdown as first SIGINT", async () => {
    const proc = createFakeProcess();
    const shutdownFn = vi.fn().mockResolvedValue(undefined);

    setupShutdownHandlers({
      shutdown: shutdownFn,
      dbPath: "/tmp/nonexistent.db",
      childPids: new Set(),
      drainTimeoutMs: 100,
      processHandle: proc,
    });

    proc.emit("SIGTERM");

    await vi.waitFor(() => {
      expect(proc.exitCalls).toContain(0);
    });

    expect(shutdownFn).toHaveBeenCalledOnce();
  });

  /**
   * Validates that a second SIGINT during the drain phase triggers force
   * kill of tracked child processes and exits with code 1. This is the
   * "panic button" path for operators who need immediate shutdown.
   */
  it("second SIGINT during drain triggers force kill with exit code 1", async () => {
    const proc = createFakeProcess();
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    // Use a shutdown that never resolves to simulate a long drain
    const shutdownFn = vi.fn().mockReturnValue(new Promise(() => {}));
    const pids = new Set([999, 888]);

    setupShutdownHandlers({
      shutdown: shutdownFn,
      dbPath: "/tmp/nonexistent.db",
      childPids: pids,
      drainTimeoutMs: 60_000, // Long timeout so drain doesn't complete
      processHandle: proc,
    });

    // First SIGINT starts the drain
    proc.emit("SIGINT");

    // Brief delay to let the async drain start
    await new Promise((r) => setTimeout(r, 50));

    // Second SIGINT should force kill
    proc.emit("SIGINT");

    expect(proc.exitCalls).toContain(1);
    expect(killSpy).toHaveBeenCalledWith(999, "SIGKILL");
    expect(killSpy).toHaveBeenCalledWith(888, "SIGKILL");

    killSpy.mockRestore();
  });

  /**
   * Validates that the second SIGINT works even with no tracked child PIDs.
   * This covers the case where no workers have been spawned yet but the
   * operator wants to force-exit.
   */
  it("second SIGINT with no child PIDs exits with code 1", async () => {
    const proc = createFakeProcess();

    // Shutdown that never resolves
    const shutdownFn = vi.fn().mockReturnValue(new Promise(() => {}));

    setupShutdownHandlers({
      shutdown: shutdownFn,
      dbPath: "/tmp/nonexistent.db",
      childPids: new Set(),
      drainTimeoutMs: 60_000,
      processHandle: proc,
    });

    proc.emit("SIGINT");
    await new Promise((r) => setTimeout(r, 50));

    proc.emit("SIGINT");

    expect(proc.exitCalls).toContain(1);
  });

  /**
   * Validates that shutdown errors result in exit code 1. If the NestJS
   * app fails to close or tracing fails to flush, the factory should
   * still exit rather than hanging.
   */
  it("exits with code 1 when shutdown() rejects", async () => {
    const proc = createFakeProcess();
    const shutdownFn = vi.fn().mockRejectedValue(new Error("shutdown failed"));

    setupShutdownHandlers({
      shutdown: shutdownFn,
      dbPath: "/tmp/nonexistent.db",
      childPids: new Set(),
      drainTimeoutMs: 100,
      processHandle: proc,
    });

    proc.emit("SIGINT");

    await vi.waitFor(() => {
      expect(proc.exitCalls).toContain(1);
    });
  });
});

// ---------------------------------------------------------------------------
// childPids module export
// ---------------------------------------------------------------------------

describe("childPids", () => {
  afterEach(() => {
    childPids.clear();
  });

  /**
   * Validates that childPids is a module-level Set that can be populated
   * externally. The worker supervisor imports this set and adds PIDs when
   * spawning worker processes.
   */
  it("is an initially empty Set<number>", () => {
    expect(childPids).toBeInstanceOf(Set);
    expect(childPids.size).toBe(0);
  });

  /**
   * Validates that PIDs added to childPids are visible to forceKillChildren.
   * This tests the contract between the worker supervisor (which populates
   * the set) and the shutdown module (which reads it).
   */
  it("PIDs added are visible to forceKillChildren", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    childPids.add(12345);
    childPids.add(67890);

    const killed = forceKillChildren(childPids);
    expect(killed).toBe(2);

    killSpy.mockRestore();
  });
});
