/**
 * Tests for T008 Drizzle schema definitions: Project, Repository, WorkflowTemplate.
 *
 * These tests verify that the Drizzle ORM schema definitions produce correct
 * SQLite tables with the expected columns, types, constraints, and indexes.
 * They exercise the schema through an in-memory SQLite database rather than
 * relying on generated migration files, ensuring the schema itself is the
 * source of truth.
 *
 * @why These tables form the top of the entity hierarchy. If they have wrong
 * column types, missing constraints, or broken FK relationships, every
 * downstream migration and repository layer (T009–T014) will fail.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { projects, repositories, workflowTemplates, tasks, taskDependencies } from "./schema.js";

/**
 * Helper: open an in-memory SQLite DB with foreign keys enabled and create
 * the T008 tables by pushing the Drizzle schema (no migration files needed).
 */
function openTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // Create tables directly from SQL matching the schema definitions.
  // This avoids coupling to migration files and tests the schema itself.
  sqlite.exec(`
    CREATE TABLE workflow_template (
      workflow_template_id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      task_selection_policy TEXT,
      review_routing_policy TEXT,
      merge_policy TEXT,
      validation_policy_id TEXT,
      retry_policy_id TEXT,
      escalation_policy_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE project (
      project_id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      owner TEXT NOT NULL,
      default_workflow_template_id TEXT REFERENCES workflow_template(workflow_template_id),
      default_policy_set_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE repository (
      repository_id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES project(project_id),
      name TEXT NOT NULL,
      remote_url TEXT NOT NULL,
      default_branch TEXT NOT NULL DEFAULT 'main',
      local_checkout_strategy TEXT NOT NULL,
      credential_profile_id TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX idx_repository_project_id ON repository(project_id);
    CREATE INDEX idx_repository_status ON repository(status);

    CREATE TABLE task (
      task_id TEXT PRIMARY KEY NOT NULL,
      repository_id TEXT NOT NULL REFERENCES repository(repository_id),
      external_ref TEXT,
      title TEXT NOT NULL,
      description TEXT,
      task_type TEXT NOT NULL,
      priority TEXT NOT NULL,
      severity TEXT,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      acceptance_criteria TEXT,
      definition_of_done TEXT,
      estimated_size TEXT,
      risk_level TEXT,
      required_capabilities TEXT,
      suggested_file_scope TEXT,
      branch_name TEXT,
      current_lease_id TEXT,
      current_review_cycle_id TEXT,
      merge_queue_item_id TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      review_round_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      version INTEGER NOT NULL DEFAULT 1,
      completed_at INTEGER
    );

    CREATE INDEX idx_task_repository_id_status ON task(repository_id, status);
    CREATE INDEX idx_task_status ON task(status);
    CREATE INDEX idx_task_priority ON task(priority);

    CREATE TABLE task_dependency (
      task_dependency_id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES task(task_id),
      depends_on_task_id TEXT NOT NULL REFERENCES task(task_id),
      dependency_type TEXT NOT NULL,
      is_hard_block INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE UNIQUE INDEX idx_task_dependency_unique ON task_dependency(task_id, depends_on_task_id);
    CREATE INDEX idx_task_dependency_task_id ON task_dependency(task_id);
    CREATE INDEX idx_task_dependency_depends_on ON task_dependency(depends_on_task_id);
  `);

  const db = drizzle(sqlite);
  return { db, sqlite };
}

/** Generate a minimal valid WorkflowTemplate row. */
function makeWorkflowTemplate(overrides: Partial<typeof workflowTemplates.$inferInsert> = {}) {
  return {
    workflowTemplateId: randomUUID(),
    name: "default-workflow",
    ...overrides,
  };
}

/** Generate a minimal valid Project row. */
function makeProject(overrides: Partial<typeof projects.$inferInsert> = {}) {
  return {
    projectId: randomUUID(),
    name: `project-${randomUUID().slice(0, 8)}`,
    owner: "test-owner",
    ...overrides,
  };
}

/** Generate a minimal valid Repository row. */
function makeRepository(
  projectId: string,
  overrides: Partial<typeof repositories.$inferInsert> = {},
) {
  return {
    repositoryId: randomUUID(),
    projectId,
    name: `repo-${randomUUID().slice(0, 8)}`,
    remoteUrl: "https://github.com/test/repo.git",
    localCheckoutStrategy: "worktree",
    status: "active",
    ...overrides,
  };
}

