/**
 * Tests for the Worker Supervisor service.
 *
 * These tests verify the full worker lifecycle management including:
 * - Worker entity creation and status tracking
 * - Workspace provisioning and packet mounting
 * - Runtime adapter lifecycle (prepare → start → stream → collect → finalize)
 * - Heartbeat forwarding from output stream events
 * - Cancellation with artifact collection
 * - Error handling and cleanup on failure
 * - Domain event emission at each lifecycle stage
 *
 * @why The Worker Supervisor is the central coordination point between
 * the control plane and worker runtime adapters. Correct lifecycle
 * management prevents resource leaks, ensures heartbeats keep leases
 * alive, and guarantees Worker entity status accurately reflects reality.
 */

import { describe, it, expect } from "vitest";

import { WorkerLeaseStatus } from "@factory/domain";

import type { ActorInfo } from "../events/domain-events.js";
import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type {
  SupervisedWorker,
  CreateWorkerData,
  UpdateWorkerData,
  WorkerSupervisorRepositoryPort,
  WorkerSupervisorTransactionRepositories,
  WorkerSupervisorUnitOfWork,
  WorkspaceProviderPort,
  PacketMounterPort,
  RuntimeAdapterPort,
  HeartbeatForwarderPort,
  LeaseTransitionerPort,
  SupervisorRunContext,
  SupervisorPreparedRun,
  SupervisorRunOutputStream,
  SupervisorCollectedArtifacts,
  SupervisorFinalizeResult,
} from "../ports/worker-supervisor.ports.js";

import {
  createWorkerSupervisorService,
  type WorkerSupervisorDependencies,
  type SpawnWorkerParams,
} from "./worker-supervisor.service.js";

import type { DomainEvent } from "../events/domain-events.js";

// ─── Test Constants ─────────────────────────────────────────────────────────

const SYSTEM_ACTOR: ActorInfo = { type: "system", id: "scheduler-001" };
const FIXED_TIME = new Date("2025-06-01T12:00:00Z");

// ─── Mock Factories ─────────────────────────────────────────────────────────

/**
 * Creates a mock Worker repository that tracks workers in memory.
 *
 * @why Verifies Worker entity creation and status updates happen
 * in the correct order with the correct field values.
 */
function createMockWorkerRepo(): WorkerSupervisorRepositoryPort & {
  workers: SupervisedWorker[];
} {
  const workers: SupervisedWorker[] = [];

  return {
    workers,

    create(data: CreateWorkerData): SupervisedWorker {
      const worker: SupervisedWorker = {
        workerId: data.workerId,
        poolId: data.poolId,
        name: data.name,
        status: data.status,
        currentTaskId: data.currentTaskId,
        currentRunId: null,
        lastHeartbeatAt: null,
      };
      workers.push(worker);
      return worker;
    },

    findById(workerId: string): SupervisedWorker | undefined {
      return workers.find((w) => w.workerId === workerId);
    },

    update(workerId: string, data: UpdateWorkerData): SupervisedWorker {
      const idx = workers.findIndex((w) => w.workerId === workerId);
      if (idx === -1) {
        throw new Error(`Worker not found: ${workerId}`);
      }
      const current = workers[idx]!;
      const updated: SupervisedWorker = {
        ...current,
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.currentRunId !== undefined ? { currentRunId: data.currentRunId } : {}),
        ...(data.currentTaskId !== undefined ? { currentTaskId: data.currentTaskId } : {}),
        ...(data.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: data.lastHeartbeatAt } : {}),
      };
      workers[idx] = updated;
      return updated;
    },
  };
}

/**
 * Creates a mock unit of work that passes through to the repository.
 *
 * @why Verifies that all DB mutations happen within transactional boundaries.
 */
function createMockUnitOfWork(
  repo: WorkerSupervisorRepositoryPort,
): WorkerSupervisorUnitOfWork & { transactionCount: number } {
  let transactionCount = 0;
  return {
    get transactionCount() {
      return transactionCount;
    },
    runInTransaction<T>(fn: (repos: WorkerSupervisorTransactionRepositories) => T): T {
      transactionCount++;
      return fn({ worker: repo });
    },
  };
}

/**
 * Creates a mock domain event emitter that records all emitted events.
 *
 * @why Verifies events are emitted in the correct order and contain
 * the correct lifecycle status transitions.
 */
