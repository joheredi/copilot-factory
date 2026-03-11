/**
 * Tests for the ReadinessService — readiness computation based on hard-block dependencies.
 *
 * These tests validate the readiness computation rules from PRD §2.3:
 *
 * - Tasks with unsatisfied hard-block dependencies are BLOCKED
 * - Tasks with all hard-block dependencies DONE are READY
 * - Soft-block dependencies (isHardBlock=false) don't affect readiness
 * - `relates_to` dependencies don't affect readiness
 * - `parent_child` semantics: parent cannot DONE until all children DONE or CANCELLED
 * - FAILED and CANCELLED dependency states do NOT satisfy hard blocks
 *
 * Test categories:
 * - Basic readiness (no deps, all deps done, some deps not done)
 * - Hard-block vs soft-block distinction
 * - Dependency type filtering (blocks vs relates_to vs parent_child)
 * - Terminal state handling (FAILED, CANCELLED don't satisfy hard blocks)
 * - Parent-child readiness
 * - Edge cases (missing tasks, mixed edge types)
 *
 * @module @factory/application/services/readiness.service.test
 */

import { describe, it, expect } from "vitest";
import { DependencyType, TaskStatus } from "@factory/domain";
import { createReadinessService } from "./readiness.service.js";
import type { ReadinessService } from "./readiness.service.js";
import type {
  ReadinessTask,
  ReadinessDependencyEdge,
  ReadinessUnitOfWork,
  ReadinessTransactionRepositories,
  ReadinessTaskRepositoryPort,
  ReadinessTaskDependencyRepositoryPort,
} from "../ports/readiness.ports.js";
import { EntityNotFoundError } from "../errors.js";

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

/**
 * In-memory store for readiness computation tests.
 *
 * Tasks are stored by ID with their current status, and dependency edges
 * are stored as a flat list. This mirrors the minimal data the readiness
 * service needs to evaluate readiness.
 */
interface MockState {
  tasks: Map<string, ReadinessTask>;
  edges: ReadinessDependencyEdge[];
}

function createMockTaskRepo(state: MockState): ReadinessTaskRepositoryPort {
  return {
    findById(id: string): ReadinessTask | undefined {
      return state.tasks.get(id);
    },
  };
}

function createMockDependencyRepo(state: MockState): ReadinessTaskDependencyRepositoryPort {
  return {
    findByTaskId(taskId: string): ReadinessDependencyEdge[] {
      return state.edges.filter((e) => e.taskId === taskId);
    },
    findByDependsOnTaskId(dependsOnTaskId: string): ReadinessDependencyEdge[] {
      return state.edges.filter((e) => e.dependsOnTaskId === dependsOnTaskId);
    },
  };
}