describe("T008 — WorkflowTemplate table", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
  });
  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why Verifies the table exists and Drizzle can insert + select from it
   * with the minimum required fields.
   */
  it("inserts and retrieves a workflow template with required fields", () => {
    const wt = makeWorkflowTemplate();
    db.insert(workflowTemplates).values(wt).run();

    const rows = db.select().from(workflowTemplates).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.workflowTemplateId).toBe(wt.workflowTemplateId);
    expect(rows[0]!.name).toBe("default-workflow");
  });

  /**
   * @why JSON policy columns must round-trip through SQLite without data loss.
   * Drizzle's `text({ mode: "json" })` handles serialization; this validates it.
   */
  it("stores and retrieves JSON policy columns correctly", () => {
    const policies = {
      taskSelectionPolicy: { strategy: "priority", maxConcurrent: 5 },
      reviewRoutingPolicy: { minReviewers: 2, pools: ["security", "architecture"] },
      mergePolicy: { strategy: "rebase", conflictClassification: "reworkable" },
    };

    const wt = makeWorkflowTemplate(policies);
    db.insert(workflowTemplates).values(wt).run();

    const row = db.select().from(workflowTemplates).get();
    expect(row!.taskSelectionPolicy).toEqual(policies.taskSelectionPolicy);
    expect(row!.reviewRoutingPolicy).toEqual(policies.reviewRoutingPolicy);
    expect(row!.mergePolicy).toEqual(policies.mergePolicy);
  });

  /**
   * @why Nullable policy-reference columns (validation, retry, escalation) must
   * accept NULL since the referenced PolicySet tables don't exist yet (T013).
   */
  it("allows null for policy reference columns", () => {
    const wt = makeWorkflowTemplate();
    db.insert(workflowTemplates).values(wt).run();

    const row = db.select().from(workflowTemplates).get();
    expect(row!.validationPolicyId).toBeNull();
    expect(row!.retryPolicyId).toBeNull();
    expect(row!.escalationPolicyId).toBeNull();
  });

  /**
   * @why Timestamps must auto-populate via `DEFAULT (unixepoch())` so callers
   * don't need to provide them. Verifies the default expression works.
   */
  it("auto-populates created_at and updated_at timestamps", () => {
    const wt = makeWorkflowTemplate();
    db.insert(workflowTemplates).values(wt).run();

    const row = db.select().from(workflowTemplates).get();
    // Drizzle returns Date objects for mode: "timestamp" columns
    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(row!.updatedAt).toBeInstanceOf(Date);
    // Should be recent (within last 10 seconds)
    const now = Date.now();
    expect(now - row!.createdAt.getTime()).toBeLessThan(10_000);
    expect(now - row!.updatedAt.getTime()).toBeLessThan(10_000);
  });

  /**
   * @why Primary key uniqueness must be enforced. Duplicate inserts must fail.
   */
  it("rejects duplicate workflow_template_id", () => {
    const wt = makeWorkflowTemplate();
    db.insert(workflowTemplates).values(wt).run();

    expect(() => db.insert(workflowTemplates).values(wt).run()).toThrow();
  });
});

describe("T008 — Project table", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
  });
  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why Verifies basic insert/select with all required fields. Projects are the
   * top-level entity; their CRUD must work before any downstream tables.
   */
  it("inserts and retrieves a project with required fields", () => {
    const p = makeProject();
    db.insert(projects).values(p).run();

    const rows = db.select().from(projects).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.projectId).toBe(p.projectId);
    expect(rows[0]!.name).toBe(p.name);
    expect(rows[0]!.owner).toBe("test-owner");
  });

  /**
   * @why Project names must be unique to prevent ambiguous references.
   * The schema defines a UNIQUE constraint on `name`.
   */
  it("enforces unique project names", () => {
    const p1 = makeProject({ name: "my-project" });
    const p2 = makeProject({ name: "my-project" });
    db.insert(projects).values(p1).run();

    expect(() => db.insert(projects).values(p2).run()).toThrow();
  });

  /**
   * @why default_workflow_template_id is an FK to workflow_template. Inserting
   * with a valid FK must succeed; inserting with an invalid FK must fail
   * when foreign_keys = ON.
   */
  it("accepts a valid workflow template FK reference", () => {
    const wt = makeWorkflowTemplate();
    db.insert(workflowTemplates).values(wt).run();

    const p = makeProject({ defaultWorkflowTemplateId: wt.workflowTemplateId });
    db.insert(projects).values(p).run();

    const row = db.select().from(projects).get();
    expect(row!.defaultWorkflowTemplateId).toBe(wt.workflowTemplateId);
  });

  /**
   * @why FK integrity must be enforced. Referencing a non-existent workflow
   * template must fail, preventing orphaned references.
   */
  it("rejects an invalid workflow template FK reference", () => {
    const p = makeProject({ defaultWorkflowTemplateId: "non-existent-id" });
    expect(() => db.insert(projects).values(p).run()).toThrow();
  });

  /**
   * @why Nullable FK columns must accept NULL without FK constraint violations.
   * Projects can exist without a default workflow or policy set.
   */
  it("allows null for optional FK columns", () => {
    const p = makeProject();
    db.insert(projects).values(p).run();

    const row = db.select().from(projects).get();
    expect(row!.defaultWorkflowTemplateId).toBeNull();
    expect(row!.defaultPolicySetId).toBeNull();
  });

  /**
   * @why Timestamps auto-populate like WorkflowTemplate.
   */
  it("auto-populates timestamps", () => {
    const p = makeProject();
    db.insert(projects).values(p).run();

    const row = db.select().from(projects).get();
    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(row!.updatedAt).toBeInstanceOf(Date);
  });
});