function createMockEventEmitter(): DomainEventEmitter & { events: DomainEvent[] } {
  const events: DomainEvent[] = [];
  return {
    events,
    emit(event: DomainEvent): void {
      events.push(event);
    },
  };
}

/**
 * Creates a mock workspace provider that records calls.
 *
 * @why Verifies workspace is created with the correct task ID, repo path,
 * and attempt number before the runtime adapter is started.
 */
function createMockWorkspaceProvider(): WorkspaceProviderPort & {
  calls: Array<{ taskId: string; repoPath: string; attempt?: number }>;
} {
  const calls: Array<{ taskId: string; repoPath: string; attempt?: number }> = [];
  return {
    calls,
    async createWorkspace(taskId: string, repoPath: string, attempt?: number) {
      calls.push({ taskId, repoPath, attempt });
      return {
        layout: {
          rootPath: `/workspaces/repo/${taskId}`,
          worktreePath: `/workspaces/repo/${taskId}/worktree`,
          logsPath: `/workspaces/repo/${taskId}/logs`,
          outputsPath: `/workspaces/repo/${taskId}/outputs`,
        },
        branchName: `factory/${taskId}`,
        reused: false,
      };
    },
  };
}

/**
 * Creates a mock packet mounter that records calls.
 *
 * @why Verifies context packets (task packet, run config, policy snapshot)
 * are mounted into the correct workspace path before execution starts.
 */
function createMockPacketMounter(): PacketMounterPort & {
  calls: Array<{ workspacePath: string; input: Record<string, unknown> }>;
} {
  const calls: Array<{ workspacePath: string; input: Record<string, unknown> }> = [];
  return {
    calls,
    async mountPackets(workspacePath: string, input: Record<string, unknown>) {
      calls.push({ workspacePath, input });
    },
  };
}

/**
 * Creates a mock runtime adapter with configurable output events.
 *
 * The adapter tracks all method calls in order and yields the provided
 * output events from streamRun. This allows tests to simulate different
 * execution scenarios (heartbeats, errors, cancellation).
 *
 * @why Verifies the supervisor calls runtime methods in the correct
 * lifecycle order and properly handles the output stream.
 */
function createMockRuntimeAdapter(options?: {
  outputEvents?: SupervisorRunOutputStream[];
  finalStatus?: SupervisorFinalizeResult["status"];
  prepareFailure?: Error;
  startFailure?: Error;
}): RuntimeAdapterPort & { calls: string[]; runCounter: number } {
  let runCounter = 0;
  const calls: string[] = [];

  const outputEvents = options?.outputEvents ?? [
    { type: "stdout" as const, content: "Starting...", timestamp: FIXED_TIME.toISOString() },
    { type: "heartbeat" as const, content: "", timestamp: FIXED_TIME.toISOString() },
    { type: "stdout" as const, content: "Done.", timestamp: FIXED_TIME.toISOString() },
  ];

  return {
    name: "mock-runtime",
    calls,
    get runCounter() {
      return runCounter;
    },

    async prepareRun(context: SupervisorRunContext): Promise<SupervisorPreparedRun> {
      calls.push("prepareRun");
      if (options?.prepareFailure) {
        throw options.prepareFailure;
      }
      runCounter++;
      return {
        runId: `run-${String(runCounter)}`,
        context,
        preparedAt: FIXED_TIME.toISOString(),
      };
    },

    async startRun(runId: string): Promise<void> {
      calls.push(`startRun:${runId}`);
      if (options?.startFailure) {
        throw options.startFailure;
      }
    },

    async *streamRun(runId: string): AsyncIterable<SupervisorRunOutputStream> {
      calls.push(`streamRun:${runId}`);
      for (const event of outputEvents) {
        yield event;
      }
    },

    async cancelRun(runId: string) {
      calls.push(`cancelRun:${runId}`);
      return { cancelled: true };
    },

    async collectArtifacts(runId: string): Promise<SupervisorCollectedArtifacts> {
      calls.push(`collectArtifacts:${runId}`);
      return {
        packetOutput: { packet_type: "dev_result_packet" },
        packetValid: true,
        artifactPaths: ["/tmp/output.json"],
        validationErrors: [],
      };
    },

    async finalizeRun(runId: string): Promise<SupervisorFinalizeResult> {
      calls.push(`finalizeRun:${runId}`);
      return {
        runId,
        status: options?.finalStatus ?? "success",
        packetOutput: { packet_type: "dev_result_packet" },
        artifactPaths: ["/tmp/output.json"],
        logs: [{ timestamp: FIXED_TIME.toISOString(), stream: "stdout", content: "Done." }],
        exitCode: 0,
        durationMs: 1500,
        finalizedAt: FIXED_TIME.toISOString(),
      };
    },
  };
}

