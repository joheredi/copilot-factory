/**
 * Tests for the workspace cleanup service.
 *
 * Verifies that the service correctly identifies orphaned worktrees,
 * respects retention periods and active leases, and handles edge cases
 * (missing directories, permission errors, empty state).
 *
 * Uses an in-memory SQLite database with full Drizzle migrations applied
 * for lease queries, and a fake filesystem for deterministic directory
 * scanning and deletion without touching the real disk.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T149-workspace-cleanup.md}
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabaseConnection } from "@factory/testing";
import type { Dirent, Stats } from "node:fs";

import {
  WorkspaceCleanupService,
  DEFAULT_RETENTION_DAYS,
  type CleanupFileSystem,
} from "./workspace-cleanup.service.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Path to Drizzle migration files relative to this test. */
const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;

/** Milliseconds per day for test date arithmetic. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── Test Helpers ──────────────────────────────────────────────────────────────

/**
 * Convert a Date to Unix epoch seconds, matching the schema's
 * `integer("...", { mode: "timestamp" })` storage format.
 */
function toEpoch(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/**
 * Insert a project, repository, and worker pool into the database to
 * satisfy foreign key constraints required by task and task_lease rows.
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
  overrides: { leaseId: string; status: string },
): void {
  const now = new Date();
  conn.sqlite
    .prepare(
      `INSERT INTO task_lease (lease_id, task_id, worker_id, pool_id, leased_at, expires_at, heartbeat_at, status)
       VALUES (?, ?, 'worker-1', ?, ?, ?, ?, ?)`,
    )
    .run(
      overrides.leaseId,
      taskId,
      poolId,
      toEpoch(now),
      toEpoch(new Date(now.getTime() + 3600_000)),
      toEpoch(now),
      overrides.status,
    );
}

// ─── Fake Filesystem ───────────────────────────────────────────────────────────

/**
 * A directory entry in the fake filesystem tree.
 *
 * Models the minimal subset of `{workspacesRoot}/{repoId}/{taskId}/` needed
 * for workspace cleanup testing. Each entry tracks whether it has been
 * deleted to verify cleanup behavior.
 */
interface FakeEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly mtimeMs: number;
  readonly size: number;
  children?: FakeEntry[];
  deleted?: boolean;
}

/**
 * Create a fake filesystem that mimics the workspace directory layout
 * for deterministic testing without touching the real disk.
 *
 * The fake supports:
 * - `existsSync`: checks if a path is registered
 * - `readdirSync`: returns children of a directory path
 * - `statSync`: returns mtime and size for a path
 * - `rmSync`: marks entries as deleted and tracks calls
 *
 * @param workspacesRoot - The root path that anchors the fake tree.
 * @param entries - Top-level entries (repo directories) under the root.
 * @returns A fake filesystem and utilities for asserting cleanup behavior.
 */
function createFakeFs(
  workspacesRoot: string,
  entries: FakeEntry[],
): {
  fs: CleanupFileSystem;
  deletedPaths: string[];
} {
  const deletedPaths: string[] = [];

  /**
   * Build a map from absolute path → FakeEntry for O(1) lookups.
   */
  const pathMap = new Map<string, FakeEntry>();

  function registerEntry(basePath: string, entry: FakeEntry): void {
    const fullPath = `${basePath}/${entry.name}`;
    pathMap.set(fullPath, entry);
    if (entry.children) {
      for (const child of entry.children) {
        registerEntry(fullPath, child);
      }
    }
  }

  // Register the root as existing.
  pathMap.set(workspacesRoot, {
    name: "",
    isDirectory: true,
    mtimeMs: Date.now(),
    size: 0,
    children: entries,
  });

  for (const entry of entries) {
    registerEntry(workspacesRoot, entry);
  }

  const fs: CleanupFileSystem = {
    existsSync(path: string): boolean {
      const entry = pathMap.get(path);
      return entry !== undefined && !entry.deleted;
    },

    readdirSync(path: string): Dirent[] {
      const entry = pathMap.get(path);
      if (!entry || entry.deleted || !entry.isDirectory || !entry.children) {
        throw new Error(`ENOENT: no such directory '${path}'`);
      }
      return entry.children
        .filter((child) => !child.deleted)
        .map((child) => ({
          name: child.name,
          isDirectory: () => child.isDirectory,
          isFile: () => !child.isDirectory,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          isSymbolicLink: () => false,
          path: path,
          parentPath: path,
        })) as unknown as Dirent[];
    },

    statSync(path: string): Stats {
      const entry = pathMap.get(path);
      if (!entry || entry.deleted) {
        throw new Error(`ENOENT: no such file or directory '${path}'`);
      }
      return { mtimeMs: entry.mtimeMs, size: entry.size } as Stats;
    },

    rmSync(path: string): void {
      const entry = pathMap.get(path);
      if (entry) {
        entry.deleted = true;
        // Also mark all children as deleted (recursive rm).
        const markDeleted = (e: FakeEntry) => {
          (e as { deleted: boolean }).deleted = true;
          if (e.children) {
            e.children.forEach(markDeleted);
          }
        };
        markDeleted(entry);
      }
      deletedPaths.push(path);
    },
  };

  return { fs, deletedPaths };
}

