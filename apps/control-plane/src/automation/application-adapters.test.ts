/**
 * Unit tests for the createWorkerDispatchUnitOfWork adapter factory.
 *
 * These tests validate that the worker dispatch unit-of-work adapter correctly
 * bridges infrastructure database repositories to the WorkerDispatchUnitOfWork
 * port interface. They ensure correct context resolution from DB entities,
 * proper null handling for missing/terminal tasks, and correct construction
 * of the WorkerSpawnContext.
 *
 * @see {@link file://docs/backlog/tasks/T134-worker-dispatch-adapter.md}
 * @module
 */
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";

import { TaskStatus, WorkerLeaseStatus } from "@factory/domain";
import { VersionConflictError } from "@factory/application";
import { createTestDatabase, type TestDatabaseConnection } from "@factory/testing";

import {
  createWorkerDispatchUnitOfWork,
  createWorkerSupervisorUnitOfWork,
  createHeartbeatUnitOfWork,
} from "./application-adapters.js";

const MIGRATIONS_FOLDER = resolve(import.meta.dirname, "../../drizzle");

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

function seedProjectAndRepository(
  conn: TestDatabaseConnection,
  overrides?: { remoteUrl?: string },
): {
  projectId: string;
  repositoryId: string;
} {
  const projectId = `proj-${crypto.randomUUID().slice(0, 8)}`;
  const repositoryId = `repo-${crypto.randomUUID().slice(0, 8)}`;

  conn.sqlite
    .prepare(
      `INSERT INTO project (project_id, name, owner)
       VALUES (?, ?, ?)`,
    )
    .run(projectId, `project-${projectId}`, "dispatch-test");

  conn.sqlite
    .prepare(
      `INSERT INTO repository (repository_id, project_id, name, remote_url, default_branch, local_checkout_strategy, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      repositoryId,
      projectId,
      "test-repo",
      overrides?.remoteUrl ?? "file:///tmp/test-repo",
      "main",
      "worktree",
      "ACTIVE",
    );

  return { projectId, repositoryId };
}

function seedTask(
  conn: TestDatabaseConnection,
  repositoryId: string,
  overrides?: {
    taskId?: string;
    status?: string;
    taskType?: string;
    title?: string;
    priority?: string;
    branchName?: string;
    acceptanceCriteria?: string[];
    definitionOfDone?: string[];
    suggestedFileScope?: string[];
  },
): string {
  const taskId = overrides?.taskId ?? `task-${crypto.randomUUID().slice(0, 8)}`;

  conn.sqlite
    .prepare(
      `INSERT INTO task (task_id, repository_id, title, task_type, priority, status, source, version,
        required_capabilities, acceptance_criteria, definition_of_done, suggested_file_scope, branch_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      taskId,
      repositoryId,
      overrides?.title ?? `task-${taskId}`,
      overrides?.taskType ?? "feature",
      overrides?.priority ?? "high",
      overrides?.status ?? TaskStatus.ASSIGNED,
      "manual",
      1,
      JSON.stringify(["typescript"]),
      JSON.stringify(overrides?.acceptanceCriteria ?? ["criteria-1"]),
      JSON.stringify(overrides?.definitionOfDone ?? ["dod-1"]),
      JSON.stringify(overrides?.suggestedFileScope ?? ["src/**/*.ts"]),
      overrides?.branchName ?? null,
    );

  return taskId;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createWorkerDispatchUnitOfWork", () => {
  let conn: TestDatabaseConnection;

  afterEach(() => {
    conn?.close();
  });

  /**
   * Validates that resolveSpawnContext returns a complete WorkerSpawnContext
   * when the task and repository exist and the task is in a dispatchable
   * state (ASSIGNED). This is the primary success path — the dispatch service
   * depends on receiving a non-null context to proceed with worker spawning.
   */
  it("resolves spawn context for an existing task in dispatchable state", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const { repositoryId } = seedProjectAndRepository(conn, {
      remoteUrl: "file:///repos/my-project",
    });
    const taskId = seedTask(conn, repositoryId, {
      status: TaskStatus.ASSIGNED,
      taskType: "feature",
      title: "Implement login page",
      priority: "high",
      branchName: "feat/login",
      acceptanceCriteria: ["Login form renders", "JWT token stored"],
      definitionOfDone: ["Tests pass", "Code reviewed"],
      suggestedFileScope: ["src/auth/**"],
    });

    const uow = createWorkerDispatchUnitOfWork(conn);
    const result = uow.runInTransaction((repos) => repos.dispatch.resolveSpawnContext(taskId));

    expect(result).not.toBeNull();
    expect(result!.repoPath).toBe("file:///repos/my-project");
    expect(result!.workerName).toBe(`worker-${taskId}`);

    // Task packet should contain all task metadata
    const packet = result!.runContext.taskPacket;
    expect(packet.task_id).toBe(taskId);
    const task = packet.task as Record<string, unknown>;
    expect(task.title).toBe("Implement login page");
    expect(task.task_type).toBe("feature");
    expect(task.priority).toBe("high");
    expect(task.branch_name).toBe("feat/login");
    expect(task.acceptance_criteria).toEqual(["Login form renders", "JWT token stored"]);
    expect(task.definition_of_done).toEqual(["Tests pass", "Code reviewed"]);
    expect(task.suggested_file_scope).toEqual(["src/auth/**"]);

    // Workspace paths should be task-scoped
    const paths = result!.runContext.workspacePaths;
    expect(paths.worktreePath).toContain(taskId);
    expect(paths.artifactRoot).toContain(taskId);
    expect(paths.packetInputPath).toContain(taskId);
    expect(paths.policySnapshotPath).toContain(taskId);

    // Timeout settings should have sensible defaults
    const timeout = result!.runContext.timeoutSettings;
    expect(timeout.timeBudgetSeconds).toBeGreaterThan(0);
    expect(timeout.heartbeatIntervalSeconds).toBeGreaterThan(0);
    expect(timeout.missedHeartbeatThreshold).toBeGreaterThan(0);
    expect(timeout.gracePeriodSeconds).toBeGreaterThan(0);
    expect(timeout.expiresAt).toBeTruthy();

    // Output schema should map feature to development_result
    expect(result!.runContext.outputSchemaExpectation.packetType).toBe("development_result");
    expect(result!.runContext.outputSchemaExpectation.schemaVersion).toBe("1.0.0");

    // Policy snapshot is empty until policy infrastructure is wired
    expect(result!.runContext.effectivePolicySnapshot).toEqual({});
  });

  /**
   * Validates that resolveSpawnContext returns null for a nonexistent task ID.
   * This prevents the dispatch service from attempting to spawn a worker for
   * a task that does not exist — it should gracefully fail the dispatch job.
   */
  it("returns null when the task does not exist", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });

    const uow = createWorkerDispatchUnitOfWork(conn);
    const result = uow.runInTransaction((repos) =>
      repos.dispatch.resolveSpawnContext("nonexistent-task-id"),
    );

    expect(result).toBeNull();
  });

  /**
   * Validates that resolveSpawnContext returns null when the task's repository
   * is missing from the database. This simulates an orphaned task whose
   * repository reference is dangling. The dispatch service should not attempt
   * to spawn a worker without knowing where the source code lives.
   */
  it("returns null when the task's repository does not exist", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    // Insert a task with a repository ID that does not exist in the DB.
    // We must disable FK checks to create this orphaned state.
    conn.sqlite.pragma("foreign_keys = OFF");
    const orphanedRepoId = `repo-orphan-${crypto.randomUUID().slice(0, 8)}`;
    const taskId = seedTask(conn, orphanedRepoId, { status: TaskStatus.ASSIGNED });
    conn.sqlite.pragma("foreign_keys = ON");

    const uow = createWorkerDispatchUnitOfWork(conn);
    const result = uow.runInTransaction((repos) => repos.dispatch.resolveSpawnContext(taskId));

    expect(result).toBeNull();
  });

  /**
   * Validates that resolveSpawnContext returns null for tasks in terminal
   * states (DONE, FAILED, CANCELLED). Terminal tasks should never be
   * dispatched to workers — they have already reached their final outcome.
   */
  it.each([TaskStatus.DONE, TaskStatus.FAILED, TaskStatus.CANCELLED])(
    "returns null for task in terminal state: %s",
    (terminalStatus) => {
      conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
      const { repositoryId } = seedProjectAndRepository(conn);
      const taskId = seedTask(conn, repositoryId, { status: terminalStatus });

      const uow = createWorkerDispatchUnitOfWork(conn);
      const result = uow.runInTransaction((repos) => repos.dispatch.resolveSpawnContext(taskId));

      expect(result).toBeNull();
    },
  );

  /**
   * Validates that resolveSpawnContext succeeds for the IN_DEVELOPMENT state.
   * Tasks in IN_DEVELOPMENT may need re-dispatch (e.g., after a lease expires
   * and a retry is scheduled). The adapter should not reject non-terminal states.
   */
  it("resolves context for a task in IN_DEVELOPMENT state", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const { repositoryId } = seedProjectAndRepository(conn);
    const taskId = seedTask(conn, repositoryId, { status: TaskStatus.IN_DEVELOPMENT });

    const uow = createWorkerDispatchUnitOfWork(conn);
    const result = uow.runInTransaction((repos) => repos.dispatch.resolveSpawnContext(taskId));

    expect(result).not.toBeNull();
    expect(result!.runContext.taskPacket.task_id).toBe(taskId);
  });

  /**
   * Validates that the output schema expectation correctly maps different
   * task types to their expected packet types. This ensures the worker
   * supervisor can validate output against the correct schema.
   */
  it.each([
    ["feature", "development_result"],
    ["bug_fix", "development_result"],
    ["refactor", "development_result"],
    ["chore", "development_result"],
    ["documentation", "documentation_result"],
    ["test", "test_result"],
    ["spike", "spike_result"],
  ] as const)("maps task type '%s' to packet type '%s'", (taskType, expectedPacketType) => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const { repositoryId } = seedProjectAndRepository(conn);
    const taskId = seedTask(conn, repositoryId, {
      status: TaskStatus.ASSIGNED,
      taskType,
    });

    const uow = createWorkerDispatchUnitOfWork(conn);
    const result = uow.runInTransaction((repos) => repos.dispatch.resolveSpawnContext(taskId));

    expect(result).not.toBeNull();
    expect(result!.runContext.outputSchemaExpectation.packetType).toBe(expectedPacketType);
  });

  /**
   * Validates that the worker name is derived from the task ID. This provides
   * a unique, traceable identifier for each worker in logs and diagnostics.
   */
  it("derives worker name from task ID", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const { repositoryId } = seedProjectAndRepository(conn);
    const taskId = seedTask(conn, repositoryId, {
      taskId: "task-abc-123",
      status: TaskStatus.ASSIGNED,
    });

    const uow = createWorkerDispatchUnitOfWork(conn);
    const result = uow.runInTransaction((repos) => repos.dispatch.resolveSpawnContext(taskId));

    expect(result).not.toBeNull();
    expect(result!.workerName).toBe("worker-task-abc-123");
  });

  /**
   * Validates that the repoPath is set to the repository's remoteUrl.
   * The workspace manager will use this to provision a worktree. This
   * confirms the adapter correctly traverses task → repository.
   */
  it("uses repository remoteUrl as repoPath", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const { repositoryId } = seedProjectAndRepository(conn, {
      remoteUrl: "https://github.com/org/my-repo.git",
    });
    const taskId = seedTask(conn, repositoryId, { status: TaskStatus.ASSIGNED });

    const uow = createWorkerDispatchUnitOfWork(conn);
    const result = uow.runInTransaction((repos) => repos.dispatch.resolveSpawnContext(taskId));

    expect(result).not.toBeNull();
    expect(result!.repoPath).toBe("https://github.com/org/my-repo.git");
  });

  /**
   * Validates that JSON array fields in the task (acceptanceCriteria,
   * definitionOfDone, requiredCapabilities, suggestedFileScope) are
   * correctly deserialized into string arrays in the task packet.
   * This ensures the worker receives structured data, not raw JSON strings.
   */
  it("deserializes JSON array fields into the task packet", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const { repositoryId } = seedProjectAndRepository(conn);
    const taskId = seedTask(conn, repositoryId, {
      status: TaskStatus.ASSIGNED,
      acceptanceCriteria: ["AC1", "AC2"],
      definitionOfDone: ["DoD1"],
      suggestedFileScope: ["src/**/*.ts", "lib/**"],
    });

    const uow = createWorkerDispatchUnitOfWork(conn);
    const result = uow.runInTransaction((repos) => repos.dispatch.resolveSpawnContext(taskId));

    expect(result).not.toBeNull();
    const packet = result!.runContext.taskPacket;
    const taskData = packet.task as Record<string, unknown>;
    expect(taskData.acceptance_criteria).toEqual(["AC1", "AC2"]);
    expect(taskData.definition_of_done).toEqual(["DoD1"]);
    expect(taskData.suggested_file_scope).toEqual(["src/**/*.ts", "lib/**"]);
    expect(taskData.required_capabilities).toEqual(["typescript"]);
  });
});

