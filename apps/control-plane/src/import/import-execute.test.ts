/**
 * Integration tests for ImportService.execute().
 *
 * These tests verify the import execution pipeline end-to-end using an
 * in-memory SQLite database with the full production schema. They cover:
 *
 * 1. First import — auto-creates project, repository, and all tasks
 * 2. Re-import with same externalRefs — deduplication (skip existing)
 * 3. Dependency wiring between imported tasks via externalRef resolution
 * 4. Best-effort dependency handling when refs cannot be resolved
 * 5. Mixed import with some duplicates and some new tasks
 * 6. Tasks are created in BACKLOG status with source "automated"
 *
 * Uses {@link createTestDatabase} from `@factory/testing` for isolated,
 * migration-applied in-memory databases. Each test gets a fresh database.
 *
 * @module @factory/control-plane
 * @see T116 — Create POST /import/execute endpoint
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabaseConnection } from "@factory/testing";
import { resolve } from "node:path";

import { ImportService } from "./import.service.js";
import type { ExecuteRequestDto } from "./dtos/execute-request.dto.js";
import {
  tasks,
  taskDependencies,
  projects,
  repositories,
} from "../infrastructure/database/schema.js";

/** Resolve the migrations folder relative to this file (src/import/ → drizzle/). */
const MIGRATIONS_FOLDER = resolve(import.meta.dirname, "../../drizzle");

