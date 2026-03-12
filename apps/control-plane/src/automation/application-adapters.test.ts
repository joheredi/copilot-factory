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

import { TaskStatus } from "@factory/domain";
import { createTestDatabase, type TestDatabaseConnection } from "@factory/testing";

import { createWorkerDispatchUnitOfWork } from "./application-adapters.js";

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
    expect(packet.taskId).toBe(taskId);
    expect(packet.title).toBe("Implement login page");
    expect(packet.taskType).toBe("feature");
    expect(packet.priority).toBe("high");
    expect(packet.branchName).toBe("feat/login");
    expect(packet.acceptanceCriteria).toEqual(["Login form renders", "JWT token stored"]);
    expect(packet.definitionOfDone).toEqual(["Tests pass", "Code reviewed"]);
    expect(packet.suggestedFileScope).toEqual(["src/auth/**"]);

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
    expect(result!.runContext.taskPacket.taskId).toBe(taskId);
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
    expect(packet.acceptanceCriteria).toEqual(["AC1", "AC2"]);
    expect(packet.definitionOfDone).toEqual(["DoD1"]);
    expect(packet.suggestedFileScope).toEqual(["src/**/*.ts", "lib/**"]);
    expect(packet.requiredCapabilities).toEqual(["typescript"]);
  });
});