// ---------------------------------------------------------------------------
// Worker Supervisor UoW tests
// ---------------------------------------------------------------------------

/**
 * Seed helpers for worker supervisor tests. Workers have a FK to worker_pool.
 */
function seedWorkerPool(conn: TestDatabaseConnection): string {
  const poolId = `pool-${crypto.randomUUID().slice(0, 8)}`;
  conn.sqlite
    .prepare(
      `INSERT INTO worker_pool (worker_pool_id, name, pool_type, max_concurrency, enabled, capabilities, default_timeout_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(poolId, "test-pool", "developer", 2, 1, JSON.stringify(["typescript"]), 600);
  return poolId;
}

describe("createWorkerSupervisorUnitOfWork", () => {
  let conn: TestDatabaseConnection;

  afterEach(() => {
    conn?.close();
  });

  /**
   * Validates the create path: the supervisor creates a worker record when
   * spawning a new ephemeral worker process. The returned SupervisedWorker
   * must have all fields set correctly, especially the status cast to the
   * domain-level WorkerEntityStatus enum.
   */
  it("creates a worker and returns a SupervisedWorker", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const poolId = seedWorkerPool(conn);
    const { repositoryId } = seedProjectAndRepository(conn);
    const taskId = seedTask(conn, repositoryId, { status: "ASSIGNED" });

    const uow = createWorkerSupervisorUnitOfWork(conn);
    const result = uow.runInTransaction((repos) =>
      repos.worker.create({
        workerId: "w-001",
        poolId,
        name: "test-worker-001",
        status: "provisioning",
        currentTaskId: taskId,
      }),
    );

    expect(result).toMatchObject({
      workerId: "w-001",
      poolId,
      name: "test-worker-001",
      status: "provisioning",
      currentTaskId: taskId,
    });
  });

  /**
   * Validates findById returns the correct worker when it exists.
   * This is critical for the supervisor's spawn lifecycle where it
   * reads back the worker to check its status.
   */
  it("finds an existing worker by ID", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const poolId = seedWorkerPool(conn);
    const { repositoryId } = seedProjectAndRepository(conn);
    const taskId = seedTask(conn, repositoryId, { status: "ASSIGNED" });

    const uow = createWorkerSupervisorUnitOfWork(conn);
    uow.runInTransaction((repos) =>
      repos.worker.create({
        workerId: "w-find",
        poolId,
        name: "findable",
        status: "provisioning",
        currentTaskId: taskId,
      }),
    );

    const found = uow.runInTransaction((repos) => repos.worker.findById("w-find"));
    expect(found).toBeDefined();
    expect(found!.workerId).toBe("w-find");
    expect(found!.name).toBe("findable");
  });

  /**
   * Validates findById returns undefined for a non-existent worker ID.
   * The supervisor must handle this gracefully when a worker disappears.
   */
  it("returns undefined for non-existent worker", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });

    const uow = createWorkerSupervisorUnitOfWork(conn);
    const result = uow.runInTransaction((repos) => repos.worker.findById("no-such-worker"));
    expect(result).toBeUndefined();
  });

  /**
   * Validates the update path: the supervisor updates worker status when
   * the worker transitions through its lifecycle (provisioning → running →
   * completed). The update must return the full updated entity.
   */
  it("updates an existing worker and returns updated entity", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const poolId = seedWorkerPool(conn);
    const { repositoryId } = seedProjectAndRepository(conn);
    const taskId = seedTask(conn, repositoryId, { status: "ASSIGNED" });

    const uow = createWorkerSupervisorUnitOfWork(conn);
    uow.runInTransaction((repos) =>
      repos.worker.create({
        workerId: "w-update",
        poolId,
        name: "updatable",
        status: "provisioning",
        currentTaskId: taskId,
      }),
    );

    const updated = uow.runInTransaction((repos) =>
      repos.worker.update("w-update", {
        status: "running",
        currentRunId: "run-123",
      }),
    );

    expect(updated.status).toBe("running");
    expect(updated.currentRunId).toBe("run-123");
    expect(updated.workerId).toBe("w-update");
  });

  /**
   * Validates that updating a non-existent worker throws VersionConflictError.
   * This prevents silent failures when the supervisor tries to update a
   * worker that was already cleaned up.
   */
  it("throws VersionConflictError when updating non-existent worker", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });

    const uow = createWorkerSupervisorUnitOfWork(conn);
    expect(() =>
      uow.runInTransaction((repos) => repos.worker.update("ghost", { status: "running" })),
    ).toThrow(VersionConflictError);
  });
});

// ---------------------------------------------------------------------------
// Heartbeat UoW tests
// ---------------------------------------------------------------------------

/**
 * Seed helpers for heartbeat tests. Leases require a task which requires
 * a project/repository.
 */
function seedLeaseForHeartbeat(
  conn: TestDatabaseConnection,
  overrides?: {
    leaseId?: string;
    status?: string;
    heartbeatAt?: number | null;
    expiresAt?: number;
    leasedAt?: number;
  },
): { leaseId: string; taskId: string } {
  // Seed project & repository if not present (idempotent via IGNORE)
  conn.sqlite
    .prepare(
      `INSERT OR IGNORE INTO project (project_id, name, owner) VALUES ('hb-proj', 'hb-project', 'heartbeat-test')`,
    )
    .run();
  conn.sqlite
    .prepare(
      `INSERT OR IGNORE INTO repository (repository_id, project_id, name, remote_url, default_branch, local_checkout_strategy, status)
       VALUES ('hb-repo', 'hb-proj', 'hb-repo', 'file:///tmp/hb', 'main', 'worktree', 'ACTIVE')`,
    )
    .run();

  const taskId = `hb-task-${crypto.randomUUID().slice(0, 8)}`;
  conn.sqlite
    .prepare(
      `INSERT INTO task (task_id, repository_id, title, task_type, priority, status, source, version,
        required_capabilities, acceptance_criteria, definition_of_done, suggested_file_scope)
       VALUES (?, 'hb-repo', 'heartbeat-task', 'feature', 'high', 'IN_DEVELOPMENT', 'manual', 1,
        '["typescript"]', '["ac"]', '["dod"]', '["src/**"]')`,
    )
    .run(taskId);

  // Seed worker pool + worker for the lease FK
  conn.sqlite
    .prepare(
      `INSERT OR IGNORE INTO worker_pool (worker_pool_id, name, pool_type, max_concurrency, enabled, capabilities, default_timeout_sec)
       VALUES ('hb-pool', 'hb-pool', 'developer', 2, 1, '["typescript"]', 600)`,
    )
    .run();
  conn.sqlite
    .prepare(
      `INSERT OR IGNORE INTO worker (worker_id, pool_id, name, status) VALUES ('hb-worker', 'hb-pool', 'hb-worker', 'running')`,
    )
    .run();

  const leaseId = overrides?.leaseId ?? `lease-${crypto.randomUUID().slice(0, 8)}`;
  const now = Math.floor(Date.now() / 1000);
  conn.sqlite
    .prepare(
      `INSERT INTO task_lease (lease_id, task_id, worker_id, pool_id, status, heartbeat_at, expires_at, leased_at)
       VALUES (?, ?, 'hb-worker', 'hb-pool', ?, ?, ?, ?)`,
    )
    .run(
      leaseId,
      taskId,
      overrides?.status ?? WorkerLeaseStatus.HEARTBEATING,
      overrides?.heartbeatAt ?? now,
      overrides?.expiresAt ?? now + 600,
      overrides?.leasedAt ?? now,
    );

  return { leaseId, taskId };
}

describe("createHeartbeatUnitOfWork", () => {
  let conn: TestDatabaseConnection;

  afterEach(() => {
    conn?.close();
  });

  /**
   * Validates findById returns a properly mapped HeartbeatableLease
   * with all fields including correct Date conversions from epoch seconds.
   * The heartbeat service depends on reading back the current lease state
   * before processing a heartbeat.
   */
  it("findById returns mapped HeartbeatableLease", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const { leaseId } = seedLeaseForHeartbeat(conn);

    const uow = createHeartbeatUnitOfWork(conn);
    const result = uow.runInTransaction((repos) => repos.lease.findById(leaseId));

    expect(result).toBeDefined();
    expect(result!.leaseId).toBe(leaseId);
    expect(result!.status).toBe(WorkerLeaseStatus.HEARTBEATING);
    expect(result!.heartbeatAt).toBeInstanceOf(Date);
    expect(result!.expiresAt).toBeInstanceOf(Date);
    expect(result!.leasedAt).toBeInstanceOf(Date);
  });

  /**
   * Validates findById returns undefined for non-existent leases.
   * The heartbeat service must handle missing leases gracefully.
   */
  it("findById returns undefined for non-existent lease", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });

    const uow = createHeartbeatUnitOfWork(conn);
    const result = uow.runInTransaction((repos) => repos.lease.findById("no-such-lease"));
    expect(result).toBeUndefined();
  });

  /**
   * Validates updateHeartbeat correctly updates the lease status and heartbeat
   * timestamp, and optionally the expiresAt. This is the core heartbeat
   * processing operation — the lease is atomically transitioned and the
   * heartbeat time recorded.
   */
  it("updateHeartbeat transitions lease status and updates timestamps", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const { leaseId } = seedLeaseForHeartbeat(conn, {
      status: WorkerLeaseStatus.RUNNING,
    });

    const uow = createHeartbeatUnitOfWork(conn);
    const newHeartbeat = new Date();
    const newExpiry = new Date(Date.now() + 300_000);

    const result = uow.runInTransaction((repos) =>
      repos.lease.updateHeartbeat(
        leaseId,
        WorkerLeaseStatus.RUNNING,
        WorkerLeaseStatus.HEARTBEATING,
        newHeartbeat,
        newExpiry,
      ),
    );

    expect(result.leaseId).toBe(leaseId);
    expect(result.status).toBe(WorkerLeaseStatus.HEARTBEATING);
  });

  /**
   * Validates optimistic concurrency: updateHeartbeat throws VersionConflictError
   * when the current lease status doesn't match the expected status. This
   * prevents concurrent heartbeat processors from corrupting lease state.
   */
  it("updateHeartbeat throws VersionConflictError on status mismatch", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const { leaseId } = seedLeaseForHeartbeat(conn, {
      status: WorkerLeaseStatus.HEARTBEATING,
    });

    const uow = createHeartbeatUnitOfWork(conn);
    expect(() =>
      uow.runInTransaction((repos) =>
        repos.lease.updateHeartbeat(
          leaseId,
          WorkerLeaseStatus.RUNNING, // wrong expected status
          WorkerLeaseStatus.HEARTBEATING,
          new Date(),
        ),
      ),
    ).toThrow(VersionConflictError);
  });

  /**
   * Validates findStaleLeases returns leases that have missed their
   * heartbeat deadline. This drives the lease recovery mechanism —
   * stale leases are candidates for reclaim by the reconciliation loop.
   */
  it("findStaleLeases returns heartbeat-stale leases", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });

    const pastTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const futureTime = Math.floor(Date.now() / 1000) + 3600;

    const { leaseId } = seedLeaseForHeartbeat(conn, {
      status: WorkerLeaseStatus.HEARTBEATING,
      heartbeatAt: pastTime,
      expiresAt: futureTime, // not TTL-expired
    });

    const uow = createHeartbeatUnitOfWork(conn);
    // Heartbeat deadline = now (past heartbeat should be detected)
    // TTL deadline = far past (should not match since lease hasn't expired)
    const heartbeatDeadline = new Date();
    const ttlDeadline = new Date(0);

    const stale = uow.runInTransaction((repos) =>
      repos.lease.findStaleLeases(heartbeatDeadline, ttlDeadline),
    );

    expect(stale.length).toBeGreaterThanOrEqual(1);
    const found = stale.find((s) => s.leaseId === leaseId);
    expect(found).toBeDefined();
    expect(found!.status).toBe(WorkerLeaseStatus.HEARTBEATING);
  });

  /**
   * Validates findStaleLeases returns TTL-expired leases (leases past
   * their expiresAt timestamp). Even if heartbeat is recent, an expired
   * lease should be reclaimed.
   */
  it("findStaleLeases returns TTL-expired leases", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });

    const now = Math.floor(Date.now() / 1000);
    const { leaseId } = seedLeaseForHeartbeat(conn, {
      status: WorkerLeaseStatus.LEASED,
      heartbeatAt: null,
      expiresAt: now - 100, // expired 100s ago
    });

    const uow = createHeartbeatUnitOfWork(conn);
    const heartbeatDeadline = new Date(0); // won't match heartbeat check
    const ttlDeadline = new Date(); // now — expired leases should be caught

    const stale = uow.runInTransaction((repos) =>
      repos.lease.findStaleLeases(heartbeatDeadline, ttlDeadline),
    );

    const found = stale.find((s) => s.leaseId === leaseId);
    expect(found).toBeDefined();
    expect(found!.status).toBe(WorkerLeaseStatus.LEASED);
  });

  /**
   * Validates that the auditEvent port is provided to the transaction.
   * The heartbeat service creates audit events when processing heartbeats,
   * so this port must be available in the transaction repositories.
   */
  it("provides auditEvent port in transaction repositories", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });

    const uow = createHeartbeatUnitOfWork(conn);
    const hasAuditEvent = uow.runInTransaction((repos) => {
      return typeof repos.auditEvent.create === "function";
    });

    expect(hasAuditEvent).toBe(true);
  });
});
