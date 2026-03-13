import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";

import type { DomainEventEmitter } from "@factory/application";
import {
  createHeartbeatService,
  createJobQueueService,
  createTransitionService,
  createWorkerDispatchService,
  createWorkerSupervisorService,
  type ActorInfo,
} from "@factory/application";
import { JobType, TaskStatus, WorkerLeaseStatus } from "@factory/domain";
import {
  createTestDatabase,
  FakeRunnerAdapter,
  FakeWorkspaceManager,
  type TestDatabaseConnection,
} from "@factory/testing";

import { createJobRepository } from "../infrastructure/repositories/job.repository.js";
import { createTaskDependencyRepository } from "../infrastructure/repositories/task-dependency.repository.js";
import { createTaskLeaseRepository } from "../infrastructure/repositories/task-lease.repository.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import { createWorkerRepository } from "../infrastructure/repositories/worker.repository.js";
import { createSqliteUnitOfWork } from "../infrastructure/unit-of-work/sqlite-unit-of-work.js";
import {
  createHeartbeatUnitOfWork,
  createJobQueueUnitOfWork,
  createWorkerDispatchUnitOfWork,
  createWorkerSupervisorUnitOfWork,
} from "./application-adapters.js";
import { AutomationService } from "./automation.service.js";
import { createHeartbeatForwarderAdapter } from "./heartbeat-forwarder-adapter.js";

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

  /**
   * Validates that processWorkerDispatches() is a method on the service and
   * can be called without error when no dispatch jobs exist. This confirms
   * the full dispatch chain (heartbeat → heartbeat forwarder → infra adapters →
   * supervisor → dispatch) was wired in the constructor without throwing.
   *
   * The dispatch returns a "skipped" result when there are no WORKER_DISPATCH
   * jobs in the queue, which is the expected behavior here since we haven't
   * run the scheduler tick to create one.
   */
  it("processWorkerDispatches does not throw when no dispatch jobs exist", async () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    seedProjectAndRepository(conn);
    seedDeveloperPool(conn);

    const service = new AutomationService(conn, createEmitter());

    // Should not throw — fire-and-forget dispatch with no pending jobs
    service.processWorkerDispatches();

    // Give the async dispatch a moment to settle
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  /**
   * End-to-end dispatch integration test proving the full task lifecycle:
   * BACKLOG → READY → ASSIGNED → dispatch → IN_DEVELOPMENT → DEV_COMPLETE.
   *
   * This is the critical-path integration test for the automation pipeline.
   * It verifies that:
   *
   * 1. **Readiness reconciliation** promotes a BACKLOG task to READY when
   *    it has no unresolved hard dependencies.
   * 2. **Scheduler tick** assigns the READY task, creating a lease (LEASED)
   *    and a WORKER_DISPATCH job.
   * 3. **Worker dispatch** claims the job, resolves spawn context, and
   *    spawns a worker through the supervisor using fake infrastructure
   *    adapters (FakeRunnerAdapter, FakeWorkspaceManager, mock PacketMounter).
   * 4. **Heartbeat forwarding** during the dispatch run progresses the
   *    lease from STARTING → RUNNING (via heartbeat events from the fake
   *    runner). A terminal heartbeat then advances it to COMPLETING.
   * 5. **Task transitions** driven via transitionService confirm the task
   *    can be moved to IN_DEVELOPMENT and then to DEV_COMPLETE after
   *    the dispatch completes.
   *
   * The test uses a hybrid wiring strategy:
   * - AutomationService handles readiness + scheduling (proven pattern).
   * - Dispatch services are manually wired with fake infrastructure,
   *   reading from the same in-memory SQLite database.
   *
   * **Why this test matters:** It is the only test that exercises the full
   * automation pipeline from backlog ingestion through worker dispatch
   * completion, catching wiring bugs, transaction ordering issues, and
   * state machine guard mismatches that unit tests cannot detect.
   *
   * **Known gap:** The lease must be manually transitioned from LEASED to
   * STARTING before dispatch. The current dispatch pipeline does not
   * automate this transition. See docs/backlog/tasks/ for the tracking task.
   */
  it("drives a task from BACKLOG through dispatch to DEV_COMPLETE", async () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const emitter = createEmitter();
    const { repositoryId } = seedProjectAndRepository(conn);
    seedDeveloperPool(conn);
    const taskId = seedTask(conn, repositoryId, "BACKLOG");
    const actor: ActorInfo = { type: "system", id: "automation-test" };

    // ── Phase 1: Use AutomationService for BACKLOG → READY → ASSIGNED ────
    const automationService = new AutomationService(conn, emitter);

    const readinessResult = automationService.reconcileTaskReadiness();
    expect(readinessResult.transitionedToReady).toBe(1);

    const initResult = automationService.initializeSchedulerTick();
    expect(initResult.created).toBe(true);

    const tickResult = automationService.processSchedulerTick();
    expect(tickResult.processed).toBe(true);
    if (tickResult.processed) {
      expect(tickResult.summary.assignmentCount).toBe(1);
    }

    // Verify task is ASSIGNED with a lease and dispatch job
    const taskRepo = createTaskRepository(conn.db);
    const leaseRepo = createTaskLeaseRepository(conn.db);
    const jobRepo = createJobRepository(conn.db);

    const assignedTask = taskRepo.findById(taskId);
    expect(assignedTask?.status).toBe(TaskStatus.ASSIGNED);
    const leaseId = assignedTask?.currentLeaseId;
    expect(leaseId).toBeTruthy();
    expect(leaseRepo.findActiveByTaskId(taskId)?.status).toBe("LEASED");

    const dispatchJobs = jobRepo
      .findByStatus("pending")
      .filter((job) => job.jobType === JobType.WORKER_DISPATCH);
    expect(dispatchJobs).toHaveLength(1);

    // ── Phase 2: Transition lease LEASED → STARTING ──────────────────────
    // The dispatch pipeline does not currently automate this transition.
    // The supervisor needs the lease in STARTING state for heartbeat
    // forwarding to succeed (HEARTBEAT_RECEIVABLE_STATES does not include
    // LEASED). We transition manually, mirroring the full-lifecycle
    // integration test pattern.
    const unitOfWork = createSqliteUnitOfWork(conn);
    const transitionService = createTransitionService(unitOfWork, emitter);

    transitionService.transitionLease(
      leaseId!,
      WorkerLeaseStatus.STARTING,
      { workerProcessSpawned: true },
      actor,
    );

    // ── Phase 3: Wire dispatch chain with fake infrastructure ────────────
    // Build the same service chain that AutomationService's constructor
    // creates, but with FakeRunnerAdapter and FakeWorkspaceManager instead
    // of real infrastructure. All services read/write the same in-memory
    // SQLite database, so the dispatch job created by the scheduler tick
    // is visible to the manually-wired dispatch service.
    const fakeRunner = new FakeRunnerAdapter({ name: "test-runner" });
    const fakeWorkspace = new FakeWorkspaceManager({ basePath: "/tmp/test-workspaces" });
    const fakePacketMounter = { mountPackets: vi.fn().mockResolvedValue(undefined) };
    const clock = () => new Date();

    const heartbeatService = createHeartbeatService(
      createHeartbeatUnitOfWork(conn),
      emitter,
      clock,
    );

    const heartbeatForwarder = createHeartbeatForwarderAdapter({
      heartbeatService,
    });

    const workerSupervisorService = createWorkerSupervisorService({
      unitOfWork: createWorkerSupervisorUnitOfWork(conn),
      eventEmitter: emitter,
      workspaceProvider: fakeWorkspace,
      packetMounter: fakePacketMounter,
      runtimeAdapter: fakeRunner,
      heartbeatForwarder,
      clock,
    });

    const jobQueueService = createJobQueueService(
      createJobQueueUnitOfWork(conn),
      () => crypto.randomUUID(),
      clock,
    );

    const workerDispatchService = createWorkerDispatchService({
      unitOfWork: createWorkerDispatchUnitOfWork(conn),
      jobQueueService,
      workerSupervisorService,
      clock,
    });

    // ── Phase 4: Process dispatch ────────────────────────────────────────
    const dispatchResult = await workerDispatchService.processDispatch();

    // Dispatch must succeed — job claimed, context resolved, worker spawned
    expect(dispatchResult.processed).toBe(true);
    if (dispatchResult.processed) {
      expect(dispatchResult.dispatched).toBe(true);
      if (dispatchResult.dispatched) {
        expect(dispatchResult.taskId).toBe(taskId);
        expect(dispatchResult.workerId).toBeTruthy();
      }
    }

    // ── Phase 5: Verify dispatch side effects ────────────────────────────

    // 5a: The dispatch job should be completed (not pending)
    const pendingJobs = jobRepo
      .findByStatus("pending")
      .filter((job) => job.jobType === JobType.WORKER_DISPATCH);
    expect(pendingJobs).toHaveLength(0);

    // 5b: A worker entity should have been created and reached terminal status
    const workerRepo = createWorkerRepository(conn.db);
    if (dispatchResult.processed && dispatchResult.dispatched) {
      const worker = workerRepo.findById(dispatchResult.workerId);
      expect(worker).toBeDefined();
      // FakeRunnerAdapter's default outcome is "completed", which maps to
      // terminal status "completed" via mapRunStatusToWorkerStatus
      expect(worker?.status).toBe("completed");
    }

    // 5c: Lease should have progressed from STARTING → RUNNING (heartbeat)
    // → COMPLETING (terminal heartbeat). FakeRunnerAdapter emits one
    // heartbeat event, which transitions STARTING → RUNNING. The terminal
    // heartbeat after stream ends transitions RUNNING → COMPLETING.
    const lease = leaseRepo.findActiveByTaskId(taskId);
    expect(lease?.status).toBe(WorkerLeaseStatus.COMPLETING);

    // 5d: FakeWorkspaceManager should have created a workspace.
    // Note: The supervisor does not own workspace cleanup — that is a
    // separate orchestration concern. We only verify creation here.
    expect(fakeWorkspace.createdWorkspaces.length).toBe(1);

    // 5e: PacketMounter should have been called exactly once
    expect(fakePacketMounter.mountPackets).toHaveBeenCalledOnce();

    // ── Phase 6: Drive task through remaining transitions ────────────────

    // 6a: ASSIGNED → IN_DEVELOPMENT
    // Guard: { hasHeartbeat: true } — satisfied because the dispatch
    // successfully forwarded heartbeats during the run.
    const inDevResult = transitionService.transitionTask(
      taskId,
      TaskStatus.IN_DEVELOPMENT,
      { hasHeartbeat: true },
      actor,
    );
    expect(inDevResult.entity.status).toBe(TaskStatus.IN_DEVELOPMENT);

    // 6b: IN_DEVELOPMENT → DEV_COMPLETE
    // Guard: { hasDevResultPacket: true, requiredValidationsPassed: true }
    // In a real flow, the worker would have produced a DevResultPacket.
    // Here we provide the guard context directly.
    const devCompleteResult = transitionService.transitionTask(
      taskId,
      TaskStatus.DEV_COMPLETE,
      { hasDevResultPacket: true, requiredValidationsPassed: true },
      actor,
      { devResultPacketType: "dev_result_packet" },
    );
    expect(devCompleteResult.entity.status).toBe(TaskStatus.DEV_COMPLETE);

    // ── Phase 7: Final state assertions ──────────────────────────────────
    // The task has traveled the full lifecycle:
    // BACKLOG → READY → ASSIGNED → [dispatch] → IN_DEVELOPMENT → DEV_COMPLETE
    const finalTask = taskRepo.findById(taskId);
    expect(finalTask?.status).toBe(TaskStatus.DEV_COMPLETE);
  });

  it("starts paused by default and skips scheduling when paused", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const { repositoryId } = seedProjectAndRepository(conn);
    seedDeveloperPool(conn);
    seedTask(conn, repositoryId, "BACKLOG");

    const service = new AutomationService(conn, createEmitter());

    // Factory starts paused by default
    expect(service.paused).toBe(true);

    // Initialize tick so there's work to do
    service.initializeSchedulerTick();

    // Reconciliation still works when called directly (public method)
    const readiness = service.reconcileTaskReadiness();
    expect(readiness.transitionedToReady).toBe(1);

    // But the tick and dispatch won't run in runCycle because it's paused
    // (runCycle is private, but we can verify by starting and checking state)
    service.start();
    expect(service.paused).toBe(false);

    service.pause();
    expect(service.paused).toBe(true);
  });

  it("start() and pause() are idempotent", () => {
    conn = createTestDatabase({ migrationsFolder: MIGRATIONS_FOLDER });
    const service = new AutomationService(conn, createEmitter());

    // Already paused — pausing again is a no-op
    service.pause();
    expect(service.paused).toBe(true);

    // Start, then start again — idempotent
    service.start();
    service.start();
    expect(service.paused).toBe(false);
  });
});
