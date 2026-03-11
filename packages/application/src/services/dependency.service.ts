/**
 * Dependency service — DAG validation and dependency graph management.
 *
 * Implements circular dependency detection when adding task dependencies.
 * The dependency graph must be validated as a DAG (Directed Acyclic Graph)
 * on every insert. Uses depth-first search (DFS) to detect cycles before
 * committing any new edge.
 *
 * All dependency types (blocks, relates_to, parent_child) participate in
 * the cycle check to maintain a consistent acyclic graph, even though only
 * `blocks` edges with `isHardBlock=true` affect readiness computation.
 *
 * @see docs/prd/002-data-model.md §2.3 — Dependency rules and DAG invariant
 * @module @factory/application/services/dependency.service
 */

import type { DependencyType } from "@factory/domain";
import type {
  DependencyEdge,
  DependencyUnitOfWork,
  TaskDependencyRepositoryPort,
} from "../ports/dependency.ports.js";
import {
  EntityNotFoundError,
  CyclicDependencyError,
  DuplicateDependencyError,
  SelfDependencyError,
} from "../errors.js";

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/** Parameters for adding a new dependency edge. */
export interface AddDependencyParams {
  /** The task that waits (dependent). */
  readonly taskId: string;
  /** The task that must complete first (prerequisite). */
  readonly dependsOnTaskId: string;
  /** Type of dependency relationship. */
  readonly dependencyType: DependencyType;
  /**
   * Whether this is a hard block on readiness.
   * Defaults to true for `blocks` type, false for others.
   */
  readonly isHardBlock?: boolean;
}

/** Result of a successful addDependency operation. */
export interface AddDependencyResult {
  readonly dependency: DependencyEdge;
}

/** Result of a successful removeDependency operation. */
export interface RemoveDependencyResult {
  readonly removed: boolean;
}

/** Result of getDependencies (forward lookup). */
export interface GetDependenciesResult {
  readonly dependencies: readonly DependencyEdge[];
}

/** Result of getDependents (reverse lookup). */
export interface GetDependentsResult {
  readonly dependents: readonly DependencyEdge[];
}

/**
 * DependencyService manages the task dependency graph with DAG validation.
 *
 * Every mutation to the graph runs inside a transaction. Before inserting
 * a new edge, a DFS cycle check ensures the graph remains acyclic.
 */
export interface DependencyService {
  /**
   * Add a dependency edge with cycle detection.
   *
   * Before inserting the edge `taskId → dependsOnTaskId`, this method:
   * 1. Validates both tasks exist
   * 2. Rejects self-dependencies
   * 3. Rejects duplicate edges
   * 4. Runs DFS from `dependsOnTaskId` following forward edges to check
   *    if `taskId` is reachable — if so, adding this edge would create a cycle
   * 5. Inserts the edge atomically within the same transaction as the check
   *
   * @throws {EntityNotFoundError} If either task does not exist
   * @throws {SelfDependencyError} If taskId === dependsOnTaskId
   * @throws {DuplicateDependencyError} If the edge already exists
   * @throws {CyclicDependencyError} If inserting would create a cycle
   */
  addDependency(params: AddDependencyParams): AddDependencyResult;

  /**
   * Remove a dependency edge by its ID.
   *
   * Removing edges cannot create cycles, so no DAG validation is needed.
   */
  removeDependency(taskDependencyId: string): RemoveDependencyResult;

  /**
   * Forward lookup: get all tasks that a given task depends on.
   *
   * Returns edges where `taskId` is the dependent (waiting) task.
   */
  getDependencies(taskId: string): GetDependenciesResult;

  /**
   * Reverse lookup: get all tasks that depend on a given task.
   *
   * Returns edges where `dependsOnTaskId` is the prerequisite task.
   */
  getDependents(taskId: string): GetDependentsResult;
}

// ---------------------------------------------------------------------------
// Cycle detection — DFS implementation
// ---------------------------------------------------------------------------

/**
 * Detect whether adding an edge `fromTaskId → toTaskId` would create a cycle.
 *
 * Strategy: starting from `toTaskId`, follow forward dependency edges
 * (i.e., for each task, look at what it depends on). If we reach
 * `fromTaskId`, then adding the edge would create a cycle.
 *
 * Wait — that's backwards. Let me think carefully:
 * - Edge semantics: `taskId` depends on `dependsOnTaskId`
 * - So `taskId → dependsOnTaskId` means "taskId waits for dependsOnTaskId"
 * - A cycle exists if dependsOnTaskId (transitively) depends on taskId
 * - To check: from dependsOnTaskId, follow its dependencies (findByTaskId)
 *   recursively, checking if taskId is reachable
 *
 * Actually: we want to check if `dependsOnTaskId` transitively depends on
 * `taskId`. So we start DFS from `dependsOnTaskId` and follow forward edges
 * (what does this task depend on?). If we reach `taskId`, there's a cycle.
 *
 * @returns The cycle path if a cycle is detected, or null if safe to insert.
 */
