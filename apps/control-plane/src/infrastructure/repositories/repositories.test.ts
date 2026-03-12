/**
 * Comprehensive tests for all 18 entity repositories.
 *
 * These tests verify that each repository factory returns an object with
 * correct CRUD and query methods, exercising them against an in-memory
 * SQLite database with the full schema. Every repository is tested in
 * isolation with a fresh DB per `describe` block.
 *
 * @why The repository layer is the single gateway between the application
 * layer and the database. If a method silently drops a WHERE clause, returns
 * stale data, or breaks FK ordering, every upstream service inherits the bug.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  createWorkflowTemplateRepository,
  createProjectRepository,
  createRepositoryRepository,
  createTaskRepository,
  VersionConflictError,
  createTaskDependencyRepository,
  createWorkerPoolRepository,
  createWorkerRepository,
  createAgentProfileRepository,
  createPromptTemplateRepository,
  createTaskLeaseRepository,
  createReviewCycleRepository,
  createReviewPacketRepository,
  createLeadReviewDecisionRepository,
  createMergeQueueItemRepository,
  createValidationRunRepository,
  createJobRepository,
  createAuditEventRepository,
  createPolicySetRepository,
} from "./index.js";

// ─── Shared test helpers ────────────────────────────────────────────────────

/**
 * Helper: open an in-memory SQLite DB with foreign keys enabled and create
 * all 18 tables via raw SQL matching the Drizzle schema definitions.
 */
function openTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

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

// ─── Entity helper factories ────────────────────────────────────────────────

/** Generate a minimal valid WorkflowTemplate row. */
function makeWorkflowTemplate(overrides: Record<string, unknown> = {}) {
  return {
    workflowTemplateId: randomUUID(),
    name: `wt-${randomUUID().slice(0, 8)}`,
    ...overrides,
  };
}

/** Generate a minimal valid Project row. */
function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    projectId: randomUUID(),
    name: `project-${randomUUID().slice(0, 8)}`,
    owner: "test-owner",
    ...overrides,
  };
}

/** Generate a minimal valid Repository row (requires a projectId FK). */
function makeRepository(projectId: string, overrides: Record<string, unknown> = {}) {
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

/** Generate a minimal valid Task row (requires a repositoryId FK). */
function makeTask(repositoryId: string, overrides: Record<string, unknown> = {}) {
  return {
    taskId: randomUUID(),
    repositoryId,
    title: `task-${randomUUID().slice(0, 8)}`,
    taskType: "implementation",
    priority: "medium",
    status: "READY",
    source: "manual",
    ...overrides,
  };
}

/** Generate a minimal valid WorkerPool row. */
function makeWorkerPool(overrides: Record<string, unknown> = {}) {
  return {
    workerPoolId: randomUUID(),
    name: `pool-${randomUUID().slice(0, 8)}`,
    poolType: "ai",
    ...overrides,
  };
}

/** Generate a minimal valid Worker row (requires a poolId FK). */
function makeWorker(poolId: string, overrides: Record<string, unknown> = {}) {
  return {
    workerId: randomUUID(),
    poolId,
    name: `worker-${randomUUID().slice(0, 8)}`,
    status: "idle",
    ...overrides,
  };
}

/** Generate a minimal valid PromptTemplate row. */
function makePromptTemplate(overrides: Record<string, unknown> = {}) {
  return {
    promptTemplateId: randomUUID(),
    name: `pt-${randomUUID().slice(0, 8)}`,
    version: "1.0.0",
    role: "developer",
    templateText: "You are a developer agent.",
    ...overrides,
  };
}

/** Generate a minimal valid AgentProfile row (requires a poolId FK). */
function makeAgentProfile(poolId: string, overrides: Record<string, unknown> = {}) {
  return {
    agentProfileId: randomUUID(),
    poolId,
    ...overrides,
  };
}

/** Generate a minimal valid TaskLease row (requires taskId, poolId FKs). */
function makeTaskLease(taskId: string, poolId: string, overrides: Record<string, unknown> = {}) {
  return {
    leaseId: randomUUID(),
    taskId,
    workerId: randomUUID(),
    poolId,
    expiresAt: new Date(Date.now() + 3600_000),
    status: "ACTIVE",
    ...overrides,
  };
}

/** Generate a minimal valid ReviewCycle row (requires taskId FK). */
function makeReviewCycle(taskId: string, overrides: Record<string, unknown> = {}) {
  return {
    reviewCycleId: randomUUID(),
    taskId,
    status: "IN_PROGRESS",
    ...overrides,
  };
}

/** Generate a minimal valid ReviewPacket row (requires taskId, reviewCycleId FKs). */
function makeReviewPacket(
  taskId: string,
  reviewCycleId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    reviewPacketId: randomUUID(),
    taskId,
    reviewCycleId,
    reviewerType: "specialist",
    verdict: "APPROVED",
    ...overrides,
  };
}

/** Generate a minimal valid LeadReviewDecision row (requires taskId, reviewCycleId FKs). */
function makeLeadReviewDecision(
  taskId: string,
  reviewCycleId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    leadReviewDecisionId: randomUUID(),
    taskId,
    reviewCycleId,
    decision: "APPROVED",
    ...overrides,
  };
}

/** Generate a minimal valid MergeQueueItem row (requires taskId, repositoryId FKs). */
function makeMergeQueueItem(
  taskId: string,
  repositoryId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    mergeQueueItemId: randomUUID(),
    taskId,
    repositoryId,
    status: "PENDING",
    position: 1,
    ...overrides,
  };
}

/** Generate a minimal valid ValidationRun row (requires taskId FK). */
function makeValidationRun(taskId: string, overrides: Record<string, unknown> = {}) {
  return {
    validationRunId: randomUUID(),
    taskId,
    runScope: "pre-merge",
    status: "RUNNING",
    ...overrides,
  };
}

/** Generate a minimal valid Job row (no FKs required). */
function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    jobId: randomUUID(),
    jobType: "execute-task",
    status: "pending",
    ...overrides,
  };
}

/** Generate a minimal valid AuditEvent row (no FKs required). */
function makeAuditEvent(overrides: Record<string, unknown> = {}) {
  return {
    auditEventId: randomUUID(),
    entityType: "task",
    entityId: randomUUID(),
    eventType: "status_change",
    actorType: "system",
    actorId: "orchestrator",
    ...overrides,
  };
}

/** Generate a minimal valid PolicySet row. */
function makePolicySet(overrides: Record<string, unknown> = {}) {
  return {
    policySetId: randomUUID(),
    name: `policy-${randomUUID().slice(0, 8)}`,
    version: "1.0.0",
    ...overrides,
  };
}

