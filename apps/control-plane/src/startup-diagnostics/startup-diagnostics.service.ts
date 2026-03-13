/**
 * Startup diagnostics service for the control-plane.
 *
 * Runs once during NestJS application bootstrap (after all modules are
 * initialized, before the server starts listening) to query the database
 * for pending recovery items from a previous unclean shutdown.
 *
 * This is a **read-only diagnostic** — it does not modify any state. The
 * actual recovery is handled by the reconciliation sweep service
 * ({@link file://packages/application/src/services/reconciliation-sweep.service.ts}).
 *
 * Detection thresholds match the reconciliation sweep defaults:
 * - Stale leases: heartbeat older than 75 s (30 s interval × 2 misses + 15 s grace)
 * - Orphaned jobs: CLAIMED/RUNNING jobs not updated in 10 minutes
 * - Stuck tasks: ASSIGNED tasks not updated in 5 minutes
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T148-startup-recovery-log.md}
 */
import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";

import { createLogger, type Logger } from "@factory/observability";

import { DATABASE_CONNECTION } from "../infrastructure/database/database.module.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";

/**
 * Default staleness window in milliseconds.
 *
 * Matches the reconciliation sweep's default staleness policy:
 * `heartbeatIntervalSeconds(30) × missedHeartbeatThreshold(2) + gracePeriodSeconds(15) = 75 s`
 */
export const DEFAULT_STALE_LEASE_WINDOW_MS = 75_000;

/**
 * Default orphaned-job timeout in milliseconds.
 *
 * Jobs in CLAIMED or RUNNING state that have not been updated within this
 * window are considered orphaned.
 */
export const DEFAULT_ORPHANED_JOB_TIMEOUT_MS = 10 * 60_000;

/**
 * Default stuck-task timeout in milliseconds.
 *
 * Tasks in ASSIGNED state that have not been updated within this window
 * are considered stuck.
 */
export const DEFAULT_STUCK_TASK_TIMEOUT_MS = 5 * 60_000;

/** Result of the startup diagnostics check. */
export interface StartupDiagnosticsResult {
  /** Number of leases with stale heartbeats. */
  readonly staleLeases: number;
  /** Number of jobs stuck in CLAIMED or RUNNING state. */
  readonly orphanedJobs: number;
  /** Number of tasks stuck in ASSIGNED state without progress. */
  readonly stuckTasks: number;
  /** Whether any recovery items were detected. */
  readonly needsRecovery: boolean;
}

/** Row shape returned by COUNT(*) queries. */
interface CountRow {
  readonly count: number;
}

/**
 * Logs a one-time recovery-status summary during application startup.
 *
 * Implements {@link OnApplicationBootstrap} so the diagnostic runs after
 * all NestJS modules (including DatabaseModule) are fully initialized.
 * The service issues three lightweight COUNT queries to detect items the
 * reconciliation sweep will process, then logs a single structured summary.
 */
@Injectable()
export class StartupDiagnosticsService implements OnApplicationBootstrap {
  private readonly logger: Logger = createLogger("startup-diagnostics");

  /** Injected database connection for direct SQL queries. */
  constructor(@Inject(DATABASE_CONNECTION) private readonly conn: DatabaseConnection) {}

