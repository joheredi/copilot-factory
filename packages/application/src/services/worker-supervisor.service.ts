/**
 * Worker Supervisor service — manages the full lifecycle of worker processes.
 *
 * Orchestrates worker spawning, process monitoring, heartbeat forwarding,
 * and cleanup. This is the central coordination point between the control
 * plane's lease/scheduling system and the worker runtime adapters.
 *
 * **Spawn lifecycle:**
 * ```
 * createWorker → createWorkspace → mountPackets → prepareRun → startRun
 *   → streamRun (heartbeat forwarding) → collectArtifacts → finalizeRun
 *   → updateWorkerStatus
 * ```
 *
 * **Cancel lifecycle:**
 * ```
 * cancelRun → collectArtifacts → finalizeRun → updateWorkerStatus
 * ```
 *
 * The supervisor does NOT own state transitions on tasks or leases — those
 * remain with the transition service and lease service. The supervisor
 * manages Worker entity status and coordinates the runtime adapter lifecycle.
 *
 * @see docs/prd/007-technical-architecture.md §7.3 — Worker Supervisor
 * @see docs/prd/010-integration-contracts.md §10.4 — Worker Lifecycle
 * @see docs/prd/010-integration-contracts.md §10.8 — Adapter Contract
 * @module @factory/application/services/worker-supervisor.service
 */

import type { DomainEventEmitter } from "../ports/event-emitter.port.js";
import type { ActorInfo } from "../events/domain-events.js";

import {
  getTracer,
  SpanStatusCode,
  SpanNames,
  SpanAttributes,
  getStarterMetrics,
} from "@factory/observability";
import { WorkerLeaseStatus } from "@factory/domain";
import type {
  WorkerEntityStatus,
  SupervisedWorker,
  WorkerSupervisorUnitOfWork,
  WorkspaceProviderPort,
  PacketMounterPort,
  RuntimeAdapterPort,
  HeartbeatForwarderPort,
  LeaseTransitionerPort,
  LeaseReclaimerPort,
  RunLogPersisterPort,
  OutputForwarderPort,
  SupervisorRunContext,
  SupervisorFinalizeResult,
  SupervisorRunOutputStream,
} from "../ports/worker-supervisor.ports.js";

// ─── Service Input/Output Types ─────────────────────────────────────────────

/**
 * Parameters for spawning a new worker process.
 *
 * Contains all the information needed to create the workspace, mount
 * context packets, and start the runtime adapter for execution.
 */
export interface SpawnWorkerParams {
  /** Unique ID to assign to the new Worker entity. */
  readonly workerId: string;
  /** ID of the worker pool this worker belongs to. */
  readonly poolId: string;
  /** Human-readable name for the worker. */
  readonly workerName: string;
  /** ID of the task being executed. */
  readonly taskId: string;
  /** ID of the lease held for this task. */
  readonly leaseId: string;
  /** Absolute path to the source repository for worktree creation. */
  readonly repoPath: string;
  /** Retry attempt number (undefined for first attempt). */
  readonly attempt?: number;
  /** The complete run context for the runtime adapter. */
  readonly runContext: SupervisorRunContext;
  /** Who initiated this spawn (for audit/events). */
  readonly actor: ActorInfo;
}

/**
 * Result of a successful worker spawn and execution.
 *
 * Contains the Worker entity, the runtime's finalize result, and all
 * output events captured during execution.
 */
export interface SpawnWorkerResult {
  /** The Worker entity in its terminal state. */
  readonly worker: SupervisedWorker;
  /** The terminal result from the runtime adapter. */
  readonly finalizeResult: SupervisorFinalizeResult;
  /** All output events captured during the run. */
  readonly outputEvents: readonly SupervisorRunOutputStream[];
}

/**
 * Parameters for cancelling a running worker.
 */
export interface CancelWorkerParams {
  /** ID of the worker to cancel. */
  readonly workerId: string;
  /** The run ID to cancel (from the runtime adapter). */
  readonly runId: string;
  /** Who initiated the cancellation. */
  readonly actor: ActorInfo;
}

/**
 * Result of a worker cancellation.
 */
export interface CancelWorkerResult {
  /** Whether the cancellation was initiated. */
  readonly cancelled: boolean;
  /** The finalize result if cancellation was successful, null otherwise. */
  readonly finalizeResult: SupervisorFinalizeResult | null;
  /** The Worker entity in its terminal state. */
  readonly worker: SupervisedWorker;
}

