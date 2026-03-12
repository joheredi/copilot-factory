/**
 * Worker dispatch port interfaces.
 *
 * These interfaces define the data-access contract that the
 * {@link WorkerDispatchService} requires to resolve task and repository
 * context needed for building {@link SpawnWorkerParams}. The dispatch
 * service bridges the job queue (where the scheduler enqueues dispatch
 * instructions) and the worker supervisor (which spawns and manages
 * workers). The port provides a transactional context-resolution
 * capability so the infrastructure layer can handle all DB lookups.
 *
 * @see docs/prd/007-technical-architecture.md §7.8 — Queue / Job Architecture
 * @module @factory/application/ports/worker-dispatch.ports
 */

import type { SupervisorRunContext } from "./worker-supervisor.ports.js";

// ---------------------------------------------------------------------------
// Dispatch context types
// ---------------------------------------------------------------------------

/**
 * Resolved context for spawning a worker, derived from task and
 * repository entities in the database.
 *
 * The dispatch service receives a slim payload from the job queue
 * (taskId, leaseId, poolId, workerId) but needs additional data
 * to build the full {@link SpawnWorkerParams}. This interface
 * represents that resolved data.
 */
export interface WorkerSpawnContext {
  /**
   * Absolute path to the source repository for worktree creation.
   * Resolved from the task's project → repository association.
   */
  readonly repoPath: string;

  /**
   * Human-readable name for the worker.
   * Typically derived from the task title or a generated identifier.
   */
  readonly workerName: string;

  /**
   * The complete run context for the runtime adapter.
   * Contains task packet, policy snapshot, workspace paths,
   * output schema expectation, and timeout settings.
   */
  readonly runContext: SupervisorRunContext;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

/**
 * Port for resolving the full spawn context from a task identifier.
 *
 * The implementation of this port is responsible for:
 * 1. Loading the task entity and its associated project/repository
 * 2. Building the task packet from task data
 * 3. Resolving the effective policy snapshot
 * 4. Computing workspace paths (worktree, artifact root, packet paths)
 * 5. Deriving timeout settings and output schema expectations
 *
 * Returns `null` if the task cannot be found or is in an invalid state
 * for dispatch (e.g., already completed or cancelled).
 */
export interface WorkerDispatchContextPort {
  /**
   * Resolve all context needed to spawn a worker for the given task.
   *
   * @param taskId - The task to resolve context for.
   * @returns The resolved spawn context, or `null` if the task
   *          cannot be found or is not in a dispatchable state.
   */
  resolveSpawnContext(taskId: string): WorkerSpawnContext | null;
}

// ---------------------------------------------------------------------------
// Transaction repositories
// ---------------------------------------------------------------------------

/**
 * Repository ports available inside a worker dispatch transaction.
 */
export interface WorkerDispatchTransactionRepositories {
  /** Port for resolving task/repository context into spawn parameters. */
  readonly dispatch: WorkerDispatchContextPort;
}

// ---------------------------------------------------------------------------
// Unit of Work
// ---------------------------------------------------------------------------

/**
 * Unit of work for worker dispatch operations.
 *
 * Provides transactional access to the context-resolution port.
 * The transaction ensures consistent reads when resolving task
 * and repository data during dispatch.
 */
export interface WorkerDispatchUnitOfWork {
  /**
   * Execute a function within a read transaction.
   *
   * @param fn - Function receiving the transaction repositories.
   * @returns The value returned by `fn`.
   */
  runInTransaction<T>(fn: (repos: WorkerDispatchTransactionRepositories) => T): T;
}
