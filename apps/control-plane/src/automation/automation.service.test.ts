import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";

import type { DomainEventEmitter } from "@factory/application";
import { JobType, TaskStatus } from "@factory/domain";
import { createTestDatabase, type TestDatabaseConnection } from "@factory/testing";

import { createJobRepository } from "../infrastructure/repositories/job.repository.js";
import { createTaskDependencyRepository } from "../infrastructure/repositories/task-dependency.repository.js";
import { createTaskLeaseRepository } from "../infrastructure/repositories/task-lease.repository.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import { AutomationService } from "./automation.service.js";

const MIGRATIONS_FOLDER = resolve(import.meta.dirname, "../../drizzle");

function createEmitter(): DomainEventEmitter {
  return {
    emit: vi.fn(),
  };
}

function seedProjectAndRepository(conn: TestDatabaseConnection): {
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
    .run(projectId, `project-${projectId}`, "automation-test");

  conn.sqlite
    .prepare(
      `INSERT INTO repository (repository_id, project_id, name, remote_url, default_branch, local_checkout_strategy, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      repositoryId,
      projectId,
      "repo-under-test",
      "file:///tmp/repo-under-test",
      "main",
      "worktree",
      "ACTIVE",
    );

  return { projectId, repositoryId };
}

function seedDeveloperPool(conn: TestDatabaseConnection): string {
  const poolId = `pool-${crypto.randomUUID().slice(0, 8)}`;

  conn.sqlite
    .prepare(
      `INSERT INTO worker_pool (worker_pool_id, name, pool_type, max_concurrency, enabled, capabilities, default_timeout_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(poolId, "developer-pool", "developer", 2, 1, JSON.stringify(["typescript"]), 600);

  return poolId;
}

function seedTask(
  conn: TestDatabaseConnection,
  repositoryId: string,
  status: string = "BACKLOG",
): string {
  const taskId = `task-${crypto.randomUUID().slice(0, 8)}`;

  conn.sqlite
    .prepare(
      `INSERT INTO task (task_id, repository_id, title, task_type, priority, status, source, version, required_capabilities)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      taskId,
      repositoryId,
      `task-${taskId}`,
      "feature",
      "high",
      status,
      "manual",
      1,
      JSON.stringify(["typescript"]),
    );

  return taskId;
}

describe("AutomationService", () => {
  let conn: TestDatabaseConnection;

  afterEach(() => {
    conn?.close();
  });

  it("reconciles backlog tasks into READY and schedules them", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const { repositoryId } = seedProjectAndRepository(conn);
    seedDeveloperPool(conn);
    const taskId = seedTask(conn, repositoryId, "BACKLOG");

    const service = new AutomationService(conn, createEmitter());

    const readinessResult = service.reconcileTaskReadiness();
    expect(readinessResult.transitionedToReady).toBe(1);

    const initResult = service.initializeSchedulerTick();
    expect(initResult.created).toBe(true);

    const tickResult = service.processSchedulerTick();
    expect(tickResult.processed).toBe(true);
    if (tickResult.processed) {
      expect(tickResult.summary.assignmentCount).toBe(1);
    }

    const taskRepo = createTaskRepository(conn.db);
    const leaseRepo = createTaskLeaseRepository(conn.db);
    const jobRepo = createJobRepository(conn.db);

    const task = taskRepo.findById(taskId);
    expect(task?.status).toBe(TaskStatus.ASSIGNED);
    expect(task?.currentLeaseId).toBeTruthy();
    expect(leaseRepo.findActiveByTaskId(taskId)?.status).toBe("LEASED");

    const dispatchJobs = jobRepo
      .findByStatus("pending")
      .filter((job) => job.jobType === JobType.WORKER_DISPATCH);
    expect(dispatchJobs).toHaveLength(1);
    expect(dispatchJobs[0]?.entityId).toBe(taskId);
  });

  it("moves blocked backlog tasks into BLOCKED when hard dependencies remain", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const { repositoryId } = seedProjectAndRepository(conn);
    const dependencyTaskId = seedTask(conn, repositoryId, "BACKLOG");
    const dependentTaskId = seedTask(conn, repositoryId, "BACKLOG");

    const dependencyRepo = createTaskDependencyRepository(conn.db);
    dependencyRepo.create({
      taskDependencyId: `dep-${crypto.randomUUID().slice(0, 8)}`,
      taskId: dependentTaskId,
      dependsOnTaskId: dependencyTaskId,
      dependencyType: "blocks",
      isHardBlock: 1,
    });

    const service = new AutomationService(conn, createEmitter());
    const result = service.reconcileTaskReadiness();

    expect(result.transitionedToBlocked).toBe(1);

    const taskRepo = createTaskRepository(conn.db);
    expect(taskRepo.findById(dependentTaskId)?.status).toBe(TaskStatus.BLOCKED);
  });
});
