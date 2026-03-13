/**
 * Tests for the startup diagnostics service.
 *
 * Verifies that the service correctly detects pending recovery items
 * (stale leases, orphaned jobs, stuck tasks) and logs appropriate
 * messages for both clean and recovery-needed startups.
 *
 * Uses an in-memory SQLite database with full Drizzle migrations applied
 * so the queries run against the real schema. Test data is inserted via
 * raw SQL to simulate various shutdown scenarios.
 *
 * @module @factory/control-plane
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabaseConnection } from "@factory/testing";

import {
  StartupDiagnosticsService,
  DEFAULT_STALE_LEASE_WINDOW_MS,
  DEFAULT_ORPHANED_JOB_TIMEOUT_MS,
  DEFAULT_STUCK_TASK_TIMEOUT_MS,
} from "./startup-diagnostics.service.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";

/** Path to Drizzle migration files relative to this test. */
const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;

/**
 * Convert a Date to Unix epoch seconds, matching the schema's
 * `integer("...", { mode: "timestamp" })` storage format.
 */
function toEpoch(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/**
 * Insert a project and repository into the database to satisfy foreign
 * key constraints required by task and task_lease rows.
 */
function seedProjectAndRepo(conn: TestDatabaseConnection): {
  projectId: string;
  repositoryId: string;
  workerPoolId: string;
} {
  const projectId = "test-project-1";
  const repositoryId = "test-repo-1";
  const workerPoolId = "test-pool-1";

  const now = toEpoch(new Date());
  conn.sqlite.exec(`
    INSERT INTO project (project_id, name, owner, created_at, updated_at)
    VALUES ('${projectId}', 'Test Project', 'test-owner', ${String(now)}, ${String(now)});

    INSERT INTO repository (repository_id, project_id, name, remote_url, default_branch, local_checkout_strategy, status, created_at, updated_at)
    VALUES ('${repositoryId}', '${projectId}', 'Test Repo', 'https://github.com/test/repo.git', 'main', 'worktree', 'active', ${String(now)}, ${String(now)});

    INSERT INTO worker_pool (worker_pool_id, name, pool_type, max_concurrency, enabled, created_at, updated_at)
    VALUES ('${workerPoolId}', 'Test Pool', 'developer', 3, 1, ${String(now)}, ${String(now)});
  `);

  return { projectId, repositoryId, workerPoolId };
}

/**
 * Insert a task row with minimal required fields.
 */
function seedTask(
  conn: TestDatabaseConnection,
  repositoryId: string,
  overrides: { taskId: string; status: string; updatedAt: Date },
): void {
  conn.sqlite
    .prepare(
      `INSERT INTO task (task_id, repository_id, title, task_type, priority, status, source, created_at, updated_at, version)
       VALUES (?, ?, 'Test Task', 'implementation', 'medium', ?, 'backlog', ?, ?, 1)`,
    )
    .run(
      overrides.taskId,
      repositoryId,
      overrides.status,
      toEpoch(overrides.updatedAt),
      toEpoch(overrides.updatedAt),
    );
}

/**
 * Insert a task lease row with minimal required fields.
 */
function seedTaskLease(
  conn: TestDatabaseConnection,
  taskId: string,
  poolId: string,
  overrides: {
    leaseId: string;
    status: string;
    heartbeatAt: Date;
    expiresAt?: Date;
  },
): void {
  const expiresAt = overrides.expiresAt ?? new Date(Date.now() + 3600_000);
  conn.sqlite
    .prepare(
      `INSERT INTO task_lease (lease_id, task_id, worker_id, pool_id, leased_at, expires_at, heartbeat_at, status)
       VALUES (?, ?, 'worker-1', ?, ?, ?, ?, ?)`,
    )
    .run(
      overrides.leaseId,
      taskId,
      poolId,
      toEpoch(new Date()),
      toEpoch(expiresAt),
      toEpoch(overrides.heartbeatAt),
      overrides.status,
    );
}

/**
 * Insert a job row with minimal required fields.
 */
function seedJob(
  conn: TestDatabaseConnection,
  overrides: { jobId: string; status: string; updatedAt: Date },
): void {
  conn.sqlite
    .prepare(
      `INSERT INTO job (job_id, job_type, status, created_at, updated_at)
       VALUES (?, 'dispatch', ?, ?, ?)`,
    )
    .run(
      overrides.jobId,
      overrides.status,
      toEpoch(overrides.updatedAt),
      toEpoch(overrides.updatedAt),
    );
}

describe("StartupDiagnosticsService", () => {
  let conn: TestDatabaseConnection;
  let service: StartupDiagnosticsService;

  beforeEach(() => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    // Direct instantiation — no NestJS DI container needed
    service = new StartupDiagnosticsService(conn as unknown as DatabaseConnection);
  });

  afterEach(() => {
    conn.close();
  });

  describe("checkRecoveryStatus", () => {
    /**
     * Validates the baseline case: a freshly initialized database with no
     * data should report zero recovery items and needsRecovery=false.
     * This is the expected result after a clean shutdown and restart.
     */
    it("should report clean startup when database is empty", () => {
      const result = service.checkRecoveryStatus();

      expect(result).toEqual({
        staleLeases: 0,
        orphanedJobs: 0,
        stuckTasks: 0,
        needsRecovery: false,
      });
    });

    /**
     * Validates that leases with recent heartbeats are NOT flagged as stale.
     * A lease that heartbeated within the 75-second window is healthy and
     * should not be counted as needing recovery.
     */
    it("should not flag leases with recent heartbeats as stale", () => {
      const now = new Date();
      const { repositoryId, workerPoolId } = seedProjectAndRepo(conn);
      seedTask(conn, repositoryId, {
        taskId: "task-1",
        status: "ASSIGNED",
        updatedAt: now,
      });
      seedTaskLease(conn, "task-1", workerPoolId, {
        leaseId: "lease-1",
        status: "active",
        heartbeatAt: new Date(now.getTime() - 30_000), // 30s ago — within window
      });

      const result = service.checkRecoveryStatus(now);

      expect(result.staleLeases).toBe(0);
      expect(result.needsRecovery).toBe(false);
    });

    /**
     * Validates that a lease with a heartbeat older than 75 seconds is
     * detected as stale. This simulates a worker crash where the heartbeat
     * stopped being refreshed.
     */
    it("should detect stale leases with heartbeats older than the staleness window", () => {
      const now = new Date();
      const { repositoryId, workerPoolId } = seedProjectAndRepo(conn);
      seedTask(conn, repositoryId, {
        taskId: "task-1",
        status: "ASSIGNED",
        updatedAt: now,
      });
      seedTaskLease(conn, "task-1", workerPoolId, {
        leaseId: "lease-stale",
        status: "active",
        heartbeatAt: new Date(now.getTime() - DEFAULT_STALE_LEASE_WINDOW_MS - 10_000), // 85s ago
      });

      const result = service.checkRecoveryStatus(now);

      expect(result.staleLeases).toBe(1);
      expect(result.needsRecovery).toBe(true);
    });

    /**
     * Validates that only active/heartbeating leases are considered.
     * A lease in 'completed' or 'revoked' status should never be counted,
     * even if its heartbeat is old.
     */
    it("should not count completed or revoked leases as stale", () => {
      const now = new Date();
      const { repositoryId, workerPoolId } = seedProjectAndRepo(conn);
      seedTask(conn, repositoryId, {
        taskId: "task-1",
        status: "COMPLETED",
        updatedAt: now,
      });
      seedTaskLease(conn, "task-1", workerPoolId, {
        leaseId: "lease-done",
        status: "completed",
        heartbeatAt: new Date(now.getTime() - 200_000), // very old, but completed
      });

      const result = service.checkRecoveryStatus(now);

      expect(result.staleLeases).toBe(0);
    });

    /**
     * Validates detection of jobs stuck in 'claimed' status past the
     * 10-minute timeout. This simulates a worker that claimed a job
     * but crashed before processing it.
     */
    it("should detect orphaned jobs in 'claimed' status past the timeout", () => {
      const now = new Date();
      seedJob(conn, {
        jobId: "job-orphan-1",
        status: "claimed",
        updatedAt: new Date(now.getTime() - DEFAULT_ORPHANED_JOB_TIMEOUT_MS - 60_000), // 11 min ago
      });

      const result = service.checkRecoveryStatus(now);

      expect(result.orphanedJobs).toBe(1);
      expect(result.needsRecovery).toBe(true);
    });

    /**
     * Validates detection of jobs stuck in 'running' status past the
     * 10-minute timeout. This simulates a worker that started processing
     * but crashed mid-execution.
     */
    it("should detect orphaned jobs in 'running' status past the timeout", () => {
      const now = new Date();
      seedJob(conn, {
        jobId: "job-orphan-2",
        status: "running",
        updatedAt: new Date(now.getTime() - DEFAULT_ORPHANED_JOB_TIMEOUT_MS - 60_000),
      });

      const result = service.checkRecoveryStatus(now);

      expect(result.orphanedJobs).toBe(1);
    });

    /**
     * Validates that recently claimed/running jobs are NOT flagged.
     * A job that was just claimed or started is expected to be in-progress.
     */
    it("should not flag recent claimed/running jobs as orphaned", () => {
      const now = new Date();
      seedJob(conn, {
        jobId: "job-active",
        status: "running",
        updatedAt: new Date(now.getTime() - 60_000), // 1 minute ago — within window
      });

      const result = service.checkRecoveryStatus(now);

      expect(result.orphanedJobs).toBe(0);
    });

    /**
     * Validates that completed or failed jobs are never counted as orphaned,
     * regardless of age.
     */
    it("should not count completed or failed jobs as orphaned", () => {
      const now = new Date();
      seedJob(conn, {
        jobId: "job-done",
        status: "completed",
        updatedAt: new Date(now.getTime() - DEFAULT_ORPHANED_JOB_TIMEOUT_MS - 60_000),
      });
      seedJob(conn, {
        jobId: "job-failed",
        status: "failed",
        updatedAt: new Date(now.getTime() - DEFAULT_ORPHANED_JOB_TIMEOUT_MS - 60_000),
      });

      const result = service.checkRecoveryStatus(now);

      expect(result.orphanedJobs).toBe(0);
    });

    /**
     * Validates detection of tasks stuck in ASSIGNED state past the
     * 5-minute timeout. This simulates a task that was assigned to a
     * worker but the worker never started processing it.
     */
    it("should detect stuck tasks in ASSIGNED state past the timeout", () => {
      const now = new Date();
      const { repositoryId } = seedProjectAndRepo(conn);
      seedTask(conn, repositoryId, {
        taskId: "task-stuck",
        status: "ASSIGNED",
        updatedAt: new Date(now.getTime() - DEFAULT_STUCK_TASK_TIMEOUT_MS - 60_000), // 6 min ago
      });

      const result = service.checkRecoveryStatus(now);

      expect(result.stuckTasks).toBe(1);
      expect(result.needsRecovery).toBe(true);
    });

    /**
     * Validates that recently assigned tasks are NOT flagged. A task
     * that was just assigned is expected to be picked up shortly.
     */
    it("should not flag recently assigned tasks as stuck", () => {
      const now = new Date();
      const { repositoryId } = seedProjectAndRepo(conn);
      seedTask(conn, repositoryId, {
        taskId: "task-recent",
        status: "ASSIGNED",
        updatedAt: new Date(now.getTime() - 60_000), // 1 min ago
      });

      const result = service.checkRecoveryStatus(now);

      expect(result.stuckTasks).toBe(0);
    });

    /**
     * Validates that tasks in non-ASSIGNED statuses are never counted
     * as stuck, even if they have old update timestamps.
     */
    it("should not count tasks in other statuses as stuck", () => {
      const now = new Date();
      const { repositoryId } = seedProjectAndRepo(conn);
      for (const status of ["READY", "IN_PROGRESS", "COMPLETED", "BLOCKED"]) {
        seedTask(conn, repositoryId, {
          taskId: `task-${status.toLowerCase()}`,
          status,
          updatedAt: new Date(now.getTime() - DEFAULT_STUCK_TASK_TIMEOUT_MS - 60_000),
        });
      }

      const result = service.checkRecoveryStatus(now);

      expect(result.stuckTasks).toBe(0);
    });

    /**
     * Validates the combined scenario where all three types of recovery
     * items exist simultaneously. Ensures the counts are independent and
     * the needsRecovery flag is true when any count is non-zero.
     */
    it("should detect all recovery item types simultaneously", () => {
      const now = new Date();
      const { repositoryId, workerPoolId } = seedProjectAndRepo(conn);

      // Stale lease
      seedTask(conn, repositoryId, {
        taskId: "task-1",
        status: "ASSIGNED",
        updatedAt: now,
      });
      seedTaskLease(conn, "task-1", workerPoolId, {
        leaseId: "lease-stale",
        status: "heartbeating",
        heartbeatAt: new Date(now.getTime() - DEFAULT_STALE_LEASE_WINDOW_MS - 10_000),
      });

      // Orphaned jobs
      seedJob(conn, {
        jobId: "job-orphan-1",
        status: "claimed",
        updatedAt: new Date(now.getTime() - DEFAULT_ORPHANED_JOB_TIMEOUT_MS - 60_000),
      });
      seedJob(conn, {
        jobId: "job-orphan-2",
        status: "running",
        updatedAt: new Date(now.getTime() - DEFAULT_ORPHANED_JOB_TIMEOUT_MS - 60_000),
      });

      // Stuck task
      seedTask(conn, repositoryId, {
        taskId: "task-stuck",
        status: "ASSIGNED",
        updatedAt: new Date(now.getTime() - DEFAULT_STUCK_TASK_TIMEOUT_MS - 60_000),
      });

      const result = service.checkRecoveryStatus(now);

      expect(result.staleLeases).toBe(1);
      expect(result.orphanedJobs).toBe(2);
      expect(result.stuckTasks).toBe(1);
      expect(result.needsRecovery).toBe(true);
    });
  });

  describe("onApplicationBootstrap", () => {
    /**
     * Validates that the bootstrap hook completes without throwing on a
     * clean startup. This ensures the service never prevents application
     * startup even when there are no recovery items.
     */
    it("should not throw on clean startup", () => {
      expect(() => service.onApplicationBootstrap()).not.toThrow();
    });

    /**
     * Validates that the bootstrap hook does not throw even when recovery
     * items exist. The service should log diagnostics but never block
     * application startup.
     */
    it("should not throw when recovery items exist", () => {
      const { repositoryId } = seedProjectAndRepo(conn);
      seedTask(conn, repositoryId, {
        taskId: "task-stuck",
        status: "ASSIGNED",
        updatedAt: new Date(Date.now() - DEFAULT_STUCK_TASK_TIMEOUT_MS - 60_000),
      });

      expect(() => service.onApplicationBootstrap()).not.toThrow();
    });

    /**
     * Validates that the bootstrap hook gracefully handles database errors
     * (e.g., closed connection) by catching the exception and logging a
     * warning instead of crashing the application.
     */
    it("should catch and log errors instead of propagating them", () => {
      // Close the database to simulate an error condition
      conn.close();

      // The service should not propagate the error
      expect(() => service.onApplicationBootstrap()).not.toThrow();
    });
  });
});
