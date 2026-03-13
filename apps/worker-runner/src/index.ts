/** @module @factory/worker-runner — Worker process supervisor for spawning and managing ephemeral worker processes.
 *
 * Re-exports dispatch and supervisor types from {@link @factory/application} to
 * establish the public API surface for worker lifecycle management. V1 execution
 * runs in-process within the control-plane; these re-exports prepare for future
 * extraction into a standalone worker process.
 */

// ── Worker Dispatch ────────────────────────────────────────────────────────────

export { createWorkerDispatchService, DEFAULT_DISPATCH_LEASE_OWNER } from "@factory/application";

export type {
  WorkerDispatchConfig,
  DispatchPayload,
  DispatchSuccessResult,
  DispatchFailedResult,
  DispatchSkippedResult,
  ProcessDispatchResult,
  WorkerDispatchService,
  WorkerDispatchDependencies,
} from "@factory/application";

// Dispatch context resolution ports
export type {
  WorkerSpawnContext,
  WorkerDispatchContextPort,
  WorkerDispatchTransactionRepositories,
  WorkerDispatchUnitOfWork,
} from "@factory/application";

// ── Worker Supervisor ──────────────────────────────────────────────────────────

export { createWorkerSupervisorService } from "@factory/application";

export type {
  SpawnWorkerParams,
  SpawnWorkerResult,
  CancelWorkerParams,
  CancelWorkerResult,
  WorkerSupervisorService,
  WorkerSupervisorDependencies,
} from "@factory/application";

// Supervisor port interfaces
export type {
  WorkerEntityStatus,
  SupervisedWorker,
  CreateWorkerData,
  UpdateWorkerData,
  WorkerSupervisorRepositoryPort,
  SupervisorWorkspaceLayout,
  SupervisorWorkspaceResult,
  SupervisorCleanupOptions,
  SupervisorCleanupResult,
  WorkspaceProviderPort,
  SupervisorMountInput,
  PacketMounterPort,
  SupervisorWorkspacePaths,
  SupervisorTimeoutSettings,
  SupervisorOutputSchemaExpectation,
  SupervisorRunContext,
  SupervisorPreparedRun,
  SupervisorRunOutputStream,
  SupervisorCancelResult,
  SupervisorCollectedArtifacts,
  SupervisorRunLogEntry,
  SupervisorRunStatus,
  SupervisorFinalizeResult,
  RuntimeAdapterPort,
  HeartbeatForwarderPort,
  WorkerSupervisorTransactionRepositories,
  WorkerSupervisorUnitOfWork,
} from "@factory/application";
