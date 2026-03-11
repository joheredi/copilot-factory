/**
 * Reverse-dependency service port interfaces — defines the data-access
 * contract required by the ReverseDependencyService for finding dependent
 * tasks and evaluating their eligibility for state transitions.
 *
 * These interfaces follow the hexagonal architecture pattern: narrow,
 * operation-specific contracts that decouple the service from infrastructure
 * details. The reverse-dependency service reads tasks and dependency edges
 * to identify which blocked tasks may become ready after a prerequisite
 * completes.
 *
 * @see docs/prd/002-data-model.md §2.3 — Dependency rules and readiness
 * @module @factory/application/ports/reverse-dependency.ports
 */

import type { DependencyType, TaskStatus } from "@factory/domain";

// ---------------------------------------------------------------------------
// Entity shapes — minimal fields the reverse-dependency service needs
// ---------------------------------------------------------------------------

/**
 * Minimal task record for reverse-dependency evaluation.
 *
 * The service needs `taskId` and `status` to determine whether a task
 * is in the BLOCKED state (eligible for recalculation) and to verify
 * the completed prerequisite's terminal status.
 */
export interface ReverseDependencyTask {
  readonly taskId: string;
  readonly status: TaskStatus;
}

/**
 * A dependency edge as seen by the reverse-dependency service.
 *
 * Represents a directed edge where `taskId` depends on `dependsOnTaskId`.
 * The service uses `isHardBlock` and `dependencyType` to filter edges
 * that actually affect readiness.
 */
export interface ReverseDependencyEdge {
  readonly taskDependencyId: string;
  /** The dependent (waiting) task. */
  readonly taskId: string;
  /** The prerequisite task. */
  readonly dependsOnTaskId: string;
  readonly dependencyType: DependencyType;
  readonly isHardBlock: boolean;
}

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

/**
 * Port for task data access within the reverse-dependency service.
 *
 * Provides task lookup by ID to check prerequisite and dependent task
 * statuses.
 */
export interface ReverseDependencyTaskRepositoryPort {
  /** Find a task by ID. Returns undefined if not found. */
  findById(id: string): ReverseDependencyTask | undefined;
}

/**
 * Port for dependency edge data access within the reverse-dependency service.
 *
 * Provides reverse lookup: given a prerequisite task ID, find all tasks
 * that depend on it.
 */
export interface ReverseDependencyEdgeRepositoryPort {
  /**
   * Reverse lookup: find all edges where `dependsOnTaskId` matches.
   * Returns edges representing tasks that depend on the given task.
   */
  findByDependsOnTaskId(dependsOnTaskId: string): ReverseDependencyEdge[];
}

// ---------------------------------------------------------------------------
// Unit of Work for reverse-dependency operations
// ---------------------------------------------------------------------------

/**
 * Repository collection available inside a reverse-dependency evaluation.
 */
export interface ReverseDependencyTransactionRepositories {
  readonly task: ReverseDependencyTaskRepositoryPort;
  readonly taskDependency: ReverseDependencyEdgeRepositoryPort;
}

/**
 * Unit of work for reverse-dependency reads.
 *
 * Wraps the read operations in a transaction for consistent point-in-time
 * snapshots of both task statuses and dependency edges.
 */
export interface ReverseDependencyUnitOfWork {
  runInTransaction<T>(fn: (repos: ReverseDependencyTransactionRepositories) => T): T;
}