  /**
   * NestJS lifecycle hook — called after all modules are initialized.
   *
   * Runs the recovery diagnostics and logs the summary. Errors are caught
   * and logged rather than propagated, so a diagnostic failure never
   * prevents the application from starting.
   */
  onApplicationBootstrap(): void {
    try {
      const result = this.checkRecoveryStatus();
      this.logRecoverySummary(result);
    } catch (error: unknown) {
      this.logger.warn("Startup diagnostics check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Query the database for pending recovery items.
   *
   * Executes three COUNT queries against the task_lease, job, and task
   * tables using the same thresholds as the reconciliation sweep service.
   * All queries are read-only and use the raw SQLite driver for efficiency.
   *
   * @param now - Current time for calculating deadlines. Defaults to `new Date()`.
   *              Exposed as a parameter for deterministic testing.
   * @returns Counts of stale leases, orphaned jobs, and stuck tasks.
   */
  checkRecoveryStatus(now: Date = new Date()): StartupDiagnosticsResult {
    const staleLeases = this.countStaleLeases(now);
    const orphanedJobs = this.countOrphanedJobs(now);
    const stuckTasks = this.countStuckTasks(now);

    return {
      staleLeases,
      orphanedJobs,
      stuckTasks,
      needsRecovery: staleLeases > 0 || orphanedJobs > 0 || stuckTasks > 0,
    };
  }

  /**
   * Count leases whose last heartbeat is older than the staleness window.
   *
   * Active lease statuses that should be heartbeating are those where a
   * worker is expected to be actively processing — specifically leases
   * in 'active' or 'heartbeating' status. If the heartbeat timestamp
   * falls behind the deadline, the worker has likely crashed.
   *
   * Uses Unix epoch seconds for comparison since the schema stores
   * timestamps as `integer("...", { mode: "timestamp" })` which Drizzle
   * maps to epoch seconds in SQLite.
   */
  private countStaleLeases(now: Date): number {
    const deadlineEpoch = Math.floor((now.getTime() - DEFAULT_STALE_LEASE_WINDOW_MS) / 1000);

    const row = this.conn.sqlite
      .prepare(
        `SELECT COUNT(*) as count FROM task_lease
         WHERE status IN ('active', 'heartbeating')
         AND heartbeat_at < ?`,
      )
      .get(deadlineEpoch) as CountRow | undefined;

    return row?.count ?? 0;
  }

  /**
   * Count jobs stuck in CLAIMED or RUNNING state past the timeout.
   *
   * A job that was claimed by a worker but never completed or failed
   * within the timeout window is considered orphaned. The worker may
   * have crashed or lost connectivity.
   */
  private countOrphanedJobs(now: Date): number {
    const deadlineEpoch = Math.floor((now.getTime() - DEFAULT_ORPHANED_JOB_TIMEOUT_MS) / 1000);

    const row = this.conn.sqlite
      .prepare(
        `SELECT COUNT(*) as count FROM job
         WHERE status IN ('claimed', 'running')
         AND updated_at < ?`,
      )
      .get(deadlineEpoch) as CountRow | undefined;

    return row?.count ?? 0;
  }

  /**
   * Count tasks stuck in ASSIGNED state past the timeout.
   *
   * A task in ASSIGNED state that has not been updated within the timeout
   * window likely had its worker crash before the lease could be
   * established or heartbeated. The reconciliation sweep will transition
   * these back to READY for rescheduling.
   */
  private countStuckTasks(now: Date): number {
    const deadlineEpoch = Math.floor((now.getTime() - DEFAULT_STUCK_TASK_TIMEOUT_MS) / 1000);

    const row = this.conn.sqlite
      .prepare(
        `SELECT COUNT(*) as count FROM task
         WHERE status = 'ASSIGNED'
         AND updated_at < ?`,
      )
      .get(deadlineEpoch) as CountRow | undefined;

    return row?.count ?? 0;
  }

  /**
   * Emit a structured log line summarizing recovery status.
   *
   * On a clean startup (no recovery items), logs at INFO level with a
   * reassuring message. When recovery items exist, logs at WARN level
   * with counts and a note that the reconciliation sweep will handle them.
   */
  private logRecoverySummary(result: StartupDiagnosticsResult): void {
    if (!result.needsRecovery) {
      this.logger.info("Clean startup — no pending recovery items");
      return;
    }

    this.logger.warn(
      `Startup recovery: ${String(result.staleLeases)} stale lease(s), ` +
        `${String(result.orphanedJobs)} orphaned job(s), ` +
        `${String(result.stuckTasks)} stuck task(s) — ` +
        `reconciliation will process within 60s`,
      {
        staleLeases: result.staleLeases,
        orphanedJobs: result.orphanedJobs,
        stuckTasks: result.stuckTasks,
      },
    );
  }
}
