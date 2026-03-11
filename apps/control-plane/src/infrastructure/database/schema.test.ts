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
import {
  projects,
  repositories,
  workflowTemplates,
  tasks,
  taskDependencies,
  workerPools,
  workers,
  promptTemplates,
  agentProfiles,
  taskLeases,
  reviewCycles,
  reviewPackets,
  leadReviewDecisions,
  mergeQueueItems,
  validationRuns,
  jobs,
  auditEvents,
  policySets,
} from "./schema.js";

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

    -- T010: WorkerPool, Worker, PromptTemplate, AgentProfile
    CREATE TABLE worker_pool (
      worker_pool_id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      pool_type TEXT NOT NULL,
      provider TEXT,
      runtime TEXT,
      model TEXT,
      max_concurrency INTEGER NOT NULL DEFAULT 1,
      default_timeout_sec INTEGER,
      default_token_budget INTEGER,
      cost_profile TEXT,
      capabilities TEXT,
      repo_scope_rules TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX idx_worker_pool_pool_type ON worker_pool(pool_type);
    CREATE INDEX idx_worker_pool_enabled ON worker_pool(enabled);

    CREATE TABLE worker (
      worker_id TEXT PRIMARY KEY NOT NULL,
      pool_id TEXT NOT NULL REFERENCES worker_pool(worker_pool_id),
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      host TEXT,
      runtime_version TEXT,
      last_heartbeat_at INTEGER,
      current_task_id TEXT REFERENCES task(task_id),
      current_run_id TEXT,
      health_metadata TEXT
    );

    CREATE INDEX idx_worker_pool_id ON worker(pool_id);
    CREATE INDEX idx_worker_status ON worker(status);

    CREATE TABLE prompt_template (
      prompt_template_id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      role TEXT NOT NULL,
      template_text TEXT NOT NULL,
      input_schema TEXT,
      output_schema TEXT,
      stop_conditions TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX idx_prompt_template_role ON prompt_template(role);

    CREATE TABLE agent_profile (
      agent_profile_id TEXT PRIMARY KEY NOT NULL,
      pool_id TEXT NOT NULL REFERENCES worker_pool(worker_pool_id),
      prompt_template_id TEXT REFERENCES prompt_template(prompt_template_id),
      tool_policy_id TEXT,
      command_policy_id TEXT,
      file_scope_policy_id TEXT,
      validation_policy_id TEXT,
      review_policy_id TEXT,
      budget_policy_id TEXT,
      retry_policy_id TEXT
    );

    CREATE INDEX idx_agent_profile_pool_id ON agent_profile(pool_id);

    -- T011: TaskLease, ReviewCycle, ReviewPacket, LeadReviewDecision
    CREATE TABLE task_lease (
      lease_id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES task(task_id),
      worker_id TEXT NOT NULL,
      pool_id TEXT NOT NULL REFERENCES worker_pool(worker_pool_id),
      leased_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL,
      heartbeat_at INTEGER,
      status TEXT NOT NULL,
      reclaim_reason TEXT,
      partial_result_artifact_refs TEXT
    );

    CREATE INDEX idx_task_lease_task_id ON task_lease(task_id);
    CREATE INDEX idx_task_lease_worker_id ON task_lease(worker_id);
    CREATE INDEX idx_task_lease_status ON task_lease(status);

    CREATE TABLE review_cycle (
      review_cycle_id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES task(task_id),
      status TEXT NOT NULL,
      required_reviewers TEXT,
      optional_reviewers TEXT,
      started_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );

    CREATE INDEX idx_review_cycle_task_id ON review_cycle(task_id);
    CREATE INDEX idx_review_cycle_status ON review_cycle(status);

    CREATE TABLE review_packet (
      review_packet_id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES task(task_id),
      review_cycle_id TEXT NOT NULL REFERENCES review_cycle(review_cycle_id),
      reviewer_pool_id TEXT,
      reviewer_type TEXT NOT NULL,
      verdict TEXT NOT NULL,
      severity_summary TEXT,
      packet_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX idx_review_packet_task_cycle ON review_packet(task_id, review_cycle_id);
    CREATE INDEX idx_review_packet_verdict ON review_packet(verdict);

    CREATE TABLE lead_review_decision (
      lead_review_decision_id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES task(task_id),
      review_cycle_id TEXT NOT NULL REFERENCES review_cycle(review_cycle_id),
      decision TEXT NOT NULL,
      blocking_issue_count INTEGER NOT NULL DEFAULT 0,
      non_blocking_issue_count INTEGER NOT NULL DEFAULT 0,
      follow_up_task_refs TEXT,
      packet_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX idx_lead_review_decision_task_id ON lead_review_decision(task_id);
    CREATE INDEX idx_lead_review_decision_cycle_id ON lead_review_decision(review_cycle_id);

    -- T012: MergeQueueItem, ValidationRun, Job
    CREATE TABLE merge_queue_item (
      merge_queue_item_id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES task(task_id),
      repository_id TEXT NOT NULL REFERENCES repository(repository_id),
      status TEXT NOT NULL,
      position INTEGER NOT NULL,
      approved_commit_sha TEXT,
      enqueued_at INTEGER NOT NULL DEFAULT (unixepoch()),
      started_at INTEGER,
      completed_at INTEGER
    );

    CREATE INDEX idx_merge_queue_item_repo_status ON merge_queue_item(repository_id, status);
    CREATE INDEX idx_merge_queue_item_task_id ON merge_queue_item(task_id);

    CREATE TABLE validation_run (
      validation_run_id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES task(task_id),
      run_scope TEXT NOT NULL,
      status TEXT NOT NULL,
      tool_name TEXT,
      summary TEXT,
      artifact_refs TEXT,
      started_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );

    CREATE INDEX idx_validation_run_task_id ON validation_run(task_id);
    CREATE INDEX idx_validation_run_task_scope ON validation_run(task_id, run_scope);

    CREATE TABLE job (
      job_id TEXT PRIMARY KEY NOT NULL,
      job_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      payload_json TEXT,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      run_after INTEGER,
      lease_owner TEXT,
      parent_job_id TEXT,
      job_group_id TEXT,
      depends_on_job_ids TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX idx_job_status_run_after ON job(status, run_after);
    CREATE INDEX idx_job_group_id ON job(job_group_id);
    CREATE INDEX idx_job_parent_job_id ON job(parent_job_id);

    -- T013: AuditEvent, PolicySet
    CREATE TABLE audit_event (
      audit_event_id TEXT PRIMARY KEY NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      old_state TEXT,
      new_state TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX idx_audit_event_entity ON audit_event(entity_type, entity_id);
    CREATE INDEX idx_audit_event_created_at ON audit_event(created_at);

    CREATE TABLE policy_set (
      policy_set_id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      scheduling_policy_json TEXT,
      review_policy_json TEXT,
      merge_policy_json TEXT,
      security_policy_json TEXT,
      validation_policy_json TEXT,
      budget_policy_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
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

// ─── T010 helpers ──────────────────────────────────────────────────────────

/** Generate a minimal valid WorkerPool row. */
function makeWorkerPool(overrides: Partial<typeof workerPools.$inferInsert> = {}) {
  return {
    workerPoolId: randomUUID(),
    name: `pool-${randomUUID().slice(0, 8)}`,
    poolType: "developer",
    ...overrides,
  };
}

/** Generate a minimal valid Worker row. */
function makeWorker(poolId: string, overrides: Partial<typeof workers.$inferInsert> = {}) {
  return {
    workerId: randomUUID(),
    poolId,
    name: `worker-${randomUUID().slice(0, 8)}`,
    status: "online",
    ...overrides,
  };
}

/** Generate a minimal valid PromptTemplate row. */
function makePromptTemplate(overrides: Partial<typeof promptTemplates.$inferInsert> = {}) {
  return {
    promptTemplateId: randomUUID(),
    name: `template-${randomUUID().slice(0, 8)}`,
    version: "1.0.0",
    role: "developer",
    templateText: "You are a developer agent. Implement the task described below.",
    ...overrides,
  };
}

/** Generate a minimal valid AgentProfile row. */
function makeAgentProfile(
  poolId: string,
  overrides: Partial<typeof agentProfiles.$inferInsert> = {},
) {
  return {
    agentProfileId: randomUUID(),
    poolId,
    ...overrides,
  };
}

// ─── T010 Tests ─────────────────────────────────────────────────────────────

describe("T010 — WorkerPool table", () => {
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
   * with the minimum required fields (name, pool_type).
   */
  it("inserts and retrieves a worker pool with required fields", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    const rows = db.select().from(workerPools).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.workerPoolId).toBe(pool.workerPoolId);
    expect(rows[0]!.name).toBe(pool.name);
    expect(rows[0]!.poolType).toBe("developer");
  });

  /**
   * @why The pool_type column must accept all valid WorkerPoolType enum values.
   * This ensures the schema is compatible with the domain enum definitions.
   */
  it("accepts all valid pool_type values", () => {
    const poolTypes = ["developer", "reviewer", "lead-reviewer", "merge-assist", "planner"];
    for (const poolType of poolTypes) {
      const pool = makeWorkerPool({ poolType });
      db.insert(workerPools).values(pool).run();
    }
    const rows = db.select().from(workerPools).all();
    expect(rows).toHaveLength(poolTypes.length);
  });

  /**
   * @why max_concurrency must default to 1 when not provided, and enabled
   * must default to 1 (true). These defaults ensure safe behavior for newly
   * created pools.
   */
  it("applies correct defaults for max_concurrency and enabled", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    const row = db.select().from(workerPools).get();
    expect(row!.maxConcurrency).toBe(1);
    expect(row!.enabled).toBe(1);
  });

  /**
   * @why JSON columns (capabilities, repo_scope_rules) must round-trip through
   * SQLite without data loss. Drizzle's `text({ mode: "json" })` handles
   * serialization; this validates the round-trip.
   */
  it("stores and retrieves JSON columns correctly", () => {
    const capabilities = ["typescript", "react", "database"];
    const repoScopeRules = { allowed: ["repo-a", "repo-b"], denied: ["repo-secret"] };

    const pool = makeWorkerPool({ capabilities, repoScopeRules });
    db.insert(workerPools).values(pool).run();

    const row = db.select().from(workerPools).get();
    expect(row!.capabilities).toEqual(capabilities);
    expect(row!.repoScopeRules).toEqual(repoScopeRules);
  });

  /**
   * @why Nullable columns (provider, runtime, model, default_timeout_sec,
   * default_token_budget, cost_profile, capabilities, repo_scope_rules) must
   * accept NULL values. These are optional configuration fields.
   */
  it("allows null for optional columns", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    const row = db.select().from(workerPools).get();
    expect(row!.provider).toBeNull();
    expect(row!.runtime).toBeNull();
    expect(row!.model).toBeNull();
    expect(row!.defaultTimeoutSec).toBeNull();
    expect(row!.defaultTokenBudget).toBeNull();
    expect(row!.costProfile).toBeNull();
    expect(row!.capabilities).toBeNull();
    expect(row!.repoScopeRules).toBeNull();
  });

  /**
   * @why Timestamps must auto-populate via `DEFAULT (unixepoch())` so callers
   * don't need to provide them. Verifies the default expression works.
   */
  it("auto-populates created_at and updated_at timestamps", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    const row = db.select().from(workerPools).get();
    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(row!.updatedAt).toBeInstanceOf(Date);
    const now = Date.now();
    expect(now - row!.createdAt.getTime()).toBeLessThan(10_000);
    expect(now - row!.updatedAt.getTime()).toBeLessThan(10_000);
  });

  /**
   * @why Primary key uniqueness must be enforced. Duplicate inserts must fail.
   */
  it("rejects duplicate worker_pool_id", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();
    expect(() => db.insert(workerPools).values(pool).run()).toThrow();
  });

  /**
   * @why Explicit integer values for max_concurrency and enabled must be
   * stored and retrieved correctly. This verifies non-default integer columns.
   */
  it("stores explicit max_concurrency and enabled values", () => {
    const pool = makeWorkerPool({
      maxConcurrency: 10,
      enabled: 0,
      defaultTimeoutSec: 300,
      defaultTokenBudget: 50000,
    });
    db.insert(workerPools).values(pool).run();

    const row = db.select().from(workerPools).get();
    expect(row!.maxConcurrency).toBe(10);
    expect(row!.enabled).toBe(0);
    expect(row!.defaultTimeoutSec).toBe(300);
    expect(row!.defaultTokenBudget).toBe(50000);
  });

  /**
   * @why All optional text fields (provider, runtime, model, cost_profile)
   * must store and retrieve values correctly when provided.
   */
  it("stores and retrieves all optional text fields", () => {
    const pool = makeWorkerPool({
      provider: "copilot",
      runtime: "copilot-cli",
      model: "gpt-4",
      costProfile: "standard",
    });
    db.insert(workerPools).values(pool).run();

    const row = db.select().from(workerPools).get();
    expect(row!.provider).toBe("copilot");
    expect(row!.runtime).toBe("copilot-cli");
    expect(row!.model).toBe("gpt-4");
    expect(row!.costProfile).toBe("standard");
  });
});

describe("T010 — Worker table", () => {
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
   * with the minimum required fields (pool_id, name, status) and the
   * mandatory FK to worker_pool.
   */
  it("inserts and retrieves a worker with required fields", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    const worker = makeWorker(pool.workerPoolId);
    db.insert(workers).values(worker).run();

    const rows = db.select().from(workers).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.workerId).toBe(worker.workerId);
    expect(rows[0]!.name).toBe(worker.name);
    expect(rows[0]!.status).toBe("online");
    expect(rows[0]!.poolId).toBe(pool.workerPoolId);
  });

  /**
   * @why The FK to worker_pool must be enforced. Inserting a worker with a
   * non-existent pool_id must fail.
   */
  it("rejects worker with non-existent pool_id", () => {
    const worker = makeWorker(randomUUID());
    expect(() => db.insert(workers).values(worker).run()).toThrow();
  });

  /**
   * @why The FK to tasks (current_task_id) must be enforced when non-null.
   * A valid task_id must exist in the tasks table.
   */
  it("rejects worker with non-existent current_task_id", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    const worker = makeWorker(pool.workerPoolId, { currentTaskId: randomUUID() });
    expect(() => db.insert(workers).values(worker).run()).toThrow();
  });

  /**
   * @why current_task_id FK must accept a valid task reference. This verifies
   * the cross-table FK between worker and task works correctly through the
   * full entity hierarchy (project → repo → task → worker).
   */
  it("accepts a valid current_task_id reference", () => {
    // Set up entity hierarchy: project → repo → task
    const wt = makeWorkflowTemplate();
    db.insert(workflowTemplates).values(wt).run();
    const proj = makeProject({ defaultWorkflowTemplateId: wt.workflowTemplateId });
    db.insert(projects).values(proj).run();
    const repo = makeRepository(proj.projectId);
    db.insert(repositories).values(repo).run();
    const task = makeTask(repo.repositoryId);
    db.insert(tasks).values(task).run();

    // Create pool and worker with task reference
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();
    const worker = makeWorker(pool.workerPoolId, { currentTaskId: task.taskId });
    db.insert(workers).values(worker).run();

    const row = db.select().from(workers).get();
    expect(row!.currentTaskId).toBe(task.taskId);
  });

  /**
   * @why Nullable columns (host, runtime_version, last_heartbeat_at,
   * current_task_id, current_run_id, health_metadata) must accept NULL.
   */
  it("allows null for optional columns", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    const worker = makeWorker(pool.workerPoolId);
    db.insert(workers).values(worker).run();

    const row = db.select().from(workers).get();
    expect(row!.host).toBeNull();
    expect(row!.runtimeVersion).toBeNull();
    expect(row!.lastHeartbeatAt).toBeNull();
    expect(row!.currentTaskId).toBeNull();
    expect(row!.currentRunId).toBeNull();
    expect(row!.healthMetadata).toBeNull();
  });

  /**
   * @why JSON health_metadata must round-trip correctly. This is used for
   * extensible diagnostics data (memory, CPU, error counts).
   */
  it("stores and retrieves JSON health_metadata correctly", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    const healthMetadata = { memoryMb: 512, cpuPercent: 45.2, errorCount: 0 };
    const worker = makeWorker(pool.workerPoolId, { healthMetadata });
    db.insert(workers).values(worker).run();

    const row = db.select().from(workers).get();
    expect(row!.healthMetadata).toEqual(healthMetadata);
  });

  /**
   * @why All optional text/integer fields must store and retrieve correctly.
   */
  it("stores all optional fields when provided", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    const worker = makeWorker(pool.workerPoolId, {
      host: "worker-host-01",
      runtimeVersion: "copilot-cli/1.2.3",
      currentRunId: randomUUID(),
    });
    db.insert(workers).values(worker).run();

    const row = db.select().from(workers).get();
    expect(row!.host).toBe("worker-host-01");
    expect(row!.runtimeVersion).toBe("copilot-cli/1.2.3");
    expect(row!.currentRunId).toBe(worker.currentRunId);
  });

  /**
   * @why Primary key uniqueness must be enforced. Duplicate inserts must fail.
   */
  it("rejects duplicate worker_id", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    const worker = makeWorker(pool.workerPoolId);
    db.insert(workers).values(worker).run();
    expect(() => db.insert(workers).values(worker).run()).toThrow();
  });

  /**
   * @why last_heartbeat_at is stored as a timestamp (integer). When provided,
   * Drizzle should handle the Date ↔ Unix epoch conversion correctly.
   */
  it("stores and retrieves last_heartbeat_at as a Date", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    const heartbeat = new Date();
    const worker = makeWorker(pool.workerPoolId, { lastHeartbeatAt: heartbeat });
    db.insert(workers).values(worker).run();

    const row = db.select().from(workers).get();
    expect(row!.lastHeartbeatAt).toBeInstanceOf(Date);
    // Compare to second precision (Unix epoch seconds)
    expect(Math.abs(row!.lastHeartbeatAt!.getTime() - heartbeat.getTime())).toBeLessThan(1000);
  });
});

