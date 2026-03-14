/**
 * Worker Supervisor ports — defines the infrastructure contracts needed
 * by the Worker Supervisor service.
 *
 * These ports abstract away database access for Worker entity CRUD and
 * provide the workspace/runtime adapter interfaces that the supervisor
 * uses to manage worker lifecycles.
 *
 * @module @factory/application/ports/worker-supervisor.ports
 * @see docs/prd/007-technical-architecture.md §7.3 — Worker Supervisor
 * @see docs/prd/010-integration-contracts.md §10.4 — Worker Lifecycle
 */

import type { TaskPacket } from "@factory/schemas";
import type { WorkerLeaseStatus, WorkerLeaseTransitionContext } from "@factory/domain";

// ─── Worker Entity ──────────────────────────────────────────────────────────

/**
 * Operational status of a Worker entity as tracked by the supervisor.
 *
 * Maps to the Worker lifecycle from PRD §10.4.3:
 * - `idle` — created but not yet assigned work
 * - `starting` — workspace being prepared, run being initialized
 * - `running` — worker process actively executing
 * - `completing` — worker finished, collecting artifacts
 * - `completed` — terminal: run finished successfully
 * - `failed` — terminal: run exited with error or invalid output
 * - `cancelled` — terminal: run was explicitly cancelled
 * - `timed_out` — terminal: run exceeded time budget
 */
export type WorkerEntityStatus =
  | "idle"
  | "starting"
  | "running"
  | "completing"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

/**
 * Minimal Worker entity shape for supervisor operations.
 *
 * The supervisor creates and updates Worker records to track the
 * lifecycle of ephemeral worker processes. This shape matches the
 * columns defined in the worker table schema.
 */
export interface SupervisedWorker {
  readonly workerId: string;
  readonly poolId: string;
  readonly name: string;
  readonly status: WorkerEntityStatus;
  readonly currentTaskId: string | null;
  readonly currentRunId: string | null;
  readonly lastHeartbeatAt: Date | null;
}

/**
 * Data needed to create a new Worker entity record.
 */
export interface CreateWorkerData {
  readonly workerId: string;
  readonly poolId: string;
  readonly name: string;
  readonly status: WorkerEntityStatus;
  readonly currentTaskId: string;
}

/**
 * Fields that can be updated on a Worker entity.
 * All fields are optional — only provided fields are updated.
 */
export interface UpdateWorkerData {
  readonly status?: WorkerEntityStatus;
  readonly currentRunId?: string | null;
  readonly currentTaskId?: string | null;
  readonly lastHeartbeatAt?: Date | null;
}

// ─── Repository Port ────────────────────────────────────────────────────────

/**
 * Repository port for Worker entity CRUD operations.
 *
 * Intentionally narrow — only exposes what the supervisor needs.
 */
export interface WorkerSupervisorRepositoryPort {
  /** Create a new Worker entity. */
  create(data: CreateWorkerData): SupervisedWorker;

  /** Find a Worker entity by ID. Returns undefined if not found. */
  findById(workerId: string): SupervisedWorker | undefined;

  /** Update a Worker entity. Returns the updated entity. */
  update(workerId: string, data: UpdateWorkerData): SupervisedWorker;
}

// ─── Workspace Port ─────────────────────────────────────────────────────────

/**
 * Workspace creation result from the WorkspaceManager.
 * Mirrors the WorkspaceResult type from infrastructure but decoupled
 * via this port so the application layer doesn't depend on infrastructure impl.
 */
export interface SupervisorWorkspaceLayout {
  readonly rootPath: string;
  readonly worktreePath: string;
  readonly logsPath: string;
  readonly outputsPath: string;
}

export interface SupervisorWorkspaceResult {
  readonly layout: SupervisorWorkspaceLayout;
  readonly branchName: string;
  readonly reused: boolean;
}

/**
 * Options for workspace cleanup via the port.
 * Mirrors CleanupWorkspaceOptions from infrastructure but decoupled.
 */
export interface SupervisorCleanupOptions {
  /** Whether to delete the task branch. Defaults to true. */
  readonly deleteBranch?: boolean;
  /** Whether to force-delete unmerged branches. Defaults to false. */
  readonly forceBranchDelete?: boolean;
}

/**
 * Result of a workspace cleanup operation.
 * Mirrors CleanupWorkspaceResult from infrastructure but decoupled.
 */
export interface SupervisorCleanupResult {
  /** Whether a git worktree was removed. */
  readonly worktreeRemoved: boolean;
  /** Whether the workspace directory tree was removed. */
  readonly directoryRemoved: boolean;
  /** Whether the task branch was deleted. */
  readonly branchDeleted: boolean;
}

