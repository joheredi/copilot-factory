/**
 * Tests for the merge details service.
 *
 * Verifies merge detail retrieval using an in-memory SQLite database
 * with Drizzle migrations applied. Tests validate correct aggregation
 * of merge queue items and validation runs for a task.
 *
 * @module @factory/control-plane
 */
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { MergeDetailsService } from "./merge-details.service.js";
import { createProjectRepository } from "../infrastructure/repositories/project.repository.js";
import { createRepositoryRepository } from "../infrastructure/repositories/repository.repository.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import { createMergeQueueItemRepository } from "../infrastructure/repositories/merge-queue-item.repository.js";
import { createValidationRunRepository } from "../infrastructure/repositories/validation-run.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";

/** Path to Drizzle migration files. */
const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;

/** Create an in-memory test database with all migrations applied. */
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

/** Seed a project and repository for FK constraints. */
function seedProjectAndRepo(db: ReturnType<typeof drizzle>): {
  projectId: string;
  repositoryId: string;
} {
  const projectId = randomUUID();
  const repositoryId = randomUUID();
  const projectRepo = createProjectRepository(db);
  projectRepo.create({
    projectId,
    name: `Project-${projectId.slice(0, 8)}`,
    owner: "test-owner",
  });
  const repoRepo = createRepositoryRepository(db);
  repoRepo.create({
    repositoryId,
    projectId,
    name: `Repo-${repositoryId.slice(0, 8)}`,
    remoteUrl: "https://github.com/test/repo.git",
    defaultBranch: "main",
    localCheckoutStrategy: "worktree",
    status: "active",
  });
  return { projectId, repositoryId };
}

/** Seed a task for FK constraints. */
function seedTask(db: ReturnType<typeof drizzle>, repositoryId: string): string {
  const taskId = randomUUID();
  const taskRepo = createTaskRepository(db);
  taskRepo.create({
    taskId,
    repositoryId,
    title: "Test Task",
    taskType: "feature",
    priority: "medium",
    source: "manual",
    status: "IN_DEVELOPMENT",
  });
  return taskId;
}

describe("MergeDetailsService", () => {
  let conn: DatabaseConnection;
  let service: MergeDetailsService;

  beforeEach(() => {
    conn = createTestConnection();
    service = new MergeDetailsService(conn);
  });

  /**
   * Validates that getMergeDetails returns undefined for a task that
   * does not exist in the database.
   */
  it("should return undefined for non-existent task", () => {
    const result = service.getMergeDetails("non-existent");
    expect(result).toBeUndefined();
  });

  /**
   * Validates that getMergeDetails returns null mergeQueueItem and
   * empty validationRuns when task has no merge-related data.
   */
  it("should return empty merge details for task with no merge data", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const taskId = seedTask(conn.db, repositoryId);

    const result = service.getMergeDetails(taskId);

    expect(result).toEqual({
      taskId,
      mergeQueueItem: null,
      validationRuns: [],
    });
  });

  /**
   * Validates that getMergeDetails returns the merge queue item and
   * associated validation runs when present.
   */
  it("should return merge queue item and validation runs", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const taskId = seedTask(conn.db, repositoryId);

    const mqRepo = createMergeQueueItemRepository(conn.db);
    const vrRepo = createValidationRunRepository(conn.db);

    const mqId = randomUUID();
    mqRepo.create({
      mergeQueueItemId: mqId,
      taskId,
      repositoryId,
      position: 1,
      status: "queued",
    });

    const vrId1 = randomUUID();
    vrRepo.create({
      validationRunId: vrId1,
      taskId,
      runScope: "pre_merge",
      status: "passed",
    });

    const vrId2 = randomUUID();
    vrRepo.create({
      validationRunId: vrId2,
      taskId,
      runScope: "post_merge",
      status: "passed",
    });

    const result = service.getMergeDetails(taskId);

    expect(result).toBeDefined();
    expect(result!.taskId).toBe(taskId);
    expect(result!.mergeQueueItem).toBeDefined();
    expect(result!.mergeQueueItem!.mergeQueueItemId).toBe(mqId);
    expect(result!.mergeQueueItem!.status).toBe("queued");
    expect(result!.validationRuns).toHaveLength(2);
  });

  /**
   * Validates that getMergeDetails returns validation runs even when
   * there is no merge queue item (e.g., pre-dev validation runs).
   */
  it("should return validation runs without merge queue item", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const taskId = seedTask(conn.db, repositoryId);

    const vrRepo = createValidationRunRepository(conn.db);
    vrRepo.create({
      validationRunId: randomUUID(),
      taskId,
      runScope: "during_dev",
      status: "failed",
    });

    const result = service.getMergeDetails(taskId);

    expect(result!.mergeQueueItem).toBeNull();
    expect(result!.validationRuns).toHaveLength(1);
    expect(result!.validationRuns[0].runScope).toBe("during_dev");
  });
});