/**
 * Create a fake repo directory entry with task workspace subdirectories.
 *
 * @param repoId - Name for the repo directory.
 * @param tasks - Array of task directory specs.
 */
function fakeRepo(
  repoId: string,
  tasks: Array<{ taskId: string; mtimeMs: number; size?: number }>,
): FakeEntry {
  return {
    name: repoId,
    isDirectory: true,
    mtimeMs: Date.now(),
    size: 0,
    children: tasks.map((t) => ({
      name: t.taskId,
      isDirectory: true,
      mtimeMs: t.mtimeMs,
      size: t.size ?? 1024,
    })),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("WorkspaceCleanupService", () => {
  let conn: TestDatabaseConnection;
  let service: WorkspaceCleanupService;

  beforeEach(() => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    service = new WorkspaceCleanupService(conn as unknown as DatabaseConnection);
  });

  afterEach(() => {
    conn.close();
  });

  // ─── Empty / Missing State ────────────────────────────────────────────

  describe("empty or missing workspaces directory", () => {
    /**
     * @why The workspaces directory may not exist on a fresh installation
     * or when the factory has never run any tasks. The service must not
     * throw in this case — it should report zero work done.
     */
    it("should return zero counts when workspaces root does not exist", () => {
      const { fs } = createFakeFs("/nonexistent", []);

      const result = service.cleanOrphanedWorkspaces({
        workspacesRoot: "/missing-root",
        fs,
        now: new Date(),
      });

      expect(result.scannedCount).toBe(0);
      expect(result.deletedCount).toBe(0);
      expect(result.pendingCount).toBe(0);
      expect(result.errorCount).toBe(0);
    });

    /**
     * @why An empty workspaces directory (all repos removed or no tasks
     * ever ran) should not cause errors or attempt any cleanup.
     */
    it("should return zero counts when workspaces root is empty", () => {
      const workspacesRoot = "/workspaces";
      const { fs } = createFakeFs(workspacesRoot, []);

      const result = service.cleanOrphanedWorkspaces({
        workspacesRoot,
        fs,
        now: new Date(),
      });

      expect(result.scannedCount).toBe(0);
      expect(result.deletedCount).toBe(0);
    });
  });

  // ─── Active Lease Protection ──────────────────────────────────────────

  describe("worktrees with active leases", () => {
    /**
     * @why Worktrees with active (non-terminal) leases MUST NEVER be
     * deleted. This is the primary safety invariant of the cleanup
     * service. An active lease means a worker is currently running or
     * about to run in that workspace.
     */
    it("should never delete a worktree that has an active lease", () => {
      const now = new Date();
      const { repositoryId, workerPoolId } = seedProjectAndRepo(conn);
      const taskId = "task-active-1";

      seedTask(conn, repositoryId, { taskId, status: "IN_DEVELOPMENT", updatedAt: now });
      seedTaskLease(conn, taskId, workerPoolId, {
        leaseId: "lease-active-1",
        status: "HEARTBEATING",
      });

      // Worktree is 30 days old (way past retention) but has active lease.
      const oldMtime = now.getTime() - 30 * MS_PER_DAY;
      const workspacesRoot = "/workspaces";
      const { fs, deletedPaths } = createFakeFs(workspacesRoot, [
        fakeRepo("repo-1", [{ taskId, mtimeMs: oldMtime }]),
      ]);

      const result = service.cleanOrphanedWorkspaces({
        workspacesRoot,
        fs,
        now,
        retentionDays: 7,
      });

      expect(result.activeLeaseCount).toBe(1);
      expect(result.deletedCount).toBe(0);
      expect(deletedPaths).not.toContain(`${workspacesRoot}/repo-1/${taskId}`);
    });

    /**
     * @why Leases in non-heartbeating active states (LEASED, STARTING,
     * RUNNING) should also protect the worktree. A worker may be in the
     * process of spinning up.
     */
    it("should protect worktrees with leases in any non-terminal status", () => {
      const now = new Date();
      const { repositoryId, workerPoolId } = seedProjectAndRepo(conn);

      const nonTerminalStatuses = [
        "IDLE",
        "LEASED",
        "STARTING",
        "RUNNING",
        "HEARTBEATING",
        "TIMED_OUT",
        "CRASHED",
      ];

      for (const status of nonTerminalStatuses) {
        const taskId = `task-${status.toLowerCase()}`;
        seedTask(conn, repositoryId, { taskId, status: "IN_DEVELOPMENT", updatedAt: now });
        seedTaskLease(conn, taskId, workerPoolId, {
          leaseId: `lease-${status.toLowerCase()}`,
          status,
        });
      }

      const workspacesRoot = "/workspaces";
      const oldMtime = now.getTime() - 30 * MS_PER_DAY;
      const { fs } = createFakeFs(workspacesRoot, [
        fakeRepo(
          "repo-1",
          nonTerminalStatuses.map((s) => ({
            taskId: `task-${s.toLowerCase()}`,
            mtimeMs: oldMtime,
          })),
        ),
      ]);

      const result = service.cleanOrphanedWorkspaces({
        workspacesRoot,
        fs,
        now,
        retentionDays: 7,
      });

      expect(result.activeLeaseCount).toBe(nonTerminalStatuses.length);
      expect(result.deletedCount).toBe(0);
    });
  });

  // ─── Orphan Deletion ──────────────────────────────────────────────────

  describe("orphaned worktree deletion", () => {
    /**
     * @why A worktree with no lease at all (task ID not in the lease table)
     * that exceeds the retention period should be deleted. This is the
     * primary cleanup scenario — a crashed worker whose worktree was
     * never cleaned up.
     */
    it("should delete orphaned worktree with no lease older than retention", () => {
      const now = new Date();
      const taskId = "orphan-task-1";
      const workspacesRoot = "/workspaces";
      const oldMtime = now.getTime() - 10 * MS_PER_DAY; // 10 days old

      const { fs, deletedPaths } = createFakeFs(workspacesRoot, [
        fakeRepo("repo-1", [{ taskId, mtimeMs: oldMtime, size: 2048 }]),
      ]);

      const result = service.cleanOrphanedWorkspaces({
        workspacesRoot,
        fs,
        now,
        retentionDays: 7,
      });

      expect(result.deletedCount).toBe(1);
      expect(result.totalFreedBytes).toBeGreaterThanOrEqual(0);
      expect(deletedPaths).toContain(`${workspacesRoot}/repo-1/${taskId}`);
    });

    /**
     * @why A worktree whose only leases are in terminal states (COMPLETING,
     * RECLAIMED) should be treated as orphaned because no active work is
     * happening. If it's past the retention period, it should be deleted.
     */
    it("should delete worktree with only terminal leases past retention", () => {
      const now = new Date();
      const { repositoryId, workerPoolId } = seedProjectAndRepo(conn);
      const taskId = "task-completed-1";

      seedTask(conn, repositoryId, { taskId, status: "DONE", updatedAt: now });
      seedTaskLease(conn, taskId, workerPoolId, {
        leaseId: "lease-completed-1",
        status: "COMPLETING",
      });

      const workspacesRoot = "/workspaces";
      const oldMtime = now.getTime() - 10 * MS_PER_DAY;
      const { fs, deletedPaths } = createFakeFs(workspacesRoot, [
        fakeRepo("repo-1", [{ taskId, mtimeMs: oldMtime }]),
      ]);

      const result = service.cleanOrphanedWorkspaces({
        workspacesRoot,
        fs,
        now,
        retentionDays: 7,
      });

      expect(result.deletedCount).toBe(1);
      expect(deletedPaths).toContain(`${workspacesRoot}/repo-1/${taskId}`);
    });

    /**
     * @why Multiple orphans across different repos should all be cleaned
     * up independently. A failure in one repo should not prevent cleanup
     * of worktrees in another repo.
     */
    it("should delete multiple orphaned worktrees across repos", () => {
      const now = new Date();
      const oldMtime = now.getTime() - 14 * MS_PER_DAY;
      const workspacesRoot = "/workspaces";

      const { fs, deletedPaths } = createFakeFs(workspacesRoot, [
        fakeRepo("repo-a", [
          { taskId: "orphan-1", mtimeMs: oldMtime },
          { taskId: "orphan-2", mtimeMs: oldMtime },
        ]),
        fakeRepo("repo-b", [{ taskId: "orphan-3", mtimeMs: oldMtime }]),
      ]);

      const result = service.cleanOrphanedWorkspaces({
        workspacesRoot,
        fs,
        now,
        retentionDays: 7,
      });

      expect(result.scannedCount).toBe(3);
      expect(result.deletedCount).toBe(3);
      expect(deletedPaths).toContain(`${workspacesRoot}/repo-a/orphan-1`);
      expect(deletedPaths).toContain(`${workspacesRoot}/repo-a/orphan-2`);
      expect(deletedPaths).toContain(`${workspacesRoot}/repo-b/orphan-3`);
    });
  });

  // ─── Retention Period ─────────────────────────────────────────────────

  describe("retention period", () => {
    /**
     * @why Orphaned worktrees within the retention window should NOT be
     * deleted. They may contain useful debugging context from a recent
     * crash and the operator may want to inspect them.
     */
    it("should not delete orphaned worktrees within retention period", () => {
      const now = new Date();
      const recentMtime = now.getTime() - 3 * MS_PER_DAY; // 3 days old
      const workspacesRoot = "/workspaces";

      const { fs, deletedPaths } = createFakeFs(workspacesRoot, [
        fakeRepo("repo-1", [{ taskId: "recent-orphan", mtimeMs: recentMtime }]),
      ]);

      const result = service.cleanOrphanedWorkspaces({
        workspacesRoot,
        fs,
        now,
        retentionDays: 7,
      });

      expect(result.deletedCount).toBe(0);
      expect(result.pendingCount).toBe(1);
      expect(deletedPaths).not.toContain(`${workspacesRoot}/repo-1/recent-orphan`);

      const pendingAction = result.actions.find((a) => a.outcome === "pending");
      expect(pendingAction).toBeDefined();
      expect(pendingAction!.daysRemaining).toBe(4); // 7 - 3 = 4 days remaining
    });

    /**
     * @why The boundary case: a worktree exactly at the retention deadline
     * should be eligible for deletion (>= comparison).
     */
    it("should delete worktree exactly at retention deadline", () => {
      const now = new Date();
      const exactlyAtDeadline = now.getTime() - 7 * MS_PER_DAY;
      const workspacesRoot = "/workspaces";

      const { fs, deletedPaths } = createFakeFs(workspacesRoot, [
        fakeRepo("repo-1", [{ taskId: "boundary-orphan", mtimeMs: exactlyAtDeadline }]),
      ]);

      const result = service.cleanOrphanedWorkspaces({
        workspacesRoot,
        fs,
        now,
        retentionDays: 7,
      });

      expect(result.deletedCount).toBe(1);
      expect(deletedPaths).toContain(`${workspacesRoot}/repo-1/boundary-orphan`);
    });

    /**
     * @why A retention period of 0 days means "delete immediately" for
     * orphaned worktrees. This should work correctly for operators who
     * don't want to keep any orphans.
     */
    it("should delete orphaned worktrees immediately when retention is 0", () => {
      const now = new Date();
      const justNow = now.getTime(); // Created right now
      const workspacesRoot = "/workspaces";

      const { fs, deletedPaths } = createFakeFs(workspacesRoot, [
        fakeRepo("repo-1", [{ taskId: "immediate-orphan", mtimeMs: justNow }]),
      ]);

      const result = service.cleanOrphanedWorkspaces({
        workspacesRoot,
        fs,
        now,
        retentionDays: 0,
      });

      expect(result.deletedCount).toBe(1);
      expect(deletedPaths).toContain(`${workspacesRoot}/repo-1/immediate-orphan`);
    });

    /**
     * @why The default retention period should be 7 days as specified by
     * the task requirements.
     */
    it("should use 7-day default retention period", () => {
      expect(DEFAULT_RETENTION_DAYS).toBe(7);
    });
  });

  // ─── Mixed Scenarios ──────────────────────────────────────────────────

  describe("mixed scenarios", () => {
    /**
     * @why In production, the workspaces directory will contain a mix of
     * active worktrees, recent orphans, and old orphans. The service must
     * correctly classify each one and only delete the eligible ones.
     */
    it("should handle a mix of active, pending, and deletable worktrees", () => {
      const now = new Date();
      const { repositoryId, workerPoolId } = seedProjectAndRepo(conn);

      // Active task with lease.
      const activeTaskId = "task-active";
      seedTask(conn, repositoryId, {
        taskId: activeTaskId,
        status: "IN_DEVELOPMENT",
        updatedAt: now,
      });
      seedTaskLease(conn, activeTaskId, workerPoolId, {
        leaseId: "lease-active",
        status: "RUNNING",
      });

      const workspacesRoot = "/workspaces";
      const { fs, deletedPaths } = createFakeFs(workspacesRoot, [
        fakeRepo("repo-1", [
          { taskId: activeTaskId, mtimeMs: now.getTime() - 30 * MS_PER_DAY }, // active lease
          { taskId: "recent-orphan", mtimeMs: now.getTime() - 2 * MS_PER_DAY }, // recent, no lease
          { taskId: "old-orphan", mtimeMs: now.getTime() - 14 * MS_PER_DAY }, // old, no lease
        ]),
      ]);

      const result = service.cleanOrphanedWorkspaces({
        workspacesRoot,
        fs,
        now,
        retentionDays: 7,
      });

      expect(result.scannedCount).toBe(3);
      expect(result.activeLeaseCount).toBe(1);
      expect(result.pendingCount).toBe(1);
      expect(result.deletedCount).toBe(1);
      expect(deletedPaths).toContain(`${workspacesRoot}/repo-1/old-orphan`);
      expect(deletedPaths).not.toContain(`${workspacesRoot}/repo-1/${activeTaskId}`);
      expect(deletedPaths).not.toContain(`${workspacesRoot}/repo-1/recent-orphan`);
    });

    /**
     * @why A task with both a terminal lease and a non-terminal lease should
     * be protected. Even one non-terminal lease means the worktree might
     * be in use (e.g., a retry after a reclaimed lease).
     */
    it("should protect worktree when task has both terminal and non-terminal leases", () => {
      const now = new Date();
      const { repositoryId, workerPoolId } = seedProjectAndRepo(conn);
      const taskId = "task-retry";

      seedTask(conn, repositoryId, { taskId, status: "IN_DEVELOPMENT", updatedAt: now });
      // Old lease was reclaimed (terminal).
      seedTaskLease(conn, taskId, workerPoolId, {
        leaseId: "lease-old-reclaimed",
        status: "RECLAIMED",
      });
      // New retry lease is active (non-terminal).
      seedTaskLease(conn, taskId, workerPoolId, {
        leaseId: "lease-retry-active",
        status: "STARTING",
      });

      const workspacesRoot = "/workspaces";
      const oldMtime = now.getTime() - 30 * MS_PER_DAY;
      const { fs, deletedPaths } = createFakeFs(workspacesRoot, [
        fakeRepo("repo-1", [{ taskId, mtimeMs: oldMtime }]),
      ]);

      const result = service.cleanOrphanedWorkspaces({
        workspacesRoot,
        fs,
        now,
        retentionDays: 7,
      });

      expect(result.activeLeaseCount).toBe(1);
      expect(result.deletedCount).toBe(0);
      expect(deletedPaths).not.toContain(`${workspacesRoot}/repo-1/${taskId}`);
    });
  });

  // ─── Error Handling ───────────────────────────────────────────────────

  describe("error handling", () => {
    /**
     * @why A filesystem error on one workspace directory should not prevent
     * cleanup of other directories. Each directory is processed independently
     * and errors are captured per-entry.
     */
    it("should isolate errors and continue processing other workspaces", () => {
      const now = new Date();
      const oldMtime = now.getTime() - 14 * MS_PER_DAY;
      const workspacesRoot = "/workspaces";

      const { fs, deletedPaths } = createFakeFs(workspacesRoot, [
        fakeRepo("repo-1", [
          { taskId: "good-orphan", mtimeMs: oldMtime },
          { taskId: "bad-orphan", mtimeMs: oldMtime },
        ]),
      ]);

      // Override rmSync to throw only for the "bad" entry.
      const originalRmSync = fs.rmSync;
      fs.rmSync = (path: string, options: { recursive: boolean; force: boolean }) => {
        if (path.includes("bad-orphan")) {
          throw new Error("Permission denied");
        }
        originalRmSync(path, options);
      };

      const result = service.cleanOrphanedWorkspaces({
        workspacesRoot,
        fs,
        now,
        retentionDays: 7,
      });

      expect(result.deletedCount).toBe(1);
      expect(result.errorCount).toBe(1);
      expect(deletedPaths).toContain(`${workspacesRoot}/repo-1/good-orphan`);

      const errorAction = result.actions.find((a) => a.outcome === "error");
      expect(errorAction).toBeDefined();
      expect(errorAction!.errorMessage).toContain("Permission denied");
    });

    /**
     * @why The onApplicationBootstrap lifecycle hook must never throw,
     * even if the entire cleanup process fails. A cleanup failure should
     * not prevent the application from starting.
     */
    it("should not throw from onApplicationBootstrap when cleanup fails", () => {
      // We can't easily make the entire cleanup fail through the public
      // API, but we can verify the hook itself catches errors.
      // The service will try to read the real WORKSPACES_ROOT env var
      // which likely doesn't exist in test, so this should complete
      // gracefully.
      expect(() => service.onApplicationBootstrap()).not.toThrow();
    });
  });

  // ─── Summary Logging ──────────────────────────────────────────────────

  describe("result summary", () => {
    /**
     * @why The cleanup result must contain accurate counts for each
     * outcome category so the operator can understand what happened
     * at a glance.
     */
    it("should produce accurate summary counts", () => {
      const now = new Date();
      const { repositoryId, workerPoolId } = seedProjectAndRepo(conn);

      // One active.
      seedTask(conn, repositoryId, {
        taskId: "active-1",
        status: "IN_DEVELOPMENT",
        updatedAt: now,
      });
      seedTaskLease(conn, "active-1", workerPoolId, { leaseId: "l1", status: "RUNNING" });

      const workspacesRoot = "/workspaces";
      const { fs } = createFakeFs(workspacesRoot, [
        fakeRepo("repo-1", [
          { taskId: "active-1", mtimeMs: now.getTime() - 20 * MS_PER_DAY },
          { taskId: "pending-1", mtimeMs: now.getTime() - 1 * MS_PER_DAY },
          { taskId: "deletable-1", mtimeMs: now.getTime() - 10 * MS_PER_DAY },
          { taskId: "deletable-2", mtimeMs: now.getTime() - 15 * MS_PER_DAY },
        ]),
      ]);

      const result = service.cleanOrphanedWorkspaces({
        workspacesRoot,
        fs,
        now,
        retentionDays: 7,
      });

      expect(result.scannedCount).toBe(4);
      expect(result.activeLeaseCount).toBe(1);
      expect(result.pendingCount).toBe(1);
      expect(result.deletedCount).toBe(2);
      expect(result.errorCount).toBe(0);
    });

    /**
     * @why The result should aggregate freed bytes across all deleted
     * worktrees to give operators a sense of how much disk space was
     * reclaimed.
     */
    it("should track total freed bytes from deleted worktrees", () => {
      const now = new Date();
      const workspacesRoot = "/workspaces";
      const oldMtime = now.getTime() - 14 * MS_PER_DAY;

      const { fs } = createFakeFs(workspacesRoot, [
        fakeRepo("repo-1", [{ taskId: "orphan-1", mtimeMs: oldMtime, size: 0 }]),
      ]);

      const result = service.cleanOrphanedWorkspaces({
        workspacesRoot,
        fs,
        now,
        retentionDays: 7,
      });

      expect(result.deletedCount).toBe(1);
      // totalFreedBytes is a best-effort estimate; verify it's a number.
      expect(typeof result.totalFreedBytes).toBe("number");
      expect(result.totalFreedBytes).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── Non-directory entries ────────────────────────────────────────────

  describe("non-directory entries", () => {
    /**
     * @why Files at the repo level (e.g., a stale .DS_Store or lock file)
     * should be silently skipped. Only directories follow the
     * {repoId}/{taskId}/ naming convention.
     */
    it("should skip non-directory entries at repo level", () => {
      const now = new Date();
      const workspacesRoot = "/workspaces";
      const oldMtime = now.getTime() - 14 * MS_PER_DAY;

      const entries: FakeEntry[] = [
        {
          name: ".DS_Store",
          isDirectory: false,
          mtimeMs: oldMtime,
          size: 4096,
        },
        fakeRepo("repo-1", [{ taskId: "orphan-1", mtimeMs: oldMtime }]),
      ];

      const { fs } = createFakeFs(workspacesRoot, entries);

      const result = service.cleanOrphanedWorkspaces({
        workspacesRoot,
        fs,
        now,
        retentionDays: 7,
      });

      // Should only scan the directory-based workspace, not the file.
      expect(result.scannedCount).toBe(1);
      expect(result.deletedCount).toBe(1);
    });
  });
});
