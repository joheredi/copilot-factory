/**
 * Two-phase shutdown for the Autonomous Software Factory CLI.
 *
 * Provides graceful drain on first Ctrl+C (SIGINT) and force-kill on
 * the second. SIGTERM triggers the same graceful path as the first SIGINT.
 *
 * Phase 1 (graceful): Polls the SQLite database for active worker leases,
 * waiting up to a configurable timeout for them to complete. Then flushes
 * OpenTelemetry traces and closes the NestJS application.
 *
 * Phase 2 (force): Sends SIGKILL to all tracked child process PIDs and
 * exits immediately with code 1.
 *
 * @see docs/backlog/tasks/T147-two-phase-shutdown.md — task specification
 * @see docs/prd/007-technical-architecture.md §7.1 — lifecycle rationale
 * @module @copilot/factory
 */

import Database from "better-sqlite3";

/**
 * Module-level set for tracking child process PIDs.
 *
 * The worker supervisor populates this set when spawning worker processes.
 * On force shutdown (second Ctrl+C), all PIDs in this set receive SIGKILL.
 * The set is exported so that the worker runtime layer can register PIDs
 * without tight coupling to the shutdown module.
 */
export const childPids: Set<number> = new Set();

/** Active lease states that indicate a worker is doing work. */
const ACTIVE_LEASE_STATES = ["STARTING", "RUNNING", "HEARTBEATING", "COMPLETING"] as const;

/** Default drain timeout in milliseconds (30 seconds). */
const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;

/** Default polling interval in milliseconds (2 seconds). */
const DEFAULT_POLL_INTERVAL_MS = 2_000;

/**
 * Result of a drain operation, indicating whether it completed because
 * all leases finished or because the timeout was reached.
 */
export interface DrainResult {
  /** Whether all active leases completed before the timeout. */
  drained: boolean;
  /** Number of active leases remaining when drain finished. */
  remainingLeases: number;
  /** Total milliseconds spent draining. */
  elapsedMs: number;
}

/**
 * Counts the number of active (non-terminal) worker leases in the database.
 *
 * Opens a short-lived read-only SQLite connection to query the task_lease
 * table. Uses the same pattern as `queryProjectCount` in startup.ts to
 * avoid interfering with the NestJS application's write connection.
 *
 * @param dbPath - Absolute path to the SQLite database file.
 * @returns Number of leases in active states (STARTING, RUNNING,
 *   HEARTBEATING, COMPLETING), or 0 if the table doesn't exist or the
 *   query fails.
 */
export function countActiveLeases(dbPath: string): number {
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const placeholders = ACTIVE_LEASE_STATES.map(() => "?").join(", ");
      const row = db
        .prepare(`SELECT COUNT(*) AS cnt FROM task_lease WHERE status IN (${placeholders})`)
        .get(...ACTIVE_LEASE_STATES) as { cnt: number } | undefined;
      return row?.cnt ?? 0;
    } finally {
      db.close();
    }
  } catch {
    // Table may not exist yet or DB may be empty — return 0
    return 0;
  }
}

/**
 * Polls the database for active leases until they all complete or the
 * timeout expires.
 *
 * This is the core drain logic for graceful shutdown. It checks the
 * database every `pollIntervalMs` milliseconds for leases in active
 * states. The drain resolves as soon as the count reaches zero or the
 * timeout is exceeded.
 *
 * @param dbPath - Absolute path to the SQLite database file.
 * @param timeoutMs - Maximum time to wait for leases to drain.
 * @param deps - Injectable dependencies for testing (timer, lease counter).
 * @returns A {@link DrainResult} indicating whether the drain completed.
 */
export async function drain(
  dbPath: string,
  timeoutMs: number = DEFAULT_DRAIN_TIMEOUT_MS,
  deps: {
    /** Override the polling interval (default: 2000ms). */
    pollIntervalMs?: number;
    /** Override the lease counter for testing. */
    countLeases?: (dbPath: string) => number;
    /** Override the timer function for testing. */
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<DrainResult> {
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const countLeases = deps.countLeases ?? countActiveLeases;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const startTime = Date.now();
  let remaining = countLeases(dbPath);

  while (remaining > 0) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      return { drained: false, remainingLeases: remaining, elapsedMs: elapsed };
    }
    await sleep(pollIntervalMs);
    remaining = countLeases(dbPath);
  }

  return { drained: true, remainingLeases: 0, elapsedMs: Date.now() - startTime };
}

