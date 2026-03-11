/**
 * Readiness service — computes whether a task should be READY or BLOCKED.
 *
 * Implements the readiness computation described in PRD §2.3:
 *
 * - **`blocks` with `is_hard_block=true`:** The dependent task cannot enter
 *   READY until the prerequisite reaches DONE.
 * - **`blocks` with `is_hard_block=false`:** Informational only — does not
 *   affect readiness.
 * - **`relates_to`:** Informational link — no effect on readiness.
 * - **`parent_child`:** Parent task cannot reach DONE until all children
 *   are DONE or CANCELLED.
 *
 * When a hard-block dependency is in FAILED or CANCELLED state, the
 * dependent task remains BLOCKED — those terminal states do not satisfy
 * the "must reach DONE" requirement.
 *
 * This service is a pure query — it does NOT perform state transitions.
 * The caller (e.g., the reconciliation loop or dependency module) is
 * responsible for acting on the result by invoking the transition service.
 * This preserves the deterministic orchestration principle.
 *
 * @see docs/prd/002-data-model.md §2.3 — Dependency rules and readiness
 * @see docs/prd/005-ai-vs-deterministic.md — Deterministic transition ownership
 * @module @factory/application/services/readiness.service
 */

import { DependencyType, TaskStatus } from "@factory/domain";
import type { ReadinessDependencyEdge, ReadinessUnitOfWork } from "../ports/readiness.ports.js";
import { EntityNotFoundError } from "../errors.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * A single reason why a task is blocked.
 *
 * Each blocking reason identifies the dependency edge and the current
 * status of the prerequisite task that is preventing readiness.
 */
export interface BlockingReason {
  /** ID of the prerequisite task that hasn't reached DONE. */
  readonly dependsOnTaskId: string;
  /** Current status of the prerequisite task. */
  readonly prerequisiteStatus: TaskStatus;
  /** The dependency type of the edge causing the block. */
  readonly dependencyType: DependencyType;
  /** The dependency edge ID for traceability. */
  readonly taskDependencyId: string;
}

/**
 * Result when a task is READY — all hard-block dependencies are satisfied.
 */
export interface ReadinessResultReady {
  readonly status: "READY";
  readonly taskId: string;
}

/**
 * Result when a task is BLOCKED — at least one hard-block dependency
 * is not satisfied.
 */
export interface ReadinessResultBlocked {
  readonly status: "BLOCKED";
  readonly taskId: string;
  /** Non-empty list of reasons the task is blocked. */
  readonly blockingReasons: readonly BlockingReason[];
}

/**
 * Union result type from `computeReadiness`.
 */
export type ReadinessResult = ReadinessResultReady | ReadinessResultBlocked;

// ---------------------------------------------------------------------------
// Parent-child result types
// ---------------------------------------------------------------------------

/**
 * A single reason why a parent task's children are not all complete.
 *
 * Each reason identifies a child task that hasn't reached DONE or CANCELLED.
 */
export interface ChildBlockingReason {
  /** ID of the child task that hasn't reached DONE or CANCELLED. */
  readonly childTaskId: string;
  /** Current status of the child task. */
  readonly childStatus: TaskStatus;
  /** The dependency edge ID for traceability. */
  readonly taskDependencyId: string;
}

/**
 * Result when all children of a parent are complete (DONE or CANCELLED).
 */
export interface ParentReadinessResultComplete {
  readonly status: "COMPLETE";
  readonly parentTaskId: string;
}

/**
 * Result when a parent still has incomplete children.
 */
export interface ParentReadinessResultIncomplete {
  readonly status: "INCOMPLETE";
  readonly parentTaskId: string;
  /** Non-empty list of incomplete children. */
  readonly incompleteChildren: readonly ChildBlockingReason[];
}

/**
 * Union result type from `checkParentChildReadiness`.
 */
export type ParentReadinessResult = ParentReadinessResultComplete | ParentReadinessResultIncomplete;

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * ReadinessService computes task readiness based on hard-block dependencies.
 *
 * This is a pure query service — it evaluates the current state of
 * dependencies and returns a result. It does NOT trigger state transitions.
 * The caller is responsible for acting on the result.
 */
export interface ReadinessService {
  /**
   * Compute whether a task should be READY or BLOCKED.
   *
   * Evaluates all hard-block dependencies (`blocks` with `isHardBlock=true`)
   * for the given task. The task is READY only if every hard-block
   * prerequisite has reached DONE. Otherwise it is BLOCKED, with a list
   * of reasons identifying which prerequisites are unsatisfied.
   *
   * Soft-block dependencies (`isHardBlock=false`) and `relates_to` edges
   * are ignored — they do not affect readiness.
   *
   * @throws {EntityNotFoundError} If the task does not exist.
   */
  computeReadiness(taskId: string): ReadinessResult;