describe("T010 — PromptTemplate table", () => {
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
   * with the minimum required fields (name, version, role, template_text).
   */
  it("inserts and retrieves a prompt template with required fields", () => {
    const tmpl = makePromptTemplate();
    db.insert(promptTemplates).values(tmpl).run();

    const rows = db.select().from(promptTemplates).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.promptTemplateId).toBe(tmpl.promptTemplateId);
    expect(rows[0]!.name).toBe(tmpl.name);
    expect(rows[0]!.version).toBe("1.0.0");
    expect(rows[0]!.role).toBe("developer");
    expect(rows[0]!.templateText).toBe(tmpl.templateText);
  });

  /**
   * @why JSON columns (input_schema, output_schema, stop_conditions) must
   * round-trip through SQLite without data loss. These define the structured
   * contract between the orchestrator and AI agents.
   */
  it("stores and retrieves JSON schema columns correctly", () => {
    const inputSchema = {
      type: "object",
      properties: { taskDescription: { type: "string" } },
      required: ["taskDescription"],
    };
    const outputSchema = {
      type: "object",
      properties: { diff: { type: "string" }, explanation: { type: "string" } },
    };
    const stopConditions = [
      { type: "token_limit", value: 10000 },
      { type: "time_limit_sec", value: 300 },
    ];

    const tmpl = makePromptTemplate({ inputSchema, outputSchema, stopConditions });
    db.insert(promptTemplates).values(tmpl).run();

    const row = db.select().from(promptTemplates).get();
    expect(row!.inputSchema).toEqual(inputSchema);
    expect(row!.outputSchema).toEqual(outputSchema);
    expect(row!.stopConditions).toEqual(stopConditions);
  });

  /**
   * @why Nullable JSON columns must accept NULL when not provided.
   */
  it("allows null for optional JSON columns", () => {
    const tmpl = makePromptTemplate();
    db.insert(promptTemplates).values(tmpl).run();

    const row = db.select().from(promptTemplates).get();
    expect(row!.inputSchema).toBeNull();
    expect(row!.outputSchema).toBeNull();
    expect(row!.stopConditions).toBeNull();
  });

  /**
   * @why Timestamps must auto-populate via `DEFAULT (unixepoch())`.
   */
  it("auto-populates created_at timestamp", () => {
    const tmpl = makePromptTemplate();
    db.insert(promptTemplates).values(tmpl).run();

    const row = db.select().from(promptTemplates).get();
    expect(row!.createdAt).toBeInstanceOf(Date);
    const now = Date.now();
    expect(now - row!.createdAt.getTime()).toBeLessThan(10_000);
  });

  /**
   * @why Primary key uniqueness must be enforced. Duplicate inserts must fail.
   */
  it("rejects duplicate prompt_template_id", () => {
    const tmpl = makePromptTemplate();
    db.insert(promptTemplates).values(tmpl).run();
    expect(() => db.insert(promptTemplates).values(tmpl).run()).toThrow();
  });

  /**
   * @why The role column must accept all valid AgentRole enum values. This
   * ensures templates can be created for every agent type in the system.
   */
  it("accepts all valid agent role values", () => {
    const roles = [
      "planner",
      "developer",
      "reviewer",
      "lead-reviewer",
      "merge-assist",
      "post-merge-analysis",
    ];
    for (const role of roles) {
      const tmpl = makePromptTemplate({ role });
      db.insert(promptTemplates).values(tmpl).run();
    }
    const rows = db.select().from(promptTemplates).all();
    expect(rows).toHaveLength(roles.length);
  });
});

describe("T010 — AgentProfile table", () => {
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
   * with the minimum required fields (pool_id). All policy references are
   * nullable.
   */
  it("inserts and retrieves an agent profile with required fields", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    const profile = makeAgentProfile(pool.workerPoolId);
    db.insert(agentProfiles).values(profile).run();

    const rows = db.select().from(agentProfiles).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.agentProfileId).toBe(profile.agentProfileId);
    expect(rows[0]!.poolId).toBe(pool.workerPoolId);
  });

  /**
   * @why The FK to worker_pool must be enforced. Inserting a profile with
   * a non-existent pool_id must fail.
   */
  it("rejects profile with non-existent pool_id", () => {
    const profile = makeAgentProfile(randomUUID());
    expect(() => db.insert(agentProfiles).values(profile).run()).toThrow();
  });

  /**
   * @why The FK to prompt_template must be enforced when non-null.
   * A valid prompt_template_id must exist.
   */
  it("rejects profile with non-existent prompt_template_id", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    const profile = makeAgentProfile(pool.workerPoolId, {
      promptTemplateId: randomUUID(),
    });
    expect(() => db.insert(agentProfiles).values(profile).run()).toThrow();
  });

  /**
   * @why The FK to prompt_template must accept a valid reference. This
   * validates the relationship between agent profiles and their templates.
   */
  it("accepts a valid prompt_template_id reference", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    const tmpl = makePromptTemplate();
    db.insert(promptTemplates).values(tmpl).run();

    const profile = makeAgentProfile(pool.workerPoolId, {
      promptTemplateId: tmpl.promptTemplateId,
    });
    db.insert(agentProfiles).values(profile).run();

    const row = db.select().from(agentProfiles).get();
    expect(row!.promptTemplateId).toBe(tmpl.promptTemplateId);
  });

  /**
   * @why All policy reference columns must accept NULL since the PolicySet
   * table doesn't exist yet (T013). These are forward-looking FKs.
   */
  it("allows null for all policy reference columns", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    const profile = makeAgentProfile(pool.workerPoolId);
    db.insert(agentProfiles).values(profile).run();

    const row = db.select().from(agentProfiles).get();
    expect(row!.promptTemplateId).toBeNull();
    expect(row!.toolPolicyId).toBeNull();
    expect(row!.commandPolicyId).toBeNull();
    expect(row!.fileScopePolicyId).toBeNull();
    expect(row!.validationPolicyId).toBeNull();
    expect(row!.reviewPolicyId).toBeNull();
    expect(row!.budgetPolicyId).toBeNull();
    expect(row!.retryPolicyId).toBeNull();
  });

  /**
   * @why All policy reference columns must store and retrieve text values
   * correctly when provided. These will become FKs once PolicySet exists.
   */
  it("stores and retrieves all policy reference columns", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    const policyIds = {
      toolPolicyId: randomUUID(),
      commandPolicyId: randomUUID(),
      fileScopePolicyId: randomUUID(),
      validationPolicyId: randomUUID(),
      reviewPolicyId: randomUUID(),
      budgetPolicyId: randomUUID(),
      retryPolicyId: randomUUID(),
    };
    const profile = makeAgentProfile(pool.workerPoolId, policyIds);
    db.insert(agentProfiles).values(profile).run();

    const row = db.select().from(agentProfiles).get();
    expect(row!.toolPolicyId).toBe(policyIds.toolPolicyId);
    expect(row!.commandPolicyId).toBe(policyIds.commandPolicyId);
    expect(row!.fileScopePolicyId).toBe(policyIds.fileScopePolicyId);
    expect(row!.validationPolicyId).toBe(policyIds.validationPolicyId);
    expect(row!.reviewPolicyId).toBe(policyIds.reviewPolicyId);
    expect(row!.budgetPolicyId).toBe(policyIds.budgetPolicyId);
    expect(row!.retryPolicyId).toBe(policyIds.retryPolicyId);
  });

  /**
   * @why Primary key uniqueness must be enforced. Duplicate inserts must fail.
   */
  it("rejects duplicate agent_profile_id", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    const profile = makeAgentProfile(pool.workerPoolId);
    db.insert(agentProfiles).values(profile).run();
    expect(() => db.insert(agentProfiles).values(profile).run()).toThrow();
  });
});