function detectCycle(
  startTaskId: string,
  targetTaskId: string,
  repo: TaskDependencyRepositoryPort,
): readonly string[] | null {
  const visited = new Set<string>();
  const pathStack: string[] = [startTaskId];

  /**
   * DFS traversal following forward dependency edges.
   * Returns true if targetTaskId is reachable from the current node.
   */
  function dfs(currentTaskId: string): boolean {
    if (currentTaskId === targetTaskId) {
      pathStack.push(targetTaskId);
      return true;
    }

    if (visited.has(currentTaskId)) {
      return false;
    }

    visited.add(currentTaskId);

    const edges = repo.findByTaskId(currentTaskId);
    for (const edge of edges) {
      pathStack.push(edge.dependsOnTaskId);
      if (dfs(edge.dependsOnTaskId)) {
        return true;
      }
      pathStack.pop();
    }

    return false;
  }

  // Start DFS from startTaskId's dependencies
  visited.add(startTaskId);
  const initialEdges = repo.findByTaskId(startTaskId);
  for (const edge of initialEdges) {
    pathStack.push(edge.dependsOnTaskId);
    if (dfs(edge.dependsOnTaskId)) {
      return pathStack;
    }
    pathStack.pop();
  }

  return null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a DependencyService with the given dependencies.
 *
 * @param unitOfWork - Transaction boundary for atomic operations
 * @param idGenerator - Generates unique IDs for new dependency edges
 */
export function createDependencyService(
  unitOfWork: DependencyUnitOfWork,
  idGenerator: () => string,
): DependencyService {
  return {
    addDependency(params: AddDependencyParams): AddDependencyResult {
      const { taskId, dependsOnTaskId, dependencyType, isHardBlock } = params;

      // Resolve isHardBlock default: true for BLOCKS type, false for others
      const resolvedIsHardBlock =
        isHardBlock !== undefined ? isHardBlock : dependencyType === ("blocks" as DependencyType);

      return unitOfWork.runInTransaction((repos) => {
        // 1. Reject self-dependencies
        if (taskId === dependsOnTaskId) {
          throw new SelfDependencyError(taskId);
        }

        // 2. Validate both tasks exist
        if (!repos.task.exists(taskId)) {
          throw new EntityNotFoundError("Task", taskId);
        }
        if (!repos.task.exists(dependsOnTaskId)) {
          throw new EntityNotFoundError("Task", dependsOnTaskId);
        }

        // 3. Reject duplicate edges
        const existing = repos.taskDependency.findByTaskIdPair(taskId, dependsOnTaskId);
        if (existing) {
          throw new DuplicateDependencyError(taskId, dependsOnTaskId);
        }

        // 4. Cycle detection: check if dependsOnTaskId transitively depends on taskId
        // If it does, adding taskId → dependsOnTaskId would create a cycle.
        const cyclePath = detectCycle(dependsOnTaskId, taskId, repos.taskDependency);
        if (cyclePath !== null) {
          throw new CyclicDependencyError(taskId, dependsOnTaskId, cyclePath);
        }

        // 5. Insert the edge
        const dependency = repos.taskDependency.create({
          taskDependencyId: idGenerator(),
          taskId,
          dependsOnTaskId,
          dependencyType,
          isHardBlock: resolvedIsHardBlock,
        });

        return { dependency };
      });
    },

    removeDependency(taskDependencyId: string): RemoveDependencyResult {
      return unitOfWork.runInTransaction((repos) => {
        const removed = repos.taskDependency.delete(taskDependencyId);
        return { removed };
      });
    },

    getDependencies(taskId: string): GetDependenciesResult {
      return unitOfWork.runInTransaction((repos) => {
        const dependencies = repos.taskDependency.findByTaskId(taskId);
        return { dependencies };
      });
    },

    getDependents(taskId: string): GetDependentsResult {
      return unitOfWork.runInTransaction((repos) => {
        const dependents = repos.taskDependency.findByDependsOnTaskId(taskId);
        return { dependents };
      });
    },
  };
}