function createMockUnitOfWork(state: MockState): ReadinessUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: ReadinessTransactionRepositories) => T): T {
      return fn({
        task: createMockTaskRepo(state),
        taskDependency: createMockDependencyRepo(state),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Create a test fixture with the given tasks and dependency edges.
 *
 * @param tasks - Array of [taskId, status] tuples
 * @param edges - Array of dependency edges (without createdAt)
 */
function setup(
  tasks: Array<[string, TaskStatus]>,
  edges?: ReadinessDependencyEdge[],
): { service: ReadinessService; state: MockState } {
  const state: MockState = {
    tasks: new Map(tasks.map(([id, status]) => [id, { taskId: id, status }])),
    edges: edges ?? [],
  };
  const service = createReadinessService(createMockUnitOfWork(state));
  return { service, state };
}

/** Shorthand to create a hard-block `blocks` edge. */
function hardBlock(id: string, taskId: string, dependsOnTaskId: string): ReadinessDependencyEdge {
  return {
    taskDependencyId: id,
    taskId,
    dependsOnTaskId,
    dependencyType: DependencyType.BLOCKS,
    isHardBlock: true,
  };
}

/** Shorthand to create a soft-block `blocks` edge (isHardBlock=false). */
function softBlock(id: string, taskId: string, dependsOnTaskId: string): ReadinessDependencyEdge {
  return {
    taskDependencyId: id,
    taskId,
    dependsOnTaskId,
    dependencyType: DependencyType.BLOCKS,
    isHardBlock: false,
  };
}

/** Shorthand to create a `relates_to` edge. */
function relatesTo(id: string, taskId: string, dependsOnTaskId: string): ReadinessDependencyEdge {
  return {
    taskDependencyId: id,
    taskId,
    dependsOnTaskId,
    dependencyType: DependencyType.RELATES_TO,
    isHardBlock: false,
  };
}

/** Shorthand to create a `parent_child` edge (parent depends on child). */
function parentChild(
  id: string,
  parentTaskId: string,
  childTaskId: string,
): ReadinessDependencyEdge {
  return {
    taskDependencyId: id,
    taskId: parentTaskId,
    dependsOnTaskId: childTaskId,
    dependencyType: DependencyType.PARENT_CHILD,
    isHardBlock: false,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("ReadinessService", () => {
  // -------------------------------------------------------------------------
  // computeReadiness — basic scenarios
  // -------------------------------------------------------------------------

  describe("computeReadiness", () => {
    /**
     * A task with no dependencies should always be READY since there are
     * no hard-block prerequisites to satisfy. This is the base case for
     * leaf tasks in the dependency graph.
     */
    it("returns READY for a task with no dependencies", () => {
      const { service } = setup([["task-1", TaskStatus.BACKLOG]]);

      const result = service.computeReadiness("task-1");

      expect(result.status).toBe("READY");
      expect(result.taskId).toBe("task-1");
    });

    /**
     * When all hard-block prerequisites have reached DONE, the task
     * should be READY. This is the happy path for unblocking.
     */
    it("returns READY when all hard-block dependencies are DONE", () => {
      const { service } = setup(
        [
          ["task-1", TaskStatus.BACKLOG],
          ["dep-1", TaskStatus.DONE],
          ["dep-2", TaskStatus.DONE],
        ],
        [hardBlock("e1", "task-1", "dep-1"), hardBlock("e2", "task-1", "dep-2")],
      );

      const result = service.computeReadiness("task-1");

      expect(result.status).toBe("READY");
    });

    /**
     * When any hard-block prerequisite has NOT reached DONE, the task
     * should be BLOCKED with reasons identifying the unsatisfied deps.
     */
    it("returns BLOCKED when a hard-block dependency is not DONE", () => {
      const { service } = setup(
        [
          ["task-1", TaskStatus.BACKLOG],
          ["dep-1", TaskStatus.DONE],
          ["dep-2", TaskStatus.IN_DEVELOPMENT],
        ],
        [hardBlock("e1", "task-1", "dep-1"), hardBlock("e2", "task-1", "dep-2")],
      );

      const result = service.computeReadiness("task-1");

      expect(result.status).toBe("BLOCKED");
      if (result.status === "BLOCKED") {
        expect(result.blockingReasons).toHaveLength(1);
        expect(result.blockingReasons[0]!.dependsOnTaskId).toBe("dep-2");
        expect(result.blockingReasons[0]!.prerequisiteStatus).toBe(TaskStatus.IN_DEVELOPMENT);
        expect(result.blockingReasons[0]!.taskDependencyId).toBe("e2");
      }
    });

    /**
     * Multiple unsatisfied hard-block dependencies should all appear in
     * the blocking reasons list, giving the caller full visibility into
     * what is blocking the task.
     */
    it("returns all blocking reasons when multiple hard-block deps are unsatisfied", () => {
      const { service } = setup(
        [
          ["task-1", TaskStatus.BACKLOG],
          ["dep-1", TaskStatus.IN_REVIEW],
          ["dep-2", TaskStatus.ASSIGNED],
          ["dep-3", TaskStatus.DONE],
        ],
        [
          hardBlock("e1", "task-1", "dep-1"),
          hardBlock("e2", "task-1", "dep-2"),
          hardBlock("e3", "task-1", "dep-3"),
        ],
      );

      const result = service.computeReadiness("task-1");

      expect(result.status).toBe("BLOCKED");
      if (result.status === "BLOCKED") {
        expect(result.blockingReasons).toHaveLength(2);
        const blockerIds = result.blockingReasons.map((r) => r.dependsOnTaskId);
        expect(blockerIds).toContain("dep-1");
        expect(blockerIds).toContain("dep-2");
      }
    });

    /**
     * EntityNotFoundError must be thrown for a task that doesn't exist.
     * This prevents computing readiness for phantom task IDs.
     */
    it("throws EntityNotFoundError for a non-existent task", () => {
      const { service } = setup([]);

      expect(() => service.computeReadiness("nonexistent")).toThrow(EntityNotFoundError);
    });

    // -----------------------------------------------------------------------
    // Hard-block vs soft-block distinction
    // -----------------------------------------------------------------------

    /**
     * Soft-block edges (isHardBlock=false) are informational and should
     * NOT prevent a task from being READY. Only hard-block edges count.
     * This validates the PRD rule: "merely informed (when is_hard_block is false)".
     */
    it("ignores soft-block dependencies (isHardBlock=false)", () => {
      const { service } = setup(
        [
          ["task-1", TaskStatus.BACKLOG],
          ["dep-1", TaskStatus.IN_DEVELOPMENT],
        ],
        [softBlock("e1", "task-1", "dep-1")],
      );

      const result = service.computeReadiness("task-1");

      expect(result.status).toBe("READY");
    });

    /**
     * When a task has both hard-block and soft-block edges, only the
     * hard-block edges should affect readiness. A satisfied hard-block
     * combined with an unsatisfied soft-block should still result in READY.
     */
    it("evaluates only hard-block edges when mixed with soft-block edges", () => {
      const { service } = setup(
        [
          ["task-1", TaskStatus.BACKLOG],
          ["dep-hard", TaskStatus.DONE],
          ["dep-soft", TaskStatus.BACKLOG],
        ],
        [hardBlock("e1", "task-1", "dep-hard"), softBlock("e2", "task-1", "dep-soft")],
      );

      const result = service.computeReadiness("task-1");

      expect(result.status).toBe("READY");
    });

    // -----------------------------------------------------------------------
    // Dependency type filtering
    // -----------------------------------------------------------------------

    /**
     * `relates_to` edges are purely informational and must not affect
     * readiness. Even if the related task is in BACKLOG, the dependent
     * task should still be READY (assuming no hard-block edges).
     */
    it("ignores relates_to dependencies entirely", () => {
      const { service } = setup(
        [
          ["task-1", TaskStatus.BACKLOG],
          ["related-1", TaskStatus.BACKLOG],
        ],
        [relatesTo("e1", "task-1", "related-1")],
      );

      const result = service.computeReadiness("task-1");

      expect(result.status).toBe("READY");
    });

    /**
     * `parent_child` edges do NOT affect the readiness computation for
     * the parent task entering READY — they control whether the parent
     * can reach DONE (tested separately in checkParentChildReadiness).
     * A parent_child edge should not block BACKLOG→READY.
     */
    it("ignores parent_child dependencies for readiness computation", () => {
      const { service } = setup(
        [
          ["parent-1", TaskStatus.BACKLOG],
          ["child-1", TaskStatus.IN_DEVELOPMENT],
        ],
        [parentChild("e1", "parent-1", "child-1")],
      );

      const result = service.computeReadiness("parent-1");

      expect(result.status).toBe("READY");
    });

    /**
     * Validates that when all dependency types are present, only
     * hard-block `blocks` edges actually affect readiness.
     */
    it("correctly handles a mix of all dependency types", () => {
      const { service } = setup(
        [
          ["task-1", TaskStatus.BACKLOG],
          ["hard-dep", TaskStatus.DONE],
          ["soft-dep", TaskStatus.IN_DEVELOPMENT],
          ["related", TaskStatus.BACKLOG],
          ["child", TaskStatus.ASSIGNED],
        ],
        [
          hardBlock("e1", "task-1", "hard-dep"),
          softBlock("e2", "task-1", "soft-dep"),
          relatesTo("e3", "task-1", "related"),
          parentChild("e4", "task-1", "child"),
        ],
      );

      const result = service.computeReadiness("task-1");

      // Only the hard-block dep matters, and it's DONE → READY
      expect(result.status).toBe("READY");
    });

    // -----------------------------------------------------------------------
    // Terminal state handling
    // -----------------------------------------------------------------------

    /**
     * PRD rule: "When a dependency task transitions to FAILED or CANCELLED,
     * hard-blocked dependents remain in BLOCKED."
     *
     * A FAILED prerequisite does NOT satisfy a hard-block dependency.
     * Only DONE satisfies it.
     */
    it("treats FAILED dependency as unsatisfied (task stays BLOCKED)", () => {
      const { service } = setup(
        [
          ["task-1", TaskStatus.BACKLOG],
          ["dep-1", TaskStatus.FAILED],
        ],
        [hardBlock("e1", "task-1", "dep-1")],
      );

      const result = service.computeReadiness("task-1");

      expect(result.status).toBe("BLOCKED");
      if (result.status === "BLOCKED") {
        expect(result.blockingReasons[0]!.prerequisiteStatus).toBe(TaskStatus.FAILED);
      }
    });

    /**
     * PRD rule: CANCELLED dependencies also do not satisfy hard blocks.
     * A cancelled prerequisite means the work was abandoned, so the
     * dependent task cannot proceed.
     */
    it("treats CANCELLED dependency as unsatisfied (task stays BLOCKED)", () => {
      const { service } = setup(
        [
          ["task-1", TaskStatus.BACKLOG],
          ["dep-1", TaskStatus.CANCELLED],
        ],
        [hardBlock("e1", "task-1", "dep-1")],
      );

      const result = service.computeReadiness("task-1");

      expect(result.status).toBe("BLOCKED");
      if (result.status === "BLOCKED") {
        expect(result.blockingReasons[0]!.prerequisiteStatus).toBe(TaskStatus.CANCELLED);
      }
    });

    /**
     * ESCALATED is also not DONE — it should block.
     */
    it("treats ESCALATED dependency as unsatisfied", () => {
      const { service } = setup(
        [
          ["task-1", TaskStatus.BACKLOG],
          ["dep-1", TaskStatus.ESCALATED],
        ],
        [hardBlock("e1", "task-1", "dep-1")],
      );

      const result = service.computeReadiness("task-1");

      expect(result.status).toBe("BLOCKED");
      if (result.status === "BLOCKED") {
        expect(result.blockingReasons[0]!.prerequisiteStatus).toBe(TaskStatus.ESCALATED);
      }
    });

    // -----------------------------------------------------------------------
    // Various prerequisite lifecycle states
    // -----------------------------------------------------------------------

    /**
     * Verify that all non-DONE lifecycle states correctly block.
     * This is a parametric-style test covering each TaskStatus value
     * to ensure nothing is accidentally treated as satisfying a hard block.
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
      TaskStatus.FAILED,
      TaskStatus.ESCALATED,
      TaskStatus.CANCELLED,
    ])("blocks when prerequisite is in %s state (not DONE)", (prereqStatus) => {
      const { service } = setup(
        [
          ["task-1", TaskStatus.BACKLOG],
          ["dep-1", prereqStatus],
        ],
        [hardBlock("e1", "task-1", "dep-1")],
      );

      const result = service.computeReadiness("task-1");

      expect(result.status).toBe("BLOCKED");
    });

    /**
     * The only status that satisfies a hard-block is DONE.
     */
    it("only DONE satisfies a hard-block dependency", () => {
      const { service } = setup(
        [
          ["task-1", TaskStatus.BACKLOG],
          ["dep-1", TaskStatus.DONE],
        ],
        [hardBlock("e1", "task-1", "dep-1")],
      );

      const result = service.computeReadiness("task-1");

      expect(result.status).toBe("READY");
    });

    // -----------------------------------------------------------------------
    // Complex graph topologies
    // -----------------------------------------------------------------------

    /**
     * Diamond dependency: task-1 depends on dep-A and dep-B, which both
     * depend on dep-C. Only direct hard-block edges to task-1 matter;
     * transitive dependencies are irrelevant to readiness computation
     * (they're handled by computing readiness for dep-A and dep-B separately).
     */
    it("handles diamond dependency topology", () => {
      const { service } = setup(
        [
          ["task-1", TaskStatus.BACKLOG],
          ["dep-A", TaskStatus.DONE],
          ["dep-B", TaskStatus.DONE],
          ["dep-C", TaskStatus.DONE],
        ],
        [
          hardBlock("e1", "task-1", "dep-A"),
          hardBlock("e2", "task-1", "dep-B"),
          hardBlock("e3", "dep-A", "dep-C"),
          hardBlock("e4", "dep-B", "dep-C"),
        ],
      );

      const result = service.computeReadiness("task-1");

      expect(result.status).toBe("READY");
    });

    /**
     * Long dependency chain: only the direct prerequisites of a task
     * are evaluated. Transitive predecessors don't matter for this
     * task's readiness — they matter for the intermediate tasks.
     */
    it("evaluates only direct dependencies (not transitive)", () => {
      const { service } = setup(
        [
          ["task-1", TaskStatus.BACKLOG],
          ["dep-1", TaskStatus.DONE],
          ["dep-2", TaskStatus.BACKLOG], // dep-1 depends on dep-2, but task-1 doesn't
        ],
        [hardBlock("e1", "task-1", "dep-1"), hardBlock("e2", "dep-1", "dep-2")],
      );

      const result = service.computeReadiness("task-1");

      // task-1 only depends on dep-1 (DONE), so it's READY
      expect(result.status).toBe("READY");
    });

    /**
     * Blocking reason should include the dependency edge ID and type
     * for traceability — callers need this to report what's blocking.
     */
    it("includes dependency type and edge ID in blocking reasons", () => {
      const { service } = setup(
        [
          ["task-1", TaskStatus.BACKLOG],
          ["dep-1", TaskStatus.IN_REVIEW],
        ],
        [hardBlock("edge-abc", "task-1", "dep-1")],
      );

      const result = service.computeReadiness("task-1");

      expect(result.status).toBe("BLOCKED");
      if (result.status === "BLOCKED") {
        const reason = result.blockingReasons[0]!;
        expect(reason.taskDependencyId).toBe("edge-abc");
        expect(reason.dependencyType).toBe(DependencyType.BLOCKS);
        expect(reason.dependsOnTaskId).toBe("dep-1");
        expect(reason.prerequisiteStatus).toBe(TaskStatus.IN_REVIEW);
      }
    });
  });

  // -------------------------------------------------------------------------
  // checkParentChildReadiness
  // -------------------------------------------------------------------------

  describe("checkParentChildReadiness", () => {
    /**
     * A parent task with no children should be COMPLETE since there
     * are no children to wait for. This handles the edge case of
     * a task with no parent_child edges.
     */
    it("returns COMPLETE for a parent with no children", () => {
      const { service } = setup([["parent-1", TaskStatus.IN_DEVELOPMENT]]);

      const result = service.checkParentChildReadiness("parent-1");

      expect(result.status).toBe("COMPLETE");
      expect(result.parentTaskId).toBe("parent-1");
    });

    /**
     * When all children are DONE, the parent's child readiness is COMPLETE.
     */
    it("returns COMPLETE when all children are DONE", () => {
      const { service } = setup(
        [
          ["parent-1", TaskStatus.IN_DEVELOPMENT],
          ["child-1", TaskStatus.DONE],
          ["child-2", TaskStatus.DONE],
        ],
        [parentChild("e1", "parent-1", "child-1"), parentChild("e2", "parent-1", "child-2")],
      );

      const result = service.checkParentChildReadiness("parent-1");

      expect(result.status).toBe("COMPLETE");
    });

    /**
     * PRD rule: parent_child semantics allow CANCELLED as a valid
     * terminal state for children. A cancelled child doesn't block
     * the parent from reaching DONE.
     */
    it("returns COMPLETE when all children are DONE or CANCELLED", () => {
      const { service } = setup(
        [
          ["parent-1", TaskStatus.IN_DEVELOPMENT],
          ["child-1", TaskStatus.DONE],
          ["child-2", TaskStatus.CANCELLED],
        ],
        [parentChild("e1", "parent-1", "child-1"), parentChild("e2", "parent-1", "child-2")],
      );

      const result = service.checkParentChildReadiness("parent-1");

      expect(result.status).toBe("COMPLETE");
    });

    /**
     * When any child is still in progress (not DONE or CANCELLED),
     * the parent's child readiness is INCOMPLETE with reasons.
     */
    it("returns INCOMPLETE when a child is not DONE or CANCELLED", () => {
      const { service } = setup(
        [
          ["parent-1", TaskStatus.IN_DEVELOPMENT],
          ["child-1", TaskStatus.DONE],
          ["child-2", TaskStatus.IN_DEVELOPMENT],
        ],
        [parentChild("e1", "parent-1", "child-1"), parentChild("e2", "parent-1", "child-2")],
      );

      const result = service.checkParentChildReadiness("parent-1");

      expect(result.status).toBe("INCOMPLETE");
      if (result.status === "INCOMPLETE") {
        expect(result.incompleteChildren).toHaveLength(1);
        expect(result.incompleteChildren[0]!.childTaskId).toBe("child-2");
        expect(result.incompleteChildren[0]!.childStatus).toBe(TaskStatus.IN_DEVELOPMENT);
      }
    });

    /**
     * FAILED children should block the parent — unlike CANCELLED,
     * FAILED means something went wrong and the work isn't done.
     */
    it("treats FAILED children as incomplete", () => {
      const { service } = setup(
        [
          ["parent-1", TaskStatus.IN_DEVELOPMENT],
          ["child-1", TaskStatus.FAILED],
        ],
        [parentChild("e1", "parent-1", "child-1")],
      );

      const result = service.checkParentChildReadiness("parent-1");

      expect(result.status).toBe("INCOMPLETE");
      if (result.status === "INCOMPLETE") {
        expect(result.incompleteChildren[0]!.childStatus).toBe(TaskStatus.FAILED);
      }
    });

    /**
     * ESCALATED children should block the parent — they need human
     * intervention before they can complete.
     */
    it("treats ESCALATED children as incomplete", () => {
      const { service } = setup(
        [
          ["parent-1", TaskStatus.IN_DEVELOPMENT],
          ["child-1", TaskStatus.ESCALATED],
        ],
        [parentChild("e1", "parent-1", "child-1")],
      );

      const result = service.checkParentChildReadiness("parent-1");

      expect(result.status).toBe("INCOMPLETE");
      if (result.status === "INCOMPLETE") {
        expect(result.incompleteChildren[0]!.childStatus).toBe(TaskStatus.ESCALATED);
      }
    });

    /**
     * Multiple incomplete children should all appear in the result.
     */
    it("reports all incomplete children", () => {
      const { service } = setup(
        [
          ["parent-1", TaskStatus.IN_DEVELOPMENT],
          ["child-1", TaskStatus.BACKLOG],
          ["child-2", TaskStatus.IN_REVIEW],
          ["child-3", TaskStatus.DONE],
        ],
        [
          parentChild("e1", "parent-1", "child-1"),
          parentChild("e2", "parent-1", "child-2"),
          parentChild("e3", "parent-1", "child-3"),
        ],
      );

      const result = service.checkParentChildReadiness("parent-1");

      expect(result.status).toBe("INCOMPLETE");
      if (result.status === "INCOMPLETE") {
        expect(result.incompleteChildren).toHaveLength(2);
        const childIds = result.incompleteChildren.map((c) => c.childTaskId);
        expect(childIds).toContain("child-1");
        expect(childIds).toContain("child-2");
      }
    });

    /**
     * EntityNotFoundError must be thrown for a parent that doesn't exist.
     */
    it("throws EntityNotFoundError for non-existent parent", () => {
      const { service } = setup([]);

      expect(() => service.checkParentChildReadiness("nonexistent")).toThrow(EntityNotFoundError);
    });

    /**
     * Only parent_child edges should be considered — hard-block edges
     * on the same parent task should be ignored by checkParentChildReadiness.
     */
    it("ignores non-parent_child edges", () => {
      const { service } = setup(
        [
          ["parent-1", TaskStatus.IN_DEVELOPMENT],
          ["dep-1", TaskStatus.IN_DEVELOPMENT],
          ["child-1", TaskStatus.DONE],
        ],
        [hardBlock("e1", "parent-1", "dep-1"), parentChild("e2", "parent-1", "child-1")],
      );

      const result = service.checkParentChildReadiness("parent-1");

      // Should only look at parent_child edges: child-1 is DONE → COMPLETE
      expect(result.status).toBe("COMPLETE");
    });

    /**
     * Edge case: verify that checkParentChildReadiness evaluates children
     * across all lifecycle states comprehensively.
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
      TaskStatus.FAILED,
      TaskStatus.ESCALATED,
    ])("treats child in %s state as incomplete", (childStatus) => {
      const { service } = setup(
        [
          ["parent-1", TaskStatus.IN_DEVELOPMENT],
          ["child-1", childStatus],
        ],
        [parentChild("e1", "parent-1", "child-1")],
      );

      const result = service.checkParentChildReadiness("parent-1");

      expect(result.status).toBe("INCOMPLETE");
    });

    /**
     * Only DONE and CANCELLED satisfy parent_child requirements.
     */
    it.each([TaskStatus.DONE, TaskStatus.CANCELLED])(
      "treats child in %s state as complete",
      (childStatus) => {
        const { service } = setup(
          [
            ["parent-1", TaskStatus.IN_DEVELOPMENT],
            ["child-1", childStatus],
          ],
          [parentChild("e1", "parent-1", "child-1")],
        );

        const result = service.checkParentChildReadiness("parent-1");

        expect(result.status).toBe("COMPLETE");
      },
    );
  });
});