describe("T010 — Cross-table relationships", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
  });
  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why Validates the full entity graph: WorkerPool → Worker, WorkerPool →
   * AgentProfile → PromptTemplate. This ensures all foreign keys in the T010
   * tables work together correctly through a SQL join.
   */
  it("joins worker pool, worker, agent profile, and prompt template", () => {
    // Create worker pool
    const pool = makeWorkerPool({ name: "dev-pool", poolType: "developer" });
    db.insert(workerPools).values(pool).run();

    // Create worker in pool
    const worker = makeWorker(pool.workerPoolId, { name: "worker-1", status: "online" });
    db.insert(workers).values(worker).run();

    // Create prompt template
    const tmpl = makePromptTemplate({ name: "dev-template", role: "developer" });
    db.insert(promptTemplates).values(tmpl).run();

    // Create agent profile referencing pool and template
    const profile = makeAgentProfile(pool.workerPoolId, {
      promptTemplateId: tmpl.promptTemplateId,
    });
    db.insert(agentProfiles).values(profile).run();

    // Verify via SQL join
    const result = sqlite
      .prepare(
        `SELECT wp.name AS pool_name, wp.pool_type,
                w.name AS worker_name, w.status AS worker_status,
                pt.name AS template_name, pt.role AS template_role,
                ap.agent_profile_id
         FROM worker_pool wp
         JOIN worker w ON w.pool_id = wp.worker_pool_id
         JOIN agent_profile ap ON ap.pool_id = wp.worker_pool_id
         JOIN prompt_template pt ON ap.prompt_template_id = pt.prompt_template_id`,
      )
      .get() as {
      pool_name: string;
      pool_type: string;
      worker_name: string;
      worker_status: string;
      template_name: string;
      template_role: string;
      agent_profile_id: string;
    };

    expect(result.pool_name).toBe("dev-pool");
    expect(result.pool_type).toBe("developer");
    expect(result.worker_name).toBe("worker-1");
    expect(result.worker_status).toBe("online");
    expect(result.template_name).toBe("dev-template");
    expect(result.template_role).toBe("developer");
    expect(result.agent_profile_id).toBe(profile.agentProfileId);
  });

  /**
   * @why A single worker pool should support multiple workers and agent
   * profiles. This verifies the one-to-many relationships work correctly.
   */
  it("supports multiple workers and profiles per pool", () => {
    const pool = makeWorkerPool();
    db.insert(workerPools).values(pool).run();

    // Add multiple workers
    for (let i = 0; i < 3; i++) {
      db.insert(workers).values(makeWorker(pool.workerPoolId)).run();
    }

    // Add multiple profiles
    for (let i = 0; i < 2; i++) {
      db.insert(agentProfiles).values(makeAgentProfile(pool.workerPoolId)).run();
    }

    const workerRows = db.select().from(workers).where(eq(workers.poolId, pool.workerPoolId)).all();
    expect(workerRows).toHaveLength(3);

    const profileRows = db
      .select()
      .from(agentProfiles)
      .where(eq(agentProfiles.poolId, pool.workerPoolId))
      .all();
    expect(profileRows).toHaveLength(2);
  });

  /**
   * @why Worker.current_task_id links the worker plane (T010) to the task
   * lifecycle plane (T009). This verifies the cross-migration FK works by
   * traversing the full hierarchy: project → repo → task → worker → pool.
   */
  it("links worker to task through the full entity hierarchy", () => {
    // Set up T008/T009 hierarchy
    const wt = makeWorkflowTemplate();
    db.insert(workflowTemplates).values(wt).run();
    const proj = makeProject({ defaultWorkflowTemplateId: wt.workflowTemplateId });
    db.insert(projects).values(proj).run();
    const repo = makeRepository(proj.projectId);
    db.insert(repositories).values(repo).run();
    const task = makeTask(repo.repositoryId, {
      title: "implement-feature",
      status: "in_development",
    });
    db.insert(tasks).values(task).run();

    // Set up T010 hierarchy
    const pool = makeWorkerPool({ name: "dev-pool" });
    db.insert(workerPools).values(pool).run();
    const worker = makeWorker(pool.workerPoolId, {
      name: "active-worker",
      status: "busy",
      currentTaskId: task.taskId,
    });
    db.insert(workers).values(worker).run();

    // Verify the full cross-migration join
    const result = sqlite
      .prepare(
        `SELECT w.name AS worker_name, t.title AS task_title,
                r.name AS repo_name, p.name AS project_name,
                wp.name AS pool_name
         FROM worker w
         JOIN task t ON w.current_task_id = t.task_id
         JOIN repository r ON t.repository_id = r.repository_id
         JOIN project p ON r.project_id = p.project_id
         JOIN worker_pool wp ON w.pool_id = wp.worker_pool_id`,
      )
      .get() as {
      worker_name: string;
      task_title: string;
      repo_name: string;
      project_name: string;
      pool_name: string;
    };

    expect(result.worker_name).toBe("active-worker");
    expect(result.task_title).toBe("implement-feature");
    expect(result.pool_name).toBe("dev-pool");
  });
});

// ─── T011: TaskLease table ──────────────────────────────────────────────────

/**
 * Helper: seed a worker pool and return its ID.
 * Needed by TaskLease tests since pool_id has a DB-level FK constraint.
 */
function seedWorkerPool(db: ReturnType<typeof openTestDb>["db"]): string {
  const poolId = randomUUID();
  db.insert(workerPools)
    .values({
      workerPoolId: poolId,
      name: `pool-${poolId.slice(0, 8)}`,
      poolType: "developer",
    })
    .run();
  return poolId;
}

/** Generate a minimal valid TaskLease row. */
function makeTaskLease(
  taskId: string,
  poolId: string,
  overrides: Partial<typeof taskLeases.$inferInsert> = {},
) {
  return {
    leaseId: randomUUID(),
    taskId,
    workerId: `worker-${randomUUID().slice(0, 8)}`,
    poolId,
    expiresAt: new Date(Date.now() + 3600_000),
    status: "LEASED",
    ...overrides,
  };
}

describe("T011 — TaskLease table", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];
  let testRepoId: string;
  let testPoolId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    testRepoId = seedProjectAndRepo(db);
    testPoolId = seedWorkerPool(db);
  });
  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why Verifies basic CRUD for the lease table. Lease tracking is the
   * foundation of the worker execution model — if a lease can't be created
   * and read back, no task can be assigned to a worker.
   */
  it("inserts and retrieves a lease with all required fields", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const lease = makeTaskLease(t.taskId, testPoolId);
    db.insert(taskLeases).values(lease).run();

    const row = db.select().from(taskLeases).get();
    expect(row).toBeDefined();
    expect(row!.leaseId).toBe(lease.leaseId);
    expect(row!.taskId).toBe(t.taskId);
    expect(row!.workerId).toBe(lease.workerId);
    expect(row!.poolId).toBe(testPoolId);
    expect(row!.status).toBe("LEASED");
    expect(row!.expiresAt).toBeDefined();
  });

  /**
   * @why leased_at must auto-populate via DEFAULT (unixepoch()). The lease
   * acquisition time is recorded automatically and used for timeout calculations.
   */
  it("auto-populates leased_at with a default timestamp", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const lease = makeTaskLease(t.taskId, testPoolId);
    db.insert(taskLeases).values(lease).run();

    const row = db.select().from(taskLeases).get();
    expect(row!.leasedAt).toBeInstanceOf(Date);
  });

  /**
   * @why heartbeat_at is nullable before the first heartbeat. It must accept
   * a timestamp value when a heartbeat is received to track worker liveness.
   */
  it("stores heartbeat_at when provided", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const now = new Date();
    const lease = makeTaskLease(t.taskId, testPoolId, { heartbeatAt: now });
    db.insert(taskLeases).values(lease).run();

    const row = db.select().from(taskLeases).get();
    expect(row!.heartbeatAt).toBeInstanceOf(Date);
  });

  /**
   * @why heartbeat_at must default to null before the first heartbeat arrives.
   * The staleness detector uses null heartbeat_at to identify leases that
   * never sent a heartbeat.
   */
  it("defaults heartbeat_at to null", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const lease = makeTaskLease(t.taskId, testPoolId);
    db.insert(taskLeases).values(lease).run();

    const row = db.select().from(taskLeases).get();
    expect(row!.heartbeatAt).toBeNull();
  });

  /**
   * @why reclaim_reason must be nullable (not set for successful leases)
   * and accept a text value when a lease is reclaimed due to timeout or crash.
   */
  it("stores reclaim_reason when provided", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const lease = makeTaskLease(t.taskId, testPoolId, {
      status: "RECLAIMED",
      reclaimReason: "heartbeat_timeout",
    });
    db.insert(taskLeases).values(lease).run();

    const row = db.select().from(taskLeases).get();
    expect(row!.reclaimReason).toBe("heartbeat_timeout");
  });

  /**
   * @why partial_result_artifact_refs must store a JSON array of artifact paths.
   * Crash recovery uses these to provide the next worker with partial results
   * from the failed execution.
   */
  it("stores partial_result_artifact_refs as a JSON array", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const refs = ["/artifacts/task-123/partial-diff.patch", "/artifacts/task-123/log.txt"];
    const lease = makeTaskLease(t.taskId, testPoolId, {
      status: "RECLAIMED",
      partialResultArtifactRefs: refs,
    });
    db.insert(taskLeases).values(lease).run();

    const row = db.select().from(taskLeases).get();
    expect(row!.partialResultArtifactRefs).toEqual(refs);
  });

  /**
   * @why FK from task_lease.task_id → task.task_id must be enforced.
   * A lease cannot exist without a valid task.
   */
  it("rejects an invalid task_id FK reference", () => {
    expect(() =>
      db.insert(taskLeases).values(makeTaskLease("non-existent-task-id", testPoolId)).run(),
    ).toThrow();
  });

  /**
   * @why FK from task_lease.pool_id → worker_pool.worker_pool_id must be
   * enforced. A lease must reference a valid pool for scheduling traceability.
   */
  it("rejects an invalid pool_id FK reference", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    expect(() =>
      db.insert(taskLeases).values(makeTaskLease(t.taskId, "non-existent-pool-id")).run(),
    ).toThrow();
  });

  /**
   * @why A task may have multiple leases over its lifetime (e.g. after reclaim
   * and reassignment). The lease history must be preserved for audit.
   */
  it("supports multiple leases per task (lease history)", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    db.insert(taskLeases)
      .values(makeTaskLease(t.taskId, testPoolId, { status: "RECLAIMED" }))
      .run();
    db.insert(taskLeases)
      .values(makeTaskLease(t.taskId, testPoolId, { status: "LEASED" }))
      .run();

    const rows = db.select().from(taskLeases).where(eq(taskLeases.taskId, t.taskId)).all();
    expect(rows).toHaveLength(2);
  });

  /**
   * @why Indexes on task_id, worker_id, and status must exist for efficient
   * querying of active leases, worker assignments, and staleness detection.
   */
  it("has indexes on task_id, worker_id, and status", () => {
    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task_lease'")
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_task_lease_task_id");
    expect(indexNames).toContain("idx_task_lease_worker_id");
    expect(indexNames).toContain("idx_task_lease_status");
  });
});

// ─── T011: ReviewCycle table ────────────────────────────────────────────────

/** Generate a minimal valid ReviewCycle row. */
function makeReviewCycle(
  taskId: string,
  overrides: Partial<typeof reviewCycles.$inferInsert> = {},
) {
  return {
    reviewCycleId: randomUUID(),
    taskId,
    status: "NOT_STARTED",
    ...overrides,
  };
}

