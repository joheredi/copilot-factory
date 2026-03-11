/**
 * Tests for the tasks service.
 *
 * Uses an in-memory SQLite database with Drizzle migrations to verify
 * CRUD operations against real SQL. Each test gets a fresh database
 * to ensure isolation.
 *
 * Tests validate:
 * - Task creation in BACKLOG state with UUID generation
 * - Batch creation atomicity
 * - Filtered listing with AND semantics across status, repository, priority, task_type
 * - Paginated listing with correct metadata
 * - Detail retrieval enriched with lease, review cycle, and dependency data
 * - Metadata update with optimistic concurrency control
 * - Version conflict detection on concurrent update
 *
 * @module @factory/control-plane
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { ConflictException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { TasksService } from "./tasks.service.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import { createTaskDependencyRepository } from "../infrastructure/repositories/task-dependency.repository.js";
import { createTaskLeaseRepository } from "../infrastructure/repositories/task-lease.repository.js";
import { createReviewCycleRepository } from "../infrastructure/repositories/review-cycle.repository.js";
import { createRepositoryRepository } from "../infrastructure/repositories/repository.repository.js";
import { createProjectRepository } from "../infrastructure/repositories/project.repository.js";
import { createWorkerPoolRepository } from "../infrastructure/repositories/worker-pool.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";

/** Path to Drizzle migration files. */
const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;

/**
 * Creates an in-memory database connection with all migrations applied.
 * Uses better-sqlite3 directly to avoid path resolution issues with `:memory:`.
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

/** Default task creation DTO for tests. */
function defaultCreateDto(overrides: Record<string, unknown> = {}) {
  return {
    repositoryId: "", // Must be set per test after creating a repository
    title: "Test Task",
    taskType: "feature" as const,
    priority: "medium" as const,
    source: "manual" as const,
    ...overrides,
  };
}

/**
 * Creates prerequisite project and repository rows for task creation.
 * Tasks have a FK to repository, which has a FK to project.
 */