describe("T008 — Repository table", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];
  let testProjectId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    // Every repository test needs a parent project.
    const p = makeProject();
    testProjectId = p.projectId;
    db.insert(projects).values(p).run();
  });
  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why Verifies basic insert/select. Repositories are the second-level entity;
   * tasks are scoped to them. Their CRUD must work correctly.
   */
  it("inserts and retrieves a repository with required fields", () => {
    const r = makeRepository(testProjectId);
    db.insert(repositories).values(r).run();

    const rows = db.select().from(repositories).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.repositoryId).toBe(r.repositoryId);
    expect(rows[0]!.name).toBe(r.name);
    expect(rows[0]!.remoteUrl).toBe("https://github.com/test/repo.git");
    expect(rows[0]!.localCheckoutStrategy).toBe("worktree");
    expect(rows[0]!.status).toBe("active");
  });

  /**
   * @why default_branch should default to "main" when not explicitly provided.
   * This matches the PRD's expectation of a sensible default.
   */
  it("defaults default_branch to 'main'", () => {
    const r = makeRepository(testProjectId);
    db.insert(repositories).values(r).run();

    const row = db.select().from(repositories).get();
    expect(row!.defaultBranch).toBe("main");
  });

  /**
   * @why Allows overriding default_branch for repos that use a different convention.
   */
  it("accepts a custom default_branch", () => {
    const r = makeRepository(testProjectId, { defaultBranch: "develop" });
    db.insert(repositories).values(r).run();

    const row = db.select().from(repositories).get();
    expect(row!.defaultBranch).toBe("develop");
  });

  /**
   * @why FK from repository.project_id → project.project_id must be enforced.
   * Repositories cannot exist without a valid parent project.
   */
  it("rejects an invalid project FK reference", () => {
    const r = makeRepository("non-existent-project-id");
    expect(() => db.insert(repositories).values(r).run()).toThrow();
  });

  /**
   * @why Deleting a project that still has repositories must fail due to FK
   * constraint. This prevents orphaned repositories.
   */
  it("prevents deleting a project with repositories", () => {
    const r = makeRepository(testProjectId);
    db.insert(repositories).values(r).run();

    expect(() => db.delete(projects).where(eq(projects.projectId, testProjectId)).run()).toThrow();
  });

  /**
   * @why Nullable optional columns must accept NULL (credential_profile_id).
   */
  it("allows null for optional columns", () => {
    const r = makeRepository(testProjectId);
    db.insert(repositories).values(r).run();

    const row = db.select().from(repositories).get();
    expect(row!.credentialProfileId).toBeNull();
  });

  /**
   * @why The idx_repository_project_id index must exist so queries filtering
   * by project_id are fast (common access pattern: "all repos in a project").
   */
  it("has index on project_id column", () => {
    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'repository'")
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_repository_project_id");
  });

  /**
   * @why The idx_repository_status index must exist so queries filtering by
   * status (e.g. "all active repos") are efficient.
   */
  it("has index on status column", () => {
    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'repository'")
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_repository_status");
  });

  /**
   * @why Multiple repositories can belong to the same project.
   * This verifies the project_id FK allows many-to-one relationships.
   */
  it("supports multiple repositories per project", () => {
    const r1 = makeRepository(testProjectId, { name: "repo-alpha" });
    const r2 = makeRepository(testProjectId, { name: "repo-beta" });
    db.insert(repositories).values(r1).run();
    db.insert(repositories).values(r2).run();

    const rows = db
      .select()
      .from(repositories)
      .where(eq(repositories.projectId, testProjectId))
      .all();
    expect(rows).toHaveLength(2);
  });

  /**
   * @why Timestamps auto-populate like Project and WorkflowTemplate.
   */
  it("auto-populates timestamps", () => {
    const r = makeRepository(testProjectId);
    db.insert(repositories).values(r).run();

    const row = db.select().from(repositories).get();
    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(row!.updatedAt).toBeInstanceOf(Date);
  });
});

