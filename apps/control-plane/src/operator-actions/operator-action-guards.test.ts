/**
 * Unit tests for OperatorActionGuards.
 *
 * These tests validate the safety guards that protect operator actions
 * from putting the system in an inconsistent state. Guards are the
 * first line of defense before the state machine and service logic.
 *
 * Each guard test documents:
 * - What invariant the guard protects
 * - Why the guard is important (what could go wrong without it)
 * - The specific precondition being validated
 *
 * Uses an in-memory SQLite database with real Drizzle migrations
 * to test against actual repository implementations.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T102-operator-guards.md}
 * @see {@link file://docs/prd/002-data-model.md} §2.1 (invariants)
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { randomUUID } from "node:crypto";

import {
  OperatorActionGuards,
  SENSITIVE_ACTIONS,
  getAuditSeverity,
} from "./operator-action-guards.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import { createTaskLeaseRepository } from "../infrastructure/repositories/task-lease.repository.js";
import { createProjectRepository } from "../infrastructure/repositories/project.repository.js";
import { createRepositoryRepository } from "../infrastructure/repositories/repository.repository.js";
import { createWorkerPoolRepository } from "../infrastructure/repositories/worker-pool.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";

/** Resolve the drizzle migrations folder relative to this test file. */
const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;

/**
 * Create an in-memory test database with all migrations applied.
 *
 * Each call returns a fresh, isolated database so tests never
 * interfere with each other.
 */
function createTestConnection(): DatabaseConnection {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
    healthCheck: () => ({ ok: true, walMode: true, foreignKeys: true }),
    writeTransaction: <T>(fn: (d: typeof db) => T): T => {
      const runner = sqlite.transaction(() => fn(db));
      return runner.immediate() as T;
    },
  };
}

/** Default project and repository IDs used across all tests. */
const PROJECT_ID = "test-project-guards";
const REPO_ID = "test-repo-guards";
const POOL_ID = "test-pool-guards";

/**
 * Create the project, repository, and worker pool prerequisite rows.
 * Must be called before inserting any task or lease rows.
 */
function createPrerequisites(conn: DatabaseConnection): void {
  conn.writeTransaction((db) => {
    const projectRepo = createProjectRepository(db);
    projectRepo.create({
      projectId: PROJECT_ID,
      name: "Guard Test Project",
      owner: "test-owner",
      description: "For operator action guard tests",
    });

    const repoRepo = createRepositoryRepository(db);
    repoRepo.create({
      repositoryId: REPO_ID,
      projectId: PROJECT_ID,
      name: "test-repo",
      remoteUrl: "https://github.com/test/test.git",
      localCheckoutStrategy: "worktree",
      status: "active",
    } as never);

    const poolRepo = createWorkerPoolRepository(db);
    poolRepo.create({
      workerPoolId: POOL_ID,
      name: "Test Pool",
      poolType: "developer",
      maxConcurrency: 1,
    });
  });
}

/**
 * Create a task in the specified status for testing.
 *
 * Inserts a task row directly with the given status, bypassing the
 * state machine. This is intentional — we're testing guards, not
 * the normal task lifecycle progression.
 */
function createTaskInState(
  conn: DatabaseConnection,
  status: string,
  overrides: Record<string, unknown> = {},
): string {
  const taskId = randomUUID();
  conn.writeTransaction((db) => {
    const repo = createTaskRepository(db);
    repo.create({
      taskId,
      repositoryId: REPO_ID,
      title: `Guard test task in ${status}`,
      taskType: "feature",
      priority: "medium",
      source: "manual",
      status,
      ...overrides,
    });
  });
  return taskId;
}

/**
 * Create an active (non-terminal) lease for a task.
 *
 * The lease is created in the given status (defaults to "RUNNING")
 * which is a non-terminal state, simulating an active worker assignment.
 */
function createActiveLease(conn: DatabaseConnection, taskId: string, status = "RUNNING"): string {
  const leaseId = randomUUID();
  conn.writeTransaction((db) => {
    const leaseRepo = createTaskLeaseRepository(db);
    leaseRepo.create({
      leaseId,
      taskId,
      workerId: "worker-test-001",
      poolId: POOL_ID,
      status,
      expiresAt: new Date(Date.now() + 60_000),
    });
  });
  return leaseId;
}