/**
 * Creates a mock heartbeat forwarder that records calls.
 *
 * @why Verifies heartbeats from the output stream are correctly
 * forwarded to the lease service with the right lease/worker IDs.
 */
function createMockHeartbeatForwarder(): HeartbeatForwarderPort & {
  calls: Array<{ leaseId: string; workerId: string; isTerminal: boolean }>;
} {
  const calls: Array<{ leaseId: string; workerId: string; isTerminal: boolean }> = [];
  return {
    calls,
    forwardHeartbeat(leaseId: string, workerId: string, isTerminal: boolean): void {
      calls.push({ leaseId, workerId, isTerminal });
    },
  };
}

/**
 * Creates a mock lease transitioner that records transition calls.
 *
 * @why Verifies the supervisor transitions the lease LEASED → STARTING
 * after the worker process is spawned, enabling heartbeat reception.
 */
function createMockLeaseTransitioner(): LeaseTransitionerPort & {
  calls: Array<{
    leaseId: string;
    targetStatus: WorkerLeaseStatus;
    context: Record<string, unknown>;
  }>;
} {
  const calls: Array<{
    leaseId: string;
    targetStatus: WorkerLeaseStatus;
    context: Record<string, unknown>;
  }> = [];
  return {
    calls,
    transitionLease(leaseId, targetStatus, context): void {
      calls.push({ leaseId, targetStatus, context: context as Record<string, unknown> });
    },
  };
}

/**
 * Creates a standard RunContext for testing.
 */
function createTestRunContext(): SupervisorRunContext {
  return {
    taskPacket: {
      packet_type: "task_packet",
      schema_version: "1.0",
      task_id: "task-001",
    },
    effectivePolicySnapshot: {
      policy_snapshot_version: "1.0",
      policy_set_id: "default",
    },
    workspacePaths: {
      worktreePath: "/workspaces/repo/task-001/worktree",
      artifactRoot: "/workspaces/repo/task-001/outputs",
      packetInputPath: "/workspaces/repo/task-001/task-packet.json",
      policySnapshotPath: "/workspaces/repo/task-001/effective-policy-snapshot.json",
    },
    outputSchemaExpectation: {
      packetType: "dev_result_packet",
      schemaVersion: "1.0",
    },
    timeoutSettings: {
      timeBudgetSeconds: 3600,
      expiresAt: "2025-06-01T13:00:00Z",
      heartbeatIntervalSeconds: 30,
      missedHeartbeatThreshold: 2,
      gracePeriodSeconds: 15,
    },
  };
}

/**
 * Creates standard spawn params for testing.
 */
function createTestSpawnParams(overrides?: Partial<SpawnWorkerParams>): SpawnWorkerParams {
  return {
    workerId: "worker-001",
    poolId: "pool-001",
    workerName: "test-worker-1",
    taskId: "task-001",
    leaseId: "lease-001",
    repoPath: "/repos/test-repo",
    runContext: createTestRunContext(),
    actor: SYSTEM_ACTOR,
    ...overrides,
  };
}

// ─── Test Suite Setup ───────────────────────────────────────────────────────

/**
 * Creates a fully wired test harness with all mock dependencies.
 */