/**
 * Port for workspace provisioning.
 *
 * Abstracts the WorkspaceManager so the supervisor doesn't depend
 * on infrastructure-layer classes directly.
 */
export interface WorkspaceProviderPort {
  /**
   * Create or reuse a workspace for a task.
   *
   * @param taskId - The task to create a workspace for.
   * @param repoPath - Absolute path to the source repository.
   * @param attempt - Retry attempt number (undefined for first attempt).
   * @returns Workspace result with layout and branch info.
   */
  createWorkspace(
    taskId: string,
    repoPath: string,
    attempt?: number,
  ): Promise<SupervisorWorkspaceResult>;

  /**
   * Clean up a workspace for a task that has reached a terminal state.
   *
   * Removes the git worktree, deletes the workspace directory tree,
   * and deletes the task branch. This operation is idempotent — it
   * handles cases where resources are already gone.
   *
   * The caller is responsible for checking task state eligibility and
   * retention policy before invoking cleanup (use {@link isWorkspaceCleanupEligible}
   * from `@factory/domain`).
   *
   * @param taskId - The task whose workspace should be cleaned up.
   * @param repoPath - Absolute path to the source repository.
   * @param options - Optional cleanup configuration.
   * @returns Result indicating which cleanup steps were performed.
   */
  cleanupWorkspace(
    taskId: string,
    repoPath: string,
    options?: SupervisorCleanupOptions,
  ): Promise<SupervisorCleanupResult>;
}

/**
 * Input data for mounting workspace packets.
 * Mirrors MountPacketsInput from infrastructure.
 */
export interface SupervisorMountInput {
  readonly taskPacket: Record<string, unknown>;
  readonly runConfig: Record<string, unknown>;
  readonly policySnapshot: Record<string, unknown>;
}

/**
 * Port for mounting context files into a workspace.
 */
export interface PacketMounterPort {
  /**
   * Mount task packet, run config, and policy snapshot into workspace.
   *
   * @param workspacePath - Absolute path to workspace root directory.
   * @param input - The packet data to mount.
   */
  mountPackets(workspacePath: string, input: SupervisorMountInput): Promise<void>;
}

// ─── Runtime Adapter Port ───────────────────────────────────────────────────

/**
 * Workspace paths available to the worker during execution.
 * Mirrors the infrastructure WorkspacePaths but defined here for decoupling.
 */
export interface SupervisorWorkspacePaths {
  readonly worktreePath: string;
  readonly artifactRoot: string;
  readonly packetInputPath: string;
  readonly policySnapshotPath: string;
}

/**
 * Time-related constraints for a worker run.
 */
export interface SupervisorTimeoutSettings {
  readonly timeBudgetSeconds: number;
  readonly expiresAt: string;
  readonly heartbeatIntervalSeconds: number;
  readonly missedHeartbeatThreshold: number;
  readonly gracePeriodSeconds: number;
}

/**
 * Expected output schema for validation.
 */
export interface SupervisorOutputSchemaExpectation {
  readonly packetType: string;
  readonly schemaVersion: string;
}

/**
 * Complete execution context provided to a worker runtime adapter.
 * Defined here so the application layer does not depend on infrastructure types.
 */
export interface SupervisorRunContext {
  readonly taskPacket: TaskPacket;
  readonly effectivePolicySnapshot: Record<string, unknown>;
  readonly workspacePaths: SupervisorWorkspacePaths;
  readonly outputSchemaExpectation: SupervisorOutputSchemaExpectation;
  readonly timeoutSettings: SupervisorTimeoutSettings;
  /** Custom prompt template text resolved from the agent profile. */
  readonly customPrompt?: string;
}

/**
 * Result of preparing a worker run.
 */
export interface SupervisorPreparedRun {
  readonly runId: string;
  readonly context: SupervisorRunContext;
  readonly preparedAt: string;
}

/**
 * A single output event from a running worker.
 */
export interface SupervisorRunOutputStream {
  readonly type: "stdout" | "stderr" | "system" | "heartbeat";
  readonly content: string;
  readonly timestamp: string;
}

/**
 * Result of attempting to cancel a running worker.
 */
export interface SupervisorCancelResult {
  readonly cancelled: boolean;
  readonly reason?: string;
}

/**
 * Artifacts collected from a completed run.
 */