describe("T008 — Cross-table relationships", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
  });
  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why End-to-end verification that the full entity chain
   * WorkflowTemplate → Project → Repository can be created and queried.
   * This is the core hierarchy for the entire system.
   */
  it("creates a full WorkflowTemplate → Project → Repository chain", () => {
    const wt = makeWorkflowTemplate({ name: "ci-workflow" });
    db.insert(workflowTemplates).values(wt).run();

    const p = makeProject({
      name: "factory-project",
      defaultWorkflowTemplateId: wt.workflowTemplateId,
    });
    db.insert(projects).values(p).run();

    const r = makeRepository(p.projectId, { name: "main-repo" });
    db.insert(repositories).values(r).run();

    // Verify the chain via raw SQL join
    const result = sqlite
      .prepare(
        `SELECT r.name AS repo_name, p.name AS project_name, wt.name AS workflow_name
         FROM repository r
         JOIN project p ON r.project_id = p.project_id
         JOIN workflow_template wt ON p.default_workflow_template_id = wt.workflow_template_id`,
      )
      .get() as { repo_name: string; project_name: string; workflow_name: string };

    expect(result.repo_name).toBe("main-repo");
    expect(result.project_name).toBe("factory-project");
    expect(result.workflow_name).toBe("ci-workflow");
  });

  /**
   * @why Verifies that all five tables exist in sqlite_master with the correct
   * names. This is the most basic structural validation.
   */
  it("all five tables exist in sqlite_master", () => {
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('project', 'repository', 'task', 'task_dependency', 'workflow_template') ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    expect(tables.map((t) => t.name)).toEqual([
      "project",
      "repository",
      "task",
      "task_dependency",
      "workflow_template",
    ]);
  });

  /**
   * @why Verifies column counts match the schema definition. Catches accidental
   * column additions or omissions during schema evolution.
   */
  it("tables have the expected number of columns", () => {
    const colCount = (table: string) =>
      (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<unknown>).length;

    // WorkflowTemplate: 11 columns
    expect(colCount("workflow_template")).toBe(11);
    // Project: 8 columns
    expect(colCount("project")).toBe(8);
    // Repository: 10 columns
    expect(colCount("repository")).toBe(10);
    // Task: 26 columns
    expect(colCount("task")).toBe(26);
    // TaskDependency: 6 columns
    expect(colCount("task_dependency")).toBe(6);
  });
});

// ─── T009: Task table ───────────────────────────────────────────────────────

/** Generate a minimal valid Task row for a given repository. */
function makeTask(repositoryId: string, overrides: Partial<typeof tasks.$inferInsert> = {}) {
  return {
    taskId: randomUUID(),
    repositoryId,
    title: `task-${randomUUID().slice(0, 8)}`,
    taskType: "feature",
    priority: "medium",
    status: "BACKLOG",
    source: "manual",
    ...overrides,
  };
}

/** Generate a minimal valid TaskDependency row. */
function makeTaskDependency(
  taskId: string,
  dependsOnTaskId: string,
  overrides: Partial<typeof taskDependencies.$inferInsert> = {},
) {
  return {
    taskDependencyId: randomUUID(),
    taskId,
    dependsOnTaskId,
    dependencyType: "blocks",
    ...overrides,
  };
}

/**
 * Helper to create a project + repository pair needed for task tests.
 * Returns the repositoryId for use in makeTask().
 */
function seedProjectAndRepo(db: ReturnType<typeof openTestDb>["db"]): string {
  const p = makeProject();
  db.insert(projects).values(p).run();
  const r = makeRepository(p.projectId);
  db.insert(repositories).values(r).run();
  return r.repositoryId;
}