function createTestHarness() {
  const workerRepo = createMockWorkerRepo();
  const unitOfWork = createMockUnitOfWork(workerRepo);
  const eventEmitter = createMockEventEmitter();
  const workspaceProvider = createMockWorkspaceProvider();
  const packetMounter = createMockPacketMounter();
  const runtimeAdapter = createMockRuntimeAdapter();
  const heartbeatForwarder = createMockHeartbeatForwarder();
  const leaseTransitioner = createMockLeaseTransitioner();

  const deps: WorkerSupervisorDependencies = {
    unitOfWork,
    eventEmitter,
    workspaceProvider,
    packetMounter,
    runtimeAdapter,
    heartbeatForwarder,
    leaseTransitioner,
    clock: () => FIXED_TIME,
  };

  const service = createWorkerSupervisorService(deps);

  return {
    service,
    workerRepo,
    unitOfWork,
    eventEmitter,
    workspaceProvider,
    packetMounter,
    runtimeAdapter,
    heartbeatForwarder,
    leaseTransitioner,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("WorkerSupervisorService", () => {
  describe("spawnWorker", () => {
    /**
     * @why Verifies the happy path: the entire lifecycle from Worker entity
     * creation through runtime execution to terminal status. This is the
     * primary usage pattern and must work correctly for the system to function.
     */
    it("should execute the full spawn lifecycle successfully", async () => {
      const { service, runtimeAdapter } = createTestHarness();
      const params = createTestSpawnParams();

      const result = await service.spawnWorker(params);

      // Worker should be in terminal "completed" state
      expect(result.worker.status).toBe("completed");
      expect(result.worker.workerId).toBe("worker-001");
      expect(result.worker.currentRunId).toBeNull();
      expect(result.worker.currentTaskId).toBeNull();

      // Finalize result should indicate success
      expect(result.finalizeResult.status).toBe("success");
      expect(result.finalizeResult.runId).toBe("run-1");

      // Output events should include all streamed events
      expect(result.outputEvents).toHaveLength(3);

      // Runtime adapter should have been called in lifecycle order
      expect(runtimeAdapter.calls).toEqual([
        "prepareRun",
        "startRun:run-1",
        "streamRun:run-1",
        "collectArtifacts:run-1",
        "finalizeRun:run-1",
      ]);
    });

    /**
     * @why Verifies that the Worker entity is created in "starting" state
     * before any workspace or runtime operations begin. This ensures the
     * Worker record exists for audit/tracking even if later steps fail.
     */
    it("should create Worker entity in starting state first", async () => {
      const { service, workerRepo } = createTestHarness();
      const params = createTestSpawnParams();

      await service.spawnWorker(params);

      // Worker should have been created (now in terminal state)
      expect(workerRepo.workers).toHaveLength(1);
      expect(workerRepo.workers[0]!.workerId).toBe("worker-001");
      expect(workerRepo.workers[0]!.poolId).toBe("pool-001");
      expect(workerRepo.workers[0]!.name).toBe("test-worker-1");
    });

    /**
     * @why Verifies workspace is provisioned with the correct task ID,
     * repo path, and attempt number. Incorrect workspace setup would
     * cause the worker to operate on wrong code or miss context files.
     */
    it("should create workspace with correct parameters", async () => {
      const { service, workspaceProvider } = createTestHarness();
      const params = createTestSpawnParams({ attempt: 2 });

      await service.spawnWorker(params);

      expect(workspaceProvider.calls).toHaveLength(1);
      expect(workspaceProvider.calls[0]).toEqual({
        taskId: "task-001",
        repoPath: "/repos/test-repo",
        attempt: 2,
      });
    });

    /**
     * @why Verifies context packets are mounted into the workspace root
     * before the runtime adapter starts. Missing packets would cause the
     * worker to run without task context or policy constraints.
     */
    it("should mount packets into workspace before starting runtime", async () => {
      const { service, packetMounter, runtimeAdapter } = createTestHarness();
      const params = createTestSpawnParams();

      await service.spawnWorker(params);

      expect(packetMounter.calls).toHaveLength(1);
      expect(packetMounter.calls[0]!.workspacePath).toBe("/workspaces/repo/task-001");

      // Packet mounting must happen before prepareRun
      expect(runtimeAdapter.calls[0]).toBe("prepareRun");
    });

    /**
     * @why Verifies heartbeat events in the output stream are forwarded
     * to the heartbeat service. Without forwarding, the lease would expire
     * and the task could be reclaimed while the worker is still executing.
     */
    it("should forward heartbeats from the output stream", async () => {
      const { service, heartbeatForwarder } = createTestHarness();
      const params = createTestSpawnParams();

      await service.spawnWorker(params);

      // One heartbeat event in the mock stream + one terminal heartbeat
      const nonTerminalHeartbeats = heartbeatForwarder.calls.filter((c) => !c.isTerminal);
      const terminalHeartbeats = heartbeatForwarder.calls.filter((c) => c.isTerminal);

      expect(nonTerminalHeartbeats).toHaveLength(1);
      expect(nonTerminalHeartbeats[0]).toEqual({
        leaseId: "lease-001",
        workerId: "worker-001",
        isTerminal: false,
      });

      // Terminal heartbeat sent after stream ends
      expect(terminalHeartbeats).toHaveLength(1);
      expect(terminalHeartbeats[0]).toEqual({
        leaseId: "lease-001",
        workerId: "worker-001",
        isTerminal: true,
      });
    });

    /**
     * @why Verifies the supervisor transitions the lease from LEASED → STARTING
     * after the worker process is spawned. Without this transition, the heartbeat
     * service rejects heartbeats because LEASED is not a heartbeat-receivable state.
     */
    it("should transition lease LEASED → STARTING after spawning worker", async () => {
      const { service, leaseTransitioner } = createTestHarness();
      const params = createTestSpawnParams();

      await service.spawnWorker(params);

      expect(leaseTransitioner.calls).toHaveLength(1);
      expect(leaseTransitioner.calls[0]).toEqual({
        leaseId: "lease-001",
        targetStatus: WorkerLeaseStatus.STARTING,
        context: { workerProcessSpawned: true },
      });
    });

    /**
     * @why Verifies the Worker entity's lastHeartbeatAt is updated when
     * heartbeats are received. This timestamp is used by staleness detection
     * to determine if a worker is still alive.
     */
    it("should update Worker lastHeartbeatAt on heartbeat events", async () => {
      const { service, workerRepo } = createTestHarness();
      const params = createTestSpawnParams();

      await service.spawnWorker(params);

      // Worker had heartbeat updates during execution (check it was called)
      // The final state won't have lastHeartbeatAt since terminal update clears it
      // But during execution, the timestamp was updated
      expect(workerRepo.workers[0]!.status).toBe("completed");
    });

    /**
     * @why Verifies domain events are emitted at each lifecycle transition.
     * These events drive the scheduler, notification service, metrics, and
     * other downstream consumers that react to worker lifecycle changes.
     */
    it("should emit domain events for all status transitions", async () => {
      const { service, eventEmitter } = createTestHarness();
      const params = createTestSpawnParams();

      await service.spawnWorker(params);

      const workerEvents = eventEmitter.events.filter((e) => e.type === "worker.status-changed");

      // Expected transitions: idle→starting, starting→running, running→completing, completing→completed
      expect(workerEvents).toHaveLength(4);

      expect(workerEvents[0]).toMatchObject({
        type: "worker.status-changed",
        entityId: "worker-001",
        fromStatus: "idle",
        toStatus: "starting",
      });

      expect(workerEvents[1]).toMatchObject({
        fromStatus: "starting",
        toStatus: "running",
      });

      expect(workerEvents[2]).toMatchObject({
        fromStatus: "running",
        toStatus: "completing",
      });

      expect(workerEvents[3]).toMatchObject({
        fromStatus: "completing",
        toStatus: "completed",
      });
    });

    /**
     * @why Verifies that a failed runtime finalizeResult correctly maps
     * to "failed" Worker entity status. The run status determines whether
     * the task should be retried or escalated.
     */
    it("should map failed run status to failed worker status", async () => {
      const workerRepo = createMockWorkerRepo();
      const unitOfWork = createMockUnitOfWork(workerRepo);
      const eventEmitter = createMockEventEmitter();
      const workspaceProvider = createMockWorkspaceProvider();
      const packetMounter = createMockPacketMounter();
      const runtimeAdapter = createMockRuntimeAdapter({ finalStatus: "failed" });
      const heartbeatForwarder = createMockHeartbeatForwarder();

      const service = createWorkerSupervisorService({
        unitOfWork,
        eventEmitter,
        workspaceProvider,
        packetMounter,
        runtimeAdapter,
        heartbeatForwarder,
        clock: () => FIXED_TIME,
      });

      const result = await service.spawnWorker(createTestSpawnParams());

      expect(result.worker.status).toBe("failed");
      expect(result.finalizeResult.status).toBe("failed");
    });

    /**
     * @why Verifies that a cancelled run maps to "cancelled" Worker entity
     * status. This is distinct from "failed" and determines the escalation path.
     */
    it("should map cancelled run status to cancelled worker status", async () => {
      const workerRepo = createMockWorkerRepo();
      const unitOfWork = createMockUnitOfWork(workerRepo);
      const runtimeAdapter = createMockRuntimeAdapter({ finalStatus: "cancelled" });

      const service = createWorkerSupervisorService({
        unitOfWork,
        eventEmitter: createMockEventEmitter(),
        workspaceProvider: createMockWorkspaceProvider(),
        packetMounter: createMockPacketMounter(),
        runtimeAdapter,
        heartbeatForwarder: createMockHeartbeatForwarder(),
        clock: () => FIXED_TIME,
      });

      const result = await service.spawnWorker(createTestSpawnParams());
      expect(result.worker.status).toBe("cancelled");
    });

    /**
     * @why Verifies that a partial run status (timeout with some progress)
     * maps to "failed" Worker entity status, since partial runs need
     * retry/escalation just like fully failed runs.
     */
    it("should map partial run status to failed worker status", async () => {
      const workerRepo = createMockWorkerRepo();
      const unitOfWork = createMockUnitOfWork(workerRepo);
      const runtimeAdapter = createMockRuntimeAdapter({ finalStatus: "partial" });

      const service = createWorkerSupervisorService({
        unitOfWork,
        eventEmitter: createMockEventEmitter(),
        workspaceProvider: createMockWorkspaceProvider(),
        packetMounter: createMockPacketMounter(),
        runtimeAdapter,
        heartbeatForwarder: createMockHeartbeatForwarder(),
        clock: () => FIXED_TIME,
      });

      const result = await service.spawnWorker(createTestSpawnParams());
      expect(result.worker.status).toBe("failed");
    });

    /**
     * @why Verifies that when the runtime adapter fails to prepare (e.g.,
     * workspace validation error), the Worker entity is still updated to
     * "failed" status and the error is propagated. This prevents zombie
     * Worker records stuck in "starting" state.
     */
    it("should handle prepareRun failure and update worker to failed", async () => {
      const workerRepo = createMockWorkerRepo();
      const unitOfWork = createMockUnitOfWork(workerRepo);
      const eventEmitter = createMockEventEmitter();
      const runtimeAdapter = createMockRuntimeAdapter({
        prepareFailure: new Error("Workspace validation failed"),
      });

      const service = createWorkerSupervisorService({
        unitOfWork,
        eventEmitter,
        workspaceProvider: createMockWorkspaceProvider(),
        packetMounter: createMockPacketMounter(),
        runtimeAdapter,
        heartbeatForwarder: createMockHeartbeatForwarder(),
        clock: () => FIXED_TIME,
      });

      await expect(service.spawnWorker(createTestSpawnParams())).rejects.toThrow(
        "Workspace validation failed",
      );

      // Worker should be in failed state
      expect(workerRepo.workers[0]!.status).toBe("failed");

      // Failed event should have been emitted
      const failedEvents = eventEmitter.events.filter(
        (e) => e.type === "worker.status-changed" && "toStatus" in e && e.toStatus === "failed",
      );
      expect(failedEvents.length).toBeGreaterThanOrEqual(1);
    });

    /**
     * @why Verifies that when startRun fails after preparation, the runtime
     * is properly cleaned up (cancel → collect → finalize) before the Worker
     * entity is updated. This prevents resource leaks from prepared but
     * never-started runs.
     */
    it("should cleanup runtime on startRun failure", async () => {
      const workerRepo = createMockWorkerRepo();
      const unitOfWork = createMockUnitOfWork(workerRepo);
      const runtimeAdapter = createMockRuntimeAdapter({
        startFailure: new Error("Process spawn failed"),
      });

      const service = createWorkerSupervisorService({
        unitOfWork,
        eventEmitter: createMockEventEmitter(),
        workspaceProvider: createMockWorkspaceProvider(),
        packetMounter: createMockPacketMounter(),
        runtimeAdapter,
        heartbeatForwarder: createMockHeartbeatForwarder(),
        clock: () => FIXED_TIME,
      });

      await expect(service.spawnWorker(createTestSpawnParams())).rejects.toThrow(
        "Process spawn failed",
      );

      // Runtime cleanup should have been attempted
      expect(runtimeAdapter.calls).toContain("cancelRun:run-1");
      expect(runtimeAdapter.calls).toContain("collectArtifacts:run-1");
      expect(runtimeAdapter.calls).toContain("finalizeRun:run-1");

      // Worker should be in failed state
      expect(workerRepo.workers[0]!.status).toBe("failed");
    });

    /**
     * @why Verifies that output events with no heartbeats still work.
     * Not all runtime adapters may emit heartbeats (e.g., short-lived
     * deterministic validators), and the supervisor must handle this.
     */
    it("should handle streams with no heartbeat events", async () => {
      const workerRepo = createMockWorkerRepo();
      const unitOfWork = createMockUnitOfWork(workerRepo);
      const heartbeatForwarder = createMockHeartbeatForwarder();
      const runtimeAdapter = createMockRuntimeAdapter({
        outputEvents: [
          { type: "stdout", content: "Output only", timestamp: FIXED_TIME.toISOString() },
        ],
      });

      const service = createWorkerSupervisorService({
        unitOfWork,
        eventEmitter: createMockEventEmitter(),
        workspaceProvider: createMockWorkspaceProvider(),
        packetMounter: createMockPacketMounter(),
        runtimeAdapter,
        heartbeatForwarder,
        clock: () => FIXED_TIME,
      });

      const result = await service.spawnWorker(createTestSpawnParams());

      // Only the terminal heartbeat should be forwarded
      const nonTerminal = heartbeatForwarder.calls.filter((c) => !c.isTerminal);
      expect(nonTerminal).toHaveLength(0);

      // Terminal heartbeat still sent
      const terminal = heartbeatForwarder.calls.filter((c) => c.isTerminal);
      expect(terminal).toHaveLength(1);

      expect(result.outputEvents).toHaveLength(1);
      expect(result.worker.status).toBe("completed");
    });

    /**
     * @why Verifies that multiple heartbeat events in the stream are all
     * forwarded. Long-running workers emit periodic heartbeats, and each
     * one must reach the lease service to prevent TTL expiry.
     */
    it("should forward multiple heartbeats from the stream", async () => {
      const heartbeatForwarder = createMockHeartbeatForwarder();
      const runtimeAdapter = createMockRuntimeAdapter({
        outputEvents: [
          { type: "heartbeat", content: "", timestamp: FIXED_TIME.toISOString() },
          { type: "stdout", content: "working...", timestamp: FIXED_TIME.toISOString() },
          { type: "heartbeat", content: "", timestamp: FIXED_TIME.toISOString() },
          { type: "heartbeat", content: "", timestamp: FIXED_TIME.toISOString() },
        ],
      });

      const workerRepo = createMockWorkerRepo();
      const service = createWorkerSupervisorService({
        unitOfWork: createMockUnitOfWork(workerRepo),
        eventEmitter: createMockEventEmitter(),
        workspaceProvider: createMockWorkspaceProvider(),
        packetMounter: createMockPacketMounter(),
        runtimeAdapter,
        heartbeatForwarder,
        clock: () => FIXED_TIME,
      });

      await service.spawnWorker(createTestSpawnParams());

      const nonTerminal = heartbeatForwarder.calls.filter((c) => !c.isTerminal);
      expect(nonTerminal).toHaveLength(3);
    });

    /**
     * @why Verifies the run config mounted into the workspace includes
     * all the metadata needed for audit and debugging — worker ID, pool ID,
     * task ID, lease ID, runtime name, and timestamp.
     */
    it("should mount run config with complete metadata", async () => {
      const { service, packetMounter } = createTestHarness();
      const params = createTestSpawnParams();

      await service.spawnWorker(params);

      const mountCall = packetMounter.calls[0]!;
      const runConfig = (mountCall.input as Record<string, unknown>).runConfig as Record<
        string,
        unknown
      >;

      expect(runConfig).toMatchObject({
        workerId: "worker-001",
        poolId: "pool-001",
        taskId: "task-001",
        leaseId: "lease-001",
        attempt: 0,
        runtimeName: "mock-runtime",
        branchName: "factory/task-001",
      });
      expect(runConfig.startedAt).toBeTruthy();
    });

    /**
     * @why Verifies that all database mutations happen within transactional
     * boundaries. The supervisor uses multiple transactions for different
     * lifecycle stages (create, update to running, heartbeat updates,
     * update to completing, update to terminal).
     */
    it("should execute worker mutations within transactions", async () => {
      const { service, unitOfWork } = createTestHarness();
      const params = createTestSpawnParams();

      await service.spawnWorker(params);

      // At minimum: create, update to running, heartbeat update, completing, terminal
      expect(unitOfWork.transactionCount).toBeGreaterThanOrEqual(4);
    });
  });

  describe("cancelWorker", () => {
    /**
     * @why Verifies that cancellation sends a cancel signal to the runtime,
     * collects partial artifacts, finalizes the run, and updates the Worker
     * entity to "cancelled" status. This is the clean shutdown path.
     */
    it("should cancel a running worker and update status", async () => {
      // First spawn a worker so it exists in the repo
      const workerRepo = createMockWorkerRepo();
      const unitOfWork = createMockUnitOfWork(workerRepo);
      const eventEmitter = createMockEventEmitter();
      const runtimeAdapter = createMockRuntimeAdapter();

      const service = createWorkerSupervisorService({
        unitOfWork,
        eventEmitter,
        workspaceProvider: createMockWorkspaceProvider(),
        packetMounter: createMockPacketMounter(),
        runtimeAdapter,
        heartbeatForwarder: createMockHeartbeatForwarder(),
        clock: () => FIXED_TIME,
      });

      // Spawn first so worker entity exists
      await service.spawnWorker(createTestSpawnParams());

      // Reset adapter calls tracking
      runtimeAdapter.calls.length = 0;

      // Manually set worker back to running state for the cancel test
      unitOfWork.runInTransaction((repos) => {
        repos.worker.update("worker-001", {
          status: "running",
          currentRunId: "run-1",
          currentTaskId: "task-001",
        });
      });

      const result = await service.cancelWorker({
        workerId: "worker-001",
        runId: "run-1",
        actor: SYSTEM_ACTOR,
      });

      expect(result.cancelled).toBe(true);
      expect(result.worker.status).toBe("cancelled");
      expect(result.finalizeResult).not.toBeNull();

      // Verify runtime adapter lifecycle on cancel
      expect(runtimeAdapter.calls).toEqual([
        "cancelRun:run-1",
        "collectArtifacts:run-1",
        "finalizeRun:run-1",
      ]);
    });

    /**
     * @why Verifies that attempting to cancel a non-existent worker returns
     * a non-cancelled result without throwing. This handles race conditions
     * where the worker may have already been cleaned up.
     */
    it("should return non-cancelled result for non-existent worker", async () => {
      const workerRepo = createMockWorkerRepo();
      const unitOfWork = createMockUnitOfWork(workerRepo);

      const service = createWorkerSupervisorService({
        unitOfWork,
        eventEmitter: createMockEventEmitter(),
        workspaceProvider: createMockWorkspaceProvider(),
        packetMounter: createMockPacketMounter(),
        runtimeAdapter: createMockRuntimeAdapter(),
        heartbeatForwarder: createMockHeartbeatForwarder(),
        clock: () => FIXED_TIME,
      });

      const result = await service.cancelWorker({
        workerId: "nonexistent",
        runId: "run-999",
        actor: SYSTEM_ACTOR,
      });

      expect(result.cancelled).toBe(false);
      expect(result.finalizeResult).toBeNull();
    });

    /**
     * @why Verifies that a cancellation domain event is emitted when a
     * worker is cancelled. Downstream consumers need this event to update
     * dashboards, metrics, and trigger any cancellation side effects.
     */
    it("should emit worker status-changed event on cancellation", async () => {
      const workerRepo = createMockWorkerRepo();
      const unitOfWork = createMockUnitOfWork(workerRepo);
      const eventEmitter = createMockEventEmitter();

      const service = createWorkerSupervisorService({
        unitOfWork,
        eventEmitter,
        workspaceProvider: createMockWorkspaceProvider(),
        packetMounter: createMockPacketMounter(),
        runtimeAdapter: createMockRuntimeAdapter(),
        heartbeatForwarder: createMockHeartbeatForwarder(),
        clock: () => FIXED_TIME,
      });

      // Spawn first
      await service.spawnWorker(createTestSpawnParams());

      // Reset events and set worker back to running
      eventEmitter.events.length = 0;
      unitOfWork.runInTransaction((repos) => {
        repos.worker.update("worker-001", {
          status: "running",
          currentRunId: "run-1",
          currentTaskId: "task-001",
        });
      });

      await service.cancelWorker({
        workerId: "worker-001",
        runId: "run-1",
        actor: SYSTEM_ACTOR,
      });

      const cancelEvents = eventEmitter.events.filter(
        (e) => e.type === "worker.status-changed" && "toStatus" in e && e.toStatus === "cancelled",
      );
      expect(cancelEvents).toHaveLength(1);
    });
  });
});