/** Generate a minimal valid TaskDependency row (requires two taskId FKs). */
function makeTaskDependency(
  taskId: string,
  dependsOnTaskId: string,
  overrides: Record<string, unknown> = {},
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
 * Seed the prerequisite rows needed by most child-entity tests.
 * Returns { projectId, repositoryId, taskId } for FK references.
 */
function seedParents(db: BetterSQLite3Database) {
  const projRepo = createProjectRepository(db);
  const repoRepo = createRepositoryRepository(db);
  const taskRepo = createTaskRepository(db);

  const project = projRepo.create(makeProject() as never);
  const repo = repoRepo.create(makeRepository(project.projectId) as never);
  const task = taskRepo.create(makeTask(repo.repositoryId) as never);

  return {
    projectId: project.projectId,
    repositoryId: repo.repositoryId,
    taskId: task.taskId,
  };
}

/**
 * Seed a worker pool and return its ID.
 */
function seedWorkerPool(db: BetterSQLite3Database): string {
  const repo = createWorkerPoolRepository(db);
  const pool = repo.create(makeWorkerPool() as never);
  return pool.workerPoolId;
}

/**
 * Seed a review cycle and return its ID (requires a taskId).
 */
function seedReviewCycle(db: BetterSQLite3Database, taskId: string): string {
  const repo = createReviewCycleRepository(db);
  const cycle = repo.create(makeReviewCycle(taskId) as never);
  return cycle.reviewCycleId;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. WorkflowTemplate Repository
// ═══════════════════════════════════════════════════════════════════════════

describe("WorkflowTemplate repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createWorkflowTemplateRepository>;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    repo = createWorkflowTemplateRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Verifies the basic insert-and-return path works. */
  it("create inserts a row and returns it with correct fields", () => {
    const data = makeWorkflowTemplate({ description: "A workflow" });
    const row = repo.create(data as never);
    expect(row.workflowTemplateId).toBe(data.workflowTemplateId);
    expect(row.name).toBe(data.name);
    expect(row.description).toBe("A workflow");
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  /** @why findById is the primary lookup; must return the exact row or undefined. */
  it("findById returns the row for an existing ID", () => {
    const created = repo.create(makeWorkflowTemplate() as never);
    const found = repo.findById(created.workflowTemplateId);
    expect(found).toBeDefined();
    expect(found!.workflowTemplateId).toBe(created.workflowTemplateId);
  });

  /** @why Must return undefined, not throw, for missing IDs. */
  it("findById returns undefined for a non-existent ID", () => {
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why findAll must return every row and honour limit/offset. */
  it("findAll returns all rows and respects limit/offset", () => {
    repo.create(makeWorkflowTemplate() as never);
    repo.create(makeWorkflowTemplate() as never);
    repo.create(makeWorkflowTemplate() as never);

    expect(repo.findAll()).toHaveLength(3);
    expect(repo.findAll({ limit: 2 })).toHaveLength(2);
    expect(repo.findAll({ limit: 10, offset: 2 })).toHaveLength(1);
  });

  /** @why update must change fields and bump updatedAt. */
  it("update modifies fields and returns updated row", () => {
    const created = repo.create(makeWorkflowTemplate() as never);
    const updated = repo.update(created.workflowTemplateId, { name: "renamed" });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe("renamed");
  });

  /** @why update on missing ID must return undefined, not throw. */
  it("update returns undefined for a non-existent ID", () => {
    expect(repo.update(randomUUID(), { name: "nope" })).toBeUndefined();
  });

  /** @why delete must return true on success and false on miss. */
  it("delete removes a row and returns true; false for non-existent", () => {
    const created = repo.create(makeWorkflowTemplate() as never);
    expect(repo.delete(created.workflowTemplateId)).toBe(true);
    expect(repo.findById(created.workflowTemplateId)).toBeUndefined();
    expect(repo.delete(randomUUID())).toBe(false);
  });

  /** @why findByName is used to look up templates by their unique name. */
  it("findByName returns the matching row or undefined", () => {
    const created = repo.create(makeWorkflowTemplate({ name: "unique-name" }) as never);
    expect(repo.findByName("unique-name")?.workflowTemplateId).toBe(created.workflowTemplateId);
    expect(repo.findByName("no-such-name")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Project Repository
// ═══════════════════════════════════════════════════════════════════════════

describe("Project repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createProjectRepository>;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    repo = createProjectRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Basic insert path. */
  it("create inserts a row and returns it with correct fields", () => {
    const data = makeProject({ description: "My project" });
    const row = repo.create(data as never);
    expect(row.projectId).toBe(data.projectId);
    expect(row.name).toBe(data.name);
    expect(row.owner).toBe("test-owner");
    expect(row.description).toBe("My project");
  });

  /** @why Primary lookup must work. */
  it("findById returns the row or undefined", () => {
    const created = repo.create(makeProject() as never);
    expect(repo.findById(created.projectId)).toBeDefined();
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why Pagination support. */
  it("findAll returns all rows and respects limit/offset", () => {
    repo.create(makeProject() as never);
    repo.create(makeProject() as never);
    expect(repo.findAll()).toHaveLength(2);
    expect(repo.findAll({ limit: 1 })).toHaveLength(1);
  });

  /** @why Field updates must persist. */
  it("update modifies fields and returns updated row", () => {
    const created = repo.create(makeProject() as never);
    const updated = repo.update(created.projectId, { owner: "new-owner" });
    expect(updated).toBeDefined();
    expect(updated!.owner).toBe("new-owner");
  });

  /** @why Delete contract. */
  it("delete removes a row, returns true; false for non-existent", () => {
    const created = repo.create(makeProject() as never);
    expect(repo.delete(created.projectId)).toBe(true);
    expect(repo.delete(randomUUID())).toBe(false);
  });

  /** @why findByOwner filters correctly by owner field. */
  it("findByOwner returns projects matching the owner", () => {
    repo.create(makeProject({ owner: "alice" }) as never);
    repo.create(makeProject({ owner: "alice" }) as never);
    repo.create(makeProject({ owner: "bob" }) as never);
    expect(repo.findByOwner("alice")).toHaveLength(2);
    expect(repo.findByOwner("nobody")).toHaveLength(0);
  });

  /** @why findByName does exact match on the UNIQUE name column. */
  it("findByName returns the matching project or undefined", () => {
    const created = repo.create(makeProject({ name: "my-proj" }) as never);
    expect(repo.findByName("my-proj")?.projectId).toBe(created.projectId);
    expect(repo.findByName("nope")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Repository Repository
// ═══════════════════════════════════════════════════════════════════════════

describe("Repository repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createRepositoryRepository>;
  let projectId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    const projRepo = createProjectRepository(db);
    const project = projRepo.create(makeProject() as never);
    projectId = project.projectId;
    repo = createRepositoryRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Insert path with FK parent. */
  it("create inserts a row and returns it with correct fields", () => {
    const data = makeRepository(projectId);
    const row = repo.create(data as never);
    expect(row.repositoryId).toBe(data.repositoryId);
    expect(row.projectId).toBe(projectId);
    expect(row.status).toBe("active");
    expect(row.defaultBranch).toBe("main");
  });

  /** @why Primary lookup. */
  it("findById returns the row or undefined", () => {
    const created = repo.create(makeRepository(projectId) as never);
    expect(repo.findById(created.repositoryId)).toBeDefined();
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why Pagination. */
  it("findAll respects limit/offset", () => {
    repo.create(makeRepository(projectId) as never);
    repo.create(makeRepository(projectId) as never);
    expect(repo.findAll()).toHaveLength(2);
    expect(repo.findAll({ limit: 1 })).toHaveLength(1);
  });

  /** @why Field update. */
  it("update modifies fields", () => {
    const created = repo.create(makeRepository(projectId) as never);
    const updated = repo.update(created.repositoryId, { status: "archived" });
    expect(updated?.status).toBe("archived");
  });

  /** @why Delete contract. */
  it("delete removes a row", () => {
    const created = repo.create(makeRepository(projectId) as never);
    expect(repo.delete(created.repositoryId)).toBe(true);
    expect(repo.delete(randomUUID())).toBe(false);
  });

  /** @why findByProjectId is a core query for listing repos under a project. */
  it("findByProjectId returns repos belonging to the project", () => {
    repo.create(makeRepository(projectId) as never);
    repo.create(makeRepository(projectId) as never);
    expect(repo.findByProjectId(projectId)).toHaveLength(2);
    expect(repo.findByProjectId(randomUUID())).toHaveLength(0);
  });

  /** @why findByStatus filters on the status column. */
  it("findByStatus returns repos matching the status", () => {
    repo.create(makeRepository(projectId, { status: "active" }) as never);
    repo.create(makeRepository(projectId, { status: "archived" }) as never);
    expect(repo.findByStatus("active")).toHaveLength(1);
    expect(repo.findByStatus("archived")).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Task Repository (critical — optimistic concurrency)
// ═══════════════════════════════════════════════════════════════════════════

describe("Task repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createTaskRepository>;
  let repositoryId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    const { repositoryId: rid } = seedParents(db);
    repositoryId = rid;
    repo = createTaskRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Inserts must populate all default fields correctly. */
  it("create inserts a row with correct fields and defaults", () => {
    const data = makeTask(repositoryId);
    const row = repo.create(data as never);
    expect(row.taskId).toBe(data.taskId);
    expect(row.repositoryId).toBe(repositoryId);
    expect(row.status).toBe("READY");
    expect(row.version).toBe(1);
    expect(row.retryCount).toBe(0);
  });

  /** @why Primary lookup contract. */
  it("findById returns the row or undefined", () => {
    const created = repo.create(makeTask(repositoryId) as never);
    expect(repo.findById(created.taskId)).toBeDefined();
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why Pagination. */
  it("findAll returns all rows and respects limit/offset", () => {
    repo.create(makeTask(repositoryId) as never);
    repo.create(makeTask(repositoryId) as never);
    repo.create(makeTask(repositoryId) as never);
    expect(repo.findAll()).toHaveLength(4); // 3 + 1 from seedParents
    expect(repo.findAll({ limit: 2 })).toHaveLength(2);
  });

  /** @why Optimistic concurrency: correct version must succeed and increment. */
  it("update with correct version succeeds and increments version", () => {
    const created = repo.create(makeTask(repositoryId) as never);
    expect(created.version).toBe(1);
    const updated = repo.update(created.taskId, 1, { status: "IN_DEVELOPMENT" });
    expect(updated.version).toBe(2);
    expect(updated.status).toBe("IN_DEVELOPMENT");
  });

  /** @why Optimistic concurrency: wrong version must throw VersionConflictError. */
  it("update with wrong version throws VersionConflictError", () => {
    const created = repo.create(makeTask(repositoryId) as never);
    expect(() => repo.update(created.taskId, 999, { status: "FAILED" })).toThrow(
      VersionConflictError,
    );
  });

  /** @why VersionConflictError must carry taskId and expectedVersion. */
  it("VersionConflictError contains taskId and expectedVersion", () => {
    const created = repo.create(makeTask(repositoryId) as never);
    try {
      repo.update(created.taskId, 42, { status: "FAILED" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VersionConflictError);
      const vce = err as VersionConflictError;
      expect(vce.taskId).toBe(created.taskId);
      expect(vce.expectedVersion).toBe(42);
    }
  });

  /** @why Delete contract. */
  it("delete removes a row", () => {
    const created = repo.create(makeTask(repositoryId) as never);
    expect(repo.delete(created.taskId)).toBe(true);
    expect(repo.delete(randomUUID())).toBe(false);
  });

  /** @why findByRepositoryId is how the scheduler finds tasks for a repo. */
  it("findByRepositoryId returns tasks belonging to the repository", () => {
    repo.create(makeTask(repositoryId) as never);
    // seedParents already created 1 task in this repo
    expect(repo.findByRepositoryId(repositoryId).length).toBeGreaterThanOrEqual(2);
    expect(repo.findByRepositoryId(randomUUID())).toHaveLength(0);
  });

  /** @why findByStatus drives the readiness computation. */
  it("findByStatus returns tasks matching the status", () => {
    repo.create(makeTask(repositoryId, { status: "IN_DEVELOPMENT" }) as never);
    repo.create(makeTask(repositoryId, { status: "IN_DEVELOPMENT" }) as never);
    expect(repo.findByStatus("IN_DEVELOPMENT")).toHaveLength(2);
  });

  /** @why findByPriority is used for prioritized scheduling. */
  it("findByPriority returns tasks matching the priority", () => {
    repo.create(makeTask(repositoryId, { priority: "critical" }) as never);
    repo.create(makeTask(repositoryId, { priority: "low" }) as never);
    expect(repo.findByPriority("critical")).toHaveLength(1);
    expect(repo.findByPriority("low")).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. TaskDependency Repository
// ═══════════════════════════════════════════════════════════════════════════

describe("TaskDependency repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createTaskDependencyRepository>;
  let taskAId: string;
  let taskBId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    const { repositoryId } = seedParents(db);
    const taskRepo = createTaskRepository(db);
    const taskA = taskRepo.create(makeTask(repositoryId) as never);
    const taskB = taskRepo.create(makeTask(repositoryId) as never);
    taskAId = taskA.taskId;
    taskBId = taskB.taskId;
    repo = createTaskDependencyRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Basic insert path for dependency edges. */
  it("create inserts and returns a dependency edge", () => {
    const data = makeTaskDependency(taskAId, taskBId);
    const row = repo.create(data as never);
    expect(row.taskId).toBe(taskAId);
    expect(row.dependsOnTaskId).toBe(taskBId);
    expect(row.dependencyType).toBe("blocks");
  });

  /** @why Primary key lookup. */
  it("findById returns the edge or undefined", () => {
    const created = repo.create(makeTaskDependency(taskAId, taskBId) as never);
    expect(repo.findById(created.taskDependencyId)).toBeDefined();
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why Pagination. */
  it("findAll returns all edges and respects limit/offset", () => {
    repo.create(makeTaskDependency(taskAId, taskBId) as never);
    expect(repo.findAll()).toHaveLength(1);
    expect(repo.findAll({ limit: 0 })).toHaveLength(0);
  });

  /** @why Forward lookup: what does taskA depend on? */
  it("findByTaskId returns edges where the task is the dependent", () => {
    repo.create(makeTaskDependency(taskAId, taskBId) as never);
    expect(repo.findByTaskId(taskAId)).toHaveLength(1);
    expect(repo.findByTaskId(taskBId)).toHaveLength(0);
  });

  /** @why Reverse lookup: what tasks depend on taskB? */
  it("findByDependsOnTaskId returns edges where the task is the prerequisite", () => {
    repo.create(makeTaskDependency(taskAId, taskBId) as never);
    expect(repo.findByDependsOnTaskId(taskBId)).toHaveLength(1);
    expect(repo.findByDependsOnTaskId(taskAId)).toHaveLength(0);
  });

  /** @why Exact-pair lookup for checking if a specific edge exists. */
  it("findByTaskIdPair returns the specific edge or undefined", () => {
    repo.create(makeTaskDependency(taskAId, taskBId) as never);
    expect(repo.findByTaskIdPair(taskAId, taskBId)).toBeDefined();
    expect(repo.findByTaskIdPair(taskBId, taskAId)).toBeUndefined();
  });

  /** @why Delete contract — edges are immutable but deletable. */
  it("delete removes an edge and returns true; false for non-existent", () => {
    const created = repo.create(makeTaskDependency(taskAId, taskBId) as never);
    expect(repo.delete(created.taskDependencyId)).toBe(true);
    expect(repo.delete(randomUUID())).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. WorkerPool Repository
// ═══════════════════════════════════════════════════════════════════════════

describe("WorkerPool repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createWorkerPoolRepository>;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    repo = createWorkerPoolRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Basic insert path. */
  it("create inserts a row and returns it", () => {
    const data = makeWorkerPool();
    const row = repo.create(data as never);
    expect(row.workerPoolId).toBe(data.workerPoolId);
    expect(row.poolType).toBe("ai");
    expect(row.enabled).toBe(1);
    expect(row.maxConcurrency).toBe(1);
  });

  /** @why Primary lookup. */
  it("findById returns the row or undefined", () => {
    const created = repo.create(makeWorkerPool() as never);
    expect(repo.findById(created.workerPoolId)).toBeDefined();
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why Pagination. */
  it("findAll returns all rows and respects limit/offset", () => {
    repo.create(makeWorkerPool() as never);
    repo.create(makeWorkerPool() as never);
    expect(repo.findAll()).toHaveLength(2);
    expect(repo.findAll({ limit: 1 })).toHaveLength(1);
  });

  /** @why Update path. */
  it("update modifies fields", () => {
    const created = repo.create(makeWorkerPool() as never);
    const updated = repo.update(created.workerPoolId, { maxConcurrency: 5 });
    expect(updated?.maxConcurrency).toBe(5);
  });

  /** @why Delete contract. */
  it("delete removes a row", () => {
    const created = repo.create(makeWorkerPool() as never);
    expect(repo.delete(created.workerPoolId)).toBe(true);
    expect(repo.delete(randomUUID())).toBe(false);
  });

  /** @why findByPoolType filters on pool_type column. */
  it("findByPoolType returns pools matching the type", () => {
    repo.create(makeWorkerPool({ poolType: "ai" }) as never);
    repo.create(makeWorkerPool({ poolType: "deterministic" }) as never);
    expect(repo.findByPoolType("ai")).toHaveLength(1);
    expect(repo.findByPoolType("deterministic")).toHaveLength(1);
  });

  /** @why findEnabled returns only pools where enabled = 1. */
  it("findEnabled returns only enabled pools", () => {
    repo.create(makeWorkerPool({ enabled: 1 }) as never);
    repo.create(makeWorkerPool({ enabled: 0 }) as never);
    expect(repo.findEnabled()).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Worker Repository
// ═══════════════════════════════════════════════════════════════════════════

describe("Worker repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createWorkerRepository>;
  let poolId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    poolId = seedWorkerPool(db);
    repo = createWorkerRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Basic insert with FK parent. */
  it("create inserts a row and returns it", () => {
    const data = makeWorker(poolId);
    const row = repo.create(data as never);
    expect(row.workerId).toBe(data.workerId);
    expect(row.poolId).toBe(poolId);
    expect(row.status).toBe("idle");
  });

  /** @why Primary lookup. */
  it("findById returns the row or undefined", () => {
    const created = repo.create(makeWorker(poolId) as never);
    expect(repo.findById(created.workerId)).toBeDefined();
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why Pagination. */
  it("findAll respects limit/offset", () => {
    repo.create(makeWorker(poolId) as never);
    repo.create(makeWorker(poolId) as never);
    expect(repo.findAll()).toHaveLength(2);
    expect(repo.findAll({ limit: 1 })).toHaveLength(1);
  });

  /** @why Update path. */
  it("update modifies fields", () => {
    const created = repo.create(makeWorker(poolId) as never);
    const updated = repo.update(created.workerId, { status: "busy" });
    expect(updated?.status).toBe("busy");
  });

  /** @why Delete contract. */
  it("delete removes a row", () => {
    const created = repo.create(makeWorker(poolId) as never);
    expect(repo.delete(created.workerId)).toBe(true);
    expect(repo.delete(randomUUID())).toBe(false);
  });

  /** @why findByPoolId lists workers in a pool. */
  it("findByPoolId returns workers in the pool", () => {
    repo.create(makeWorker(poolId) as never);
    repo.create(makeWorker(poolId) as never);
    expect(repo.findByPoolId(poolId)).toHaveLength(2);
    expect(repo.findByPoolId(randomUUID())).toHaveLength(0);
  });

  /** @why findByStatus filters on worker status. */
  it("findByStatus returns workers matching the status", () => {
    repo.create(makeWorker(poolId, { status: "idle" }) as never);
    repo.create(makeWorker(poolId, { status: "busy" }) as never);
    expect(repo.findByStatus("idle")).toHaveLength(1);
    expect(repo.findByStatus("busy")).toHaveLength(1);
  });

  /** @why findByCurrentTaskId locates the worker running a specific task. */
  it("findByCurrentTaskId returns the worker or undefined", () => {
    // Seed a task so we have a valid FK
    const { taskId } = seedParents(db);
    repo.create(makeWorker(poolId, { currentTaskId: taskId }) as never);
    expect(repo.findByCurrentTaskId(taskId)).toBeDefined();
    expect(repo.findByCurrentTaskId(randomUUID())).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. PromptTemplate Repository
// ═══════════════════════════════════════════════════════════════════════════

describe("PromptTemplate repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createPromptTemplateRepository>;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    repo = createPromptTemplateRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Basic insert. */
  it("create inserts a row and returns it", () => {
    const data = makePromptTemplate();
    const row = repo.create(data as never);
    expect(row.promptTemplateId).toBe(data.promptTemplateId);
    expect(row.role).toBe("developer");
    expect(row.templateText).toBe("You are a developer agent.");
  });

  /** @why Primary lookup. */
  it("findById returns the row or undefined", () => {
    const created = repo.create(makePromptTemplate() as never);
    expect(repo.findById(created.promptTemplateId)).toBeDefined();
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why Pagination. */
  it("findAll respects limit/offset", () => {
    repo.create(makePromptTemplate() as never);
    repo.create(makePromptTemplate() as never);
    expect(repo.findAll()).toHaveLength(2);
    expect(repo.findAll({ limit: 1 })).toHaveLength(1);
  });

  /** @why Update path. */
  it("update modifies fields", () => {
    const created = repo.create(makePromptTemplate() as never);
    const updated = repo.update(created.promptTemplateId, {
      templateText: "Updated text",
    });
    expect(updated?.templateText).toBe("Updated text");
  });

  /** @why Delete contract. */
  it("delete removes a row", () => {
    const created = repo.create(makePromptTemplate() as never);
    expect(repo.delete(created.promptTemplateId)).toBe(true);
    expect(repo.delete(randomUUID())).toBe(false);
  });

  /** @why findByRole filters templates by their intended agent role. */
  it("findByRole returns templates matching the role", () => {
    repo.create(makePromptTemplate({ role: "developer" }) as never);
    repo.create(makePromptTemplate({ role: "reviewer" }) as never);
    expect(repo.findByRole("developer")).toHaveLength(1);
    expect(repo.findByRole("reviewer")).toHaveLength(1);
    expect(repo.findByRole("planner")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. AgentProfile Repository
// ═══════════════════════════════════════════════════════════════════════════

describe("AgentProfile repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createAgentProfileRepository>;
  let poolId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    poolId = seedWorkerPool(db);
    repo = createAgentProfileRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Basic insert with FK parent. */
  it("create inserts a row and returns it", () => {
    const data = makeAgentProfile(poolId);
    const row = repo.create(data as never);
    expect(row.agentProfileId).toBe(data.agentProfileId);
    expect(row.poolId).toBe(poolId);
  });

  /** @why Primary lookup. */
  it("findById returns the row or undefined", () => {
    const created = repo.create(makeAgentProfile(poolId) as never);
    expect(repo.findById(created.agentProfileId)).toBeDefined();
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why Pagination. */
  it("findAll respects limit/offset", () => {
    repo.create(makeAgentProfile(poolId) as never);
    repo.create(makeAgentProfile(poolId) as never);
    expect(repo.findAll()).toHaveLength(2);
    expect(repo.findAll({ limit: 1 })).toHaveLength(1);
  });

  /** @why Update path. */
  it("update modifies fields", () => {
    const created = repo.create(makeAgentProfile(poolId) as never);
    const updated = repo.update(created.agentProfileId, {
      toolPolicyId: "tp-123",
    });
    expect(updated?.toolPolicyId).toBe("tp-123");
  });

  /** @why Delete contract. */
  it("delete removes a row", () => {
    const created = repo.create(makeAgentProfile(poolId) as never);
    expect(repo.delete(created.agentProfileId)).toBe(true);
    expect(repo.delete(randomUUID())).toBe(false);
  });

  /** @why findByPoolId lists profiles associated with a pool. */
  it("findByPoolId returns profiles in the pool", () => {
    repo.create(makeAgentProfile(poolId) as never);
    repo.create(makeAgentProfile(poolId) as never);
    expect(repo.findByPoolId(poolId)).toHaveLength(2);
    expect(repo.findByPoolId(randomUUID())).toHaveLength(0);
  });

  /** @why FK to PromptTemplate should resolve when provided. */
  it("create with promptTemplateId FK works", () => {
    const ptRepo = createPromptTemplateRepository(db);
    const pt = ptRepo.create(makePromptTemplate() as never);
    const profile = repo.create(
      makeAgentProfile(poolId, { promptTemplateId: pt.promptTemplateId }) as never,
    );
    expect(profile.promptTemplateId).toBe(pt.promptTemplateId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. TaskLease Repository
// ═══════════════════════════════════════════════════════════════════════════

describe("TaskLease repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createTaskLeaseRepository>;
  let taskId: string;
  let poolId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    const parents = seedParents(db);
    taskId = parents.taskId;
    poolId = seedWorkerPool(db);
    repo = createTaskLeaseRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Basic insert with FK parents. */
  it("create inserts a row and returns it", () => {
    const data = makeTaskLease(taskId, poolId);
    const row = repo.create(data as never);
    expect(row.leaseId).toBe(data.leaseId);
    expect(row.taskId).toBe(taskId);
    expect(row.status).toBe("ACTIVE");
  });

  /** @why Primary lookup. */
  it("findById returns the row or undefined", () => {
    const created = repo.create(makeTaskLease(taskId, poolId) as never);
    expect(repo.findById(created.leaseId)).toBeDefined();
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why Pagination. */
  it("findAll respects limit/offset", () => {
    repo.create(makeTaskLease(taskId, poolId) as never);
    repo.create(makeTaskLease(taskId, poolId) as never);
    expect(repo.findAll()).toHaveLength(2);
    expect(repo.findAll({ limit: 1 })).toHaveLength(1);
  });

  /** @why Update path. */
  it("update modifies fields", () => {
    const created = repo.create(makeTaskLease(taskId, poolId) as never);
    const updated = repo.update(created.leaseId, { status: "COMPLETED" });
    expect(updated?.status).toBe("COMPLETED");
  });

  /** @why Delete contract. */
  it("delete removes a row", () => {
    const created = repo.create(makeTaskLease(taskId, poolId) as never);
    expect(repo.delete(created.leaseId)).toBe(true);
    expect(repo.delete(randomUUID())).toBe(false);
  });

  /** @why findByTaskId returns all leases (active and historical) for a task. */
  it("findByTaskId returns all leases for the task", () => {
    repo.create(makeTaskLease(taskId, poolId) as never);
    repo.create(makeTaskLease(taskId, poolId, { status: "COMPLETED" }) as never);
    expect(repo.findByTaskId(taskId)).toHaveLength(2);
  });

  /** @why findByWorkerId returns all leases held by a specific worker. */
  it("findByWorkerId returns leases for the worker", () => {
    const wId = randomUUID();
    repo.create(makeTaskLease(taskId, poolId, { workerId: wId }) as never);
    expect(repo.findByWorkerId(wId)).toHaveLength(1);
    expect(repo.findByWorkerId(randomUUID())).toHaveLength(0);
  });

  /** @why findByStatus filters leases by status. */
  it("findByStatus returns leases matching the status", () => {
    repo.create(makeTaskLease(taskId, poolId, { status: "ACTIVE" }) as never);
    repo.create(makeTaskLease(taskId, poolId, { status: "COMPLETED" }) as never);
    expect(repo.findByStatus("ACTIVE")).toHaveLength(1);
    expect(repo.findByStatus("COMPLETED")).toHaveLength(1);
  });

  /** @why findActiveByTaskId must return non-terminal leases and ignore terminal ones. */
  it("findActiveByTaskId returns the active lease and ignores terminal ones", () => {
    repo.create(makeTaskLease(taskId, poolId, { status: "ACTIVE" }) as never);
    const active = repo.findActiveByTaskId(taskId);
    expect(active).toBeDefined();
    expect(active!.status).toBe("ACTIVE");
  });

  /** @why When all leases are terminal, findActiveByTaskId returns undefined. */
  it("findActiveByTaskId returns undefined when all leases are terminal", () => {
    repo.create(makeTaskLease(taskId, poolId, { status: "COMPLETED" }) as never);
    repo.create(makeTaskLease(taskId, poolId, { status: "TIMED_OUT" }) as never);
    repo.create(makeTaskLease(taskId, poolId, { status: "CRASHED" }) as never);
    repo.create(makeTaskLease(taskId, poolId, { status: "RECLAIMED" }) as never);
    expect(repo.findActiveByTaskId(taskId)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. ReviewCycle Repository
// ═══════════════════════════════════════════════════════════════════════════

describe("ReviewCycle repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createReviewCycleRepository>;
  let taskId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    const parents = seedParents(db);
    taskId = parents.taskId;
    repo = createReviewCycleRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Basic insert. */
  it("create inserts a row and returns it", () => {
    const data = makeReviewCycle(taskId);
    const row = repo.create(data as never);
    expect(row.reviewCycleId).toBe(data.reviewCycleId);
    expect(row.status).toBe("IN_PROGRESS");
  });

  /** @why Primary lookup. */
  it("findById returns the row or undefined", () => {
    const created = repo.create(makeReviewCycle(taskId) as never);
    expect(repo.findById(created.reviewCycleId)).toBeDefined();
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why Pagination. */
  it("findAll respects limit/offset", () => {
    repo.create(makeReviewCycle(taskId) as never);
    repo.create(makeReviewCycle(taskId) as never);
    expect(repo.findAll()).toHaveLength(2);
    expect(repo.findAll({ limit: 1 })).toHaveLength(1);
  });

  /** @why Update path. */
  it("update modifies fields", () => {
    const created = repo.create(makeReviewCycle(taskId) as never);
    const updated = repo.update(created.reviewCycleId, { status: "COMPLETED" });
    expect(updated?.status).toBe("COMPLETED");
  });

  /** @why Delete contract. */
  it("delete removes a row", () => {
    const created = repo.create(makeReviewCycle(taskId) as never);
    expect(repo.delete(created.reviewCycleId)).toBe(true);
    expect(repo.delete(randomUUID())).toBe(false);
  });

  /** @why findByTaskId lists all review cycles for a task. */
  it("findByTaskId returns cycles for the task", () => {
    repo.create(makeReviewCycle(taskId) as never);
    repo.create(makeReviewCycle(taskId) as never);
    expect(repo.findByTaskId(taskId)).toHaveLength(2);
    expect(repo.findByTaskId(randomUUID())).toHaveLength(0);
  });

  /** @why findByStatus filters cycles by status. */
  it("findByStatus returns cycles matching the status", () => {
    repo.create(makeReviewCycle(taskId, { status: "IN_PROGRESS" }) as never);
    repo.create(makeReviewCycle(taskId, { status: "COMPLETED" }) as never);
    expect(repo.findByStatus("IN_PROGRESS")).toHaveLength(1);
    expect(repo.findByStatus("COMPLETED")).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. ReviewPacket Repository
// ═══════════════════════════════════════════════════════════════════════════

describe("ReviewPacket repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createReviewPacketRepository>;
  let taskId: string;
  let reviewCycleId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    const parents = seedParents(db);
    taskId = parents.taskId;
    reviewCycleId = seedReviewCycle(db, taskId);
    repo = createReviewPacketRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Basic insert with FK parents. */
  it("create inserts a row and returns it", () => {
    const data = makeReviewPacket(taskId, reviewCycleId);
    const row = repo.create(data as never);
    expect(row.reviewPacketId).toBe(data.reviewPacketId);
    expect(row.verdict).toBe("APPROVED");
    expect(row.reviewerType).toBe("specialist");
  });

  /** @why Primary lookup. */
  it("findById returns the row or undefined", () => {
    const created = repo.create(makeReviewPacket(taskId, reviewCycleId) as never);
    expect(repo.findById(created.reviewPacketId)).toBeDefined();
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why Pagination. */
  it("findAll respects limit/offset", () => {
    repo.create(makeReviewPacket(taskId, reviewCycleId) as never);
    repo.create(makeReviewPacket(taskId, reviewCycleId) as never);
    expect(repo.findAll()).toHaveLength(2);
    expect(repo.findAll({ limit: 1 })).toHaveLength(1);
  });

  /** @why Update path. */
  it("update modifies fields", () => {
    const created = repo.create(makeReviewPacket(taskId, reviewCycleId) as never);
    const updated = repo.update(created.reviewPacketId, { verdict: "REJECTED" });
    expect(updated?.verdict).toBe("REJECTED");
  });

  /** @why Delete contract. */
  it("delete removes a row", () => {
    const created = repo.create(makeReviewPacket(taskId, reviewCycleId) as never);
    expect(repo.delete(created.reviewPacketId)).toBe(true);
    expect(repo.delete(randomUUID())).toBe(false);
  });

  /** @why findByReviewCycleId lists packets within a cycle. */
  it("findByReviewCycleId returns packets for the cycle", () => {
    repo.create(makeReviewPacket(taskId, reviewCycleId) as never);
    repo.create(makeReviewPacket(taskId, reviewCycleId) as never);
    expect(repo.findByReviewCycleId(reviewCycleId)).toHaveLength(2);
    expect(repo.findByReviewCycleId(randomUUID())).toHaveLength(0);
  });

  /** @why findByTaskId lists all packets across cycles for a task. */
  it("findByTaskId returns packets for the task", () => {
    repo.create(makeReviewPacket(taskId, reviewCycleId) as never);
    expect(repo.findByTaskId(taskId)).toHaveLength(1);
  });

  /** @why findByVerdict filters packets by review outcome. */
  it("findByVerdict returns packets matching the verdict", () => {
    repo.create(makeReviewPacket(taskId, reviewCycleId, { verdict: "APPROVED" }) as never);
    repo.create(makeReviewPacket(taskId, reviewCycleId, { verdict: "REJECTED" }) as never);
    expect(repo.findByVerdict("APPROVED")).toHaveLength(1);
    expect(repo.findByVerdict("REJECTED")).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. LeadReviewDecision Repository
// ═══════════════════════════════════════════════════════════════════════════

describe("LeadReviewDecision repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createLeadReviewDecisionRepository>;
  let taskId: string;
  let reviewCycleId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    const parents = seedParents(db);
    taskId = parents.taskId;
    reviewCycleId = seedReviewCycle(db, taskId);
    repo = createLeadReviewDecisionRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Basic insert. */
  it("create inserts a row and returns it", () => {
    const data = makeLeadReviewDecision(taskId, reviewCycleId);
    const row = repo.create(data as never);
    expect(row.leadReviewDecisionId).toBe(data.leadReviewDecisionId);
    expect(row.decision).toBe("APPROVED");
    expect(row.blockingIssueCount).toBe(0);
  });

  /** @why Primary lookup. */
  it("findById returns the row or undefined", () => {
    const created = repo.create(makeLeadReviewDecision(taskId, reviewCycleId) as never);
    expect(repo.findById(created.leadReviewDecisionId)).toBeDefined();
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why Pagination. */
  it("findAll respects limit/offset", () => {
    repo.create(makeLeadReviewDecision(taskId, reviewCycleId) as never);
    repo.create(makeLeadReviewDecision(taskId, reviewCycleId) as never);
    expect(repo.findAll()).toHaveLength(2);
    expect(repo.findAll({ limit: 1 })).toHaveLength(1);
  });

  /** @why Update path. */
  it("update modifies fields", () => {
    const created = repo.create(makeLeadReviewDecision(taskId, reviewCycleId) as never);
    const updated = repo.update(created.leadReviewDecisionId, {
      decision: "REVISE",
      blockingIssueCount: 3,
    });
    expect(updated?.decision).toBe("REVISE");
    expect(updated?.blockingIssueCount).toBe(3);
  });

  /** @why Delete contract. */
  it("delete removes a row", () => {
    const created = repo.create(makeLeadReviewDecision(taskId, reviewCycleId) as never);
    expect(repo.delete(created.leadReviewDecisionId)).toBe(true);
    expect(repo.delete(randomUUID())).toBe(false);
  });

  /** @why findByReviewCycleId returns the single decision for a cycle. */
  it("findByReviewCycleId returns the decision or undefined", () => {
    repo.create(makeLeadReviewDecision(taskId, reviewCycleId) as never);
    expect(repo.findByReviewCycleId(reviewCycleId)).toBeDefined();
    expect(repo.findByReviewCycleId(randomUUID())).toBeUndefined();
  });

  /** @why findByTaskId lists all decisions across cycles for a task. */
  it("findByTaskId returns decisions for the task", () => {
    repo.create(makeLeadReviewDecision(taskId, reviewCycleId) as never);
    expect(repo.findByTaskId(taskId)).toHaveLength(1);
    expect(repo.findByTaskId(randomUUID())).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. MergeQueueItem Repository
// ═══════════════════════════════════════════════════════════════════════════

describe("MergeQueueItem repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createMergeQueueItemRepository>;
  let taskId: string;
  let repositoryId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    const parents = seedParents(db);
    taskId = parents.taskId;
    repositoryId = parents.repositoryId;
    repo = createMergeQueueItemRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Basic insert. */
  it("create inserts a row and returns it", () => {
    const data = makeMergeQueueItem(taskId, repositoryId);
    const row = repo.create(data as never);
    expect(row.mergeQueueItemId).toBe(data.mergeQueueItemId);
    expect(row.status).toBe("PENDING");
    expect(row.position).toBe(1);
  });

  /** @why Primary lookup. */
  it("findById returns the row or undefined", () => {
    const created = repo.create(makeMergeQueueItem(taskId, repositoryId) as never);
    expect(repo.findById(created.mergeQueueItemId)).toBeDefined();
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why Pagination. */
  it("findAll respects limit/offset", () => {
    repo.create(makeMergeQueueItem(taskId, repositoryId) as never);
    expect(repo.findAll()).toHaveLength(1);
  });

  /** @why Update path. */
  it("update modifies fields", () => {
    const created = repo.create(makeMergeQueueItem(taskId, repositoryId) as never);
    const updated = repo.update(created.mergeQueueItemId, {
      status: "MERGING",
    });
    expect(updated?.status).toBe("MERGING");
  });

  /** @why Delete contract. */
  it("delete removes a row", () => {
    const created = repo.create(makeMergeQueueItem(taskId, repositoryId) as never);
    expect(repo.delete(created.mergeQueueItemId)).toBe(true);
    expect(repo.delete(randomUUID())).toBe(false);
  });

  /** @why findByRepositoryId must return items ordered by position (ascending). */
  it("findByRepositoryId returns items ordered by position", () => {
    // Create additional tasks for separate merge queue items
    const taskRepo = createTaskRepository(db);
    const task2 = taskRepo.create(makeTask(repositoryId) as never);
    const task3 = taskRepo.create(makeTask(repositoryId) as never);

    repo.create(makeMergeQueueItem(task3.taskId, repositoryId, { position: 3 }) as never);
    repo.create(makeMergeQueueItem(taskId, repositoryId, { position: 1 }) as never);
    repo.create(makeMergeQueueItem(task2.taskId, repositoryId, { position: 2 }) as never);

    const items = repo.findByRepositoryId(repositoryId);
    expect(items).toHaveLength(3);
    expect(items[0]!.position).toBe(1);
    expect(items[1]!.position).toBe(2);
    expect(items[2]!.position).toBe(3);
  });

  /** @why findByTaskId locates the queue item for a specific task. */
  it("findByTaskId returns the item or undefined", () => {
    repo.create(makeMergeQueueItem(taskId, repositoryId) as never);
    expect(repo.findByTaskId(taskId)).toBeDefined();
    expect(repo.findByTaskId(randomUUID())).toBeUndefined();
  });

  /** @why findByStatus filters queue items by status. */
  it("findByStatus returns items matching the status", () => {
    const taskRepo = createTaskRepository(db);
    const task2 = taskRepo.create(makeTask(repositoryId) as never);

    repo.create(makeMergeQueueItem(taskId, repositoryId, { status: "PENDING" }) as never);
    repo.create(
      makeMergeQueueItem(task2.taskId, repositoryId, {
        status: "MERGING",
        position: 2,
      }) as never,
    );
    expect(repo.findByStatus("PENDING")).toHaveLength(1);
    expect(repo.findByStatus("MERGING")).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. ValidationRun Repository
// ═══════════════════════════════════════════════════════════════════════════

describe("ValidationRun repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createValidationRunRepository>;
  let taskId: string;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    const parents = seedParents(db);
    taskId = parents.taskId;
    repo = createValidationRunRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Basic insert. */
  it("create inserts a row and returns it", () => {
    const data = makeValidationRun(taskId);
    const row = repo.create(data as never);
    expect(row.validationRunId).toBe(data.validationRunId);
    expect(row.runScope).toBe("pre-merge");
    expect(row.status).toBe("RUNNING");
  });

  /** @why Primary lookup. */
  it("findById returns the row or undefined", () => {
    const created = repo.create(makeValidationRun(taskId) as never);
    expect(repo.findById(created.validationRunId)).toBeDefined();
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why Pagination. */
  it("findAll respects limit/offset", () => {
    repo.create(makeValidationRun(taskId) as never);
    repo.create(makeValidationRun(taskId) as never);
    expect(repo.findAll()).toHaveLength(2);
    expect(repo.findAll({ limit: 1 })).toHaveLength(1);
  });

  /** @why Update path. */
  it("update modifies fields", () => {
    const created = repo.create(makeValidationRun(taskId) as never);
    const updated = repo.update(created.validationRunId, {
      status: "PASSED",
      summary: "All checks green",
    });
    expect(updated?.status).toBe("PASSED");
    expect(updated?.summary).toBe("All checks green");
  });

  /** @why Delete contract. */
  it("delete removes a row", () => {
    const created = repo.create(makeValidationRun(taskId) as never);
    expect(repo.delete(created.validationRunId)).toBe(true);
    expect(repo.delete(randomUUID())).toBe(false);
  });

  /** @why findByTaskId lists all validation runs for a task. */
  it("findByTaskId returns runs for the task", () => {
    repo.create(makeValidationRun(taskId) as never);
    repo.create(makeValidationRun(taskId) as never);
    expect(repo.findByTaskId(taskId)).toHaveLength(2);
    expect(repo.findByTaskId(randomUUID())).toHaveLength(0);
  });

  /** @why findByTaskIdAndScope narrows by both task and run scope. */
  it("findByTaskIdAndScope returns runs matching task and scope", () => {
    repo.create(makeValidationRun(taskId, { runScope: "pre-merge" }) as never);
    repo.create(makeValidationRun(taskId, { runScope: "post-merge" }) as never);
    expect(repo.findByTaskIdAndScope(taskId, "pre-merge")).toHaveLength(1);
    expect(repo.findByTaskIdAndScope(taskId, "post-merge")).toHaveLength(1);
    expect(repo.findByTaskIdAndScope(taskId, "unknown")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. Job Repository (critical — atomic claimJob)
// ═══════════════════════════════════════════════════════════════════════════

describe("Job repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createJobRepository>;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    repo = createJobRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Basic insert. */
  it("create inserts a row and returns it with defaults", () => {
    const data = makeJob();
    const row = repo.create(data as never);
    expect(row.jobId).toBe(data.jobId);
    expect(row.jobType).toBe("execute-task");
    expect(row.status).toBe("pending");
    expect(row.attemptCount).toBe(0);
  });

  /** @why Primary lookup. */
  it("findById returns the row or undefined", () => {
    const created = repo.create(makeJob() as never);
    expect(repo.findById(created.jobId)).toBeDefined();
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why Pagination. */
  it("findAll respects limit/offset", () => {
    repo.create(makeJob() as never);
    repo.create(makeJob() as never);
    expect(repo.findAll()).toHaveLength(2);
    expect(repo.findAll({ limit: 1 })).toHaveLength(1);
  });

  /** @why Update path. */
  it("update modifies fields and sets updatedAt", () => {
    const created = repo.create(makeJob() as never);
    const updated = repo.update(created.jobId, { status: "COMPLETED" });
    expect(updated?.status).toBe("COMPLETED");
  });

  /** @why Delete contract. */
  it("delete removes a row", () => {
    const created = repo.create(makeJob() as never);
    expect(repo.delete(created.jobId)).toBe(true);
    expect(repo.delete(randomUUID())).toBe(false);
  });

  /** @why findByStatus filters jobs by queue status. */
  it("findByStatus returns jobs matching the status", () => {
    repo.create(makeJob({ status: "pending" }) as never);
    repo.create(makeJob({ status: "claimed" }) as never);
    expect(repo.findByStatus("pending")).toHaveLength(1);
    expect(repo.findByStatus("claimed")).toHaveLength(1);
  });

  /** @why findByJobGroupId groups related jobs. */
  it("findByJobGroupId returns jobs in the group", () => {
    const groupId = randomUUID();
    repo.create(makeJob({ jobGroupId: groupId }) as never);
    repo.create(makeJob({ jobGroupId: groupId }) as never);
    repo.create(makeJob() as never);
    expect(repo.findByJobGroupId(groupId)).toHaveLength(2);
  });

  /** @why findByParentJobId finds child jobs. */
  it("findByParentJobId returns child jobs", () => {
    const parent = repo.create(makeJob() as never);
    repo.create(makeJob({ parentJobId: parent.jobId }) as never);
    repo.create(makeJob({ parentJobId: parent.jobId }) as never);
    expect(repo.findByParentJobId(parent.jobId)).toHaveLength(2);
  });

  /** @why findClaimable returns pending jobs whose runAfter is null or in the past. */
  it("findClaimable returns eligible jobs", () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3600_000);
    repo.create(makeJob() as never);
    repo.create(makeJob({ runAfter: past }) as never);
    repo.create(makeJob({ runAfter: future }) as never);
    repo.create(makeJob({ status: "claimed", runAfter: past }) as never);

    const claimable = repo.findClaimable(new Date());
    expect(claimable).toHaveLength(2);
    expect(claimable[0]!.status).toBe("pending");
  });

  /** @why claimJob on a pending job must atomically set claimed, assign owner, increment attemptCount. */
  it("claimJob succeeds on a PENDING job", () => {
    const created = repo.create(makeJob() as never);
    const claimed = repo.claimJob(created.jobId, "worker-1");
    expect(claimed).toBeDefined();
    expect(claimed!.status).toBe("claimed");
    expect(claimed!.leaseOwner).toBe("worker-1");
    expect(claimed!.attemptCount).toBe(1);
  });

  /** @why claimJob must fail gracefully when the job is already claimed. */
  it("claimJob returns undefined on an already-claimed job", () => {
    const created = repo.create(makeJob() as never);
    repo.claimJob(created.jobId, "worker-1");
    const second = repo.claimJob(created.jobId, "worker-2");
    expect(second).toBeUndefined();
  });

  /** @why claimJob on a non-existent job must return undefined, not throw. */
  it("claimJob returns undefined for a non-existent job", () => {
    expect(repo.claimJob(randomUUID(), "worker-1")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. AuditEvent Repository (insert-only)
// ═══════════════════════════════════════════════════════════════════════════

describe("AuditEvent repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createAuditEventRepository>;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    repo = createAuditEventRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Basic insert for append-only audit log. */
  it("create inserts a row and returns it", () => {
    const data = makeAuditEvent();
    const row = repo.create(data as never);
    expect(row.auditEventId).toBe(data.auditEventId);
    expect(row.entityType).toBe("task");
    expect(row.eventType).toBe("status_change");
    expect(row.actorType).toBe("system");
  });

  /** @why Primary lookup. */
  it("findById returns the row or undefined", () => {
    const created = repo.create(makeAuditEvent() as never);
    expect(repo.findById(created.auditEventId)).toBeDefined();
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why Pagination. */
  it("findAll respects limit/offset", () => {
    repo.create(makeAuditEvent() as never);
    repo.create(makeAuditEvent() as never);
    expect(repo.findAll()).toHaveLength(2);
    expect(repo.findAll({ limit: 1 })).toHaveLength(1);
  });

  /** @why findByEntity is the primary query pattern for audit review. */
  it("findByEntity returns events for the entity", () => {
    const entityId = randomUUID();
    repo.create(makeAuditEvent({ entityType: "task", entityId }) as never);
    repo.create(makeAuditEvent({ entityType: "task", entityId }) as never);
    repo.create(makeAuditEvent({ entityType: "task", entityId: randomUUID() }) as never);
    expect(repo.findByEntity("task", entityId)).toHaveLength(2);
  });

  /** @why findByTimeRange supports operational monitoring over time windows. */
  it("findByTimeRange returns events within the range", () => {
    // Insert events — they will have createdAt set by the DB default (unixepoch())
    repo.create(makeAuditEvent() as never);
    repo.create(makeAuditEvent() as never);

    const from = new Date(Date.now() - 10_000);
    const to = new Date(Date.now() + 10_000);
    const events = repo.findByTimeRange(from, to);
    expect(events).toHaveLength(2);

    // A time range in the past should return nothing
    const pastFrom = new Date(Date.now() - 100_000);
    const pastTo = new Date(Date.now() - 90_000);
    expect(repo.findByTimeRange(pastFrom, pastTo)).toHaveLength(0);
  });

  /** @why AuditEvent is insert-only — no update or delete methods should exist. */
  it("does not expose update or delete methods", () => {
    const repoObj = repo as Record<string, unknown>;
    expect(repoObj["update"]).toBeUndefined();
    expect(repoObj["delete"]).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18. PolicySet Repository
// ═══════════════════════════════════════════════════════════════════════════

describe("PolicySet repository", () => {
  let db: BetterSQLite3Database;
  let sqlite: InstanceType<typeof Database>;
  let repo: ReturnType<typeof createPolicySetRepository>;

  beforeEach(() => {
    ({ db, sqlite } = openTestDb());
    repo = createPolicySetRepository(db);
  });
  afterEach(() => sqlite.close());

  /** @why Basic insert. */
  it("create inserts a row and returns it", () => {
    const data = makePolicySet();
    const row = repo.create(data as never);
    expect(row.policySetId).toBe(data.policySetId);
    expect(row.version).toBe("1.0.0");
  });

  /** @why Primary lookup. */
  it("findById returns the row or undefined", () => {
    const created = repo.create(makePolicySet() as never);
    expect(repo.findById(created.policySetId)).toBeDefined();
    expect(repo.findById(randomUUID())).toBeUndefined();
  });

  /** @why Pagination. */
  it("findAll respects limit/offset", () => {
    repo.create(makePolicySet() as never);
    repo.create(makePolicySet() as never);
    expect(repo.findAll()).toHaveLength(2);
    expect(repo.findAll({ limit: 1 })).toHaveLength(1);
  });

  /** @why Update path. */
  it("update modifies fields", () => {
    const created = repo.create(makePolicySet() as never);
    const updated = repo.update(created.policySetId, { version: "2.0.0" });
    expect(updated?.version).toBe("2.0.0");
  });

  /** @why Delete contract. */
  it("delete removes a row", () => {
    const created = repo.create(makePolicySet() as never);
    expect(repo.delete(created.policySetId)).toBe(true);
    expect(repo.delete(randomUUID())).toBe(false);
  });

  /** @why findByName returns all versions of a policy set by name. */
  it("findByName returns policy sets matching the name", () => {
    repo.create(makePolicySet({ name: "default", version: "1.0.0" }) as never);
    repo.create(makePolicySet({ name: "default", version: "2.0.0" }) as never);
    repo.create(makePolicySet({ name: "custom" }) as never);
    expect(repo.findByName("default")).toHaveLength(2);
    expect(repo.findByName("custom")).toHaveLength(1);
    expect(repo.findByName("nonexistent")).toHaveLength(0);
  });
});
