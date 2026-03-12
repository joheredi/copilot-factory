/**
 * Tests for the merge queue service.
 *
 * Verifies merge queue listing with pagination and filtering using an
 * in-memory SQLite database with Drizzle migrations applied. Tests
 * validate correct JOIN behavior with tasks, ordering by position,
 * pagination math, and filter application.
 *
 * @module @factory/control-plane
 */
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { MergeQueueService } from "./merge-queue.service.js";
import { createProjectRepository } from "../infrastructure/repositories/project.repository.js";
import { createRepositoryRepository } from "../infrastructure/repositories/repository.repository.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import { createMergeQueueItemRepository } from "../infrastructure/repositories/merge-queue-item.repository.js";
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

/** Seed a task for FK constraints. Returns the task ID. */
function seedTask(
  db: ReturnType<typeof drizzle>,
  repositoryId: string,
  title: string = "Test Task",
  status: string = "MERGE_QUEUED",
): string {
  const taskId = randomUUID();
  const taskRepo = createTaskRepository(db);
  taskRepo.create({
    taskId,
    repositoryId,
    title,
    taskType: "feature",
    priority: "medium",
    source: "manual",
    status,
  });
  return taskId;
}

/** Seed a merge queue item. Returns the item ID. */
function seedMergeQueueItem(
  db: ReturnType<typeof drizzle>,
  taskId: string,
  repositoryId: string,
  position: number,
  status: string = "ENQUEUED",
): string {
  const mqId = randomUUID();
  const mqRepo = createMergeQueueItemRepository(db);
  mqRepo.create({
    mergeQueueItemId: mqId,
    taskId,
    repositoryId,
    position,
    status,
  });
  return mqId;
}

describe("MergeQueueService", () => {
  let conn: DatabaseConnection;
  let service: MergeQueueService;

  beforeEach(() => {
    conn = createTestConnection();
    service = new MergeQueueService(conn);
  });

  /**
   * Validates that findAll returns an empty paginated response
   * when no merge queue items exist.
   */
  it("should return empty response when no items exist", () => {
    const result = service.findAll(1, 20);

    expect(result.data).toHaveLength(0);
    expect(result.meta).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });

  /**
   * Validates that findAll returns merge queue items enriched with
   * task title and status from the joined tasks table.
   */
  it("should return items with task title and status", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const taskId = seedTask(conn.db, repositoryId, "Implement login", "MERGE_QUEUED");
    seedMergeQueueItem(conn.db, taskId, repositoryId, 1, "ENQUEUED");

    const result = service.findAll(1, 20);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].taskTitle).toBe("Implement login");
    expect(result.data[0].taskStatus).toBe("MERGE_QUEUED");
    expect(result.data[0].status).toBe("ENQUEUED");
    expect(result.data[0].position).toBe(1);
  });

  /**
   * Validates that items are returned ordered by position ascending,
   * ensuring correct queue display order.
   */
  it("should return items ordered by position", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const task1 = seedTask(conn.db, repositoryId, "First task");
    const task2 = seedTask(conn.db, repositoryId, "Second task");
    const task3 = seedTask(conn.db, repositoryId, "Third task");

    seedMergeQueueItem(conn.db, task3, repositoryId, 3, "ENQUEUED");
    seedMergeQueueItem(conn.db, task1, repositoryId, 1, "MERGING");
    seedMergeQueueItem(conn.db, task2, repositoryId, 2, "VALIDATING");

    const result = service.findAll(1, 20);

    expect(result.data).toHaveLength(3);
    expect(result.data[0].position).toBe(1);
    expect(result.data[0].taskTitle).toBe("First task");
    expect(result.data[1].position).toBe(2);
    expect(result.data[2].position).toBe(3);
  });

  /**
   * Validates that pagination correctly limits results and computes
   * page metadata (total, totalPages).
   */
  it("should paginate results correctly", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);

    for (let i = 1; i <= 5; i++) {
      const taskId = seedTask(conn.db, repositoryId, `Task ${i}`);
      seedMergeQueueItem(conn.db, taskId, repositoryId, i);
    }

    const page1 = service.findAll(1, 2);
    expect(page1.data).toHaveLength(2);
    expect(page1.meta.total).toBe(5);
    expect(page1.meta.totalPages).toBe(3);
    expect(page1.meta.page).toBe(1);

    const page2 = service.findAll(2, 2);
    expect(page2.data).toHaveLength(2);
    expect(page2.data[0].position).toBe(3);

    const page3 = service.findAll(3, 2);
    expect(page3.data).toHaveLength(1);
  });

  /**
   * Validates that the status filter narrows results to only items
   * with the specified merge queue item status.
   */
  it("should filter by status", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const task1 = seedTask(conn.db, repositoryId, "Queued task");
    const task2 = seedTask(conn.db, repositoryId, "Merging task");

    seedMergeQueueItem(conn.db, task1, repositoryId, 1, "ENQUEUED");
    seedMergeQueueItem(conn.db, task2, repositoryId, 2, "MERGING");

    const result = service.findAll(1, 20, { status: "ENQUEUED" });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].status).toBe("ENQUEUED");
    expect(result.meta.total).toBe(1);
  });

  /**
   * Validates that the repositoryId filter narrows results to only
   * items belonging to the specified repository.
   */
  it("should filter by repositoryId", () => {
    const { repositoryId: repo1 } = seedProjectAndRepo(conn.db);
    const { repositoryId: repo2 } = seedProjectAndRepo(conn.db);

    const task1 = seedTask(conn.db, repo1, "Repo 1 task");
    const task2 = seedTask(conn.db, repo2, "Repo 2 task");

    seedMergeQueueItem(conn.db, task1, repo1, 1);
    seedMergeQueueItem(conn.db, task2, repo2, 1);

    const result = service.findAll(1, 20, { repositoryId: repo1 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].repositoryId).toBe(repo1);
    expect(result.meta.total).toBe(1);
  });

  /**
   * Validates that multiple filters combine with AND semantics.
   */
  it("should combine status and repositoryId filters", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const task1 = seedTask(conn.db, repositoryId, "Enqueued");
    const task2 = seedTask(conn.db, repositoryId, "Merging");

    seedMergeQueueItem(conn.db, task1, repositoryId, 1, "ENQUEUED");
    seedMergeQueueItem(conn.db, task2, repositoryId, 2, "MERGING");

    const result = service.findAll(1, 20, {
      status: "MERGING",
      repositoryId,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].status).toBe("MERGING");
  });
});
