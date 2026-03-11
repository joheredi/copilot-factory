/**
 * Reverse-dependency recalculation service.
 *
 * When a task reaches DONE, this service automatically recalculates
 * readiness for all reverse-dependent tasks and transitions eligible
 * ones from BLOCKED to READY.
 *
 * ## Design
 *
 * This service composes two existing services:
 * - **ReadinessService** (pure query) — evaluates whether a blocked task
 *   now has all hard-block dependencies satisfied.
 * - **TransitionService** (command) — commits the BLOCKED → READY state
 *   change with audit logging and domain events.
 *
 * The service is idempotent: calling it multiple times for the same
 * completed task produces the same outcome. Already-transitioned tasks
 * are safely skipped via optimistic concurrency or state validation.
 *
 * ## Trigger conditions
 *
 * - **DONE:** Triggers full recalculation for all hard-block reverse
 *   dependents in BLOCKED state.
 * - **FAILED / CANCELLED:** No recalculation — hard-blocked dependents
 *   remain BLOCKED because those terminal states do not satisfy the
 *   "must reach DONE" requirement.
 * - **Other states:** Returns early with zero evaluations — the task
 *   is not in a terminal state that resolves dependencies.
 *
 * @see docs/prd/002-data-model.md §2.3 — Dependency rules and readiness
 * @see docs/prd/005-ai-vs-deterministic.md — Deterministic transition ownership
 * @module @factory/application/services/reverse-dependency.service
 */

import { TaskStatus, DependencyType } from "@factory/domain";
import type { ReverseDependencyUnitOfWork } from "../ports/reverse-dependency.ports.js";
import type { ReadinessService } from "./readiness.service.js";
import type { TransitionService } from "./transition.service.js";
import type { ActorInfo } from "../events/domain-events.js";
import { EntityNotFoundError, InvalidTransitionError, VersionConflictError } from "../errors.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * A task that was successfully transitioned from BLOCKED to READY.
 */
export interface TransitionedTask {
  /** The task that was unblocked. */
  readonly taskId: string;
  /** The state the task was in before transition (always BLOCKED). */
  readonly fromStatus: typeof TaskStatus.BLOCKED;
  /** The state the task was transitioned to (always READY). */
  readonly toStatus: typeof TaskStatus.READY;
}

/**
 * A dependent task that was evaluated but not transitioned.
 *
 * Captures the reason for skipping so operators can diagnose
 * why a task remains blocked after a prerequisite completes.
 */
export interface SkippedTask {
  /** The task that was evaluated but not transitioned. */
  readonly taskId: string;
  /** Human-readable explanation of why the task was skipped. */
  readonly reason: string;
}

/**
 * Result of a reverse-dependency recalculation pass.
 *
 * Contains a complete audit of what happened: the completed task,
 * how many dependents were evaluated, which were transitioned, and
 * which were skipped (with reasons).
 */
