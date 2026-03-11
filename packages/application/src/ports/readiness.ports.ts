/**
 * Readiness service port interfaces — defines the data-access contract
 * required by the ReadinessService for computing task readiness.
 *
 * These interfaces follow the hexagonal architecture pattern used by
 * other application-layer ports: narrow, operation-specific contracts that
 * decouple the service from infrastructure details.
 *
 * @see docs/prd/002-data-model.md §2.3 — TaskDependency and readiness rules
 * @module @factory/application/ports/readiness.ports
 */

import type { DependencyType, TaskStatus } from "@factory/domain";

// ---------------------------------------------------------------------------
// Entity shapes — minimal fields the readiness service needs
// ---------------------------------------------------------------------------

/**
 * Minimal task record for readiness evaluation.
 *
 * Only the `taskId` and `status` are needed — the readiness service
 * checks whether prerequisite tasks have reached DONE (or DONE/CANCELLED
 * for parent_child edges).
 */
export interface ReadinessTask {
  readonly taskId: string;
  readonly status: TaskStatus;
}

/**
 * A dependency edge as seen by the readiness service.
 *
 * Represents a directed edge where `taskId` depends on `dependsOnTaskId`.
 * The readiness service only cares about `isHardBlock` and `dependencyType`
 * to decide whether the edge affects readiness.
 */
export interface ReadinessDependencyEdge {
  readonly taskDependencyId: string;
  readonly taskId: string;
  readonly dependsOnTaskId: string;
  readonly dependencyType: DependencyType;
  readonly isHardBlock: boolean;
}

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

/**
 * Port for task data access within the readiness service.
 *
 * Provides task lookup by ID to check prerequisite task statuses.
 */
export interface ReadinessTaskRepositoryPort {
  /** Find a task by ID. Returns undefined if not found. */
  findById(id: string): ReadinessTask | undefined;
}

/**
 * Port for task dependency data access within the readiness service.
 *
 * Provides forward dependency lookup (what does a task depend on?)
 * and reverse lookup for parent_child edges (what children does a parent have?).
 */
export interface ReadinessTaskDependencyRepositoryPort {
  /**
   * Forward lookup: find all dependencies of a given task.
   * Returns edges where `taskId` is the dependent (waiting) task.
   */
  findByTaskId(taskId: string): ReadinessDependencyEdge[];

  /**
   * Reverse lookup: find all tasks that depend on a given task.
   * Returns edges where `dependsOnTaskId` is the prerequisite task.
   * Used for parent_child: find children of a parent task.
   */
  findByDependsOnTaskId(dependsOnTaskId: string): ReadinessDependencyEdge[];
}

// ---------------------------------------------------------------------------
// Unit of Work for readiness operations
// ---------------------------------------------------------------------------

/**
 * Repository collection available inside a readiness computation.
 */
export interface ReadinessTransactionRepositories {
  readonly task: ReadinessTaskRepositoryPort;
  readonly taskDependency: ReadinessTaskDependencyRepositoryPort;
}

/**
 * Unit of work for readiness computations.
 *
 * Wraps readiness queries in a transaction for consistent reads —
 * the readiness result should reflect a single point-in-time snapshot
 * of both the dependency graph and task statuses.
 */
export interface ReadinessUnitOfWork {
  runInTransaction<T>(fn: (repos: ReadinessTransactionRepositories) => T): T;
}