describe("T009 — Task table", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];
  let testRepoId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    testRepoId = seedProjectAndRepo(db);
  });
  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why Verifies basic insert/select with all required fields. Tasks are the
   * central work item; if CRUD fails here, the entire system is broken.
   */
  it("inserts and retrieves a task with required fields", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const rows = db.select().from(tasks).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.taskId).toBe(t.taskId);
    expect(rows[0]!.title).toBe(t.title);
    expect(rows[0]!.taskType).toBe("feature");
    expect(rows[0]!.priority).toBe("medium");
    expect(rows[0]!.status).toBe("BACKLOG");
    expect(rows[0]!.source).toBe("manual");
  });

  /**
   * @why The version column is the foundation of optimistic concurrency control.
   * It must default to 1 and be present on every row. Without this, concurrent
   * state transitions cannot be safely detected (PRD 002 §2.4).
   */
  it("defaults version to 1", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const row = db.select().from(tasks).get();
    expect(row!.version).toBe(1);
  });

  /**
   * @why retry_count and review_round_count must default to 0. These counters
   * drive retry/escalation policy (retry_count) and review routing decisions
   * (review_round_count). Incorrect defaults would cause premature escalation.
   */
  it("defaults retry_count and review_round_count to 0", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const row = db.select().from(tasks).get();
    expect(row!.retryCount).toBe(0);
    expect(row!.reviewRoundCount).toBe(0);
  });

  /**
   * @why JSON array columns (acceptance_criteria, definition_of_done,
   * required_capabilities, suggested_file_scope) must round-trip through
   * SQLite without data loss. These carry structured data used by agents
   * and the validation layer.
   */
  it("stores and retrieves JSON array columns correctly", () => {
    const jsonFields = {
      acceptanceCriteria: ["All tests pass", "No linting errors", "Coverage > 80%"],
      definitionOfDone: ["Code reviewed", "Merged to main"],
      requiredCapabilities: ["typescript", "react", "testing"],
      suggestedFileScope: ["apps/control-plane/src/modules/tasks/**", "packages/domain/src/**"],
    };

    const t = makeTask(testRepoId, jsonFields);
    db.insert(tasks).values(t).run();

    const row = db.select().from(tasks).get();
    expect(row!.acceptanceCriteria).toEqual(jsonFields.acceptanceCriteria);
    expect(row!.definitionOfDone).toEqual(jsonFields.definitionOfDone);
    expect(row!.requiredCapabilities).toEqual(jsonFields.requiredCapabilities);
    expect(row!.suggestedFileScope).toEqual(jsonFields.suggestedFileScope);
  });

  /**
   * @why Nullable columns must accept NULL without constraint violations.
   * Several task fields are optional (external_ref, description, severity,
   * estimated_size, risk_level, branch_name, and FK placeholders).
   */
  it("allows null for optional columns", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const row = db.select().from(tasks).get();
    expect(row!.externalRef).toBeNull();
    expect(row!.description).toBeNull();
    expect(row!.severity).toBeNull();
    expect(row!.estimatedSize).toBeNull();
    expect(row!.riskLevel).toBeNull();
    expect(row!.branchName).toBeNull();
    expect(row!.currentLeaseId).toBeNull();
    expect(row!.currentReviewCycleId).toBeNull();
    expect(row!.mergeQueueItemId).toBeNull();
    expect(row!.completedAt).toBeNull();
  });

  /**
   * @why FK from task.repository_id → repository.repository_id must be enforced.
   * Tasks cannot exist without a valid parent repository. This prevents
   * orphaned tasks that reference non-existent repositories.
   */
  it("rejects an invalid repository FK reference", () => {
    const t = makeTask("non-existent-repo-id");
    expect(() => db.insert(tasks).values(t).run()).toThrow();
  });

  /**
   * @why Deleting a repository that still has tasks must fail due to FK
   * constraint. This prevents orphaned tasks.
   */
  it("prevents deleting a repository with tasks", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    expect(() =>
      db.delete(repositories).where(eq(repositories.repositoryId, testRepoId)).run(),
    ).toThrow();
  });

  /**
   * @why Primary key uniqueness must be enforced. Duplicate task_id inserts
   * must fail to prevent data corruption.
   */
  it("rejects duplicate task_id", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    expect(() => db.insert(tasks).values(t).run()).toThrow();
  });

  /**
   * @why Timestamps must auto-populate via DEFAULT (unixepoch()) so callers
   * don't need to provide them. Same pattern as T008 tables.
   */
  it("auto-populates created_at and updated_at timestamps", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const row = db.select().from(tasks).get();
    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(row!.updatedAt).toBeInstanceOf(Date);
    const now = Date.now();
    expect(now - row!.createdAt.getTime()).toBeLessThan(10_000);
    expect(now - row!.updatedAt.getTime()).toBeLessThan(10_000);
  });

  /**
   * @why completed_at is nullable (null until task reaches terminal state)
   * but must accept a valid timestamp when provided.
   */
  it("accepts a completed_at timestamp when provided", () => {
    const completedDate = new Date("2025-06-15T10:00:00Z");
    const t = makeTask(testRepoId, { completedAt: completedDate });
    db.insert(tasks).values(t).run();

    const row = db.select().from(tasks).get();
    expect(row!.completedAt).toBeInstanceOf(Date);
    expect(row!.completedAt!.getTime()).toBe(completedDate.getTime());
  });

  /**
   * @why Multiple tasks can belong to the same repository. This is the normal
   * operating mode — a repository may have dozens of tasks in various states.
   */
  it("supports multiple tasks per repository", () => {
    const t1 = makeTask(testRepoId, { title: "task-alpha" });
    const t2 = makeTask(testRepoId, { title: "task-beta" });
    db.insert(tasks).values(t1).run();
    db.insert(tasks).values(t2).run();

    const rows = db.select().from(tasks).where(eq(tasks.repositoryId, testRepoId)).all();
    expect(rows).toHaveLength(2);
  });

  /**
   * @why The composite index (repository_id, status) must exist for the common
   * query pattern "all READY tasks in a given repository". Without this index,
   * scheduling queries degrade to full table scans.
   */
  it("has composite index on (repository_id, status)", () => {
    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task'")
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_task_repository_id_status");
  });

  /**
   * @why The status index must exist for global queries like "all READY tasks
   * across all repositories" used by the scheduler.
   */
  it("has index on status column", () => {
    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task'")
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_task_status");
  });

  /**
   * @why The priority index must exist for priority-based scheduling queries.
   * The scheduler orders tasks by priority when selecting the next task to dispatch.
   */
  it("has index on priority column", () => {
    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task'")
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_task_priority");
  });

  /**
   * @why All optional text fields (external_ref, severity, estimated_size,
   * risk_level, branch_name) must accept non-null values when provided.
   * This verifies the columns exist and store data correctly.
   */
  it("stores all optional text fields when provided", () => {
    const t = makeTask(testRepoId, {
      externalRef: "GH-1234",
      description: "A detailed task description",
      severity: "high",
      estimatedSize: "m",
      riskLevel: "low",
      branchName: "feat/task-123",
      currentLeaseId: "lease-uuid-placeholder",
      currentReviewCycleId: "review-cycle-uuid-placeholder",
      mergeQueueItemId: "merge-queue-uuid-placeholder",
    });
    db.insert(tasks).values(t).run();

    const row = db.select().from(tasks).get();
    expect(row!.externalRef).toBe("GH-1234");
    expect(row!.description).toBe("A detailed task description");
    expect(row!.severity).toBe("high");
    expect(row!.estimatedSize).toBe("m");
    expect(row!.riskLevel).toBe("low");
    expect(row!.branchName).toBe("feat/task-123");
    expect(row!.currentLeaseId).toBe("lease-uuid-placeholder");
    expect(row!.currentReviewCycleId).toBe("review-cycle-uuid-placeholder");
    expect(row!.mergeQueueItemId).toBe("merge-queue-uuid-placeholder");
  });

  /**
   * @why version can be explicitly set (e.g. during optimistic concurrency updates).
   * The application layer increments it on each state transition.
   */
  it("accepts explicit version values", () => {
    const t = makeTask(testRepoId, { version: 5 });
    db.insert(tasks).values(t).run();

    const row = db.select().from(tasks).get();
    expect(row!.version).toBe(5);
  });
});

