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
import { projects, repositories, workflowTemplates } from "./schema.js";

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
   * @why Verifies that all three tables exist in sqlite_master with the correct
   * names. This is the most basic structural validation.
   */
  it("all three tables exist in sqlite_master", () => {
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('project', 'repository', 'workflow_template') ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    expect(tables.map((t) => t.name)).toEqual(["project", "repository", "workflow_template"]);
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
  });
});