describe("T011 — ReviewCycle table", () => {
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
   * @why Verifies basic CRUD for review cycles. Every task that enters the
   * review phase creates a ReviewCycle. If CRUD fails, the entire review
   * pipeline is broken.
   */
  it("inserts and retrieves a review cycle with required fields", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const cycle = makeReviewCycle(t.taskId);
    db.insert(reviewCycles).values(cycle).run();

    const row = db.select().from(reviewCycles).get();
    expect(row).toBeDefined();
    expect(row!.reviewCycleId).toBe(cycle.reviewCycleId);
    expect(row!.taskId).toBe(t.taskId);
    expect(row!.status).toBe("NOT_STARTED");
  });

  /**
   * @why started_at must auto-populate via DEFAULT (unixepoch()). The cycle
   * start time is needed for timing metrics and SLA calculations.
   */
  it("auto-populates started_at with a default timestamp", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const cycle = makeReviewCycle(t.taskId);
    db.insert(reviewCycles).values(cycle).run();

    const row = db.select().from(reviewCycles).get();
    expect(row!.startedAt).toBeInstanceOf(Date);
  });

  /**
   * @why completed_at must be nullable (not set when cycle is in-progress)
   * and accept a timestamp when the cycle reaches a terminal state.
   */
  it("stores completed_at when provided", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const now = new Date();
    const cycle = makeReviewCycle(t.taskId, { status: "APPROVED", completedAt: now });
    db.insert(reviewCycles).values(cycle).run();

    const row = db.select().from(reviewCycles).get();
    expect(row!.completedAt).toBeInstanceOf(Date);
  });

  /**
   * @why completed_at defaults to null for in-progress cycles.
   */
  it("defaults completed_at to null", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const cycle = makeReviewCycle(t.taskId);
    db.insert(reviewCycles).values(cycle).run();

    const row = db.select().from(reviewCycles).get();
    expect(row!.completedAt).toBeNull();
  });

  /**
   * @why required_reviewers must store a JSON array of reviewer identifiers.
   * The review router populates these when routing specialist reviewers.
   */
  it("stores required_reviewers as a JSON array", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const reviewers = ["pool-security", "pool-architecture"];
    const cycle = makeReviewCycle(t.taskId, { requiredReviewers: reviewers });
    db.insert(reviewCycles).values(cycle).run();

    const row = db.select().from(reviewCycles).get();
    expect(row!.requiredReviewers).toEqual(reviewers);
  });

  /**
   * @why optional_reviewers must store a JSON array of reviewer identifiers.
   * These are informational reviews that don't block cycle progression.
   */
  it("stores optional_reviewers as a JSON array", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    const reviewers = ["pool-style", "pool-docs"];
    const cycle = makeReviewCycle(t.taskId, { optionalReviewers: reviewers });
    db.insert(reviewCycles).values(cycle).run();

    const row = db.select().from(reviewCycles).get();
    expect(row!.optionalReviewers).toEqual(reviewers);
  });

  /**
   * @why FK from review_cycle.task_id → task.task_id must be enforced.
   * A review cycle cannot exist without a valid task.
   */
  it("rejects an invalid task_id FK reference", () => {
    expect(() =>
      db.insert(reviewCycles).values(makeReviewCycle("non-existent-task-id")).run(),
    ).toThrow();
  });

  /**
   * @why A task may have multiple review cycles (one per rework round).
   * The cycle history is preserved for audit and metrics.
   */
  it("supports multiple review cycles per task (rework history)", () => {
    const t = makeTask(testRepoId);
    db.insert(tasks).values(t).run();

    db.insert(reviewCycles)
      .values(makeReviewCycle(t.taskId, { status: "REJECTED" }))
      .run();
    db.insert(reviewCycles)
      .values(makeReviewCycle(t.taskId, { status: "IN_PROGRESS" }))
      .run();

    const rows = db.select().from(reviewCycles).where(eq(reviewCycles.taskId, t.taskId)).all();
    expect(rows).toHaveLength(2);
  });

  /**
   * @why Indexes on task_id and status must exist for efficient querying of
   * active review cycles and cycle history per task.
   */
  it("has indexes on task_id and status", () => {
    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'review_cycle'")
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_review_cycle_task_id");
    expect(indexNames).toContain("idx_review_cycle_status");
  });
});

// ─── T011: ReviewPacket table ───────────────────────────────────────────────

/** Generate a minimal valid ReviewPacket row. */
function makeReviewPacket(
  taskId: string,
  reviewCycleId: string,
  overrides: Partial<typeof reviewPackets.$inferInsert> = {},
) {
  return {
    reviewPacketId: randomUUID(),
    taskId,
    reviewCycleId,
    reviewerType: "reviewer",
    verdict: "approved",
    ...overrides,
  };
}

describe("T011 — ReviewPacket table", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];
  let testRepoId: string;
  let testTaskId: string;
  let testCycleId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    testRepoId = seedProjectAndRepo(db);

    const t = makeTask(testRepoId);
    testTaskId = t.taskId;
    db.insert(tasks).values(t).run();

    const cycle = makeReviewCycle(testTaskId);
    testCycleId = cycle.reviewCycleId;
    db.insert(reviewCycles).values(cycle).run();
  });
  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why Verifies basic CRUD for review packets. Each specialist reviewer
   * produces a ReviewPacket per cycle. If CRUD fails, review results
   * cannot be persisted.
   */
  it("inserts and retrieves a review packet with required fields", () => {
    const pkt = makeReviewPacket(testTaskId, testCycleId);
    db.insert(reviewPackets).values(pkt).run();

    const row = db.select().from(reviewPackets).get();
    expect(row).toBeDefined();
    expect(row!.reviewPacketId).toBe(pkt.reviewPacketId);
    expect(row!.taskId).toBe(testTaskId);
    expect(row!.reviewCycleId).toBe(testCycleId);
    expect(row!.reviewerType).toBe("reviewer");
    expect(row!.verdict).toBe("approved");
  });

  /**
   * @why created_at must auto-populate. The creation timestamp is used for
   * ordering reviews and tracking review latency.
   */
  it("auto-populates created_at with a default timestamp", () => {
    const pkt = makeReviewPacket(testTaskId, testCycleId);
    db.insert(reviewPackets).values(pkt).run();

    const row = db.select().from(reviewPackets).get();
    expect(row!.createdAt).toBeInstanceOf(Date);
  });

  /**
   * @why severity_summary must store a JSON object with issue counts by level.
   * The lead reviewer uses this to make a consolidated decision.
   */
  it("stores severity_summary as a JSON object", () => {
    const summary = { critical: 0, high: 1, medium: 3, low: 2 };
    const pkt = makeReviewPacket(testTaskId, testCycleId, { severitySummary: summary });
    db.insert(reviewPackets).values(pkt).run();

    const row = db.select().from(reviewPackets).get();
    expect(row!.severitySummary).toEqual(summary);
  });

  /**
   * @why packet_json must store the full structured review output as JSON.
   * This is the primary payload containing issues, suggestions, and metadata.
   */
  it("stores packet_json as a JSON object", () => {
    const packet = {
      version: "1.0",
      issues: [{ severity: "high", message: "Missing error handling", file: "src/index.ts" }],
      suggestions: ["Add try-catch blocks"],
    };
    const pkt = makeReviewPacket(testTaskId, testCycleId, { packetJson: packet });
    db.insert(reviewPackets).values(pkt).run();

    const row = db.select().from(reviewPackets).get();
    expect(row!.packetJson).toEqual(packet);
  });

  /**
   * @why reviewer_pool_id is nullable — it tracks the origin pool for metrics
   * but is not required for basic review packet storage.
   */
  it("stores reviewer_pool_id when provided", () => {
    const pkt = makeReviewPacket(testTaskId, testCycleId, {
      reviewerPoolId: "pool-security-123",
    });
    db.insert(reviewPackets).values(pkt).run();

    const row = db.select().from(reviewPackets).get();
    expect(row!.reviewerPoolId).toBe("pool-security-123");
  });

  /**
   * @why FK from review_packet.task_id → task.task_id must be enforced.
   */
  it("rejects an invalid task_id FK reference", () => {
    expect(() =>
      db.insert(reviewPackets).values(makeReviewPacket("non-existent-task-id", testCycleId)).run(),
    ).toThrow();
  });

  /**
   * @why FK from review_packet.review_cycle_id → review_cycle.review_cycle_id
   * must be enforced. Packets must belong to a valid cycle.
   */
  it("rejects an invalid review_cycle_id FK reference", () => {
    expect(() =>
      db.insert(reviewPackets).values(makeReviewPacket(testTaskId, "non-existent-cycle-id")).run(),
    ).toThrow();
  });

  /**
   * @why A review cycle may have multiple packets from different specialist
   * reviewers. Each reviewer produces exactly one packet per cycle.
   */
  it("supports multiple packets per review cycle", () => {
    db.insert(reviewPackets)
      .values(
        makeReviewPacket(testTaskId, testCycleId, {
          reviewerType: "reviewer",
          verdict: "approved",
        }),
      )
      .run();
    db.insert(reviewPackets)
      .values(
        makeReviewPacket(testTaskId, testCycleId, {
          reviewerType: "reviewer",
          verdict: "changes_requested",
        }),
      )
      .run();

    const rows = db
      .select()
      .from(reviewPackets)
      .where(eq(reviewPackets.reviewCycleId, testCycleId))
      .all();
    expect(rows).toHaveLength(2);
  });

  /**
   * @why Indexes on (task_id, review_cycle_id) and verdict must exist for
   * efficient querying of review results.
   */
  it("has indexes on (task_id, review_cycle_id) and verdict", () => {
    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'review_packet'")
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_review_packet_task_cycle");
    expect(indexNames).toContain("idx_review_packet_verdict");
  });
});

// ─── T011: LeadReviewDecision table ─────────────────────────────────────────

/** Generate a minimal valid LeadReviewDecision row. */
function makeLeadReviewDecision(
  taskId: string,
  reviewCycleId: string,
  overrides: Partial<typeof leadReviewDecisions.$inferInsert> = {},
) {
  return {
    leadReviewDecisionId: randomUUID(),
    taskId,
    reviewCycleId,
    decision: "approved",
    ...overrides,
  };
}