// ─── Service Interface ──────────────────────────────────────────────────────

/**
 * Worker Supervisor service interface.
 *
 * Manages the complete lifecycle of worker processes from spawn to cleanup.
 * The supervisor creates Worker entity records, provisions workspaces,
 * starts runtime adapters, forwards heartbeats, and handles process exit.
 */
export interface WorkerSupervisorService {
  /**
   * Spawn a new worker process for a task.
   *
   * Creates a Worker entity, provisions a workspace, mounts context packets,
   * prepares and starts the runtime adapter, monitors the output stream
   * (forwarding heartbeats), and finalizes the run on completion.
   *
   * This is an async operation that resolves when the worker has finished
   * executing and all cleanup is complete.
   *
   * @param params - Spawn parameters including task, lease, and run context.
   * @returns The spawn result with the finalized Worker entity and runtime result.
   * @throws If workspace creation, packet mounting, or runtime preparation fails.
   */
  spawnWorker(params: SpawnWorkerParams): Promise<SpawnWorkerResult>;

  /**
   * Cancel a running worker.
   *
   * Sends a cancellation signal to the runtime adapter, collects any
   * partial artifacts, finalizes the run, and updates the Worker entity
   * to its terminal state.
   *
   * @param params - Cancellation parameters.
   * @returns The cancellation result.
   */
  cancelWorker(params: CancelWorkerParams): Promise<CancelWorkerResult>;
}

// ─── Dependencies ───────────────────────────────────────────────────────────

/**
 * All dependencies required by the Worker Supervisor.
 * Collected into a single interface for clarity at the factory function.
 */