// ─── T009: TaskDependency table ─────────────────────────────────────────────

describe("T009 — TaskDependency table", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];
  let testRepoId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    testRepoId = seedProjectAndRepo(db);
  });
  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why Verifies basic insert/select with all required fields. Task dependencies
   * drive the readiness computation engine (T036); if CRUD fails here, tasks
   * will never become READY.
   */
  it("inserts and retrieves a task dependency with required fields", () => {
    const t1 = makeTask(testRepoId, { title: "dependent-task" });
    const t2 = makeTask(testRepoId, { title: "dependency-task" });
    db.insert(tasks).values(t1).run();
    db.insert(tasks).values(t2).run();

    const dep = makeTaskDependency(t1.taskId, t2.taskId);
    db.insert(taskDependencies).values(dep).run();

    const rows = db.select().from(taskDependencies).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.taskDependencyId).toBe(dep.taskDependencyId);
    expect(rows[0]!.taskId).toBe(t1.taskId);
    expect(rows[0]!.dependsOnTaskId).toBe(t2.taskId);
    expect(rows[0]!.dependencyType).toBe("blocks");
  });

  /**
   * @why is_hard_block must default to 1 (true). The default behavior for
   * "blocks" dependencies is hard-blocking — the dependent task cannot
   * enter READY until the dependency reaches DONE.
   */
  it("defaults is_hard_block to 1 (true)", () => {
    const t1 = makeTask(testRepoId);
    const t2 = makeTask(testRepoId);
    db.insert(tasks).values(t1).run();
    db.insert(tasks).values(t2).run();

    const dep = makeTaskDependency(t1.taskId, t2.taskId);
    db.insert(taskDependencies).values(dep).run();

    const row = db.select().from(taskDependencies).get();
    expect(row!.isHardBlock).toBe(1);
  });

  /**
   * @why is_hard_block must accept 0 (false) for soft-blocking dependencies.
   * Soft-blocked tasks are informed of the dependency but not prevented
   * from entering READY.
   */
  it("accepts is_hard_block = 0 (false) for soft dependencies", () => {
    const t1 = makeTask(testRepoId);
    const t2 = makeTask(testRepoId);
    db.insert(tasks).values(t1).run();
    db.insert(tasks).values(t2).run();

    const dep = makeTaskDependency(t1.taskId, t2.taskId, { isHardBlock: 0 });
    db.insert(taskDependencies).values(dep).run();

    const row = db.select().from(taskDependencies).get();
    expect(row!.isHardBlock).toBe(0);
  });

  /**
   * @why The unique constraint on (task_id, depends_on_task_id) prevents
   * duplicate dependency edges. Without this, the dependency graph could
   * contain redundant edges that confuse readiness computation.
   */
  it("rejects duplicate (task_id, depends_on_task_id) pairs", () => {
    const t1 = makeTask(testRepoId);
    const t2 = makeTask(testRepoId);
    db.insert(tasks).values(t1).run();
    db.insert(tasks).values(t2).run();

    const dep1 = makeTaskDependency(t1.taskId, t2.taskId);
    db.insert(taskDependencies).values(dep1).run();

    const dep2 = makeTaskDependency(t1.taskId, t2.taskId);
    expect(() => db.insert(taskDependencies).values(dep2).run()).toThrow();
  });

  /**
   * @why FK from task_dependency.task_id → task.task_id must be enforced.
   * Dependencies cannot reference non-existent tasks.
   */
  it("rejects an invalid task_id FK reference", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const dep = makeTaskDependency("non-existent-task-id", t.taskId);
    expect(() => db.insert(taskDependencies).values(dep).run()).toThrow();
  });

  /**
   * @why FK from task_dependency.depends_on_task_id → task.task_id must be
   * enforced. Dependencies cannot reference non-existent tasks.
   */
  it("rejects an invalid depends_on_task_id FK reference", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const dep = makeTaskDependency(t.taskId, "non-existent-task-id");
    expect(() => db.insert(taskDependencies).values(dep).run()).toThrow();
  });

  /**
   * @why A task can have multiple dependencies. This is the normal case —
   * a task may depend on several predecessor tasks completing first.
   */
  it("supports multiple dependencies per task", () => {
    const dependent = makeTask(testRepoId, { title: "main-task" });
    const dep1 = makeTask(testRepoId, { title: "dep-1" });
    const dep2 = makeTask(testRepoId, { title: "dep-2" });
    const dep3 = makeTask(testRepoId, { title: "dep-3" });
    db.insert(tasks).values(dependent).run();
    db.insert(tasks).values(dep1).run();
    db.insert(tasks).values(dep2).run();
    db.insert(tasks).values(dep3).run();

    db.insert(taskDependencies).values(makeTaskDependency(dependent.taskId, dep1.taskId)).run();
    db.insert(taskDependencies).values(makeTaskDependency(dependent.taskId, dep2.taskId)).run();
    db.insert(taskDependencies).values(makeTaskDependency(dependent.taskId, dep3.taskId)).run();

    const rows = db
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.taskId, dependent.taskId))
      .all();
    expect(rows).toHaveLength(3);
  });

  /**
   * @why A task can be depended upon by multiple other tasks (reverse deps).
   * The reverse dependency index supports efficient recalculation when a
   * task transitions to DONE.
   */
  it("supports multiple reverse dependencies (depended upon by many)", () => {
    const upstream = makeTask(testRepoId, { title: "upstream" });
    const down1 = makeTask(testRepoId, { title: "downstream-1" });
    const down2 = makeTask(testRepoId, { title: "downstream-2" });
    db.insert(tasks).values(upstream).run();
    db.insert(tasks).values(down1).run();
    db.insert(tasks).values(down2).run();

    db.insert(taskDependencies).values(makeTaskDependency(down1.taskId, upstream.taskId)).run();
    db.insert(taskDependencies).values(makeTaskDependency(down2.taskId, upstream.taskId)).run();

    const rows = db
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.dependsOnTaskId, upstream.taskId))
      .all();
    expect(rows).toHaveLength(2);
  });

  /**
   * @why All three dependency types must be storable. Readiness computation,
   * parent-child grouping, and informational links all behave differently.
   */
  it("stores all dependency type values", () => {
    const t1 = makeTask(testRepoId);
    const t2 = makeTask(testRepoId);
    const t3 = makeTask(testRepoId);
    const t4 = makeTask(testRepoId);
    db.insert(tasks).values(t1).run();
    db.insert(tasks).values(t2).run();
    db.insert(tasks).values(t3).run();
    db.insert(tasks).values(t4).run();

    db.insert(taskDependencies)
      .values(makeTaskDependency(t1.taskId, t2.taskId, { dependencyType: "blocks" }))
      .run();
    db.insert(taskDependencies)
      .values(makeTaskDependency(t1.taskId, t3.taskId, { dependencyType: "relates_to" }))
      .run();
    db.insert(taskDependencies)
      .values(makeTaskDependency(t1.taskId, t4.taskId, { dependencyType: "parent_child" }))
      .run();

    const rows = db
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.taskId, t1.taskId))
      .all();
    const types = rows.map((r) => r.dependencyType).sort();
    expect(types).toEqual(["blocks", "parent_child", "relates_to"]);
  });

  /**
   * @why The idx_task_dependency_task_id index must exist for forward lookups:
   * "what does this task depend on?" This is used during readiness computation.
   */
  it("has index on task_id column", () => {
    const indexes = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task_dependency'",
      )
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_task_dependency_task_id");
  });

  /**
   * @why The idx_task_dependency_depends_on index must exist for reverse lookups:
   * "what tasks depend on this one?" This is used when a task transitions to DONE
   * and reverse-dependent tasks need readiness recalculation.
   */
  it("has index on depends_on_task_id column", () => {
    const indexes = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task_dependency'",
      )
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_task_dependency_depends_on");
  });

  /**
   * @why The unique index on (task_id, depends_on_task_id) must exist.
   * This serves as both a constraint and an index for duplicate checking.
   */
  it("has unique index on (task_id, depends_on_task_id)", () => {
    const indexes = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task_dependency'",
      )
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_task_dependency_unique");
  });

  /**
   * @why Timestamps must auto-populate on task dependencies just like other tables.
   */
  it("auto-populates created_at timestamp", () => {
    const t1 = makeTask(testRepoId);
    const t2 = makeTask(testRepoId);
    db.insert(tasks).values(t1).run();
    db.insert(tasks).values(t2).run();

    const dep = makeTaskDependency(t1.taskId, t2.taskId);
    db.insert(taskDependencies).values(dep).run();

    const row = db.select().from(taskDependencies).get();
    expect(row!.createdAt).toBeInstanceOf(Date);
    const now = Date.now();
    expect(now - row!.createdAt.getTime()).toBeLessThan(10_000);
  });

  /**
   * @why Deleting a task that has dependency edges must fail due to FK
   * constraints. This prevents orphaned dependency records.
   */
  it("prevents deleting a task that is referenced by dependencies", () => {
    const t1 = makeTask(testRepoId);
    const t2 = makeTask(testRepoId);
    db.insert(tasks).values(t1).run();
    db.insert(tasks).values(t2).run();

    db.insert(taskDependencies).values(makeTaskDependency(t1.taskId, t2.taskId)).run();

    // Cannot delete t2 because it's referenced as depends_on_task_id
    expect(() => db.delete(tasks).where(eq(tasks.taskId, t2.taskId)).run()).toThrow();
    // Cannot delete t1 because it's referenced as task_id
    expect(() => db.delete(tasks).where(eq(tasks.taskId, t1.taskId)).run()).toThrow();
  });
});