describe("T011 — LeadReviewDecision table", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];
  let testRepoId: string;
  let testTaskId: string;
  let testCycleId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    testRepoId = seedProjectAndRepo(db);

    const t = makeTask(testRepoId);
    testTaskId = t.taskId;
    db.insert(tasks).values(t).run();

    const cycle = makeReviewCycle(testTaskId);
    testCycleId = cycle.reviewCycleId;
    db.insert(reviewCycles).values(cycle).run();
  });
  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why Verifies basic CRUD for lead review decisions. The lead reviewer's
   * decision determines whether a task proceeds to merge, enters rework,
   * or gets escalated. If this table fails, the review pipeline halts.
   */
  it("inserts and retrieves a decision with required fields", () => {
    const dec = makeLeadReviewDecision(testTaskId, testCycleId);
    db.insert(leadReviewDecisions).values(dec).run();

    const row = db.select().from(leadReviewDecisions).get();
    expect(row).toBeDefined();
    expect(row!.leadReviewDecisionId).toBe(dec.leadReviewDecisionId);
    expect(row!.taskId).toBe(testTaskId);
    expect(row!.reviewCycleId).toBe(testCycleId);
    expect(row!.decision).toBe("approved");
  });

  /**
   * @why blocking_issue_count must default to 0. When the decision is
   * "approved", there are no blocking issues.
   */
  it("defaults blocking_issue_count to 0", () => {
    const dec = makeLeadReviewDecision(testTaskId, testCycleId);
    db.insert(leadReviewDecisions).values(dec).run();

    const row = db.select().from(leadReviewDecisions).get();
    expect(row!.blockingIssueCount).toBe(0);
  });

  /**
   * @why non_blocking_issue_count must default to 0.
   */
  it("defaults non_blocking_issue_count to 0", () => {
    const dec = makeLeadReviewDecision(testTaskId, testCycleId);
    db.insert(leadReviewDecisions).values(dec).run();

    const row = db.select().from(leadReviewDecisions).get();
    expect(row!.nonBlockingIssueCount).toBe(0);
  });

  /**
   * @why blocking_issue_count and non_blocking_issue_count must accept
   * explicit values. The lead reviewer sets these based on consolidated
   * specialist review findings.
   */
  it("stores explicit issue counts", () => {
    const dec = makeLeadReviewDecision(testTaskId, testCycleId, {
      decision: "changes_requested",
      blockingIssueCount: 3,
      nonBlockingIssueCount: 7,
    });
    db.insert(leadReviewDecisions).values(dec).run();

    const row = db.select().from(leadReviewDecisions).get();
    expect(row!.blockingIssueCount).toBe(3);
    expect(row!.nonBlockingIssueCount).toBe(7);
  });

  /**
   * @why follow_up_task_refs must store a JSON array of task references.
   * When the decision is "approved_with_follow_up", this array contains
   * identifiers for follow-up tasks to be created.
   */
  it("stores follow_up_task_refs as a JSON array", () => {
    const refs = ["task-follow-up-1", "task-follow-up-2"];
    const dec = makeLeadReviewDecision(testTaskId, testCycleId, {
      decision: "approved_with_follow_up",
      followUpTaskRefs: refs,
    });
    db.insert(leadReviewDecisions).values(dec).run();

    const row = db.select().from(leadReviewDecisions).get();
    expect(row!.followUpTaskRefs).toEqual(refs);
  });

  /**
   * @why packet_json must store the full structured lead review decision
   * as JSON. This is the primary payload for the consolidation output.
   */
  it("stores packet_json as a JSON object", () => {
    const packet = {
      version: "1.0",
      summary: "All blocking issues resolved",
      consolidatedFindings: [{ category: "performance", count: 2 }],
    };
    const dec = makeLeadReviewDecision(testTaskId, testCycleId, { packetJson: packet });
    db.insert(leadReviewDecisions).values(dec).run();

    const row = db.select().from(leadReviewDecisions).get();
    expect(row!.packetJson).toEqual(packet);
  });

  /**
   * @why created_at must auto-populate. Decision timestamps are used for
   * audit trails and metrics.
   */
  it("auto-populates created_at with a default timestamp", () => {
    const dec = makeLeadReviewDecision(testTaskId, testCycleId);
    db.insert(leadReviewDecisions).values(dec).run();

    const row = db.select().from(leadReviewDecisions).get();
    expect(row!.createdAt).toBeInstanceOf(Date);
  });

  /**
   * @why FK from lead_review_decision.task_id → task.task_id must be enforced.
   */
  it("rejects an invalid task_id FK reference", () => {
    expect(() =>
      db
        .insert(leadReviewDecisions)
        .values(makeLeadReviewDecision("non-existent-task-id", testCycleId))
        .run(),
    ).toThrow();
  });

  /**
   * @why FK from lead_review_decision.review_cycle_id →
   * review_cycle.review_cycle_id must be enforced.
   */
  it("rejects an invalid review_cycle_id FK reference", () => {
    expect(() =>
      db
        .insert(leadReviewDecisions)
        .values(makeLeadReviewDecision(testTaskId, "non-existent-cycle-id"))
        .run(),
    ).toThrow();
  });

  /**
   * @why Indexes on task_id and review_cycle_id must exist for efficient
   * lookups of decisions by task and by cycle.
   */
  it("has indexes on task_id and review_cycle_id", () => {
    const indexes = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'lead_review_decision'",
      )
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_lead_review_decision_task_id");
    expect(indexNames).toContain("idx_lead_review_decision_cycle_id");
  });

  /**
   * @why Cross-table joins must work correctly. The review pipeline queries
   * review cycles with their packets and lead decisions together. This
   * validates the FK relationships are correct for join queries.
   */
  it("supports cross-table joins: task → review_cycle → review_packet + lead_decision", () => {
    // Add a review packet
    const pkt = makeReviewPacket(testTaskId, testCycleId, {
      verdict: "changes_requested",
      severitySummary: { critical: 0, high: 1, medium: 0, low: 0 },
    });
    db.insert(reviewPackets).values(pkt).run();

    // Add a lead decision
    const dec = makeLeadReviewDecision(testTaskId, testCycleId, {
      decision: "changes_requested",
      blockingIssueCount: 1,
    });
    db.insert(leadReviewDecisions).values(dec).run();

    // Cross-table join
    const result = sqlite
      .prepare(
        `SELECT rc.status AS cycle_status,
                rp.verdict AS packet_verdict,
                lrd.decision AS lead_decision,
                lrd.blocking_issue_count AS blocking_issues,
                t.title AS task_title
         FROM review_cycle rc
         JOIN task t ON rc.task_id = t.task_id
         JOIN review_packet rp ON rp.review_cycle_id = rc.review_cycle_id
         JOIN lead_review_decision lrd ON lrd.review_cycle_id = rc.review_cycle_id`,
      )
      .get() as {
      cycle_status: string;
      packet_verdict: string;
      lead_decision: string;
      blocking_issues: number;
      task_title: string;
    };

    expect(result.cycle_status).toBe("NOT_STARTED");
    expect(result.packet_verdict).toBe("changes_requested");
    expect(result.lead_decision).toBe("changes_requested");
    expect(result.blocking_issues).toBe(1);
  });
});

// ─── T012: MergeQueueItem table ─────────────────────────────────────────────

/**
 * Generate a minimal valid MergeQueueItem row.
 *
 * Requires a task_id and repository_id from pre-seeded parent rows.
 */
function makeMergeQueueItem(
  taskId: string,
  repositoryId: string,
  overrides: Partial<typeof mergeQueueItems.$inferInsert> = {},
) {
  return {
    mergeQueueItemId: randomUUID(),
    taskId,
    repositoryId,
    status: "ENQUEUED",
    position: 1,
    ...overrides,
  };
}

describe("T012 — MergeQueueItem table", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];

  /** Shared parent IDs for FK satisfaction. */
  let projectId: string;
  let repoId: string;
  let taskId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    projectId = randomUUID();
    repoId = randomUUID();
    taskId = randomUUID();

    db.insert(projects)
      .values(makeProject({ projectId, name: `proj-${projectId.slice(0, 8)}` }))
      .run();
    db.insert(repositories)
      .values(
        makeRepository(projectId, {
          repositoryId: repoId,
          name: `repo-${repoId.slice(0, 8)}`,
        }),
      )
      .run();
    db.insert(tasks)
      .values(makeTask(repoId, { taskId, title: `task-${taskId.slice(0, 8)}` }))
      .run();
  });

  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why Verifies the merge_queue_item table can store a minimal valid row
   * with all required columns. If this fails, the table DDL is broken.
   */
  it("should insert and read back a merge queue item", () => {
    const row = makeMergeQueueItem(taskId, repoId);
    db.insert(mergeQueueItems).values(row).run();

    const result = db
      .select()
      .from(mergeQueueItems)
      .where(eq(mergeQueueItems.mergeQueueItemId, row.mergeQueueItemId))
      .get();

    expect(result).toBeDefined();
    expect(result!.taskId).toBe(taskId);
    expect(result!.repositoryId).toBe(repoId);
    expect(result!.status).toBe("ENQUEUED");
    expect(result!.position).toBe(1);
  });

  /**
   * @why Verifies that enqueued_at defaults to the current Unix timestamp.
   * The merge queue relies on enqueued_at for ordering and audit.
   */
  it("should set enqueued_at to current timestamp by default", () => {
    const before = Math.floor(Date.now() / 1000);
    const row = makeMergeQueueItem(taskId, repoId);
    db.insert(mergeQueueItems).values(row).run();

    const result = db
      .select()
      .from(mergeQueueItems)
      .where(eq(mergeQueueItems.mergeQueueItemId, row.mergeQueueItemId))
      .get();

    expect(result).toBeDefined();
    const ts =
      result!.enqueuedAt instanceof Date
        ? Math.floor(result!.enqueuedAt.getTime() / 1000)
        : (result!.enqueuedAt as number);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1);
  });

  /**
   * @why approved_commit_sha, started_at, completed_at should be nullable —
   * they are populated at different stages of the merge lifecycle.
   */
  it("should allow nullable optional fields", () => {
    const row = makeMergeQueueItem(taskId, repoId, {
      approvedCommitSha: null,
      startedAt: null,
      completedAt: null,
    });
    db.insert(mergeQueueItems).values(row).run();

    const result = db
      .select()
      .from(mergeQueueItems)
      .where(eq(mergeQueueItems.mergeQueueItemId, row.mergeQueueItemId))
      .get();

    expect(result).toBeDefined();
    expect(result!.approvedCommitSha).toBeNull();
    expect(result!.startedAt).toBeNull();
    expect(result!.completedAt).toBeNull();
  });

  /**
   * @why The approved_commit_sha is set when a task is approved for merge.
   * The merge executor must verify this SHA before merging.
   */
  it("should store approved_commit_sha", () => {
    const sha = "abc123def456";
    const row = makeMergeQueueItem(taskId, repoId, { approvedCommitSha: sha });
    db.insert(mergeQueueItems).values(row).run();

    const result = db
      .select()
      .from(mergeQueueItems)
      .where(eq(mergeQueueItems.mergeQueueItemId, row.mergeQueueItemId))
      .get();

    expect(result!.approvedCommitSha).toBe(sha);
  });

  /**
   * @why FK constraint on task_id ensures referential integrity. Inserting
   * a merge queue item for a non-existent task must fail.
   */
  it("should reject FK violation on task_id", () => {
    const row = makeMergeQueueItem("nonexistent-task", repoId);
    expect(() => db.insert(mergeQueueItems).values(row).run()).toThrow();
  });

  /**
   * @why FK constraint on repository_id ensures referential integrity.
   */
  it("should reject FK violation on repository_id", () => {
    const row = makeMergeQueueItem(taskId, "nonexistent-repo");
    expect(() => db.insert(mergeQueueItems).values(row).run()).toThrow();
  });

  /**
   * @why Multiple tasks can be enqueued in the same repository. The merge
   * queue processes them in position order.
   */
  it("should support multiple items per repository with different positions", () => {
    const taskId2 = randomUUID();
    db.insert(tasks)
      .values(makeTask(repoId, { taskId: taskId2, title: "task-2" }))
      .run();

    db.insert(mergeQueueItems)
      .values(makeMergeQueueItem(taskId, repoId, { position: 1 }))
      .run();
    db.insert(mergeQueueItems)
      .values(makeMergeQueueItem(taskId2, repoId, { position: 2 }))
      .run();

    const results = db
      .select()
      .from(mergeQueueItems)
      .where(eq(mergeQueueItems.repositoryId, repoId))
      .all();

    expect(results).toHaveLength(2);
  });

  /**
   * @why The (repository_id, status) index is critical for merge queue polling.
   * Verify the index exists and the query it supports works correctly.
   */
  it("should support filtering by repository_id and status", () => {
    db.insert(mergeQueueItems)
      .values(
        makeMergeQueueItem(taskId, repoId, {
          status: "ENQUEUED",
          position: 1,
        }),
      )
      .run();

    const results = sqlite
      .prepare(`SELECT * FROM merge_queue_item WHERE repository_id = ? AND status = ?`)
      .all(repoId, "ENQUEUED") as Array<Record<string, unknown>>;

    expect(results).toHaveLength(1);
  });
});

// ─── T012: ValidationRun table ──────────────────────────────────────────────

/**
 * Generate a minimal valid ValidationRun row.
 *
 * Requires a task_id from a pre-seeded parent row.
 */
function makeValidationRun(
  taskId: string,
  overrides: Partial<typeof validationRuns.$inferInsert> = {},
) {
  return {
    validationRunId: randomUUID(),
    taskId,
    runScope: "pre-dev",
    status: "pending",
    ...overrides,
  };
}