export interface RecalculationResult {
  /** The prerequisite task whose completion triggered recalculation. */
  readonly completedTaskId: string;
  /** Current status of the completed task at evaluation time. */
  readonly completedTaskStatus:
    | typeof TaskStatus.DONE
    | typeof TaskStatus.FAILED
    | typeof TaskStatus.CANCELLED
    | (string & {});
  /** Number of unique hard-block dependents evaluated. */
  readonly evaluatedCount: number;
  /** Tasks that were successfully transitioned BLOCKED → READY. */
  readonly transitioned: readonly TransitionedTask[];
  /** Tasks that were evaluated but not transitioned, with reasons. */
  readonly skipped: readonly SkippedTask[];
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * ReverseDependencyService recalculates readiness for downstream tasks
 * when a prerequisite task reaches a terminal state.
 *
 * This is the "propagation" half of the dependency engine — it reacts
 * to task completions and pushes readiness changes forward through the
 * dependency graph. The ReadinessService provides the query logic; this
 * service orchestrates the evaluation and commits transitions.
 */
export interface ReverseDependencyService {
  /**
   * Recalculate readiness for all tasks that depend on the given task.
   *
   * When the completed task is DONE, finds all reverse hard-block
   * dependents in BLOCKED state, evaluates their readiness, and
   * transitions eligible ones to READY.
   *
   * When the completed task is FAILED or CANCELLED, returns immediately
   * with no transitions — hard-blocked dependents remain BLOCKED.
   *
   * Idempotent: safe to call multiple times for the same completed task.
   *
   * @param completedTaskId - The task that reached a terminal state.
   * @param actor - The actor triggering the recalculation (for audit trail).
   * @throws {EntityNotFoundError} If the completed task does not exist.
   */
  recalculateDependents(completedTaskId: string, actor: ActorInfo): RecalculationResult;
}

// ---------------------------------------------------------------------------
// Implementation helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether a reverse-dependency edge is a hard block that affects
 * readiness. Only `blocks` edges with `isHardBlock=true` can prevent a
 * task from being READY.
 */
function isHardBlockEdge(edge: { dependencyType: DependencyType; isHardBlock: boolean }): boolean {
  return edge.dependencyType === DependencyType.BLOCKS && edge.isHardBlock;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a ReverseDependencyService with the given dependencies.
 *
 * @param unitOfWork - Transaction boundary for consistent reads of tasks
 *   and dependency edges.
 * @param readinessService - Pure query service for computing task readiness.
 * @param transitionService - Command service for committing BLOCKED → READY
 *   state transitions with audit logging and domain events.
 */
export function createReverseDependencyService(
  unitOfWork: ReverseDependencyUnitOfWork,
  readinessService: ReadinessService,
  transitionService: TransitionService,
): ReverseDependencyService {
  return {
    recalculateDependents(completedTaskId: string, actor: ActorInfo): RecalculationResult {
      // ---------------------------------------------------------------
      // Step 1: Verify the completed task exists and read its status
      // ---------------------------------------------------------------
      const completedTask = unitOfWork.runInTransaction((repos) => {
        const task = repos.task.findById(completedTaskId);
        if (!task) {
          throw new EntityNotFoundError("Task", completedTaskId);
        }
        return task;
      });

      // ---------------------------------------------------------------
      // Step 2: Only DONE triggers recalculation
      // ---------------------------------------------------------------
      // FAILED/CANCELLED do not satisfy hard-block dependencies, so
      // dependents remain BLOCKED. Other non-terminal states are not
      // actionable either.
      if (completedTask.status !== TaskStatus.DONE) {
        return {
          completedTaskId,
          completedTaskStatus: completedTask.status,
          evaluatedCount: 0,
          transitioned: [],
          skipped: [],
        };
      }

      // ---------------------------------------------------------------
      // Step 3: Find all hard-block reverse dependents in BLOCKED state
      // ---------------------------------------------------------------
      const blockedDependentIds = unitOfWork.runInTransaction((repos) => {
        const reverseEdges = repos.taskDependency.findByDependsOnTaskId(completedTaskId);

        // Only hard-block edges can affect readiness
        const hardBlockEdges = reverseEdges.filter(isHardBlockEdge);

        // Deduplicate dependent task IDs (a task might have multiple
        // edges pointing to the same prerequisite, though unlikely)
        const uniqueTaskIds = new Set(hardBlockEdges.map((e) => e.taskId));

        // Filter to only BLOCKED tasks — other states don't need
        // recalculation (READY is already ready, IN_DEVELOPMENT etc.
        // have already moved past the dependency gate)
        const blocked: string[] = [];
        for (const taskId of uniqueTaskIds) {
          const task = repos.task.findById(taskId);
          if (task && task.status === TaskStatus.BLOCKED) {
            blocked.push(taskId);
          }
        }

        return blocked;
      });

      // ---------------------------------------------------------------
      // Step 4: Compute readiness and transition eligible tasks
      // ---------------------------------------------------------------
      const transitioned: TransitionedTask[] = [];
      const skipped: SkippedTask[] = [];

      for (const taskId of blockedDependentIds) {
        // Use ReadinessService to evaluate all of this task's
        // dependencies — not just the one that completed. A task
        // with multiple hard-block prerequisites only becomes READY
        // when ALL of them are DONE.
        const readiness = readinessService.computeReadiness(taskId);

        if (readiness.status !== "READY") {
          skipped.push({
            taskId,
            reason: "still has unresolved hard-block dependencies",
          });
          continue;
        }

        // -----------------------------------------------------------
        // Step 5: Transition BLOCKED → READY via TransitionService
        // -----------------------------------------------------------
        try {
          transitionService.transitionTask(
            taskId,
            TaskStatus.READY,
            {
              allDependenciesResolved: true,
              hasPolicyBlockers: false,
            },
            actor,
            {
              triggeredBy: "reverse-dependency-recalculation",
              completedTaskId,
            },
          );

          transitioned.push({
            taskId,
            fromStatus: TaskStatus.BLOCKED,
            toStatus: TaskStatus.READY,
          });
        } catch (error: unknown) {
          // Handle expected concurrency and state race conditions
          // gracefully. These are safe to skip — the reconciliation
          // loop (T038) will catch any missed transitions.
          if (error instanceof InvalidTransitionError || error instanceof VersionConflictError) {
            skipped.push({
              taskId,
              reason: `transition failed: ${error.message}`,
            });
          } else {
            // Re-throw unexpected errors (DB failures, etc.)
            throw error;
          }
        }
      }

      return {
        completedTaskId,
        completedTaskStatus: completedTask.status,
        evaluatedCount: blockedDependentIds.length,
        transitioned,
        skipped,
      };
    },
  };
}