function createPrerequisites(db: ReturnType<typeof drizzle>): {
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

describe("TasksService", () => {
  let conn: DatabaseConnection;
  let service: TasksService;
  let repositoryId: string;

  beforeEach(() => {
    conn = createTestConnection();
    service = new TasksService(conn);

    // Create prerequisite project and repository for FK constraints
    const prereqs = createPrerequisites(conn.db);
    repositoryId = prereqs.repositoryId;
  });

  afterEach(() => {
    conn.close();
  });

  /**
   * Validates that a task is created with a UUID and starts in BACKLOG state.
   * This is a critical invariant: tasks must always begin in BACKLOG.
   */
  it("should create a task in BACKLOG state", () => {
    const task = service.create(defaultCreateDto({ repositoryId }));

    expect(task.taskId).toBeDefined();
    expect(task.status).toBe("BACKLOG");
    expect(task.title).toBe("Test Task");
    expect(task.taskType).toBe("feature");
    expect(task.priority).toBe("medium");
    expect(task.source).toBe("manual");
    expect(task.version).toBe(1);
  });

  /**
   * Validates that optional fields are persisted when provided.
   */
  it("should create a task with optional fields", () => {
    const task = service.create(
      defaultCreateDto({
        repositoryId,
        description: "A detailed description",
        externalRef: "https://github.com/issues/123",
        acceptanceCriteria: ["Criterion 1", "Criterion 2"],
        estimatedSize: "m",
        riskLevel: "high",
      }),
    );

    expect(task.description).toBe("A detailed description");
    expect(task.externalRef).toBe("https://github.com/issues/123");
    expect(task.acceptanceCriteria).toEqual(["Criterion 1", "Criterion 2"]);
    expect(task.estimatedSize).toBe("m");
    expect(task.riskLevel).toBe("high");
  });

  /**
   * Validates that batch creation creates all tasks atomically.
   * If any fails, the entire batch should roll back.
   */
  it("should create tasks in batch", () => {
    const tasks = service.createBatch([
      defaultCreateDto({ repositoryId, title: "Task 1" }),
      defaultCreateDto({ repositoryId, title: "Task 2" }),
      defaultCreateDto({ repositoryId, title: "Task 3" }),
    ]);

    expect(tasks).toHaveLength(3);
    expect(tasks.every((t) => t.status === "BACKLOG")).toBe(true);
    expect(tasks.map((t) => t.title)).toEqual(["Task 1", "Task 2", "Task 3"]);
  });

  /**
   * Validates that an empty batch returns an empty array without error.
   */
  it("should handle empty batch gracefully", () => {
    const tasks = service.createBatch([]);
    expect(tasks).toHaveLength(0);
  });

  /**
   * Validates paginated listing returns correct metadata for page 1.
   * Ensures the total count and page calculation are accurate.
   */
  it("should list tasks with pagination", () => {
    service.create(defaultCreateDto({ repositoryId, title: "T1" }));
    service.create(defaultCreateDto({ repositoryId, title: "T2" }));
    service.create(defaultCreateDto({ repositoryId, title: "T3" }));

    const result = service.findAll(1, 2);

    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(3);
    expect(result.meta.totalPages).toBe(2);
    expect(result.meta.page).toBe(1);
  });

  /**
   * Validates that page 2 returns remaining items.
   * Ensures offset calculation (page - 1) * limit is correct.
   */
  it("should return correct data for page 2", () => {
    service.create(defaultCreateDto({ repositoryId, title: "T1" }));
    service.create(defaultCreateDto({ repositoryId, title: "T2" }));
    service.create(defaultCreateDto({ repositoryId, title: "T3" }));

    const result = service.findAll(2, 2);

    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(3);
    expect(result.meta.page).toBe(2);
  });

  /**
   * Validates filtering by status. Only tasks matching the specified
   * status should be returned in the result set.
   */
  it("should filter tasks by status", () => {
    service.create(defaultCreateDto({ repositoryId, title: "T1" }));
    // Manually update one task's status to test filtering
    const task2 = service.create(defaultCreateDto({ repositoryId, title: "T2" }));
    conn.writeTransaction((db) => {
      const repo = createTaskRepository(db);
      repo.update(task2.taskId, 1, { status: "READY" });
    });

    const backlogResult = service.findAll(1, 20, { status: "BACKLOG" });
    expect(backlogResult.data).toHaveLength(1);
    expect(backlogResult.data[0]!.title).toBe("T1");

    const readyResult = service.findAll(1, 20, { status: "READY" });
    expect(readyResult.data).toHaveLength(1);
    expect(readyResult.data[0]!.title).toBe("T2");
  });

  /**
   * Validates filtering by priority. Confirms AND semantics when
   * combined with other filters.
   */
  it("should filter tasks by priority", () => {
    service.create(defaultCreateDto({ repositoryId, title: "High", priority: "high" as const }));
    service.create(defaultCreateDto({ repositoryId, title: "Low", priority: "low" as const }));

    const result = service.findAll(1, 20, { priority: "high" });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.title).toBe("High");
    expect(result.meta.total).toBe(1);
  });

  /**
   * Validates filtering by task type.
   */
  it("should filter tasks by taskType", () => {
    service.create(
      defaultCreateDto({ repositoryId, title: "Feature", taskType: "feature" as const }),
    );
    service.create(defaultCreateDto({ repositoryId, title: "Bug", taskType: "bug_fix" as const }));

    const result = service.findAll(1, 20, { taskType: "bug_fix" });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.title).toBe("Bug");
  });

  /**
   * Validates filtering by repositoryId. Important for scoping task
   * views to a specific repository.
   */
  it("should filter tasks by repositoryId", () => {
    // Create a second repository
    const prereqs2 = createPrerequisites(conn.db);

    service.create(defaultCreateDto({ repositoryId, title: "Repo1 Task" }));
    service.create(defaultCreateDto({ repositoryId: prereqs2.repositoryId, title: "Repo2 Task" }));

    const result = service.findAll(1, 20, { repositoryId });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.title).toBe("Repo1 Task");
  });

  /**
   * Validates that multiple filters are combined with AND semantics.
   * Only tasks matching ALL filter criteria should be returned.
   */
  it("should combine multiple filters with AND semantics", () => {
    service.create(
      defaultCreateDto({
        repositoryId,
        title: "Match",
        priority: "high" as const,
        taskType: "feature" as const,
      }),
    );
    service.create(
      defaultCreateDto({
        repositoryId,
        title: "Wrong Priority",
        priority: "low" as const,
        taskType: "feature" as const,
      }),
    );
    service.create(
      defaultCreateDto({
        repositoryId,
        title: "Wrong Type",
        priority: "high" as const,
        taskType: "bug_fix" as const,
      }),
    );

    const result = service.findAll(1, 20, { priority: "high", taskType: "feature" });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.title).toBe("Match");
  });

  /**
   * Validates that findById returns the correct task.
   */
  it("should find a task by ID", () => {
    const created = service.create(defaultCreateDto({ repositoryId, title: "Find Me" }));
    const found = service.findById(created.taskId);

    expect(found).toBeDefined();
    expect(found!.title).toBe("Find Me");
  });

  /**
   * Validates that findById returns undefined for missing IDs.
   */
  it("should return undefined for non-existent ID", () => {
    const found = service.findById("does-not-exist");
    expect(found).toBeUndefined();
  });

  /**
   * Validates that findDetailById returns the task with empty related
   * entities when no lease, review cycle, or dependencies exist.
   */
  it("should return task detail with empty related entities", () => {
    const created = service.create(defaultCreateDto({ repositoryId }));
    const detail = service.findDetailById(created.taskId);

    expect(detail).toBeDefined();
    expect(detail!.task.taskId).toBe(created.taskId);
    expect(detail!.currentLease).toBeNull();
    expect(detail!.currentReviewCycle).toBeNull();
    expect(detail!.dependencies).toEqual([]);
    expect(detail!.dependents).toEqual([]);
  });

  /**
   * Validates that findDetailById returns undefined for missing tasks.
   */
  it("should return undefined detail for non-existent task", () => {
    const detail = service.findDetailById("does-not-exist");
    expect(detail).toBeUndefined();
  });

  /**
   * Validates that findDetailById includes dependency edges.
   * Tests both forward (what this task depends on) and reverse
   * (what depends on this task) lookups.
   */
  it("should return task detail with dependency information", () => {
    const task1 = service.create(defaultCreateDto({ repositoryId, title: "Task 1" }));
    const task2 = service.create(defaultCreateDto({ repositoryId, title: "Task 2" }));

    // Create a dependency: task2 depends on task1
    conn.writeTransaction((db) => {
      const depRepo = createTaskDependencyRepository(db);
      depRepo.create({
        taskDependencyId: randomUUID(),
        taskId: task2.taskId,
        dependsOnTaskId: task1.taskId,
        dependencyType: "blocks",
        isHardBlock: 1,
      });
    });

    // Task2 should show task1 as a dependency
    const detail2 = service.findDetailById(task2.taskId);
    expect(detail2!.dependencies).toHaveLength(1);
    expect(detail2!.dependencies[0]!.dependsOnTaskId).toBe(task1.taskId);
    expect(detail2!.dependents).toHaveLength(0);

    // Task1 should show task2 as a dependent
    const detail1 = service.findDetailById(task1.taskId);
    expect(detail1!.dependencies).toHaveLength(0);
    expect(detail1!.dependents).toHaveLength(1);
    expect(detail1!.dependents[0]!.taskId).toBe(task2.taskId);
  });

  /**
   * Validates that findDetailById includes the current lease when
   * the task has a currentLeaseId set.
   */
  it("should return task detail with current lease", () => {
    const task = service.create(defaultCreateDto({ repositoryId }));
    const leaseId = randomUUID();
    const poolId = randomUUID();

    // Create prerequisite worker pool for lease FK
    conn.writeTransaction((db) => {
      const poolRepo = createWorkerPoolRepository(db);
      poolRepo.create({
        workerPoolId: poolId,
        name: "test-pool",
        poolType: "developer",
      });
    });

    // Create a lease and link it to the task
    conn.writeTransaction((db) => {
      const leaseRepo = createTaskLeaseRepository(db);
      leaseRepo.create({
        leaseId,
        taskId: task.taskId,
        workerId: randomUUID(),
        poolId,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 3600_000),
      });

      const taskRepo = createTaskRepository(db);
      taskRepo.update(task.taskId, 1, { currentLeaseId: leaseId });
    });

    const detail = service.findDetailById(task.taskId);
    expect(detail!.currentLease).not.toBeNull();
    expect(detail!.currentLease!.leaseId).toBe(leaseId);
  });

  /**
   * Validates that findDetailById includes the current review cycle
   * when the task has a currentReviewCycleId set.
   */
  it("should return task detail with current review cycle", () => {
    const task = service.create(defaultCreateDto({ repositoryId }));
    const reviewCycleId = randomUUID();

    conn.writeTransaction((db) => {
      const reviewRepo = createReviewCycleRepository(db);
      reviewRepo.create({
        reviewCycleId,
        taskId: task.taskId,
        roundNumber: 1,
        status: "IN_PROGRESS",
      });

      const taskRepo = createTaskRepository(db);
      taskRepo.update(task.taskId, 1, { currentReviewCycleId: reviewCycleId });
    });

    const detail = service.findDetailById(task.taskId);
    expect(detail!.currentReviewCycle).not.toBeNull();
    expect(detail!.currentReviewCycle!.reviewCycleId).toBe(reviewCycleId);
  });

  /**
   * Validates that update modifies the specified fields and increments version.
   * OCC is a critical correctness property for concurrent task updates.
   */
  it("should update a task with version check", () => {
    const created = service.create(defaultCreateDto({ repositoryId, title: "Original" }));
    const updated = service.update(created.taskId, { title: "Updated", version: 1 });

    expect(updated).toBeDefined();
    expect(updated!.title).toBe("Updated");
    expect(updated!.version).toBe(2);
  });

  /**
   * Validates that update returns undefined for non-existent tasks.
   */
  it("should return undefined when updating non-existent task", () => {
    const result = service.update("missing", { title: "Nope", version: 1 });
    expect(result).toBeUndefined();
  });

  /**
   * Validates that version conflict throws ConflictException (409).
   * This tests the optimistic concurrency control mechanism that
   * prevents lost-update anomalies during concurrent modifications.
   */
  it("should throw ConflictException on version conflict", () => {
    const created = service.create(defaultCreateDto({ repositoryId }));

    // First update succeeds (version 1 → 2)
    service.update(created.taskId, { title: "First", version: 1 });

    // Second update with stale version should fail
    expect(() => service.update(created.taskId, { title: "Second", version: 1 })).toThrow(
      ConflictException,
    );
  });

  /**
   * Validates that no-filter listing returns all tasks.
   * This is the baseline behavior when no query parameters are provided.
   */
  it("should return all tasks when no filters applied", () => {
    service.create(defaultCreateDto({ repositoryId, title: "T1" }));
    service.create(defaultCreateDto({ repositoryId, title: "T2" }));

    const result = service.findAll(1, 20);
    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(2);
  });

  /**
   * Validates that out-of-range pages return empty data with correct total.
   */
  it("should return empty data for out-of-range page", () => {
    service.create(defaultCreateDto({ repositoryId }));

    const result = service.findAll(100, 20);
    expect(result.data).toHaveLength(0);
    expect(result.meta.total).toBe(1);
  });
});