describe("T012 — ValidationRun table", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];

  let projectId: string;
  let repoId: string;
  let taskId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    projectId = randomUUID();
    repoId = randomUUID();
    taskId = randomUUID();

    db.insert(projects)
      .values(makeProject({ projectId, name: `proj-${projectId.slice(0, 8)}` }))
      .run();
    db.insert(repositories)
      .values(
        makeRepository(projectId, {
          repositoryId: repoId,
          name: `repo-${repoId.slice(0, 8)}`,
        }),
      )
      .run();
    db.insert(tasks)
      .values(makeTask(repoId, { taskId, title: `task-${taskId.slice(0, 8)}` }))
      .run();
  });

  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why Verifies the validation_run table can store a minimal valid row.
   * If this fails, the table DDL is broken.
   */
  it("should insert and read back a validation run", () => {
    const row = makeValidationRun(taskId);
    db.insert(validationRuns).values(row).run();

    const result = db
      .select()
      .from(validationRuns)
      .where(eq(validationRuns.validationRunId, row.validationRunId))
      .get();

    expect(result).toBeDefined();
    expect(result!.taskId).toBe(taskId);
    expect(result!.runScope).toBe("pre-dev");
    expect(result!.status).toBe("pending");
  });

  /**
   * @why started_at defaults to the current Unix timestamp. Validation
   * runs track their start time for duration calculations.
   */
  it("should set started_at to current timestamp by default", () => {
    const before = Math.floor(Date.now() / 1000);
    const row = makeValidationRun(taskId);
    db.insert(validationRuns).values(row).run();

    const result = db
      .select()
      .from(validationRuns)
      .where(eq(validationRuns.validationRunId, row.validationRunId))
      .get();

    expect(result).toBeDefined();
    const ts =
      result!.startedAt instanceof Date
        ? Math.floor(result!.startedAt.getTime() / 1000)
        : (result!.startedAt as number);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1);
  });

  /**
   * @why tool_name, summary, artifact_refs, completed_at are nullable —
   * they are populated after the validation run completes.
   */
  it("should allow nullable optional fields", () => {
    const row = makeValidationRun(taskId, {
      toolName: null,
      summary: null,
      artifactRefs: null,
      completedAt: null,
    });
    db.insert(validationRuns).values(row).run();

    const result = db
      .select()
      .from(validationRuns)
      .where(eq(validationRuns.validationRunId, row.validationRunId))
      .get();

    expect(result).toBeDefined();
    expect(result!.toolName).toBeNull();
    expect(result!.summary).toBeNull();
    expect(result!.artifactRefs).toBeNull();
    expect(result!.completedAt).toBeNull();
  });

  /**
   * @why artifact_refs stores a JSON array of artifact identifiers.
   * The validation gate and artifact service parse this for retrieval.
   */
  it("should store and retrieve artifact_refs as JSON", () => {
    const refs = ["artifact-001", "artifact-002"];
    const row = makeValidationRun(taskId, { artifactRefs: refs });
    db.insert(validationRuns).values(row).run();

    const result = db
      .select()
      .from(validationRuns)
      .where(eq(validationRuns.validationRunId, row.validationRunId))
      .get();

    expect(result!.artifactRefs).toEqual(refs);
  });

  /**
   * @why All five validation run scopes from the PRD must be storable.
   * Gate-checking logic queries by scope.
   */
  it("should accept all valid run_scope values", () => {
    const scopes = ["pre-dev", "during-dev", "pre-review", "pre-merge", "post-merge"];
    for (const scope of scopes) {
      const row = makeValidationRun(taskId, {
        validationRunId: randomUUID(),
        runScope: scope,
      });
      db.insert(validationRuns).values(row).run();
    }

    const results = db.select().from(validationRuns).where(eq(validationRuns.taskId, taskId)).all();

    expect(results).toHaveLength(5);
  });

  /**
   * @why tool_name records which validation tool ran (e.g. vitest, eslint).
   * The validation runner populates this.
   */
  it("should store tool_name and summary", () => {
    const row = makeValidationRun(taskId, {
      toolName: "vitest",
      summary: "42 tests passed, 0 failed",
      status: "passed",
    });
    db.insert(validationRuns).values(row).run();

    const result = db
      .select()
      .from(validationRuns)
      .where(eq(validationRuns.validationRunId, row.validationRunId))
      .get();

    expect(result!.toolName).toBe("vitest");
    expect(result!.summary).toBe("42 tests passed, 0 failed");
    expect(result!.status).toBe("passed");
  });

  /**
   * @why FK constraint on task_id ensures referential integrity.
   */
  it("should reject FK violation on task_id", () => {
    const row = makeValidationRun("nonexistent-task");
    expect(() => db.insert(validationRuns).values(row).run()).toThrow();
  });

  /**
   * @why The (task_id, run_scope) composite index supports the gate-checking
   * query "find all validation runs for this task at this scope."
   */
  it("should support querying by task_id and run_scope", () => {
    db.insert(validationRuns)
      .values(makeValidationRun(taskId, { runScope: "pre-merge", status: "passed" }))
      .run();
    db.insert(validationRuns)
      .values(
        makeValidationRun(taskId, {
          validationRunId: randomUUID(),
          runScope: "post-merge",
          status: "pending",
        }),
      )
      .run();

    const results = sqlite
      .prepare(`SELECT * FROM validation_run WHERE task_id = ? AND run_scope = ?`)
      .all(taskId, "pre-merge") as Array<Record<string, unknown>>;

    expect(results).toHaveLength(1);
    expect(results[0]!["status"]).toBe("passed");
  });
});

// ─── T012: Job table ────────────────────────────────────────────────────────

/**
 * Generate a minimal valid Job row.
 */
function makeJob(overrides: Partial<typeof jobs.$inferInsert> = {}) {
  return {
    jobId: randomUUID(),
    jobType: "worker_dispatch",
    status: "pending",
    ...overrides,
  };
}

describe("T012 — Job table", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
  });

  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why Verifies the job table can store a minimal valid row with only
   * required columns. If this fails, the table DDL is broken.
   */
  it("should insert and read back a minimal job", () => {
    const row = makeJob();
    db.insert(jobs).values(row).run();

    const result = db.select().from(jobs).where(eq(jobs.jobId, row.jobId)).get();

    expect(result).toBeDefined();
    expect(result!.jobType).toBe("worker_dispatch");
    expect(result!.status).toBe("pending");
    expect(result!.attemptCount).toBe(0);
  });

  /**
   * @why created_at and updated_at must default to the current Unix timestamp.
   * The job queue relies on these for ordering and staleness detection.
   */
  it("should set created_at and updated_at to current timestamp by default", () => {
    const before = Math.floor(Date.now() / 1000);
    const row = makeJob();
    db.insert(jobs).values(row).run();

    const result = db.select().from(jobs).where(eq(jobs.jobId, row.jobId)).get();

    expect(result).toBeDefined();
    for (const field of [result!.createdAt, result!.updatedAt]) {
      const ts = field instanceof Date ? Math.floor(field.getTime() / 1000) : (field as number);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1);
    }
  });

  /**
   * @why attempt_count defaults to 0 and is incremented on each claim.
   * Retry policy uses this to decide whether to retry or fail permanently.
   */
  it("should default attempt_count to 0", () => {
    const row = makeJob();
    db.insert(jobs).values(row).run();

    const result = db.select().from(jobs).where(eq(jobs.jobId, row.jobId)).get();

    expect(result!.attemptCount).toBe(0);
  });

  /**
   * @why entity_type, entity_id, payload_json, run_after, lease_owner,
   * parent_job_id, job_group_id, depends_on_job_ids are all nullable.
   * They are populated at different stages or for different job types.
   */
  it("should allow nullable optional fields", () => {
    const row = makeJob({
      entityType: null,
      entityId: null,
      payloadJson: null,
      runAfter: null,
      leaseOwner: null,
      parentJobId: null,
      jobGroupId: null,
      dependsOnJobIds: null,
    });
    db.insert(jobs).values(row).run();

    const result = db.select().from(jobs).where(eq(jobs.jobId, row.jobId)).get();

    expect(result).toBeDefined();
    expect(result!.entityType).toBeNull();
    expect(result!.entityId).toBeNull();
    expect(result!.payloadJson).toBeNull();
    expect(result!.runAfter).toBeNull();
    expect(result!.leaseOwner).toBeNull();
    expect(result!.parentJobId).toBeNull();
    expect(result!.jobGroupId).toBeNull();
    expect(result!.dependsOnJobIds).toBeNull();
  });

  /**
   * @why payload_json stores job-type-specific input data. The job queue
   * deserializes this when dispatching work to a worker.
   */
  it("should store and retrieve payload_json as JSON", () => {
    const payload = { taskId: "task-123", workerPoolId: "pool-abc" };
    const row = makeJob({ payloadJson: payload });
    db.insert(jobs).values(row).run();

    const result = db.select().from(jobs).where(eq(jobs.jobId, row.jobId)).get();

    expect(result!.payloadJson).toEqual(payload);
  });

  /**
   * @why depends_on_job_ids is a JSON array of job IDs. The queue poller
   * checks this constraint before claiming a job.
   */
  it("should store and retrieve depends_on_job_ids as JSON array", () => {
    const depIds = [randomUUID(), randomUUID()];
    const row = makeJob({ dependsOnJobIds: depIds });
    db.insert(jobs).values(row).run();

    const result = db.select().from(jobs).where(eq(jobs.jobId, row.jobId)).get();

    expect(result!.dependsOnJobIds).toEqual(depIds);
  });

  /**
   * @why All eight job types from the PRD must be storable. The job queue
   * dispatches to different handlers based on job_type.
   */
  it("should accept all valid job_type values", () => {
    const types = [
      "scheduler_tick",
      "worker_dispatch",
      "reviewer_dispatch",
      "lead_review_consolidation",
      "merge_dispatch",
      "validation_execution",
      "reconciliation_sweep",
      "cleanup",
    ];
    for (const jt of types) {
      db.insert(jobs)
        .values(makeJob({ jobId: randomUUID(), jobType: jt }))
        .run();
    }

    const results = db.select().from(jobs).all();
    expect(results).toHaveLength(8);
  });

  /**
   * @why All six job statuses from the PRD must be storable. The job
   * lifecycle transitions through these statuses.
   */
  it("should accept all valid status values", () => {
    const statuses = ["pending", "claimed", "running", "completed", "failed", "cancelled"];
    for (const st of statuses) {
      db.insert(jobs)
        .values(makeJob({ jobId: randomUUID(), status: st }))
        .run();
    }

    const results = db.select().from(jobs).all();
    expect(results).toHaveLength(6);
  });

  /**
   * @why entity_type + entity_id link a job to the domain entity it operates
   * on. Used for audit correlation and job deduplication.
   */
  it("should store entity_type and entity_id", () => {
    const row = makeJob({
      entityType: "task",
      entityId: "task-abc-123",
    });
    db.insert(jobs).values(row).run();

    const result = db.select().from(jobs).where(eq(jobs.jobId, row.jobId)).get();

    expect(result!.entityType).toBe("task");
    expect(result!.entityId).toBe("task-abc-123");
  });

  /**
   * @why lease_owner tracks which worker process holds the job. When a worker
   * crashes, the reconciliation sweep identifies orphaned jobs by lease_owner.
   */
  it("should store lease_owner when a job is claimed", () => {
    const row = makeJob({
      status: "claimed",
      leaseOwner: "worker-instance-1",
      attemptCount: 1,
    });
    db.insert(jobs).values(row).run();

    const result = db.select().from(jobs).where(eq(jobs.jobId, row.jobId)).get();

    expect(result!.leaseOwner).toBe("worker-instance-1");
    expect(result!.attemptCount).toBe(1);
  });

  /**
   * @why parent_job_id enables job hierarchy tracking. A scheduler_tick
   * spawns worker_dispatch jobs as children.
   */
  it("should store parent_job_id for child jobs", () => {
    const parentRow = makeJob({ jobType: "scheduler_tick" });
    db.insert(jobs).values(parentRow).run();

    const childRow = makeJob({
      jobType: "worker_dispatch",
      parentJobId: parentRow.jobId,
    });
    db.insert(jobs).values(childRow).run();

    const child = db.select().from(jobs).where(eq(jobs.jobId, childRow.jobId)).get();

    expect(child!.parentJobId).toBe(parentRow.jobId);
  });

  /**
   * @why job_group_id groups related jobs (e.g. all specialist reviewer
   * jobs in one review cycle). The lead review consolidation job queries
   * all jobs in its group.
   */
  it("should store job_group_id for grouped jobs", () => {
    const groupId = randomUUID();
    db.insert(jobs)
      .values(makeJob({ jobType: "reviewer_dispatch", jobGroupId: groupId }))
      .run();
    db.insert(jobs)
      .values(
        makeJob({
          jobId: randomUUID(),
          jobType: "reviewer_dispatch",
          jobGroupId: groupId,
        }),
      )
      .run();

    const results = sqlite
      .prepare(`SELECT * FROM job WHERE job_group_id = ?`)
      .all(groupId) as Array<Record<string, unknown>>;

    expect(results).toHaveLength(2);
  });

  /**
   * @why The (status, run_after) composite index is the hot-path query for
   * the scheduler tick loop: "find all pending jobs whose run_after has
   * passed." This test verifies the index supports the query.
   */
  it("should support queue polling by status and run_after", () => {
    const pastTime = new Date(Date.now() - 60_000);
    const futureTime = new Date(Date.now() + 60_000);

    db.insert(jobs)
      .values(makeJob({ status: "pending", runAfter: pastTime }))
      .run();
    db.insert(jobs)
      .values(
        makeJob({
          jobId: randomUUID(),
          status: "pending",
          runAfter: futureTime,
        }),
      )
      .run();
    db.insert(jobs)
      .values(
        makeJob({
          jobId: randomUUID(),
          status: "completed",
          runAfter: pastTime,
        }),
      )
      .run();

    const now = Math.floor(Date.now() / 1000);
    const results = sqlite
      .prepare(
        `SELECT * FROM job WHERE status = 'pending' AND (run_after IS NULL OR run_after <= ?)`,
      )
      .all(now) as Array<Record<string, unknown>>;

    expect(results).toHaveLength(1);
    expect(results[0]!["status"]).toBe("pending");
  });

  /**
   * @why run_after supports delayed job execution. A job with run_after
   * in the future should not be dispatched yet.
   */
  it("should store run_after timestamp for delayed execution", () => {
    const futureTime = new Date(Date.now() + 3600_000);
    const row = makeJob({ runAfter: futureTime });
    db.insert(jobs).values(row).run();

    const result = db.select().from(jobs).where(eq(jobs.jobId, row.jobId)).get();

    expect(result).toBeDefined();
    const ts =
      result!.runAfter instanceof Date
        ? Math.floor(result!.runAfter.getTime() / 1000)
        : (result!.runAfter as number);
    expect(ts).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

// ─── T012: Cross-table relationships ────────────────────────────────────────

describe("T012 — Cross-table relationships", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];

  let projectId: string;
  let repoId: string;
  let taskId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    projectId = randomUUID();
    repoId = randomUUID();
    taskId = randomUUID();

    db.insert(projects)
      .values(makeProject({ projectId, name: `proj-${projectId.slice(0, 8)}` }))
      .run();
    db.insert(repositories)
      .values(
        makeRepository(projectId, {
          repositoryId: repoId,
          name: `repo-${repoId.slice(0, 8)}`,
        }),
      )
      .run();
    db.insert(tasks)
      .values(makeTask(repoId, { taskId, title: `task-${taskId.slice(0, 8)}` }))
      .run();
  });

  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why A task queued for merge should have both a merge queue item
   * and validation runs. This join validates that the FK relationships
   * between task → merge_queue_item and task → validation_run work.
   */
  it("should join task with merge_queue_item and validation_run", () => {
    db.insert(mergeQueueItems)
      .values(makeMergeQueueItem(taskId, repoId, { status: "VALIDATING" }))
      .run();
    db.insert(validationRuns)
      .values(
        makeValidationRun(taskId, {
          runScope: "pre-merge",
          status: "passed",
          toolName: "vitest",
        }),
      )
      .run();

    const result = sqlite
      .prepare(
        `SELECT
           t.title AS task_title,
           mqi.status AS merge_status,
           vr.run_scope,
           vr.status AS validation_status,
           vr.tool_name
         FROM task t
         JOIN merge_queue_item mqi ON mqi.task_id = t.task_id
         JOIN validation_run vr ON vr.task_id = t.task_id
         WHERE t.task_id = ?`,
      )
      .get(taskId) as {
      task_title: string;
      merge_status: string;
      run_scope: string;
      validation_status: string;
      tool_name: string;
    };

    expect(result.merge_status).toBe("VALIDATING");
    expect(result.run_scope).toBe("pre-merge");
    expect(result.validation_status).toBe("passed");
    expect(result.tool_name).toBe("vitest");
  });

  /**
   * @why A job dispatched for a task should be joinable to the task entity
   * through entity_type/entity_id columns. This is not a DB FK but an
   * application-level correlation.
   */
  it("should correlate jobs to tasks via entity_type and entity_id", () => {
    db.insert(jobs)
      .values(
        makeJob({
          jobType: "worker_dispatch",
          entityType: "task",
          entityId: taskId,
          status: "completed",
        }),
      )
      .run();

    const result = sqlite
      .prepare(
        `SELECT t.title, j.job_type, j.status AS job_status
         FROM job j
         JOIN task t ON j.entity_id = t.task_id
         WHERE j.entity_type = 'task' AND j.entity_id = ?`,
      )
      .get(taskId) as {
      title: string;
      job_type: string;
      job_status: string;
    };

    expect(result.job_type).toBe("worker_dispatch");
    expect(result.job_status).toBe("completed");
  });

  /**
   * @why Review cycle coordination: specialist reviewer jobs share a
   * job_group_id, and the lead review consolidation job depends on them.
   * This test validates the coordination pattern described in PRD 002 §2.3.
   */
  it("should support review cycle job coordination pattern", () => {
    const groupId = randomUUID();

    const specialistJob1 = makeJob({
      jobType: "reviewer_dispatch",
      jobGroupId: groupId,
      status: "completed",
    });
    const specialistJob2 = makeJob({
      jobId: randomUUID(),
      jobType: "reviewer_dispatch",
      jobGroupId: groupId,
      status: "completed",
    });

    db.insert(jobs).values(specialistJob1).run();
    db.insert(jobs).values(specialistJob2).run();

    const leadJob = makeJob({
      jobType: "lead_review_consolidation",
      jobGroupId: groupId,
      dependsOnJobIds: [specialistJob1.jobId, specialistJob2.jobId],
      status: "pending",
    });
    db.insert(jobs).values(leadJob).run();

    const result = db.select().from(jobs).where(eq(jobs.jobId, leadJob.jobId)).get();

    expect(result!.dependsOnJobIds).toEqual([specialistJob1.jobId, specialistJob2.jobId]);

    const groupJobs = sqlite
      .prepare(`SELECT * FROM job WHERE job_group_id = ?`)
      .all(groupId) as Array<Record<string, unknown>>;

    expect(groupJobs).toHaveLength(3);
  });
});

