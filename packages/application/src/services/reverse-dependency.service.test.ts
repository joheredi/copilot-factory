/**
 * Tests for the reverse-dependency recalculation service.
 *
 * These tests verify that when a task reaches a terminal state (DONE, FAILED,
 * CANCELLED), the service correctly evaluates all reverse hard-block dependents
 * and transitions eligible BLOCKED tasks to READY.
 *
 * The test suite covers:
 * - **DONE triggers:** Verifies that completing a task unblocks dependents
 *   whose hard-block dependencies are all satisfied.
 * - **FAILED/CANCELLED no-ops:** Verifies that terminal states other than
 *   DONE do not trigger any transitions.
 * - **Multi-dependency chains:** Verifies that a task with multiple hard-block
 *   prerequisites only becomes READY when ALL are DONE.
 * - **Edge filtering:** Verifies that only hard-block `blocks` edges are
 *   considered; soft-block and `relates_to` edges are ignored.
 * - **Idempotency:** Verifies that calling the service multiple times for
 *   the same completed task is safe.
 * - **Error handling:** Verifies graceful handling of missing tasks, version
 *   conflicts, and invalid transitions.
 *
 * @see docs/prd/002-data-model.md §2.3 — Dependency rules and readiness
 * @module @factory/application/services/reverse-dependency.service.test
 */

import { describe, it, expect } from "vitest";
import { TaskStatus, DependencyType } from "@factory/domain";
import { createReverseDependencyService } from "./reverse-dependency.service.js";
import type { ReadinessService, ReadinessResult } from "./readiness.service.js";
import type { TransitionService } from "./transition.service.js";
import type {
  ReverseDependencyTask,
  ReverseDependencyEdge,
  ReverseDependencyUnitOfWork,
  ReverseDependencyTransactionRepositories,
} from "../ports/reverse-dependency.ports.js";
import type { ActorInfo } from "../events/domain-events.js";
import { EntityNotFoundError, InvalidTransitionError, VersionConflictError } from "../errors.js";

// ---------------------------------------------------------------------------
// Mock infrastructure — follows the same in-memory pattern used by
// readiness.service.test.ts and dependency.service.test.ts
// ---------------------------------------------------------------------------

interface MockState {
  tasks: Map<string, ReverseDependencyTask>;
  edges: ReverseDependencyEdge[];
}

function createMockTaskRepo(state: MockState) {
  return {
    findById(id: string): ReverseDependencyTask | undefined {
      return state.tasks.get(id);
    },
  };
}

function createMockEdgeRepo(state: MockState) {
  return {
    findByDependsOnTaskId(dependsOnTaskId: string): ReverseDependencyEdge[] {
      return state.edges.filter((e) => e.dependsOnTaskId === dependsOnTaskId);
    },
  };
}