/**
 * Sends SIGKILL to all tracked child process PIDs.
 *
 * Used during force shutdown (second Ctrl+C) to immediately terminate
 * all worker processes. Silently ignores PIDs that no longer exist
 * (e.g., already exited). Returns the count of successfully signaled
 * processes.
 *
 * @param pids - Set of child process PIDs to kill.
 * @returns Number of processes that were successfully signaled.
 */
export function forceKillChildren(pids: Set<number>): number {
  let killed = 0;
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
      killed++;
    } catch {
      // Process already dead — ignore
    }
  }
  return killed;
}

/**
 * Configuration for setting up two-phase shutdown handlers.
 */
export interface ShutdownConfig {
  /**
   * Async function that performs graceful app cleanup.
   * Typically calls `app.close()` followed by `tracingHandle.shutdown()`.
   */
  shutdown: () => Promise<void>;
  /** Absolute path to the SQLite database file for lease polling. */
  dbPath: string;
  /** Set of child process PIDs to force-kill on second signal. */
  childPids: Set<number>;
  /** Maximum drain timeout in milliseconds (default: 30000). */
  drainTimeoutMs?: number;
  /**
   * Injectable process-like object for testing. When omitted, uses the
   * real `process` global.
   */
  processHandle?: ProcessHandle;
}

/**
 * Minimal process interface for signal handling and exit.
 *
 * Extracted to enable unit testing without triggering real process
 * signals or exits.
 */
export interface ProcessHandle {
  /** Register a signal handler. */
  on(signal: string, handler: () => void): void;
  /** Exit the process with a status code. */
  exit(code: number): never;
}

/**
 * Wires up SIGINT and SIGTERM handlers for two-phase shutdown.
 *
 * First signal (SIGINT or SIGTERM) initiates a graceful drain: polls the
 * database for active worker leases, waits up to `drainTimeoutMs` for them
 * to finish, then calls the provided `shutdown()` function and exits with
 * code 0.
 *
 * Second SIGINT during the drain phase force-kills all tracked child
 * processes and exits immediately with code 1.
 *
 * @param config - Shutdown configuration including dependencies and timeouts.
 *
 * @example
 * ```typescript
 * setupShutdownHandlers({
 *   shutdown: async () => { await app.close(); await tracing.shutdown(); },
 *   dbPath: "/home/user/.copilot-factory/factory.db",
 *   childPids,
 *   drainTimeoutMs: 30_000,
 * });
 * ```
 */
export function setupShutdownHandlers(config: ShutdownConfig): void {
  const {
    shutdown,
    dbPath,
    childPids: pids,
    drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
    processHandle,
  } = config;

  const proc = processHandle ?? (process as unknown as ProcessHandle);
  let draining = false;

  const handleSignal = (): void => {
    if (draining) {
      // Second signal — force kill all tracked child processes
      console.log("\n  ⚡ Force stopping...");
      const killed = forceKillChildren(pids);
      if (killed > 0) {
        console.log(`  Killed ${killed} worker process(es)`);
      }
      proc.exit(1);
      return;
    }

    draining = true;
    console.log(
      `\n  🛑 Shutting down gracefully... (${drainTimeoutMs / 1_000}s drain, Ctrl+C again to force)`,
    );

    drain(dbPath, drainTimeoutMs)
      .then((result) => {
        if (!result.drained) {
          console.log(
            `  ⚠️  Drain timeout reached — ${result.remainingLeases} worker(s) still active`,
          );
          console.log("  Workers will be recovered by the reconciliation sweep on next startup");
        } else if (result.elapsedMs > 0) {
          console.log(`  ✅ All workers drained in ${(result.elapsedMs / 1_000).toFixed(1)}s`);
        }
        return shutdown();
      })
      .then(() => {
        proc.exit(0);
      })
      .catch((err: unknown) => {
        console.error("  ❌ Error during shutdown:", err);
        proc.exit(1);
      });
  };

  proc.on("SIGINT", handleSignal);
  proc.on("SIGTERM", handleSignal);
}