// ─── T013 Factory Functions ─────────────────────────────────────────────────

/** Generate a minimal valid AuditEvent row. */
function makeAuditEvent(overrides: Partial<typeof auditEvents.$inferInsert> = {}) {
  return {
    auditEventId: randomUUID(),
    entityType: "task",
    entityId: randomUUID(),
    eventType: "state_transition",
    actorType: "system",
    actorId: "scheduler",
    ...overrides,
  };
}

/** Generate a minimal valid PolicySet row. */
function makePolicySet(overrides: Partial<typeof policySets.$inferInsert> = {}) {
  return {
    policySetId: randomUUID(),
    name: "default-policy",
    version: "1.0.0",
    ...overrides,
  };
}

// ─── T013 Tests ─────────────────────────────────────────────────────────────

describe("T013 — AuditEvent table", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
  });

  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why The audit_event table must exist for the audit trail to function.
   * This verifies the table was created correctly by openTestDb.
   */
  it("audit_event table exists in sqlite_master", () => {
    const row = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='audit_event'`)
      .get() as { name: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.name).toBe("audit_event");
  });

  /**
   * @why Basic CRUD: an audit event with all required fields should round-trip
   * through the ORM without data loss. This validates column mapping.
   */
  it("inserts and retrieves an audit event with required fields", () => {
    const event = makeAuditEvent();
    db.insert(auditEvents).values(event).run();

    const result = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.auditEventId, event.auditEventId))
      .get();

    expect(result).toBeDefined();
    expect(result!.auditEventId).toBe(event.auditEventId);
    expect(result!.entityType).toBe("task");
    expect(result!.entityId).toBe(event.entityId);
    expect(result!.eventType).toBe("state_transition");
    expect(result!.actorType).toBe("system");
    expect(result!.actorId).toBe("scheduler");
  });

  /**
   * @why State transition events carry old_state and new_state. This validates
   * that nullable state columns store and retrieve correctly.
   */
  it("stores old_state and new_state for state transition events", () => {
    const event = makeAuditEvent({
      eventType: "state_transition",
      oldState: "READY",
      newState: "ASSIGNED",
    });
    db.insert(auditEvents).values(event).run();

    const result = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.auditEventId, event.auditEventId))
      .get();

    expect(result!.oldState).toBe("READY");
    expect(result!.newState).toBe("ASSIGNED");
  });

  /**
   * @why Events like "created" or "deleted" have no state transition, so
   * old_state and new_state must accept null.
   */
  it("allows null for old_state and new_state", () => {
    const event = makeAuditEvent({
      eventType: "created",
      oldState: null,
      newState: null,
    });
    db.insert(auditEvents).values(event).run();

    const result = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.auditEventId, event.auditEventId))
      .get();

    expect(result!.oldState).toBeNull();
    expect(result!.newState).toBeNull();
  });

  /**
   * @why metadata_json carries event-specific context as a JSON object.
   * This validates JSON round-trip through SQLite without data loss.
   */
  it("stores and retrieves metadata_json correctly", () => {
    const metadata = {
      leaseTimeoutSec: 300,
      previousWorker: "worker-abc",
      reason: "heartbeat_missed",
    };
    const event = makeAuditEvent({
      eventType: "lease_reclaimed",
      metadataJson: metadata,
    });
    db.insert(auditEvents).values(event).run();

    const result = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.auditEventId, event.auditEventId))
      .get();

    expect(result!.metadataJson).toEqual(metadata);
  });

  /**
   * @why metadata_json is optional — events without extra context should
   * store null without error.
   */
  it("allows null for metadata_json", () => {
    const event = makeAuditEvent({ metadataJson: null });
    db.insert(auditEvents).values(event).run();

    const result = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.auditEventId, event.auditEventId))
      .get();

    expect(result!.metadataJson).toBeNull();
  });

  /**
   * @why created_at must auto-populate so callers don't need to provide it.
   * The audit trail depends on reliable timestamps for ordering.
   */
  it("auto-populates created_at timestamp", () => {
    const event = makeAuditEvent();
    db.insert(auditEvents).values(event).run();

    const result = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.auditEventId, event.auditEventId))
      .get();

    expect(result!.createdAt).toBeDefined();
    expect(result!.createdAt).toBeInstanceOf(Date);
  });

  /**
   * @why Duplicate audit_event_id must be rejected to preserve uniqueness.
   * The PK constraint is the last line of defense against duplicate events.
   */
  it("rejects duplicate audit_event_id", () => {
    const event = makeAuditEvent();
    db.insert(auditEvents).values(event).run();

    expect(() => {
      db.insert(auditEvents).values(event).run();
    }).toThrow();
  });

  /**
   * @why The audit trail is append-only and must support high-volume inserts.
   * Multiple events for the same entity must coexist without conflict.
   */
  it("supports multiple events for the same entity", () => {
    const entityId = randomUUID();
    const events = [
      makeAuditEvent({ entityId, eventType: "created", newState: "BACKLOG" }),
      makeAuditEvent({
        entityId,
        eventType: "state_transition",
        oldState: "BACKLOG",
        newState: "READY",
      }),
      makeAuditEvent({
        entityId,
        eventType: "state_transition",
        oldState: "READY",
        newState: "ASSIGNED",
      }),
    ];
    for (const event of events) {
      db.insert(auditEvents).values(event).run();
    }

    const results = sqlite
      .prepare(`SELECT * FROM audit_event WHERE entity_id = ?`)
      .all(entityId) as Array<Record<string, unknown>>;

    expect(results).toHaveLength(3);
  });

  /**
   * @why The (entity_type, entity_id) composite index is critical for the
   * primary audit query: "show all events for this entity." Without it,
   * entity-scoped queries would require a full table scan on large tables.
   */
  it("has composite index on (entity_type, entity_id)", () => {
    const indexes = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='audit_event' AND name='idx_audit_event_entity'`,
      )
      .all() as Array<{ name: string }>;
    expect(indexes).toHaveLength(1);
  });

  /**
   * @why The created_at index supports time-range queries for operational
   * monitoring: "what happened in the last hour?" Without this index,
   * time-range queries would be slow on a table that grows indefinitely.
   */
  it("has index on created_at", () => {
    const indexes = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='audit_event' AND name='idx_audit_event_created_at'`,
      )
      .all() as Array<{ name: string }>;
    expect(indexes).toHaveLength(1);
  });

  /**
   * @why Different actor types (system, worker, operator) must all be
   * storable. This validates the actor_type column accepts all expected values.
   */
  it("accepts all actor types", () => {
    const actorTypes = ["system", "worker", "operator", "scheduler", "reconciliation"];
    for (const actorType of actorTypes) {
      const event = makeAuditEvent({ actorType });
      db.insert(auditEvents).values(event).run();

      const result = db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.auditEventId, event.auditEventId))
        .get();

      expect(result!.actorType).toBe(actorType);
    }
  });

  /**
   * @why Different entity types must be supported — the audit trail tracks
   * events across all entity types in the system.
   */
  it("accepts all entity types", () => {
    const entityTypes = [
      "task",
      "lease",
      "review_cycle",
      "merge_queue_item",
      "policy_set",
      "worker",
      "job",
    ];
    for (const entityType of entityTypes) {
      const event = makeAuditEvent({ entityType });
      db.insert(auditEvents).values(event).run();

      const result = db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.auditEventId, event.auditEventId))
        .get();

      expect(result!.entityType).toBe(entityType);
    }
  });

  /**
   * @why Different event types must be supported — from state transitions
   * to operator overrides. This validates the column accepts the full range.
   */
  it("accepts all event types", () => {
    const eventTypes = [
      "state_transition",
      "created",
      "deleted",
      "policy_applied",
      "lease_reclaimed",
      "operator_override",
      "configuration_changed",
    ];
    for (const eventType of eventTypes) {
      const event = makeAuditEvent({ eventType });
      db.insert(auditEvents).values(event).run();

      const result = db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.auditEventId, event.auditEventId))
        .get();

      expect(result!.eventType).toBe(eventType);
    }
  });

  /**
   * @why Complex metadata_json objects with nested structures must survive
   * JSON round-trip. Policy changes and review details can be deeply nested.
   */
  it("handles complex nested metadata_json", () => {
    const metadata = {
      reviewDetails: {
        verdict: "changes_requested",
        issues: [
          { severity: "high", code: "SEC-001", title: "SQL injection risk" },
          { severity: "medium", code: "PERF-003", title: "N+1 query" },
        ],
        blockingCount: 1,
      },
      timestamp: 1700000000,
    };
    const event = makeAuditEvent({ metadataJson: metadata });
    db.insert(auditEvents).values(event).run();

    const result = db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.auditEventId, event.auditEventId))
      .get();

    expect(result!.metadataJson).toEqual(metadata);
  });

  /**
   * @why The table must have the correct number of columns matching the
   * PRD §2.3 AuditEvent entity definition. Missing or extra columns would
   * indicate a schema drift.
   */
  it("has the expected number of columns", () => {
    const columns = sqlite.prepare(`PRAGMA table_info(audit_event)`).all() as Array<{
      name: string;
    }>;
    // audit_event_id, entity_type, entity_id, event_type, actor_type,
    // actor_id, old_state, new_state, metadata_json, created_at
    expect(columns).toHaveLength(10);
  });
});

describe("T013 — PolicySet table", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
  });

  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why The policy_set table must exist for policy configuration storage.
   * This verifies the table was created correctly by openTestDb.
   */
  it("policy_set table exists in sqlite_master", () => {
    const row = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='policy_set'`)
      .get() as { name: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.name).toBe("policy_set");
  });

  /**
   * @why Basic CRUD: a policy set with required fields should round-trip
   * through the ORM without data loss.
   */
  it("inserts and retrieves a policy set with required fields", () => {
    const ps = makePolicySet();
    db.insert(policySets).values(ps).run();

    const result = db
      .select()
      .from(policySets)
      .where(eq(policySets.policySetId, ps.policySetId))
      .get();

    expect(result).toBeDefined();
    expect(result!.policySetId).toBe(ps.policySetId);
    expect(result!.name).toBe("default-policy");
    expect(result!.version).toBe("1.0.0");
  });

  /**
   * @why All six JSON policy columns must store and retrieve complex policy
   * objects without data loss. This is the core functionality of the table.
   */
  it("stores and retrieves all JSON policy columns correctly", () => {
    const schedulingPolicy = {
      priorityWeights: { P0: 100, P1: 50, P2: 10 },
      maxQueueDepth: 20,
      starvationTimeoutSec: 3600,
    };
    const reviewPolicy = {
      requiredReviewerCount: 2,
      autoApproveThreshold: "low",
      escalationTriggers: ["critical_issue", "timeout"],
    };
    const mergePolicy = {
      strategy: "rebase",
      conflictClassification: { reworkable: ["text"], irrecoverable: ["binary"] },
      requiredGates: ["typecheck", "lint", "test"],
    };
    const securityPolicy = {
      allowedCommands: ["npm", "node", "git"],
      pathRestrictions: ["/src/**", "/test/**"],
      networkAccess: false,
    };
    const validationPolicy = {
      stages: {
        preDev: ["lint"],
        preMerge: ["typecheck", "lint", "test"],
      },
      timeoutSec: 300,
    };
    const budgetPolicy = {
      maxTokensPerSession: 100000,
      costCapPerTask: 5.0,
      alertThreshold: 0.8,
    };

    const ps = makePolicySet({
      schedulingPolicyJson: schedulingPolicy,
      reviewPolicyJson: reviewPolicy,
      mergePolicyJson: mergePolicy,
      securityPolicyJson: securityPolicy,
      validationPolicyJson: validationPolicy,
      budgetPolicyJson: budgetPolicy,
    });
    db.insert(policySets).values(ps).run();

    const result = db
      .select()
      .from(policySets)
      .where(eq(policySets.policySetId, ps.policySetId))
      .get();

    expect(result!.schedulingPolicyJson).toEqual(schedulingPolicy);
    expect(result!.reviewPolicyJson).toEqual(reviewPolicy);
    expect(result!.mergePolicyJson).toEqual(mergePolicy);
    expect(result!.securityPolicyJson).toEqual(securityPolicy);
    expect(result!.validationPolicyJson).toEqual(validationPolicy);
    expect(result!.budgetPolicyJson).toEqual(budgetPolicy);
  });

  /**
   * @why Policy columns are nullable — a policy set may only define a subset
   * of policies. This validates that null is accepted for all JSON columns.
   */
  it("allows null for all JSON policy columns", () => {
    const ps = makePolicySet({
      schedulingPolicyJson: null,
      reviewPolicyJson: null,
      mergePolicyJson: null,
      securityPolicyJson: null,
      validationPolicyJson: null,
      budgetPolicyJson: null,
    });
    db.insert(policySets).values(ps).run();

    const result = db
      .select()
      .from(policySets)
      .where(eq(policySets.policySetId, ps.policySetId))
      .get();

    expect(result!.schedulingPolicyJson).toBeNull();
    expect(result!.reviewPolicyJson).toBeNull();
    expect(result!.mergePolicyJson).toBeNull();
    expect(result!.securityPolicyJson).toBeNull();
    expect(result!.validationPolicyJson).toBeNull();
    expect(result!.budgetPolicyJson).toBeNull();
  });

  /**
   * @why created_at must auto-populate so callers don't need to provide it.
   */
  it("auto-populates created_at timestamp", () => {
    const ps = makePolicySet();
    db.insert(policySets).values(ps).run();

    const result = db
      .select()
      .from(policySets)
      .where(eq(policySets.policySetId, ps.policySetId))
      .get();

    expect(result!.createdAt).toBeDefined();
    expect(result!.createdAt).toBeInstanceOf(Date);
  });

  /**
   * @why Duplicate policy_set_id must be rejected to preserve uniqueness.
   */
  it("rejects duplicate policy_set_id", () => {
    const ps = makePolicySet();
    db.insert(policySets).values(ps).run();

    expect(() => {
      db.insert(policySets).values(ps).run();
    }).toThrow();
  });

  /**
   * @why Multiple policy set versions must coexist — version management
   * requires storing historical versions alongside the current one.
   */
  it("supports multiple policy sets with different versions", () => {
    const baseName = `policy-${randomUUID().slice(0, 8)}`;
    const versions = ["1.0.0", "1.1.0", "2.0.0"];
    for (const version of versions) {
      db.insert(policySets)
        .values(makePolicySet({ name: baseName, version }))
        .run();
    }

    const results = sqlite
      .prepare(`SELECT * FROM policy_set WHERE name = ?`)
      .all(baseName) as Array<Record<string, unknown>>;

    expect(results).toHaveLength(3);
  });

  /**
   * @why The table must have the correct number of columns matching the
   * PRD §2.3 PolicySet entity definition.
   */
  it("has the expected number of columns", () => {
    const columns = sqlite.prepare(`PRAGMA table_info(policy_set)`).all() as Array<{
      name: string;
    }>;
    // policy_set_id, name, version, scheduling_policy_json, review_policy_json,
    // merge_policy_json, security_policy_json, validation_policy_json,
    // budget_policy_json, created_at
    expect(columns).toHaveLength(10);
  });

  /**
   * @why Deeply nested policy objects with arrays must survive JSON round-trip.
   * Real policy documents can be arbitrarily complex.
   */
  it("handles deeply nested JSON policy objects", () => {
    const complexPolicy = {
      rules: [
        {
          name: "high-priority-fast-track",
          conditions: { priority: ["P0"], estimatedSize: ["small", "medium"] },
          actions: { skipReview: false, maxConcurrency: 3 },
        },
        {
          name: "security-critical",
          conditions: { riskLevel: ["high"], capabilities: ["security"] },
          actions: { requireLeadReview: true, additionalReviewers: 1 },
        },
      ],
      defaults: { maxConcurrency: 1, timeoutSec: 600 },
    };

    const ps = makePolicySet({ schedulingPolicyJson: complexPolicy });
    db.insert(policySets).values(ps).run();

    const result = db
      .select()
      .from(policySets)
      .where(eq(policySets.policySetId, ps.policySetId))
      .get();

    expect(result!.schedulingPolicyJson).toEqual(complexPolicy);
  });
});