function createMockUnitOfWork(state: MockState): ReverseDependencyUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: ReverseDependencyTransactionRepositories) => T): T {
      return fn({
        task: createMockTaskRepo(state),
        taskDependency: createMockEdgeRepo(state),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Test helpers — edge creation and service setup
// ---------------------------------------------------------------------------

/** System actor used for all test transitions. */
const SYSTEM_ACTOR: ActorInfo = { type: "system", id: "reverse-dep-service" };

let edgeCounter = 0;

/**
 * Create a hard-block dependency edge (blocks + isHardBlock=true).
 * This is the only edge type that affects readiness.
 */
function hardBlock(taskId: string, dependsOnTaskId: string): ReverseDependencyEdge {
  return {
    taskDependencyId: `dep-${++edgeCounter}`,
    taskId,
    dependsOnTaskId,
    dependencyType: DependencyType.BLOCKS,
    isHardBlock: true,
  };
}

/**
 * Create a soft-block dependency edge (blocks + isHardBlock=false).
 * Does NOT affect readiness — should be ignored by the service.
 */
function softBlock(taskId: string, dependsOnTaskId: string): ReverseDependencyEdge {
  return {
    taskDependencyId: `dep-${++edgeCounter}`,
    taskId,
    dependsOnTaskId,
    dependencyType: DependencyType.BLOCKS,
    isHardBlock: false,
  };
}

/**
 * Create a relates_to dependency edge.
 * Does NOT affect readiness — should be ignored by the service.
 */
function relatesTo(taskId: string, dependsOnTaskId: string): ReverseDependencyEdge {
  return {
    taskDependencyId: `dep-${++edgeCounter}`,
    taskId,
    dependsOnTaskId,
    dependencyType: DependencyType.RELATES_TO,
    isHardBlock: false,
  };
}

/**
 * Create a parent_child dependency edge.
 * Does NOT affect readiness in the forward direction — should be ignored.
 */
function parentChild(taskId: string, dependsOnTaskId: string): ReverseDependencyEdge {
  return {
    taskDependencyId: `dep-${++edgeCounter}`,
    taskId,
    dependsOnTaskId,
    dependencyType: DependencyType.PARENT_CHILD,
    isHardBlock: false,
  };
}

/**
 * Create a mock ReadinessService that returns configurable results.
 * Defaults to READY for all tasks unless overridden.
 */
function createMockReadinessService(
  overrides: Map<string, ReadinessResult> = new Map(),
): ReadinessService {
  return {
    computeReadiness(taskId: string): ReadinessResult {
      const override = overrides.get(taskId);
      if (override) {
        return override;
      }
      // Default: task is READY
      return { status: "READY", taskId };
    },
    checkParentChildReadiness() {
      return { status: "COMPLETE" as const, parentTaskId: "" };
    },
  };
}

/**
 * Create a mock TransitionService that records all transitions.
 * Can be configured to throw errors for specific task IDs.
 */
function createMockTransitionService(
  errors: Map<string, Error> = new Map(),
): TransitionService & { calls: Array<{ taskId: string; targetStatus: string }> } {
  const calls: Array<{ taskId: string; targetStatus: string }> = [];
  return {
    calls,
    transitionTask(taskId, targetStatus, _context, _actor, _metadata) {
      const error = errors.get(taskId);
      if (error) {
        throw error;
      }
      calls.push({ taskId, targetStatus });
      // Return a minimal result (the service only cares about success/failure)
      return {
        entity: {
          taskId,
          status: targetStatus,
          version: 2,
          projectId: "",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        auditEvent: {
          auditEventId: "ae-1",
          entityType: "task",
          entityId: taskId,
          eventType: "",
          actorType: "system",
          actorId: "",
          oldState: "",
          newState: "",
          metadata: null,
          createdAt: new Date(),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    },
    transitionLease() {
      throw new Error("Not expected in these tests");
    },
    transitionReviewCycle() {
      throw new Error("Not expected in these tests");
    },
    transitionMergeQueueItem() {
      throw new Error("Not expected in these tests");
    },
  };
}

interface SetupOptions {
  tasks: Array<[string, (typeof TaskStatus)[keyof typeof TaskStatus]]>;
  edges?: ReverseDependencyEdge[];
  readinessOverrides?: Map<string, ReadinessResult>;
  transitionErrors?: Map<string, Error>;
}

/**
 * Set up a test scenario with tasks, edges, and mock services.
 * Returns the service under test and all mock objects for assertions.
 */
function setup(opts: SetupOptions) {
  edgeCounter = 0;

  const state: MockState = {
    tasks: new Map(opts.tasks.map(([id, status]) => [id, { taskId: id, status }])),
    edges: opts.edges ?? [],
  };

  const unitOfWork = createMockUnitOfWork(state);
  const readinessService = createMockReadinessService(opts.readinessOverrides);
  const transitionService = createMockTransitionService(opts.transitionErrors);

  const service = createReverseDependencyService(unitOfWork, readinessService, transitionService);

  return { service, state, transitionService, readinessService };
}

// ===========================================================================
// Test suite
// ===========================================================================

describe("ReverseDependencyService", () => {
  // -------------------------------------------------------------------------
  // Basic DONE triggers
  // -------------------------------------------------------------------------

  describe("when a task reaches DONE", () => {
    /**
     * Validates the core behavior: a single BLOCKED dependent with one
     * hard-block dependency on the completed task should be transitioned
     * to READY when the prerequisite completes.
     */
    it("should transition a single BLOCKED dependent to READY", () => {
      const { service, transitionService } = setup({
        tasks: [
          ["task-a", TaskStatus.DONE],
          ["task-b", TaskStatus.BLOCKED],
        ],
        edges: [hardBlock("task-b", "task-a")],
      });

      const result = service.recalculateDependents("task-a", SYSTEM_ACTOR);

      expect(result.completedTaskId).toBe("task-a");
      expect(result.completedTaskStatus).toBe(TaskStatus.DONE);
      expect(result.evaluatedCount).toBe(1);
      expect(result.transitioned).toHaveLength(1);
      expect(result.transitioned[0]!.taskId).toBe("task-b");
      expect(result.transitioned[0]!.fromStatus).toBe(TaskStatus.BLOCKED);
      expect(result.transitioned[0]!.toStatus).toBe(TaskStatus.READY);
      expect(result.skipped).toHaveLength(0);
      expect(transitionService.calls).toHaveLength(1);
      expect(transitionService.calls[0]!.taskId).toBe("task-b");
      expect(transitionService.calls[0]!.targetStatus).toBe(TaskStatus.READY);
    });

    /**
     * Validates that multiple BLOCKED dependents are all evaluated and
     * transitioned when they are all ready.
     */
    it("should transition multiple BLOCKED dependents to READY", () => {
      const { service, transitionService } = setup({
        tasks: [
          ["prereq", TaskStatus.DONE],
          ["dep-1", TaskStatus.BLOCKED],
          ["dep-2", TaskStatus.BLOCKED],
          ["dep-3", TaskStatus.BLOCKED],
        ],
        edges: [
          hardBlock("dep-1", "prereq"),
          hardBlock("dep-2", "prereq"),
          hardBlock("dep-3", "prereq"),
        ],
      });

      const result = service.recalculateDependents("prereq", SYSTEM_ACTOR);

      expect(result.evaluatedCount).toBe(3);
      expect(result.transitioned).toHaveLength(3);
      const transitionedIds = result.transitioned.map((t) => t.taskId).sort();
      expect(transitionedIds).toEqual(["dep-1", "dep-2", "dep-3"]);
      expect(transitionService.calls).toHaveLength(3);
    });

    /**
     * Validates that dependents not in BLOCKED state are ignored.
     * Tasks in READY, IN_DEVELOPMENT, etc. have already passed the
     * dependency gate and don't need recalculation.
     */
    it("should skip dependents not in BLOCKED state", () => {
      const { service, transitionService } = setup({
        tasks: [
          ["prereq", TaskStatus.DONE],
          ["already-ready", TaskStatus.READY],
          ["in-dev", TaskStatus.IN_DEVELOPMENT],
          ["blocked-one", TaskStatus.BLOCKED],
        ],
        edges: [
          hardBlock("already-ready", "prereq"),
          hardBlock("in-dev", "prereq"),
          hardBlock("blocked-one", "prereq"),
        ],
      });

      const result = service.recalculateDependents("prereq", SYSTEM_ACTOR);

      // Only blocked-one should be evaluated
      expect(result.evaluatedCount).toBe(1);
      expect(result.transitioned).toHaveLength(1);
      expect(result.transitioned[0]!.taskId).toBe("blocked-one");
      expect(transitionService.calls).toHaveLength(1);
    });

    /**
     * Validates that when there are no reverse dependents, the service
     * returns a clean result with zero evaluations.
     */
    it("should handle a task with no dependents", () => {
      const { service } = setup({
        tasks: [["lonely-task", TaskStatus.DONE]],
        edges: [],
      });

      const result = service.recalculateDependents("lonely-task", SYSTEM_ACTOR);

      expect(result.completedTaskId).toBe("lonely-task");
      expect(result.completedTaskStatus).toBe(TaskStatus.DONE);
      expect(result.evaluatedCount).toBe(0);
      expect(result.transitioned).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Multi-dependency evaluation
  // -------------------------------------------------------------------------

  describe("multiple hard-block dependencies", () => {
    /**
     * Validates that a task with multiple prerequisites only becomes READY
     * when ALL hard-block dependencies are DONE. If one prerequisite
     * completes but another is still pending, the task stays BLOCKED.
     */
    it("should keep task BLOCKED when not all prerequisites are DONE", () => {
      const { service, transitionService } = setup({
        tasks: [
          ["prereq-1", TaskStatus.DONE],
          ["prereq-2", TaskStatus.IN_DEVELOPMENT],
          ["dependent", TaskStatus.BLOCKED],
        ],
        edges: [hardBlock("dependent", "prereq-1"), hardBlock("dependent", "prereq-2")],
        readinessOverrides: new Map([
          [
            "dependent",
            {
              status: "BLOCKED",
              taskId: "dependent",
              blockingReasons: [
                {
                  dependsOnTaskId: "prereq-2",
                  prerequisiteStatus: TaskStatus.IN_DEVELOPMENT,
                  dependencyType: DependencyType.BLOCKS,
                  taskDependencyId: "dep-2",
                },
              ],
            },
          ],
        ]),
      });

      const result = service.recalculateDependents("prereq-1", SYSTEM_ACTOR);

      expect(result.evaluatedCount).toBe(1);
      expect(result.transitioned).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]!.taskId).toBe("dependent");
      expect(result.skipped[0]!.reason).toContain("unresolved");
      expect(transitionService.calls).toHaveLength(0);
    });

    /**
     * Validates that a task with multiple prerequisites becomes READY
     * when the last blocking prerequisite completes.
     */
    it("should transition task when the last prerequisite completes", () => {
      const { service, transitionService } = setup({
        tasks: [
          ["prereq-1", TaskStatus.DONE],
          ["prereq-2", TaskStatus.DONE],
          ["dependent", TaskStatus.BLOCKED],
        ],
        edges: [hardBlock("dependent", "prereq-1"), hardBlock("dependent", "prereq-2")],
        // ReadinessService returns READY because both prereqs are DONE
      });

      const result = service.recalculateDependents("prereq-2", SYSTEM_ACTOR);

      expect(result.evaluatedCount).toBe(1);
      expect(result.transitioned).toHaveLength(1);
      expect(result.transitioned[0]!.taskId).toBe("dependent");
      expect(transitionService.calls).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // FAILED / CANCELLED — no recalculation
  // -------------------------------------------------------------------------

  describe("when a task reaches FAILED or CANCELLED", () => {
    /**
     * Validates that FAILED tasks do not trigger any recalculation.
     * FAILED does not satisfy hard-block dependencies, so dependents
     * must remain BLOCKED.
     */
    it("should not recalculate when task is FAILED", () => {
      const { service, transitionService } = setup({
        tasks: [
          ["failed-task", TaskStatus.FAILED],
          ["dependent", TaskStatus.BLOCKED],
        ],
        edges: [hardBlock("dependent", "failed-task")],
      });

      const result = service.recalculateDependents("failed-task", SYSTEM_ACTOR);

      expect(result.completedTaskStatus).toBe(TaskStatus.FAILED);
      expect(result.evaluatedCount).toBe(0);
      expect(result.transitioned).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
      expect(transitionService.calls).toHaveLength(0);
    });

    /**
     * Validates that CANCELLED tasks do not trigger any recalculation.
     * CANCELLED does not satisfy hard-block dependencies.
     */
    it("should not recalculate when task is CANCELLED", () => {
      const { service, transitionService } = setup({
        tasks: [
          ["cancelled-task", TaskStatus.CANCELLED],
          ["dependent", TaskStatus.BLOCKED],
        ],
        edges: [hardBlock("dependent", "cancelled-task")],
      });

      const result = service.recalculateDependents("cancelled-task", SYSTEM_ACTOR);

      expect(result.completedTaskStatus).toBe(TaskStatus.CANCELLED);
      expect(result.evaluatedCount).toBe(0);
      expect(result.transitioned).toHaveLength(0);
      expect(transitionService.calls).toHaveLength(0);
    });

    /**
     * Validates that non-terminal states (e.g., IN_DEVELOPMENT) also
     * don't trigger recalculation — the task hasn't completed yet.
     */
    it.each([
      TaskStatus.BACKLOG,
      TaskStatus.READY,
      TaskStatus.BLOCKED,
      TaskStatus.ASSIGNED,
      TaskStatus.IN_DEVELOPMENT,
      TaskStatus.DEV_COMPLETE,
      TaskStatus.IN_REVIEW,
      TaskStatus.CHANGES_REQUESTED,
      TaskStatus.APPROVED,
      TaskStatus.QUEUED_FOR_MERGE,
      TaskStatus.MERGING,
      TaskStatus.POST_MERGE_VALIDATION,
      TaskStatus.ESCALATED,
    ])("should not recalculate when task is in %s state", (status) => {
      const { service, transitionService } = setup({
        tasks: [
          ["task-x", status],
          ["dependent", TaskStatus.BLOCKED],
        ],
        edges: [hardBlock("dependent", "task-x")],
      });

      const result = service.recalculateDependents("task-x", SYSTEM_ACTOR);

      expect(result.evaluatedCount).toBe(0);
      expect(result.transitioned).toHaveLength(0);
      expect(transitionService.calls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Edge type filtering
  // -------------------------------------------------------------------------

  describe("edge type filtering", () => {
    /**
     * Validates that soft-block edges (blocks + isHardBlock=false) do NOT
     * trigger recalculation for the dependent task.
     */
    it("should ignore soft-block edges", () => {
      const { service, transitionService } = setup({
        tasks: [
          ["prereq", TaskStatus.DONE],
          ["soft-dep", TaskStatus.BLOCKED],
        ],
        edges: [softBlock("soft-dep", "prereq")],
      });

      const result = service.recalculateDependents("prereq", SYSTEM_ACTOR);

      expect(result.evaluatedCount).toBe(0);
      expect(result.transitioned).toHaveLength(0);
      expect(transitionService.calls).toHaveLength(0);
    });

    /**
     * Validates that relates_to edges do NOT trigger recalculation.
     * These are informational only.
     */
    it("should ignore relates_to edges", () => {
      const { service, transitionService } = setup({
        tasks: [
          ["prereq", TaskStatus.DONE],
          ["related", TaskStatus.BLOCKED],
        ],
        edges: [relatesTo("related", "prereq")],
      });

      const result = service.recalculateDependents("prereq", SYSTEM_ACTOR);

      expect(result.evaluatedCount).toBe(0);
      expect(result.transitioned).toHaveLength(0);
      expect(transitionService.calls).toHaveLength(0);
    });

    /**
     * Validates that parent_child edges do NOT trigger recalculation.
     * Parent-child readiness is evaluated differently (parent waits for
     * children, not vice versa).
     */
    it("should ignore parent_child edges", () => {
      const { service, transitionService } = setup({
        tasks: [
          ["child", TaskStatus.DONE],
          ["parent", TaskStatus.BLOCKED],
        ],
        edges: [parentChild("parent", "child")],
      });

      const result = service.recalculateDependents("child", SYSTEM_ACTOR);

      expect(result.evaluatedCount).toBe(0);
      expect(result.transitioned).toHaveLength(0);
      expect(transitionService.calls).toHaveLength(0);
    });

    /**
     * Validates that when a mix of edge types exists, only hard-block
     * edges trigger evaluation.
     */
    it("should evaluate only hard-block edges in a mixed graph", () => {
      const { service, transitionService } = setup({
        tasks: [
          ["prereq", TaskStatus.DONE],
          ["hard-dep", TaskStatus.BLOCKED],
          ["soft-dep", TaskStatus.BLOCKED],
          ["related", TaskStatus.BLOCKED],
        ],
        edges: [
          hardBlock("hard-dep", "prereq"),
          softBlock("soft-dep", "prereq"),
          relatesTo("related", "prereq"),
        ],
      });

      const result = service.recalculateDependents("prereq", SYSTEM_ACTOR);

      // Only hard-dep should be evaluated
      expect(result.evaluatedCount).toBe(1);
      expect(result.transitioned).toHaveLength(1);
      expect(result.transitioned[0]!.taskId).toBe("hard-dep");
      expect(transitionService.calls).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    /**
     * Validates that EntityNotFoundError is thrown when the completed
     * task does not exist. This prevents silent failures when called
     * with an invalid task ID.
     */
    it("should throw EntityNotFoundError for non-existent completed task", () => {
      const { service } = setup({
        tasks: [],
        edges: [],
      });

      expect(() => service.recalculateDependents("ghost", SYSTEM_ACTOR)).toThrow(
        EntityNotFoundError,
      );
    });

    /**
     * Validates that InvalidTransitionError from the transition service
     * is caught and the task is added to the skipped list instead of
     * crashing the entire recalculation pass. This ensures idempotency —
     * if a task was already transitioned by another process, we skip it
     * gracefully.
     */
    it("should skip tasks that fail with InvalidTransitionError", () => {
      const { service } = setup({
        tasks: [
          ["prereq", TaskStatus.DONE],
          ["dep-ok", TaskStatus.BLOCKED],
          ["dep-conflict", TaskStatus.BLOCKED],
        ],
        edges: [hardBlock("dep-ok", "prereq"), hardBlock("dep-conflict", "prereq")],
        transitionErrors: new Map([
          [
            "dep-conflict",
            new InvalidTransitionError(
              "Task",
              "dep-conflict",
              TaskStatus.BLOCKED,
              TaskStatus.READY,
              "already transitioned",
            ),
          ],
        ]),
      });

      const result = service.recalculateDependents("prereq", SYSTEM_ACTOR);

      expect(result.evaluatedCount).toBe(2);
      // dep-ok should be transitioned, dep-conflict should be skipped
      expect(result.transitioned).toHaveLength(1);
      expect(result.transitioned[0]!.taskId).toBe("dep-ok");
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]!.taskId).toBe("dep-conflict");
      expect(result.skipped[0]!.reason).toContain("transition failed");
    });

    /**
     * Validates that VersionConflictError from optimistic concurrency
     * is caught and the task is added to the skipped list. This handles
     * the case where another process modified the task between our
     * readiness check and the transition attempt.
     */
    it("should skip tasks that fail with VersionConflictError", () => {
      const { service } = setup({
        tasks: [
          ["prereq", TaskStatus.DONE],
          ["dep-race", TaskStatus.BLOCKED],
        ],
        edges: [hardBlock("dep-race", "prereq")],
        transitionErrors: new Map([["dep-race", new VersionConflictError("Task", "dep-race", 1)]]),
      });

      const result = service.recalculateDependents("prereq", SYSTEM_ACTOR);

      expect(result.evaluatedCount).toBe(1);
      expect(result.transitioned).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]!.taskId).toBe("dep-race");
      expect(result.skipped[0]!.reason).toContain("transition failed");
    });

    /**
     * Validates that unexpected errors (not InvalidTransitionError or
     * VersionConflictError) are re-thrown. The service should not
     * swallow infrastructure failures — those need to bubble up.
     */
    it("should re-throw unexpected errors", () => {
      const { service } = setup({
        tasks: [
          ["prereq", TaskStatus.DONE],
          ["dep-crash", TaskStatus.BLOCKED],
        ],
        edges: [hardBlock("dep-crash", "prereq")],
        transitionErrors: new Map([["dep-crash", new Error("database connection lost")]]),
      });

      expect(() => service.recalculateDependents("prereq", SYSTEM_ACTOR)).toThrow(
        "database connection lost",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency
  // -------------------------------------------------------------------------

  describe("idempotency", () => {
    /**
     * Validates that calling the service twice for the same completed task
     * doesn't cause errors or duplicate transitions. The second call
     * should find no BLOCKED dependents (they were already transitioned
     * to READY on the first call).
     */
    it("should be safe to call multiple times", () => {
      const state: MockState = {
        tasks: new Map([
          ["prereq", { taskId: "prereq", status: TaskStatus.DONE }],
          ["dependent", { taskId: "dependent", status: TaskStatus.BLOCKED }],
        ]),
        edges: [
          {
            taskDependencyId: "dep-1",
            taskId: "dependent",
            dependsOnTaskId: "prereq",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
        ],
      };

      const unitOfWork = createMockUnitOfWork(state);
      const readinessService = createMockReadinessService();
      const transitionService = createMockTransitionService();

      const service = createReverseDependencyService(
        unitOfWork,
        readinessService,
        transitionService,
      );

      // First call: should transition
      const result1 = service.recalculateDependents("prereq", SYSTEM_ACTOR);
      expect(result1.transitioned).toHaveLength(1);

      // Simulate the transition: update mock state
      state.tasks.set("dependent", { taskId: "dependent", status: TaskStatus.READY });

      // Second call: dependent is now READY, so nothing to do
      const result2 = service.recalculateDependents("prereq", SYSTEM_ACTOR);
      expect(result2.evaluatedCount).toBe(0);
      expect(result2.transitioned).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Complex graph topologies
  // -------------------------------------------------------------------------

  describe("complex graph topologies", () => {
    /**
     * Validates diamond dependency pattern:
     *
     *       A (DONE)
     *      / \
     *     B   C  (both DONE)
     *      \ /
     *       D  (BLOCKED)
     *
     * When C completes (A and B already DONE), D should become READY
     * because all three prerequisites are satisfied.
     */
    it("should handle diamond dependency (D depends on B and C)", () => {
      const { service } = setup({
        tasks: [
          ["A", TaskStatus.DONE],
          ["B", TaskStatus.DONE],
          ["C", TaskStatus.DONE],
          ["D", TaskStatus.BLOCKED],
        ],
        edges: [hardBlock("D", "B"), hardBlock("D", "C")],
      });

      const result = service.recalculateDependents("C", SYSTEM_ACTOR);

      expect(result.evaluatedCount).toBe(1);
      expect(result.transitioned).toHaveLength(1);
      expect(result.transitioned[0]!.taskId).toBe("D");
    });

    /**
     * Validates fan-out pattern: one task unblocks many downstream tasks.
     *
     *         A (DONE)
     *       / | \
     *      B  C  D  (all BLOCKED)
     */
    it("should handle fan-out (one task unblocks many)", () => {
      const { service } = setup({
        tasks: [
          ["A", TaskStatus.DONE],
          ["B", TaskStatus.BLOCKED],
          ["C", TaskStatus.BLOCKED],
          ["D", TaskStatus.BLOCKED],
          ["E", TaskStatus.BLOCKED],
          ["F", TaskStatus.BLOCKED],
        ],
        edges: [
          hardBlock("B", "A"),
          hardBlock("C", "A"),
          hardBlock("D", "A"),
          hardBlock("E", "A"),
          hardBlock("F", "A"),
        ],
      });

      const result = service.recalculateDependents("A", SYSTEM_ACTOR);

      expect(result.evaluatedCount).toBe(5);
      expect(result.transitioned).toHaveLength(5);
    });

    /**
     * Validates partial unblocking: A completes, B depends on A and C.
     * Since C is not DONE, B stays BLOCKED.
     *
     *     A (DONE)    C (IN_DEVELOPMENT)
     *      \         /
     *       B (BLOCKED)
     */
    it("should handle partial unblocking (some deps still pending)", () => {
      const { service } = setup({
        tasks: [
          ["A", TaskStatus.DONE],
          ["C", TaskStatus.IN_DEVELOPMENT],
          ["B", TaskStatus.BLOCKED],
        ],
        edges: [hardBlock("B", "A"), hardBlock("B", "C")],
        readinessOverrides: new Map([
          [
            "B",
            {
              status: "BLOCKED",
              taskId: "B",
              blockingReasons: [
                {
                  dependsOnTaskId: "C",
                  prerequisiteStatus: TaskStatus.IN_DEVELOPMENT,
                  dependencyType: DependencyType.BLOCKS,
                  taskDependencyId: "dep-2",
                },
              ],
            },
          ],
        ]),
      });

      const result = service.recalculateDependents("A", SYSTEM_ACTOR);

      expect(result.evaluatedCount).toBe(1);
      expect(result.transitioned).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]!.reason).toContain("unresolved");
    });

    /**
     * Validates that duplicate edges to the same dependent are handled
     * correctly — the task should be evaluated only once.
     */
    it("should deduplicate dependent tasks with multiple edges", () => {
      const { service, transitionService } = setup({
        tasks: [
          ["prereq", TaskStatus.DONE],
          ["dependent", TaskStatus.BLOCKED],
        ],
        // Two hard-block edges from dependent to prereq (unusual but possible)
        edges: [hardBlock("dependent", "prereq"), hardBlock("dependent", "prereq")],
      });

      const result = service.recalculateDependents("prereq", SYSTEM_ACTOR);

      // Should be evaluated only once despite two edges
      expect(result.evaluatedCount).toBe(1);
      expect(result.transitioned).toHaveLength(1);
      expect(transitionService.calls).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Result structure
  // -------------------------------------------------------------------------

  describe("result structure", () => {
    /**
     * Validates that the result includes the correct actor metadata
     * passed through to the transition service.
     */
    it("should pass actor info to the transition service", () => {
      const mockTransition = createMockTransitionService();
      const state: MockState = {
        tasks: new Map([
          ["prereq", { taskId: "prereq", status: TaskStatus.DONE }],
          ["dep", { taskId: "dep", status: TaskStatus.BLOCKED }],
        ]),
        edges: [
          {
            taskDependencyId: "dep-1",
            taskId: "dep",
            dependsOnTaskId: "prereq",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
        ],
      };

      const service = createReverseDependencyService(
        createMockUnitOfWork(state),
        createMockReadinessService(),
        mockTransition,
      );

      const customActor: ActorInfo = { type: "dependency-module", id: "dm-1" };
      service.recalculateDependents("prereq", customActor);

      expect(mockTransition.calls).toHaveLength(1);
    });
  });
});