describe("ImportService.execute", () => {
  let conn: TestDatabaseConnection;
  let service: ImportService;

  beforeEach(() => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    service = new ImportService(conn);
  });

  afterEach(() => {
    conn.close();
  });

  // ── Helpers ──────────────────────────────────────────────────────────

  /**
   * Build a minimal valid execute request with sensible defaults.
   * Override individual fields via the `overrides` parameter.
   */
  function makeRequest(overrides?: Partial<ExecuteRequestDto>): ExecuteRequestDto {
    return {
      path: "/test/project",
      projectName: "test-project",
      tasks: [
        {
          title: "Task One",
          taskType: "feature",
          priority: "medium",
          externalRef: "T001",
        },
      ],
      ...overrides,
    } as ExecuteRequestDto;
  }

  // ── Tests ────────────────────────────────────────────────────────────

  /**
   * Validates that a first-time import creates the project, repository,
   * and all tasks from scratch. This is the primary happy path and
   * verifies the full scaffolding chain.
   */
  it("should create project, repository, and tasks on first import", () => {
    const request = makeRequest({
      tasks: [
        { title: "Task A", taskType: "feature", priority: "high", externalRef: "T001" },
        { title: "Task B", taskType: "bug_fix", priority: "low", externalRef: "T002" },
      ],
    });

    const result = service.execute(request);

    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.projectId).toBeTruthy();
    expect(result.repositoryId).toBeTruthy();

    // Verify project was created with correct name
    const allProjects = conn.db.select().from(projects).all();
    expect(allProjects).toHaveLength(1);
    expect(allProjects[0].name).toBe("test-project");

    // Verify repository was created
    const allRepos = conn.db.select().from(repositories).all();
    expect(allRepos).toHaveLength(1);
    expect(allRepos[0].name).toBe("test-project");
    expect(allRepos[0].projectId).toBe(result.projectId);

    // Verify tasks were created
    const allTasks = conn.db.select().from(tasks).all();
    expect(allTasks).toHaveLength(2);
    expect(allTasks.map((t) => t.title).sort()).toEqual(["Task A", "Task B"]);
  });

  /**
   * Validates deduplication: re-importing the same tasks (same externalRefs)
   * should skip all of them and create zero new tasks. This ensures
   * idempotent import behavior.
   */
  it("should skip tasks with duplicate externalRefs on re-import", () => {
    const request = makeRequest({
      tasks: [
        { title: "Task A", taskType: "feature", priority: "medium", externalRef: "T001" },
        { title: "Task B", taskType: "feature", priority: "medium", externalRef: "T002" },
      ],
    });

    // First import
    const first = service.execute(request);
    expect(first.created).toBe(2);

    // Re-import with same externalRefs
    const second = service.execute(request);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.errors).toHaveLength(0);

    // Verify no duplicate tasks in the database
    const allTasks = conn.db.select().from(tasks).all();
    expect(allTasks).toHaveLength(2);
  });

  /**
   * Validates that dependencies declared in ImportedTask.dependencies
   * are resolved via externalRef and persisted as TaskDependency rows.
   * This is critical for preserving the dependency graph from the source.
   */
  it("should create TaskDependency records for declared dependencies", () => {
    const request = makeRequest({
      tasks: [
        { title: "Foundation", taskType: "feature", priority: "high", externalRef: "T001" },
        {
          title: "Depends on Foundation",
          taskType: "feature",
          priority: "medium",
          externalRef: "T002",
          dependencies: ["T001"],
        },
        {
          title: "Depends on Both",
          taskType: "feature",
          priority: "low",
          externalRef: "T003",
          dependencies: ["T001", "T002"],
        },
      ],
    });

    const result = service.execute(request);

    expect(result.created).toBe(3);
    expect(result.errors).toHaveLength(0);

    // Verify dependency edges were created
    const allDeps = conn.db.select().from(taskDependencies).all();
    expect(allDeps).toHaveLength(3); // T002→T001, T003→T001, T003→T002

    // Verify each dependency points to the correct tasks
    const allTasks = conn.db.select().from(tasks).all();
    const refToId = new Map(allTasks.map((t) => [t.externalRef, t.taskId]));

    const t002Deps = allDeps.filter((d) => d.taskId === refToId.get("T002"));
    expect(t002Deps).toHaveLength(1);
    expect(t002Deps[0].dependsOnTaskId).toBe(refToId.get("T001"));

    const t003Deps = allDeps.filter((d) => d.taskId === refToId.get("T003"));
    expect(t003Deps).toHaveLength(2);
    const t003DepRefs = t003Deps.map((d) => d.dependsOnTaskId).sort();
    expect(t003DepRefs).toEqual([refToId.get("T001"), refToId.get("T002")].sort());
  });

  /**
   * Validates best-effort dependency handling: when a dependency externalRef
   * cannot be resolved (e.g. the target task wasn't included in the import),
   * the import should continue but emit a warning in the errors array.
   * This prevents import failures due to incomplete task sets.
   */
  it("should emit warnings for unresolved dependency references", () => {
    const request = makeRequest({
      tasks: [
        {
          title: "Has Missing Dep",
          taskType: "feature",
          priority: "medium",
          externalRef: "T001",
          dependencies: ["T999"], // T999 doesn't exist
        },
      ],
    });

    const result = service.execute(request);

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("T999");
    expect(result.errors[0]).toContain("not found");

    // No dependency records should have been created
    const allDeps = conn.db.select().from(taskDependencies).all();
    expect(allDeps).toHaveLength(0);
  });

  /**
   * Validates that tasks are created in BACKLOG status with source
   * "automated", regardless of any status/source in the imported data.
   * The deterministic control plane owns task state, not the import source.
   */
  it("should create tasks in BACKLOG status with automated source", () => {
    const request = makeRequest({
      tasks: [
        {
          title: "Imported Task",
          taskType: "feature",
          priority: "high",
          externalRef: "T001",
          description: "A task imported from external source",
          acceptanceCriteria: ["Criterion 1", "Criterion 2"],
          riskLevel: "medium",
          estimatedSize: "m",
        },
      ],
    });

    const result = service.execute(request);
    expect(result.created).toBe(1);

    const allTasks = conn.db.select().from(tasks).all();
    expect(allTasks).toHaveLength(1);
    expect(allTasks[0].status).toBe("BACKLOG");
    expect(allTasks[0].source).toBe("automated");
    expect(allTasks[0].description).toBe("A task imported from external source");
    expect(allTasks[0].riskLevel).toBe("medium");
    expect(allTasks[0].estimatedSize).toBe("m");
  });

  /**
   * Validates mixed import: some tasks already exist (have matching
   * externalRefs) while others are new. Only new tasks should be created,
   * and the counts should accurately reflect what happened.
   */
  it("should handle mixed import with some existing and some new tasks", () => {
    // First import: create T001 and T002
    service.execute(
      makeRequest({
        tasks: [
          { title: "Old Task A", taskType: "feature", priority: "medium", externalRef: "T001" },
          { title: "Old Task B", taskType: "feature", priority: "medium", externalRef: "T002" },
        ],
      }),
    );

    // Second import: T001 exists, T003 is new
    const result = service.execute(
      makeRequest({
        tasks: [
          { title: "Old Task A", taskType: "feature", priority: "medium", externalRef: "T001" },
          { title: "New Task C", taskType: "bug_fix", priority: "high", externalRef: "T003" },
        ],
      }),
    );

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);

    const allTasks = conn.db.select().from(tasks).all();
    expect(allTasks).toHaveLength(3);
  });

  /**
   * Validates that the project is reused (not duplicated) when importing
   * into the same project name multiple times. The repository should also
   * be reused if the name matches.
   */
  it("should reuse existing project and repository on subsequent imports", () => {
    const first = service.execute(
      makeRequest({
        tasks: [{ title: "Task A", taskType: "feature", priority: "medium", externalRef: "T001" }],
      }),
    );

    const second = service.execute(
      makeRequest({
        tasks: [{ title: "Task B", taskType: "feature", priority: "medium", externalRef: "T002" }],
      }),
    );

    // Same project and repo should be reused
    expect(second.projectId).toBe(first.projectId);
    expect(second.repositoryId).toBe(first.repositoryId);

    // Only one project and one repository in DB
    const allProjects = conn.db.select().from(projects).all();
    expect(allProjects).toHaveLength(1);

    const allRepos = conn.db.select().from(repositories).all();
    expect(allRepos).toHaveLength(1);
  });

  /**
   * Validates that custom repository name and URL are used when provided,
   * rather than falling back to defaults derived from the project name
   * and path.
   */
  it("should use custom repository name and URL when provided", () => {
    const result = service.execute(
      makeRequest({
        repositoryName: "my-repo",
        repositoryUrl: "https://github.com/org/my-repo.git",
        tasks: [{ title: "Task A", taskType: "feature", priority: "medium", externalRef: "T001" }],
      }),
    );

    const allRepos = conn.db.select().from(repositories).all();
    expect(allRepos).toHaveLength(1);
    expect(allRepos[0].name).toBe("my-repo");
    expect(allRepos[0].remoteUrl).toBe("https://github.com/org/my-repo.git");
    expect(allRepos[0].repositoryId).toBe(result.repositoryId);
  });

  /**
   * Validates that tasks without externalRef are always created (never
   * skipped), since dedup relies on externalRef matching. This ensures
   * tasks from sources that don't provide external identifiers can still
   * be imported.
   */
  it("should always create tasks without externalRef (no dedup possible)", () => {
    const request = makeRequest({
      tasks: [
        { title: "No Ref Task", taskType: "feature", priority: "medium" },
        { title: "No Ref Task 2", taskType: "feature", priority: "medium" },
      ],
    });

    // Import twice
    service.execute(request);
    const result = service.execute(request);

    // Both imports should create tasks (no dedup without externalRef)
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);

    const allTasks = conn.db.select().from(tasks).all();
    expect(allTasks).toHaveLength(4);
  });

  /**
   * Validates that dependency resolution works across existing and
   * newly imported tasks. When a new task depends on a previously
   * imported task (via externalRef), the dependency should be wired
   * correctly.
   */
  it("should resolve dependencies against previously imported tasks", () => {
    // First import: create T001
    service.execute(
      makeRequest({
        tasks: [
          { title: "Foundation", taskType: "feature", priority: "high", externalRef: "T001" },
        ],
      }),
    );

    // Second import: T002 depends on T001 (already exists)
    const result = service.execute(
      makeRequest({
        tasks: [
          {
            title: "Depends on T001",
            taskType: "feature",
            priority: "medium",
            externalRef: "T002",
            dependencies: ["T001"],
          },
        ],
      }),
    );

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Verify the dependency was created
    const allDeps = conn.db.select().from(taskDependencies).all();
    expect(allDeps).toHaveLength(1);

    const allTasks = conn.db.select().from(tasks).all();
    const refToId = new Map(allTasks.map((t) => [t.externalRef, t.taskId]));
    expect(allDeps[0].taskId).toBe(refToId.get("T002"));
    expect(allDeps[0].dependsOnTaskId).toBe(refToId.get("T001"));
  });
});