export interface SupervisorCollectedArtifacts {
  readonly packetOutput: unknown;
  readonly packetValid: boolean;
  readonly artifactPaths: readonly string[];
  readonly validationErrors: readonly string[];
}

/**
 * Log entry from a completed run.
 */
export interface SupervisorRunLogEntry {
  readonly timestamp: string;
  readonly stream: "stdout" | "stderr" | "system";
  readonly content: string;
}

/**
 * Terminal status of a completed worker run.
 */
export type SupervisorRunStatus = "success" | "failed" | "partial" | "cancelled";

/**
 * Final result of a worker run after cleanup.
 */
export interface SupervisorFinalizeResult {
  readonly runId: string;
  readonly status: SupervisorRunStatus;
  readonly packetOutput: unknown;
  readonly artifactPaths: readonly string[];
  readonly logs: readonly SupervisorRunLogEntry[];
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly finalizedAt: string;
}

/**
 * Port for the worker runtime adapter.
 *
 * This mirrors the WorkerRuntime interface from infrastructure but is
 * defined here to maintain the port-based decoupling pattern used by
 * all application services.
 */
export interface RuntimeAdapterPort {
  readonly name: string;
  prepareRun(context: SupervisorRunContext): Promise<SupervisorPreparedRun>;
  startRun(runId: string): Promise<void>;
  streamRun(runId: string): AsyncIterable<SupervisorRunOutputStream>;
  cancelRun(runId: string): Promise<SupervisorCancelResult>;
  collectArtifacts(runId: string): Promise<SupervisorCollectedArtifacts>;
  finalizeRun(runId: string): Promise<SupervisorFinalizeResult>;
}

// ─── Heartbeat Forwarder Port ───────────────────────────────────────────────

/**
 * Port for forwarding heartbeats to the lease/heartbeat service.
 *
 * The supervisor detects heartbeat events in the output stream and
 * forwards them to the heartbeat service to keep the lease alive.
 */
export interface HeartbeatForwarderPort {
  /**
   * Forward a heartbeat for a lease.
   *
   * @param leaseId - The lease to send the heartbeat for.
   * @param workerId - The worker sending the heartbeat.
   * @param isTerminal - Whether this is the terminal heartbeat (completion signal).
   */
  forwardHeartbeat(leaseId: string, workerId: string, isTerminal: boolean): void;
}

// ─── Unit of Work ───────────────────────────────────────────────────────────

/**
 * Transaction repositories available to the supervisor.
 */
export interface WorkerSupervisorTransactionRepositories {
  readonly worker: WorkerSupervisorRepositoryPort;
}

/**
 * Unit of work for supervisor transactional operations.
 */
export interface WorkerSupervisorUnitOfWork {
  runInTransaction<T>(fn: (repos: WorkerSupervisorTransactionRepositories) => T): T;
}

// ─── Lease Transitioner Port ────────────────────────────────────────────────

/**
 * Minimal port for transitioning a worker lease's status.
 *
 * The supervisor uses this to advance the lease from LEASED → STARTING
 * after the worker process is spawned, so the heartbeat service can
 * accept heartbeats (it requires STARTING, RUNNING, or HEARTBEATING).
 *
 * @see docs/prd/002-data-model.md §2.2 — Worker Lease State Machine
 */
export interface LeaseTransitionerPort {
  /**
   * Transition a lease to the given target status.
   *
   * @param leaseId - The lease to transition.
   * @param targetStatus - The target lease status.
   * @param context - Guard context for the state machine validation.
   */
  transitionLease(
    leaseId: string,
    targetStatus: WorkerLeaseStatus,
    context: WorkerLeaseTransitionContext,
  ): void;
}

// ─── Lease Reclaimer Port ───────────────────────────────────────────────────

/**
 * Minimal port for reclaiming a lease after worker failure.
 *
 * Wraps the {@link LeaseReclaimService} to atomically transition the lease
 * to CRASHED → RECLAIMED, evaluate retry/escalation policy, and transition
 * the task back to READY (if retries remain) or FAILED/ESCALATED.
 *
 * The supervisor calls this when `finalizeRun()` reports a non-success
 * outcome or when the spawn process throws an exception.
 *
 * @see docs/prd/002-data-model.md §2.8 — Lease State → Task State Mapping
 */
export interface LeaseReclaimerPort {
  /**
   * Reclaim a lease due to worker failure and recover the task.
   *
   * @param leaseId - The lease to reclaim.
   * @param metadata - Optional metadata for the audit trail (e.g., exit code, error).
   */
  reclaimLease(leaseId: string, metadata?: Record<string, unknown>): void;
}