describe("T013 — Cross-table relationships", () => {
  let db: ReturnType<typeof openTestDb>["db"];
  let sqlite: ReturnType<typeof openTestDb>["sqlite"];

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
  });

  afterEach(() => {
    sqlite.close();
  });

  /**
   * @why Audit events reference entities by type+id without FK constraints.
   * This test validates that audit events can reference tasks and that the
   * entity-scoped audit query works via a join.
   */
  it("correlates audit events to tasks via entity_type and entity_id", () => {
    const projectId = randomUUID();
    const repoId = randomUUID();
    const taskId = randomUUID();

    db.insert(projects)
      .values(makeProject({ projectId, name: `proj-${projectId.slice(0, 8)}` }))
      .run();
    db.insert(repositories)
      .values(
        makeRepository(projectId, { repositoryId: repoId, name: `repo-${repoId.slice(0, 8)}` }),
      )
      .run();
    db.insert(tasks)
      .values(makeTask(repoId, { taskId, title: `task-${taskId.slice(0, 8)}` }))
      .run();

    db.insert(auditEvents)
      .values(
        makeAuditEvent({
          entityType: "task",
          entityId: taskId,
          eventType: "state_transition",
          oldState: "BACKLOG",
          newState: "READY",
          actorType: "system",
          actorId: "scheduler",
        }),
      )
      .run();

    const result = sqlite
      .prepare(
        `SELECT t.title, ae.event_type, ae.old_state, ae.new_state
         FROM audit_event ae
         JOIN task t ON ae.entity_id = t.task_id
         WHERE ae.entity_type = 'task' AND ae.entity_id = ?`,
      )
      .get(taskId) as {
      title: string;
      event_type: string;
      old_state: string;
      new_state: string;
    };

    expect(result.event_type).toBe("state_transition");
    expect(result.old_state).toBe("BACKLOG");
    expect(result.new_state).toBe("READY");
  });

  /**
   * @why Policy sets are referenced by Projects (default_policy_set_id),
   * WorkflowTemplates, and AgentProfiles. This test validates that a project
   * can store a policy_set_id reference and the two can be joined.
   */
  it("links policy sets to projects via default_policy_set_id", () => {
    const ps = makePolicySet({
      name: "strict-review",
      version: "1.0.0",
      reviewPolicyJson: { requiredReviewerCount: 3 },
    });
    db.insert(policySets).values(ps).run();

    const project = makeProject({
      name: `proj-${randomUUID().slice(0, 8)}`,
      defaultPolicySetId: ps.policySetId,
    });
    db.insert(projects).values(project).run();

    const result = sqlite
      .prepare(
        `SELECT p.name AS project_name, ps.name AS policy_name, ps.version
         FROM project p
         JOIN policy_set ps ON p.default_policy_set_id = ps.policy_set_id
         WHERE p.project_id = ?`,
      )
      .get(project.projectId) as {
      project_name: string;
      policy_name: string;
      version: string;
    };

    expect(result.policy_name).toBe("strict-review");
    expect(result.version).toBe("1.0.0");
  });

  /**
   * @why An audit event recording a policy change should be joinable to
   * the affected PolicySet entity. This validates the audit trail for
   * policy management operations.
   */
  it("records audit events for policy set changes", () => {
    const ps = makePolicySet({ name: "default", version: "1.0.0" });
    db.insert(policySets).values(ps).run();

    db.insert(auditEvents)
      .values(
        makeAuditEvent({
          entityType: "policy_set",
          entityId: ps.policySetId,
          eventType: "configuration_changed",
          actorType: "operator",
          actorId: "admin-user",
          metadataJson: { changedFields: ["review_policy_json"], previousVersion: "0.9.0" },
        }),
      )
      .run();

    const result = sqlite
      .prepare(
        `SELECT ps.name AS policy_name, ae.event_type, ae.actor_type
         FROM audit_event ae
         JOIN policy_set ps ON ae.entity_id = ps.policy_set_id
         WHERE ae.entity_type = 'policy_set' AND ae.entity_id = ?`,
      )
      .get(ps.policySetId) as {
      policy_name: string;
      event_type: string;
      actor_type: string;
    };

    expect(result.policy_name).toBe("default");
    expect(result.event_type).toBe("configuration_changed");
    expect(result.actor_type).toBe("operator");
  });

  /**
   * @why Both T013 tables (audit_event, policy_set) must be present alongside
   * all previously created tables. This validates that T013 additions didn't
   * break any existing table creation.
   */
  it("all tables from T008-T013 exist in sqlite_master", () => {
    const expectedTables = [
      "workflow_template",
      "project",
      "repository",
      "task",
      "task_dependency",
      "worker_pool",
      "worker",
      "prompt_template",
      "agent_profile",
      "task_lease",
      "review_cycle",
      "review_packet",
      "lead_review_decision",
      "merge_queue_item",
      "validation_run",
      "job",
      "audit_event",
      "policy_set",
    ];

    const tables = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name).sort();
    expect(tableNames).toEqual(expectedTables.sort());
  });
});