export interface WorkerSupervisorDependencies {
  /** Transaction boundary for Worker entity operations. */
  readonly unitOfWork: WorkerSupervisorUnitOfWork;
  /** Domain event publisher. */
  readonly eventEmitter: DomainEventEmitter;
  /** Workspace provisioning (worktree creation). */
  readonly workspaceProvider: WorkspaceProviderPort;
  /** Context file mounting (task packet, policy snapshot). */
  readonly packetMounter: PacketMounterPort;
  /** Runtime adapter for worker process management. */
  readonly runtimeAdapter: RuntimeAdapterPort;
  /** Heartbeat forwarding to the lease/heartbeat service. */
  readonly heartbeatForwarder: HeartbeatForwarderPort;
  /**
   * Lease state transitioner for advancing the lease lifecycle.
   * When provided, the supervisor transitions the lease LEASED → STARTING
   * after the worker process is spawned, enabling heartbeat reception.
   */
  readonly leaseTransitioner?: LeaseTransitionerPort;
  /**
   * Lease reclaimer for recovering from worker failures.
   * When provided, the supervisor reclaims the lease on failure, which
   * atomically transitions the lease to CRASHED → RECLAIMED, evaluates
   * retry policy, and returns the task to READY or FAILED.
   */
  readonly leaseReclaimer?: LeaseReclaimerPort;
  /**
   * Run log persister for writing stdout/stderr to the workspace logs directory.
   * When provided, logs are persisted after every run (success or failure).
   */
  readonly runLogPersister?: RunLogPersisterPort;
  /**
   * Output forwarder for streaming stdout/stderr to the real-time broadcast layer.
   * When provided, output events are forwarded to WebSocket clients during execution.
   */
  readonly outputForwarder?: OutputForwarderPort;
  /** Clock function for timestamps (injectable for testing). */
  readonly clock?: () => Date;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Map a runtime finalize result status to a Worker entity status.
 *
 * The runtime uses string statuses ("success", "failed", "partial", "cancelled")
 * while the Worker entity uses more specific statuses that distinguish
 * between completion modes.
 */
function mapRunStatusToWorkerStatus(
  runStatus: SupervisorFinalizeResult["status"],
): WorkerEntityStatus {
  switch (runStatus) {
    case "success":
      return "completed";
    case "failed":
    case "partial":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a Worker Supervisor service with injected dependencies.
 *
 * The supervisor coordinates workspace provisioning, runtime adapter
 * lifecycle, heartbeat forwarding, and Worker entity status tracking.
 *
 * @param deps - All required dependencies.
 * @returns A WorkerSupervisorService instance.
 */
/** @internal OpenTelemetry tracer for worker supervisor spans. */
const supervisorTracer = getTracer("worker-supervisor");

export function createWorkerSupervisorService(
  deps: WorkerSupervisorDependencies,
): WorkerSupervisorService {
  const {
    unitOfWork,
    eventEmitter,
    workspaceProvider,
    packetMounter,
    runtimeAdapter,
    heartbeatForwarder,
    leaseTransitioner,
    leaseReclaimer,
    runLogPersister,
    outputForwarder,
    clock = () => new Date(),
  } = deps;

  return {
    async spawnWorker(params: SpawnWorkerParams): Promise<SpawnWorkerResult> {
      const {
        workerId,
        poolId,
        workerName,
        taskId,
        leaseId,
        repoPath,
        attempt,
        runContext,
        actor,
      } = params;

      const runStartTime = Date.now();

      // ── worker.prepare span: workspace provisioning and runtime setup ──
      const prepareSpan = supervisorTracer.startSpan(SpanNames.WORKER_PREPARE);
      prepareSpan.setAttribute(SpanAttributes.TASK_ID, taskId);
      prepareSpan.setAttribute(SpanAttributes.WORKER_ID, workerId);
      prepareSpan.setAttribute(SpanAttributes.POOL_ID, poolId);

      // Step 1: Create Worker entity in "starting" state
      const worker = unitOfWork.runInTransaction((repos) => {
        return repos.worker.create({
          workerId,
          poolId,
          name: workerName,
          status: "starting",
          currentTaskId: taskId,
        });
      });

      eventEmitter.emit({
        type: "worker.status-changed",
        entityType: "worker",
        entityId: workerId,
        actor,
        timestamp: clock(),
        fromStatus: "idle",
        toStatus: "starting",
      });

      let preparedRunId: string | undefined;

      try {
        // Step 2: Create workspace (worktree + directories)
        const workspaceResult = await workspaceProvider.createWorkspace(taskId, repoPath, attempt);

        // Step 3: Mount context packets into workspace
        await packetMounter.mountPackets(workspaceResult.layout.rootPath, {
          taskPacket: runContext.taskPacket as Record<string, unknown>,
          runConfig: {
            workerId,
            poolId,
            taskId,
            leaseId,
            attempt: attempt ?? 0,
            runtimeName: runtimeAdapter.name,
            branchName: workspaceResult.branchName,
            startedAt: clock().toISOString(),
          },
          policySnapshot: runContext.effectivePolicySnapshot as Record<string, unknown>,
        });

        // Step 4: Prepare the runtime adapter
        const prepared = await runtimeAdapter.prepareRun(runContext);
        preparedRunId = prepared.runId;

        prepareSpan.setAttribute(SpanAttributes.RUN_ID, prepared.runId);
        prepareSpan.setStatus({ code: SpanStatusCode.OK });
        prepareSpan.end();

        // ── worker.run span: execution, heartbeats, and finalization ──
        const runSpan = supervisorTracer.startSpan(SpanNames.WORKER_RUN);
        runSpan.setAttribute(SpanAttributes.TASK_ID, taskId);
        runSpan.setAttribute(SpanAttributes.WORKER_ID, workerId);
        runSpan.setAttribute(SpanAttributes.RUN_ID, prepared.runId);

        // Step 5: Start the worker process
        await runtimeAdapter.startRun(prepared.runId);

        // Step 5b: Transition lease LEASED → STARTING so heartbeats are accepted
        if (leaseTransitioner) {
          leaseTransitioner.transitionLease(leaseId, WorkerLeaseStatus.STARTING, {
            workerProcessSpawned: true,
          });
        }

        // Step 6: Update Worker entity to "running"
        unitOfWork.runInTransaction((repos) => {
          repos.worker.update(workerId, {
            status: "running",
            currentRunId: prepared.runId,
          });
        });

        eventEmitter.emit({
          type: "worker.status-changed",
          entityType: "worker",
          entityId: workerId,
          actor,
          timestamp: clock(),
          fromStatus: "starting",
          toStatus: "running",
        });

        // Step 7: Stream output events, forwarding heartbeats and output
        const outputEvents: SupervisorRunOutputStream[] = [];
        for await (const event of runtimeAdapter.streamRun(prepared.runId)) {
          outputEvents.push(event);

          if (event.type === "heartbeat") {
            heartbeatForwarder.forwardHeartbeat(leaseId, workerId, false);

            // Update last heartbeat timestamp
            unitOfWork.runInTransaction((repos) => {
              repos.worker.update(workerId, {
                lastHeartbeatAt: clock(),
              });
            });
          }

          // Forward stdout/stderr to the real-time broadcast layer
          if (outputForwarder && (event.type === "stdout" || event.type === "stderr")) {
            outputForwarder.forwardOutput(workerId, event);
          }
        }

        // Step 8: Worker exited — collect artifacts and finalize to determine outcome
        await runtimeAdapter.collectArtifacts(prepared.runId);
        const finalizeResult = await runtimeAdapter.finalizeRun(prepared.runId);
        const terminalStatus = mapRunStatusToWorkerStatus(finalizeResult.status);

        // Step 8b: Persist run logs to workspace for post-mortem debugging
        if (runLogPersister && finalizeResult.logs.length > 0) {
          try {
            await runLogPersister.persistRunLogs(
              workspaceResult.layout.logsPath,
              finalizeResult.logs,
            );
          } catch {
            // Best-effort: log persistence failure should not block worker completion
          }
        }

        if (finalizeResult.status === "success") {
          // ── Success path: transition worker to completing → completed ──

          unitOfWork.runInTransaction((repos) => {
            repos.worker.update(workerId, { status: "completing" });
          });

          eventEmitter.emit({
            type: "worker.status-changed",
            entityType: "worker",
            entityId: workerId,
            actor,
            timestamp: clock(),
            fromStatus: "running",
            toStatus: "completing",
          });

          // Terminal heartbeat transitions the lease to COMPLETING via the
          // heartbeat service (which sets heartbeatAt and validates the
          // state machine transition atomically).
          heartbeatForwarder.forwardHeartbeat(leaseId, workerId, true);

          const terminalWorker = unitOfWork.runInTransaction((repos) => {
            return repos.worker.update(workerId, {
              status: terminalStatus,
              currentRunId: null,
              currentTaskId: null,
            });
          });

          eventEmitter.emit({
            type: "worker.status-changed",
            entityType: "worker",
            entityId: workerId,
            actor,
            timestamp: clock(),
            fromStatus: "completing",
            toStatus: terminalStatus,
          });

          runSpan.setAttribute(SpanAttributes.RESULT_STATUS, terminalStatus);
          runSpan.setStatus({ code: SpanStatusCode.OK });
          runSpan.end();

          const starterMetrics = getStarterMetrics();
          const runDurationSeconds = (Date.now() - runStartTime) / 1000;
          starterMetrics.workerRuns.inc({ pool_id: poolId, result: "success" });
          starterMetrics.workerRunDuration.observe({ pool_id: poolId }, runDurationSeconds);

          return {
            worker: terminalWorker,
            finalizeResult,
            outputEvents,
          };
        }

        // ── Failure path: reclaim lease and recover task ────────────────

        // Update Worker entity to terminal "failed" status
        const terminalWorker = unitOfWork.runInTransaction((repos) => {
          return repos.worker.update(workerId, {
            status: terminalStatus,
            currentRunId: null,
            currentTaskId: null,
          });
        });

        eventEmitter.emit({
          type: "worker.status-changed",
          entityType: "worker",
          entityId: workerId,
          actor,
          timestamp: clock(),
          fromStatus: "running",
          toStatus: terminalStatus,
        });

        // Reclaim the lease via the lease-reclaim service, which atomically
        // transitions lease → CRASHED → RECLAIMED, evaluates retry policy,
        // and transitions the task back to READY (or FAILED/ESCALATED).
        if (leaseReclaimer) {
          try {
            leaseReclaimer.reclaimLease(leaseId, {
              triggeredBy: "worker-supervisor",
              reason: "worker_execution_failed",
              exitCode: finalizeResult.exitCode,
              runStatus: finalizeResult.status,
              durationMs: finalizeResult.durationMs,
            });
          } catch {
            // Best-effort: if the reconciliation sweep already reclaimed this
            // lease, or if the lease is in a state that can't be reclaimed
            // (e.g., already COMPLETING from a race), we log but don't fail.
          }
        }

        runSpan.setAttribute(SpanAttributes.RESULT_STATUS, terminalStatus);
        runSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: `Worker failed: exit code ${finalizeResult.exitCode}, status ${finalizeResult.status}`,
        });
        runSpan.end();

        const failMetrics = getStarterMetrics();
        const failDurationSeconds = (Date.now() - runStartTime) / 1000;
        const failResultLabel = terminalStatus === "cancelled" ? "cancelled" : "failed";
        failMetrics.workerRuns.inc({ pool_id: poolId, result: failResultLabel });
        failMetrics.workerRunDuration.observe({ pool_id: poolId }, failDurationSeconds);

        return {
          worker: terminalWorker,
          finalizeResult,
          outputEvents,
        };
      } catch (error: unknown) {
        // End any open spans on failure
        const errMsg = error instanceof Error ? error.message : String(error);
        if (!preparedRunId) {
          // Failure happened during prepare phase
          prepareSpan.setStatus({ code: SpanStatusCode.ERROR, message: errMsg });
          prepareSpan.end();
        } else {
          // Failure happened during run phase
          const failRunSpan = supervisorTracer.startSpan(SpanNames.WORKER_RUN);
          failRunSpan.setAttribute(SpanAttributes.TASK_ID, taskId);
          failRunSpan.setAttribute(SpanAttributes.WORKER_ID, workerId);
          failRunSpan.setStatus({ code: SpanStatusCode.ERROR, message: errMsg });
          failRunSpan.end();
        }

        // On any failure: attempt to finalize the runtime if it was prepared
        if (preparedRunId) {
          try {
            await runtimeAdapter.cancelRun(preparedRunId);
            await runtimeAdapter.collectArtifacts(preparedRunId);
            await runtimeAdapter.finalizeRun(preparedRunId);
          } catch {
            // Best-effort cleanup — if finalization fails, we still update the worker
          }
        }

        // Update Worker entity to "failed"
        unitOfWork.runInTransaction((repos) => {
          repos.worker.update(workerId, {
            status: "failed",
            currentRunId: null,
            currentTaskId: null,
          });
        });

        eventEmitter.emit({
          type: "worker.status-changed",
          entityType: "worker",
          entityId: workerId,
          actor,
          timestamp: clock(),
          fromStatus: worker.status,
          toStatus: "failed",
        });

        // Attempt to reclaim the lease so the task can be recovered.
        // Best-effort: the lease may be in LEASED (very early failure) which
        // isn't reclaimable — the reconciliation sweep handles that case.
        if (leaseReclaimer) {
          try {
            leaseReclaimer.reclaimLease(leaseId, {
              triggeredBy: "worker-supervisor",
              reason: "worker_spawn_exception",
              error: error instanceof Error ? error.message : String(error),
            });
          } catch {
            // If reclaim fails (lease not in reclaimable state, or sweep
            // already handled it), we continue — the sweep is the fallback.
          }
        }

        // ── Metrics instrumentation (§10.13.3) ──────────────────────────
        const failMetrics = getStarterMetrics();
        const failDurationSeconds = (Date.now() - runStartTime) / 1000;
        failMetrics.workerRuns.inc({ pool_id: poolId, result: "failed" });
        failMetrics.workerRunDuration.observe({ pool_id: poolId }, failDurationSeconds);

        throw error;
      }
    },

    async cancelWorker(params: CancelWorkerParams): Promise<CancelWorkerResult> {
      const { workerId, runId, actor } = params;

      // Find current worker state
      const worker = unitOfWork.runInTransaction((repos) => {
        return repos.worker.findById(workerId);
      });

      if (!worker) {
        // Worker not found — return non-cancelled result
        return {
          cancelled: false,
          finalizeResult: null,
          worker: {
            workerId,
            poolId: "",
            name: "",
            status: "failed",
            currentTaskId: null,
            currentRunId: null,
            lastHeartbeatAt: null,
          },
        };
      }

      // Send cancellation to the runtime adapter
      const cancelResult = await runtimeAdapter.cancelRun(runId);

      if (!cancelResult.cancelled) {
        return {
          cancelled: false,
          finalizeResult: null,
          worker,
        };
      }

      // Collect artifacts and finalize after cancellation
      await runtimeAdapter.collectArtifacts(runId);
      const finalizeResult = await runtimeAdapter.finalizeRun(runId);

      // Update Worker entity to cancelled
      const cancelledWorker = unitOfWork.runInTransaction((repos) => {
        return repos.worker.update(workerId, {
          status: "cancelled",
          currentRunId: null,
          currentTaskId: null,
        });
      });

      eventEmitter.emit({
        type: "worker.status-changed",
        entityType: "worker",
        entityId: workerId,
        actor,
        timestamp: clock(),
        fromStatus: worker.status,
        toStatus: "cancelled",
      });

      return {
        cancelled: true,
        finalizeResult,
        worker: cancelledWorker,
      };
    },
  };
}