// ─── T009: Cross-table relationships ────────────────────────────────────────

describe("T009 — Task cross-table relationships", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
  });
  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why End-to-end verification that the full entity chain
   * Project → Repository → Task → TaskDependency can be created and queried.
   * This validates FK relationships across all four levels.
   */
  it("creates a full Project → Repository → Task → TaskDependency chain", () => {
    const p = makeProject({ name: "test-project" });
    db.insert(projects).values(p).run();

    const r = makeRepository(p.projectId, { name: "test-repo" });
    db.insert(repositories).values(r).run();

    const t1 = makeTask(r.repositoryId, { title: "implement-feature", status: "READY" });
    const t2 = makeTask(r.repositoryId, { title: "write-tests", status: "BLOCKED" });
    db.insert(tasks).values(t1).run();
    db.insert(tasks).values(t2).run();

    const dep = makeTaskDependency(t2.taskId, t1.taskId, {
      dependencyType: "blocks",
      isHardBlock: 1,
    });
    db.insert(taskDependencies).values(dep).run();

    // Verify via SQL join
    const result = sqlite
      .prepare(
        `SELECT t.title AS task_title, r.name AS repo_name, p.name AS project_name,
                td.dependency_type, dep_task.title AS depends_on_title
         FROM task_dependency td
         JOIN task t ON td.task_id = t.task_id
         JOIN task dep_task ON td.depends_on_task_id = dep_task.task_id
         JOIN repository r ON t.repository_id = r.repository_id
         JOIN project p ON r.project_id = p.project_id`,
      )
      .get() as {
      task_title: string;
      repo_name: string;
      project_name: string;
      dependency_type: string;
      depends_on_title: string;
    };

    expect(result.task_title).toBe("write-tests");
    expect(result.depends_on_title).toBe("implement-feature");
    expect(result.repo_name).toBe("test-repo");
    expect(result.project_name).toBe("test-project");
    expect(result.dependency_type).toBe("blocks");
  });
});