describe("OperatorActionGuards", () => {
  let conn: DatabaseConnection;
  let guards: OperatorActionGuards;

  beforeEach(() => {
    conn = createTestConnection();
    createPrerequisites(conn);
    guards = new OperatorActionGuards(conn);
  });

  // ─── Force Unblock Guards ───────────────────────────────────────────────

  describe("guardForceUnblock", () => {
    /**
     * Validates that force_unblock requires a non-empty reason.
     * This is critical because force_unblock bypasses dependency checks —
     * the operator must explain why the dependency can be safely ignored.
     * The reason is logged with elevated audit severity for compliance.
     */
    it("should reject empty reason string", () => {
      const taskId = createTaskInState(conn, "BLOCKED");

      expect(() => guards.guardForceUnblock(taskId, "")).toThrow(/non-empty reason/i);
    });

    /**
     * Validates that whitespace-only reasons are also rejected.
     * Prevents operators from circumventing the reason requirement
     * with spaces or tabs.
     */
    it("should reject whitespace-only reason", () => {
      const taskId = createTaskInState(conn, "BLOCKED");

      expect(() => guards.guardForceUnblock(taskId, "   ")).toThrow(/non-empty reason/i);
    });

    /**
     * Validates that force_unblock provides a clear error when the task
     * is not in BLOCKED state. This gives a better error message than
     * letting the state machine reject the transition.
     */
    it("should reject when task is not in BLOCKED state", () => {
      const taskId = createTaskInState(conn, "READY");

      expect(() => guards.guardForceUnblock(taskId, "Valid reason")).toThrow(/BLOCKED/);
    });

    /**
     * Validates the happy path — guard passes for a BLOCKED task
     * with a valid reason.
     */
    it("should pass for BLOCKED task with valid reason", () => {
      const taskId = createTaskInState(conn, "BLOCKED");

      expect(() =>
        guards.guardForceUnblock(taskId, "Dependency resolved externally"),
      ).not.toThrow();
    });

    /**
     * Validates that guard passes for non-existent tasks (letting the
     * service layer handle the not-found error with proper HTTP status).
     */
    it("should pass for non-existent task (defers to service)", () => {
      expect(() => guards.guardForceUnblock("nonexistent-id", "Valid reason")).not.toThrow();
    });
  });

  // ─── Reopen Guards ──────────────────────────────────────────────────────

  describe("guardReopen", () => {
    /**
     * Validates that reopen rejects tasks with active leases.
     *
     * This is the most critical guard in this module. An active lease
     * means a worker may still be executing work against this task.
     * Reopening would move the task to BACKLOG while the worker's
     * lease still references it, violating the invariant that only
     * one active development assignment exists per task.
     *
     * Without this guard, the system could have:
     * - A task in BACKLOG (ready for new assignment)
     * - A worker with an active lease still working on it
     * - A scheduler that creates a second lease → two workers on same task
     */
    it("should reject reopen when task has active lease in RUNNING state", () => {
      const taskId = createTaskInState(conn, "DONE");
      createActiveLease(conn, taskId, "RUNNING");

      expect(() => guards.guardReopen(taskId)).toThrow(/active lease/i);
    });

    /**
     * Validates that any non-terminal lease state blocks reopen.
     * LEASED, STARTING, RUNNING, HEARTBEATING, and COMPLETING are
     * all active lease states that indicate potential worker activity.
     */
    it("should reject reopen when task has active lease in LEASED state", () => {
      const taskId = createTaskInState(conn, "FAILED");
      createActiveLease(conn, taskId, "LEASED");

      expect(() => guards.guardReopen(taskId)).toThrow(/active lease/i);
    });

    /**
     * Validates that HEARTBEATING leases (actively sending heartbeats)
     * also block reopen. This is the most common active state.
     */
    it("should reject reopen when task has active lease in HEARTBEATING state", () => {
      const taskId = createTaskInState(conn, "CANCELLED");
      createActiveLease(conn, taskId, "HEARTBEATING");

      expect(() => guards.guardReopen(taskId)).toThrow(/active lease/i);
    });

    /**
     * Validates that COMPLETING leases (worker finishing up) block reopen.
     * The worker is about to submit results — reopening would discard them.
     */
    it("should reject reopen when task has active lease in COMPLETING state", () => {
      const taskId = createTaskInState(conn, "DONE");
      createActiveLease(conn, taskId, "COMPLETING");

      expect(() => guards.guardReopen(taskId)).toThrow(/active lease/i);
    });

    /**
     * Validates that terminal lease states (TIMED_OUT, CRASHED, RECLAIMED)
     * do NOT block reopen. These leases are no longer active and the
     * worker is no longer executing.
     */
    it("should allow reopen when all leases are terminal (TIMED_OUT)", () => {
      const taskId = createTaskInState(conn, "DONE");
      createActiveLease(conn, taskId, "TIMED_OUT");

      expect(() => guards.guardReopen(taskId)).not.toThrow();
    });

    /**
     * Validates that CRASHED lease state does not block reopen.
     */
    it("should allow reopen when lease is CRASHED", () => {
      const taskId = createTaskInState(conn, "FAILED");
      createActiveLease(conn, taskId, "CRASHED");

      expect(() => guards.guardReopen(taskId)).not.toThrow();
    });

    /**
     * Validates that RECLAIMED lease state does not block reopen.
     */
    it("should allow reopen when lease is RECLAIMED", () => {
      const taskId = createTaskInState(conn, "CANCELLED");
      createActiveLease(conn, taskId, "RECLAIMED");

      expect(() => guards.guardReopen(taskId)).not.toThrow();
    });

    /**
     * Validates the happy path — reopen passes for terminal task
     * with no leases at all.
     */
    it("should allow reopen for DONE task with no leases", () => {
      const taskId = createTaskInState(conn, "DONE");

      expect(() => guards.guardReopen(taskId)).not.toThrow();
    });

    /**
     * Validates that guard rejects non-terminal tasks even before
     * checking leases. The task must be in DONE, FAILED, or CANCELLED.
     */
    it("should reject reopen for non-terminal task (READY)", () => {
      const taskId = createTaskInState(conn, "READY");

      expect(() => guards.guardReopen(taskId)).toThrow(/terminal state/i);
    });

    /**
     * Validates that guard rejects IN_DEVELOPMENT tasks (non-terminal).
     */
    it("should reject reopen for IN_DEVELOPMENT task", () => {
      const taskId = createTaskInState(conn, "IN_DEVELOPMENT");

      expect(() => guards.guardReopen(taskId)).toThrow(/terminal state/i);
    });

    /**
     * Validates the error message includes the lease ID for debugging.
     * Operators need to know which lease is blocking the reopen so
     * they can take corrective action.
     */
    it("should include lease ID in error message", () => {
      const taskId = createTaskInState(conn, "DONE");
      const leaseId = createActiveLease(conn, taskId, "RUNNING");

      expect(() => guards.guardReopen(taskId)).toThrow(new RegExp(leaseId));
    });

    /**
     * Validates that non-existent tasks pass the guard (deferred
     * to service for NotFoundException).
     */
    it("should pass for non-existent task", () => {
      expect(() => guards.guardReopen("nonexistent")).not.toThrow();
    });
  });

  // ─── Cancel Guards ──────────────────────────────────────────────────────

  describe("guardCancel", () => {
    /**
     * Validates that cancelling a task in MERGING state is always rejected.
     *
     * A merge operation actively modifies the git repository. Cancelling
     * mid-merge could leave partial commits, dangling branches, or
     * corrupted merge state. The operator must wait for the merge to
     * complete or fail naturally.
     */
    it("should reject cancel when task is in MERGING state", () => {
      const taskId = createTaskInState(conn, "MERGING");

      expect(() => guards.guardCancel(taskId)).toThrow(/MERGING/);
    });

    /**
     * Validates that MERGING rejection happens even with acknowledgment.
     * Unlike IN_DEVELOPMENT, MERGING is an unconditional block because
     * of the risk of repository corruption.
     */
    it("should reject cancel when task is MERGING even with acknowledgment", () => {
      const taskId = createTaskInState(conn, "MERGING");

      expect(() => guards.guardCancel(taskId, true)).toThrow(/MERGING/);
    });

    /**
     * Validates that cancelling an IN_DEVELOPMENT task requires explicit
     * acknowledgment. Without this guard, operators could accidentally
     * discard hours of worker computation.
     */
    it("should reject cancel of IN_DEVELOPMENT task without acknowledgment", () => {
      const taskId = createTaskInState(conn, "IN_DEVELOPMENT");

      expect(() => guards.guardCancel(taskId)).toThrow(/acknowledgeInProgressWork/i);
    });

    /**
     * Validates that IN_DEVELOPMENT cancellation succeeds when the
     * operator explicitly acknowledges the loss of in-progress work.
     */
    it("should allow cancel of IN_DEVELOPMENT task with acknowledgment", () => {
      const taskId = createTaskInState(conn, "IN_DEVELOPMENT");

      expect(() => guards.guardCancel(taskId, true)).not.toThrow();
    });

    /**
     * Validates that tasks not in progress can be cancelled without
     * acknowledgment. READY, ASSIGNED, BLOCKED, etc. have no active
     * work to lose.
     */
    it("should allow cancel of READY task without acknowledgment", () => {
      const taskId = createTaskInState(conn, "READY");

      expect(() => guards.guardCancel(taskId)).not.toThrow();
    });

    /**
     * Validates cancel passes for ASSIGNED tasks (work not yet started).
     */
    it("should allow cancel of ASSIGNED task without acknowledgment", () => {
      const taskId = createTaskInState(conn, "ASSIGNED");

      expect(() => guards.guardCancel(taskId)).not.toThrow();
    });

    /**
     * Validates cancel passes for BLOCKED tasks.
     */
    it("should allow cancel of BLOCKED task without acknowledgment", () => {
      const taskId = createTaskInState(conn, "BLOCKED");

      expect(() => guards.guardCancel(taskId)).not.toThrow();
    });

    /**
     * Validates that non-existent tasks pass the guard (deferred
     * to service for NotFoundException).
     */
    it("should pass for non-existent task", () => {
      expect(() => guards.guardCancel("nonexistent")).not.toThrow();
    });
  });

  // ─── Override Merge Order Guards ────────────────────────────────────────

  describe("guardOverrideMergeOrder", () => {
    /**
     * Validates that merge order override is rejected when the task
     * is not in QUEUED_FOR_MERGE state. This provides a clear error
     * message before the service-level check.
     */
    it("should reject override when task is not in QUEUED_FOR_MERGE", () => {
      const taskId = createTaskInState(conn, "READY");

      expect(() => guards.guardOverrideMergeOrder(taskId)).toThrow(/QUEUED_FOR_MERGE/);
    });

    /**
     * Validates the happy path — guard passes for QUEUED_FOR_MERGE task.
     */
    it("should allow override for QUEUED_FOR_MERGE task", () => {
      const taskId = createTaskInState(conn, "QUEUED_FOR_MERGE");

      expect(() => guards.guardOverrideMergeOrder(taskId)).not.toThrow();
    });

    /**
     * Validates that non-existent tasks pass the guard (deferred).
     */
    it("should pass for non-existent task", () => {
      expect(() => guards.guardOverrideMergeOrder("nonexistent")).not.toThrow();
    });
  });

  // ─── Audit Severity ─────────────────────────────────────────────────────

  describe("getAuditSeverity", () => {
    /**
     * Validates that sensitive actions are correctly classified with
     * elevated audit severity. This is important for compliance and
     * monitoring — elevated events should trigger alerts.
     */
    it("should return elevated for force_unblock", () => {
      expect(getAuditSeverity("force_unblock")).toBe("elevated");
    });

    it("should return elevated for override_merge_order", () => {
      expect(getAuditSeverity("override_merge_order")).toBe("elevated");
    });

    it("should return elevated for reopen", () => {
      expect(getAuditSeverity("reopen")).toBe("elevated");
    });

    /**
     * Validates that non-sensitive actions get normal severity.
     */
    it("should return normal for pause", () => {
      expect(getAuditSeverity("pause")).toBe("normal");
    });

    it("should return normal for resume", () => {
      expect(getAuditSeverity("resume")).toBe("normal");
    });

    it("should return normal for cancel", () => {
      expect(getAuditSeverity("cancel")).toBe("normal");
    });

    it("should return normal for change_priority", () => {
      expect(getAuditSeverity("change_priority")).toBe("normal");
    });
  });

  // ─── SENSITIVE_ACTIONS set ──────────────────────────────────────────────

  describe("SENSITIVE_ACTIONS", () => {
    /**
     * Validates the exact set of sensitive actions. If a new action
     * is added that should be sensitive, this test will catch the
     * omission.
     */
    it("should contain exactly force_unblock, override_merge_order, reopen", () => {
      expect(SENSITIVE_ACTIONS.size).toBe(3);
      expect(SENSITIVE_ACTIONS.has("force_unblock")).toBe(true);
      expect(SENSITIVE_ACTIONS.has("override_merge_order")).toBe(true);
      expect(SENSITIVE_ACTIONS.has("reopen")).toBe(true);
    });
  });
});