  /**
   * Check whether all children of a parent task are complete.
   *
   * For `parent_child` dependency semantics: a parent cannot reach DONE
   * until all children are DONE or CANCELLED. This method evaluates
   * the children's statuses and returns COMPLETE or INCOMPLETE.
   *
   * @throws {EntityNotFoundError} If the parent task does not exist.
   */
  checkParentChildReadiness(parentTaskId: string): ParentReadinessResult;
}

// ---------------------------------------------------------------------------
// Implementation helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether a dependency edge is a hard block that affects readiness.
 *
 * Only `blocks` type edges with `isHardBlock=true` prevent a task from
 * being READY. All other edge types are informational.
 */
function isReadinessBlockingEdge(edge: ReadinessDependencyEdge): boolean {
  return edge.dependencyType === DependencyType.BLOCKS && edge.isHardBlock;
}

/**
 * Determine whether a dependency edge represents a parent_child relationship.
 */
function isParentChildEdge(edge: ReadinessDependencyEdge): boolean {
  return edge.dependencyType === DependencyType.PARENT_CHILD;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a ReadinessService with the given dependencies.
 *
 * @param unitOfWork - Transaction boundary for consistent reads
 */
export function createReadinessService(unitOfWork: ReadinessUnitOfWork): ReadinessService {
  return {
    computeReadiness(taskId: string): ReadinessResult {
      return unitOfWork.runInTransaction((repos) => {
        // Verify the task exists
        const task = repos.task.findById(taskId);
        if (!task) {
          throw new EntityNotFoundError("Task", taskId);
        }

        // Get all forward dependencies for this task
        const dependencies = repos.taskDependency.findByTaskId(taskId);

        // Filter to only hard-block edges that affect readiness
        const hardBlockEdges = dependencies.filter(isReadinessBlockingEdge);

        // If there are no hard-block dependencies, the task is READY
        if (hardBlockEdges.length === 0) {
          return { status: "READY" as const, taskId };
        }

        // Check each hard-block prerequisite's status
        const blockingReasons: BlockingReason[] = [];

        for (const edge of hardBlockEdges) {
          const prerequisite = repos.task.findById(edge.dependsOnTaskId);

          // If prerequisite doesn't exist, treat as blocking (defensive)
          if (!prerequisite) {
            blockingReasons.push({
              dependsOnTaskId: edge.dependsOnTaskId,
              prerequisiteStatus: TaskStatus.BACKLOG,
              dependencyType: edge.dependencyType,
              taskDependencyId: edge.taskDependencyId,
            });
            continue;
          }

          // Only DONE satisfies a hard-block dependency
          if (prerequisite.status !== TaskStatus.DONE) {
            blockingReasons.push({
              dependsOnTaskId: edge.dependsOnTaskId,
              prerequisiteStatus: prerequisite.status,
              dependencyType: edge.dependencyType,
              taskDependencyId: edge.taskDependencyId,
            });
          }
        }

        if (blockingReasons.length === 0) {
          return { status: "READY" as const, taskId };
        }

        return {
          status: "BLOCKED" as const,
          taskId,
          blockingReasons,
        };
      });
    },

    checkParentChildReadiness(parentTaskId: string): ParentReadinessResult {
      return unitOfWork.runInTransaction((repos) => {
        // Verify the parent task exists
        const parent = repos.task.findById(parentTaskId);
        if (!parent) {
          throw new EntityNotFoundError("Task", parentTaskId);
        }

        // Find all parent_child edges where this task is the parent.
        // In parent_child edges, the parent depends on the child
        // (parent cannot DONE until children are DONE/CANCELLED).
        // So we look for edges where dependsOnTaskId is the child
        // and taskId is the parent.
        const allDependencies = repos.taskDependency.findByTaskId(parentTaskId);
        const childEdges = allDependencies.filter(isParentChildEdge);

        // If no children, parent is complete
        if (childEdges.length === 0) {
          return { status: "COMPLETE" as const, parentTaskId };
        }

        // Check each child's status — must be DONE or CANCELLED
        const incompleteChildren: ChildBlockingReason[] = [];

        for (const edge of childEdges) {
          const child = repos.task.findById(edge.dependsOnTaskId);

          // If child doesn't exist, treat as incomplete (defensive)
          if (!child) {
            incompleteChildren.push({
              childTaskId: edge.dependsOnTaskId,
              childStatus: TaskStatus.BACKLOG,
              taskDependencyId: edge.taskDependencyId,
            });
            continue;
          }

          if (child.status !== TaskStatus.DONE && child.status !== TaskStatus.CANCELLED) {
            incompleteChildren.push({
              childTaskId: edge.dependsOnTaskId,
              childStatus: child.status,
              taskDependencyId: edge.taskDependencyId,
            });
          }
        }

        if (incompleteChildren.length === 0) {
          return { status: "COMPLETE" as const, parentTaskId };
        }

        return {
          status: "INCOMPLETE" as const,
          parentTaskId,
          incompleteChildren,
        };
      });
    },
  };
}
