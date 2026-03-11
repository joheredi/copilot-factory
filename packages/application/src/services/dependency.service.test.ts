/**
 * Tests for the DependencyService — DAG validation with circular dependency detection.
 *
 * These tests validate the core invariant from PRD §2.3: "Circular dependencies
 * are rejected at creation time. The Dependency Module validates the graph is a
 * DAG on every insert."
 *
 * Test categories:
 * - Input validation (self-dependency, missing tasks, duplicate edges)
 * - Cycle detection with various graph topologies
 * - Valid DAG structures that must be accepted
 * - Forward/reverse lookups
 * - Edge removal
 * - isHardBlock default resolution
 *
 * @module @factory/application/services/dependency.service.test
 */

import { describe, it, expect } from "vitest";
import { DependencyType } from "@factory/domain";
import { createDependencyService } from "./dependency.service.js";
import type {
  DependencyEdge,
  NewDependencyEdge,
  DependencyUnitOfWork,
  DependencyTransactionRepositories,
  TaskDependencyRepositoryPort,
  DependencyTaskRepositoryPort,
} from "../ports/dependency.ports.js";
import {
  EntityNotFoundError,
  CyclicDependencyError,
  DuplicateDependencyError,
  SelfDependencyError,
} from "../errors.js";

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

/** In-memory store for dependency edges, indexed by ID. */
interface MockState {
  tasks: Set<string>;
  edges: Map<string, DependencyEdge>;
}

function createMockTaskRepo(state: MockState): DependencyTaskRepositoryPort {
  return {
    exists(id: string): boolean {
      return state.tasks.has(id);
    },
  };
}

function createMockDependencyRepo(state: MockState): TaskDependencyRepositoryPort {
  return {
    findByTaskId(taskId: string): DependencyEdge[] {
      return [...state.edges.values()].filter((e) => e.taskId === taskId);
    },

    findByDependsOnTaskId(dependsOnTaskId: string): DependencyEdge[] {
      return [...state.edges.values()].filter((e) => e.dependsOnTaskId === dependsOnTaskId);
    },

    findByTaskIdPair(taskId: string, dependsOnTaskId: string): DependencyEdge | undefined {
      return [...state.edges.values()].find(
        (e) => e.taskId === taskId && e.dependsOnTaskId === dependsOnTaskId,
      );
    },

    create(data: NewDependencyEdge): DependencyEdge {
      const edge: DependencyEdge = {
        taskDependencyId: data.taskDependencyId,
        taskId: data.taskId,
        dependsOnTaskId: data.dependsOnTaskId,
        dependencyType: data.dependencyType,
        isHardBlock: data.isHardBlock,
        createdAt: new Date(),
      };
      state.edges.set(edge.taskDependencyId, edge);
      return edge;
    },

    delete(taskDependencyId: string): boolean {
      return state.edges.delete(taskDependencyId);
    },
  };
}

function createMockUnitOfWork(state: MockState): DependencyUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: DependencyTransactionRepositories) => T): T {
      return fn({
        task: createMockTaskRepo(state),
        taskDependency: createMockDependencyRepo(state),
      });
    },
  };
}

let idCounter: number;

function createTestIdGenerator(): () => string {
  idCounter = 0;
  return () => `dep-${String(++idCounter).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setup(taskIds: string[], existingEdges?: Omit<DependencyEdge, "createdAt">[]) {
  const state: MockState = {
    tasks: new Set(taskIds),
    edges: new Map(),
  };

  if (existingEdges) {
    for (const edge of existingEdges) {
      state.edges.set(edge.taskDependencyId, {
        ...edge,
        createdAt: new Date(),
      });
    }
  }

  const unitOfWork = createMockUnitOfWork(state);
  const idGen = createTestIdGenerator();
  const service = createDependencyService(unitOfWork, idGen);

  return { state, service };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DependencyService", () => {
  describe("addDependency — input validation", () => {
    /**
     * Self-dependencies are nonsensical: a task cannot wait for itself.
     * This is a fast check before any graph traversal.
     */
    it("should reject self-dependency", () => {
      const { service } = setup(["task-1"]);

      expect(() =>
        service.addDependency({
          taskId: "task-1",
          dependsOnTaskId: "task-1",
          dependencyType: DependencyType.BLOCKS,
        }),
      ).toThrow(SelfDependencyError);
    });

    /**
     * Both the dependent and prerequisite tasks must exist.
     * Missing tasks indicate stale references or invalid input.
     */
    it("should reject when dependent task does not exist", () => {
      const { service } = setup(["task-2"]);

      expect(() =>
        service.addDependency({
          taskId: "task-1",
          dependsOnTaskId: "task-2",
          dependencyType: DependencyType.BLOCKS,
        }),
      ).toThrow(EntityNotFoundError);
    });

    /**
     * Prerequisite task must also exist for referential integrity.
     */
    it("should reject when prerequisite task does not exist", () => {
      const { service } = setup(["task-1"]);

      expect(() =>
        service.addDependency({
          taskId: "task-1",
          dependsOnTaskId: "task-2",
          dependencyType: DependencyType.BLOCKS,
        }),
      ).toThrow(EntityNotFoundError);
    });

    /**
     * Duplicate edges are prevented by the unique constraint on (taskId, dependsOnTaskId).
     * The service checks this before attempting insertion.
     */
    it("should reject duplicate dependency edge", () => {
      const { service } = setup(
        ["task-1", "task-2"],
        [
          {
            taskDependencyId: "existing-1",
            taskId: "task-1",
            dependsOnTaskId: "task-2",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
        ],
      );

      expect(() =>
        service.addDependency({
          taskId: "task-1",
          dependsOnTaskId: "task-2",
          dependencyType: DependencyType.BLOCKS,
        }),
      ).toThrow(DuplicateDependencyError);
    });
  });

  describe("addDependency — cycle detection", () => {
    /**
     * Direct cycle: A → B and then B → A.
     * This is the simplest cycle case and must be caught.
     */
    it("should detect direct two-node cycle", () => {
      const { service } = setup(
        ["A", "B"],
        [
          {
            taskDependencyId: "e1",
            taskId: "A",
            dependsOnTaskId: "B",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
        ],
      );

      expect(() =>
        service.addDependency({
          taskId: "B",
          dependsOnTaskId: "A",
          dependencyType: DependencyType.BLOCKS,
        }),
      ).toThrow(CyclicDependencyError);
    });

    /**
     * Transitive cycle: A → B → C, then C → A.
     * The DFS must follow the chain B → C to find A is reachable.
     */
    it("should detect transitive three-node cycle", () => {
      const { service } = setup(
        ["A", "B", "C"],
        [
          {
            taskDependencyId: "e1",
            taskId: "A",
            dependsOnTaskId: "B",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
          {
            taskDependencyId: "e2",
            taskId: "B",
            dependsOnTaskId: "C",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
        ],
      );

      expect(() =>
        service.addDependency({
          taskId: "C",
          dependsOnTaskId: "A",
          dependencyType: DependencyType.BLOCKS,
        }),
      ).toThrow(CyclicDependencyError);
    });

    /**
     * Long chain cycle: A → B → C → D → E, then E → A.
     * Validates DFS works for deeper graphs.
     */
    it("should detect cycle in a long chain", () => {
      const { service } = setup(
        ["A", "B", "C", "D", "E"],
        [
          {
            taskDependencyId: "e1",
            taskId: "A",
            dependsOnTaskId: "B",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
          {
            taskDependencyId: "e2",
            taskId: "B",
            dependsOnTaskId: "C",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
          {
            taskDependencyId: "e3",
            taskId: "C",
            dependsOnTaskId: "D",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
          {
            taskDependencyId: "e4",
            taskId: "D",
            dependsOnTaskId: "E",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
        ],
      );

      expect(() =>
        service.addDependency({
          taskId: "E",
          dependsOnTaskId: "A",
          dependencyType: DependencyType.BLOCKS,
        }),
      ).toThrow(CyclicDependencyError);
    });

    /**
     * Cycle detection should include the cycle path for diagnostics.
     * This helps operators understand why an edge was rejected.
     */
    it("should include cycle path in error", () => {
      const { service } = setup(
        ["A", "B", "C"],
        [
          {
            taskDependencyId: "e1",
            taskId: "A",
            dependsOnTaskId: "B",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
          {
            taskDependencyId: "e2",
            taskId: "B",
            dependsOnTaskId: "C",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
        ],
      );

      try {
        service.addDependency({
          taskId: "C",
          dependsOnTaskId: "A",
          dependencyType: DependencyType.BLOCKS,
        });
        expect.unreachable("Should have thrown CyclicDependencyError");
      } catch (error) {
        expect(error).toBeInstanceOf(CyclicDependencyError);
        const cycleError = error as CyclicDependencyError;
        expect(cycleError.taskId).toBe("C");
        expect(cycleError.dependsOnTaskId).toBe("A");
        // Path should show the cycle: A → B → C (→ A implied)
        expect(cycleError.path.length).toBeGreaterThanOrEqual(3);
        expect(cycleError.path).toContain("A");
        expect(cycleError.path).toContain("C");
      }
    });

    /**
     * All dependency types participate in cycle detection.
     * Even relates_to edges (which don't affect readiness) must not form cycles,
     * per PRD §2.3 which says the graph must be a DAG.
     */
    it("should detect cycle through relates_to edges", () => {
      const { service } = setup(
        ["A", "B"],
        [
          {
            taskDependencyId: "e1",
            taskId: "A",
            dependsOnTaskId: "B",
            dependencyType: DependencyType.RELATES_TO,
            isHardBlock: false,
          },
        ],
      );

      expect(() =>
        service.addDependency({
          taskId: "B",
          dependsOnTaskId: "A",
          dependencyType: DependencyType.RELATES_TO,
        }),
      ).toThrow(CyclicDependencyError);
    });

    /**
     * parent_child edges also participate in cycle detection.
     */
    it("should detect cycle through parent_child edges", () => {
      const { service } = setup(
        ["A", "B"],
        [
          {
            taskDependencyId: "e1",
            taskId: "A",
            dependsOnTaskId: "B",
            dependencyType: DependencyType.PARENT_CHILD,
            isHardBlock: false,
          },
        ],
      );

      expect(() =>
        service.addDependency({
          taskId: "B",
          dependsOnTaskId: "A",
          dependencyType: DependencyType.PARENT_CHILD,
        }),
      ).toThrow(CyclicDependencyError);
    });

    /**
     * Mixed dependency types: cycle across different edge types.
     * A blocks→B relates_to→C, then C parent_child→A = cycle.
     */
    it("should detect cycle across mixed dependency types", () => {
      const { service } = setup(
        ["A", "B", "C"],
        [
          {
            taskDependencyId: "e1",
            taskId: "A",
            dependsOnTaskId: "B",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
          {
            taskDependencyId: "e2",
            taskId: "B",
            dependsOnTaskId: "C",
            dependencyType: DependencyType.RELATES_TO,
            isHardBlock: false,
          },
        ],
      );

      expect(() =>
        service.addDependency({
          taskId: "C",
          dependsOnTaskId: "A",
          dependencyType: DependencyType.PARENT_CHILD,
        }),
      ).toThrow(CyclicDependencyError);
    });
  });

  describe("addDependency — valid DAG structures", () => {
    /**
     * Simple linear chain: A → B → C.
     * This is the most basic DAG topology.
     */
    it("should accept a simple linear chain", () => {
      const { service } = setup(["A", "B", "C"]);

      const r1 = service.addDependency({
        taskId: "A",
        dependsOnTaskId: "B",
        dependencyType: DependencyType.BLOCKS,
      });
      expect(r1.dependency.taskId).toBe("A");
      expect(r1.dependency.dependsOnTaskId).toBe("B");

      const r2 = service.addDependency({
        taskId: "B",
        dependsOnTaskId: "C",
        dependencyType: DependencyType.BLOCKS,
      });
      expect(r2.dependency.taskId).toBe("B");
      expect(r2.dependency.dependsOnTaskId).toBe("C");
    });

    /**
     * Diamond DAG: A → B, A → C, B → D, C → D.
     * Both B and C depend on D; A depends on both B and C.
     * This is a valid DAG despite the convergence point.
     */
    it("should accept a diamond-shaped DAG", () => {
      const { service } = setup(["A", "B", "C", "D"]);

      service.addDependency({
        taskId: "A",
        dependsOnTaskId: "B",
        dependencyType: DependencyType.BLOCKS,
      });
      service.addDependency({
        taskId: "A",
        dependsOnTaskId: "C",
        dependencyType: DependencyType.BLOCKS,
      });
      service.addDependency({
        taskId: "B",
        dependsOnTaskId: "D",
        dependencyType: DependencyType.BLOCKS,
      });

      // This should succeed — C → D doesn't create a cycle
      const result = service.addDependency({
        taskId: "C",
        dependsOnTaskId: "D",
        dependencyType: DependencyType.BLOCKS,
      });
      expect(result.dependency.taskId).toBe("C");
      expect(result.dependency.dependsOnTaskId).toBe("D");
    });

    /**
     * Tree structure: A → B, A → C, B → D, B → E, C → F.
     * No convergence — each node has at most one parent.
     */
    it("should accept a tree structure", () => {
      const { service } = setup(["A", "B", "C", "D", "E", "F"]);

      service.addDependency({
        taskId: "A",
        dependsOnTaskId: "B",
        dependencyType: DependencyType.BLOCKS,
      });
      service.addDependency({
        taskId: "A",
        dependsOnTaskId: "C",
        dependencyType: DependencyType.BLOCKS,
      });
      service.addDependency({
        taskId: "B",
        dependsOnTaskId: "D",
        dependencyType: DependencyType.BLOCKS,
      });
      service.addDependency({
        taskId: "B",
        dependsOnTaskId: "E",
        dependencyType: DependencyType.BLOCKS,
      });

      const result = service.addDependency({
        taskId: "C",
        dependsOnTaskId: "F",
        dependencyType: DependencyType.BLOCKS,
      });
      expect(result.dependency).toBeDefined();
    });

    /**
     * Disconnected components: A → B (component 1), C → D (component 2).
     * Adding edges within separate components never creates cycles.
     */
    it("should accept edges in disconnected components", () => {
      const { service } = setup(["A", "B", "C", "D"]);

      service.addDependency({
        taskId: "A",
        dependsOnTaskId: "B",
        dependencyType: DependencyType.BLOCKS,
      });

      const result = service.addDependency({
        taskId: "C",
        dependsOnTaskId: "D",
        dependencyType: DependencyType.BLOCKS,
      });
      expect(result.dependency.taskId).toBe("C");
    });

    /**
     * Wide fan-out: A depends on B, C, D, E (many prerequisites).
     * A single task can have multiple dependencies.
     */
    it("should accept wide fan-out (multiple prerequisites)", () => {
      const { service } = setup(["A", "B", "C", "D", "E"]);

      for (const dep of ["B", "C", "D", "E"]) {
        const result = service.addDependency({
          taskId: "A",
          dependsOnTaskId: dep,
          dependencyType: DependencyType.BLOCKS,
        });
        expect(result.dependency.dependsOnTaskId).toBe(dep);
      }
    });

    /**
     * Wide fan-in: B, C, D all depend on A (many dependents).
     * Multiple tasks can depend on the same prerequisite.
     */
    it("should accept wide fan-in (multiple dependents)", () => {
      const { service } = setup(["A", "B", "C", "D"]);

      for (const task of ["B", "C", "D"]) {
        const result = service.addDependency({
          taskId: task,
          dependsOnTaskId: "A",
          dependencyType: DependencyType.BLOCKS,
        });
        expect(result.dependency.taskId).toBe(task);
      }
    });

    /**
     * After successfully building a diamond, adding a reverse edge
     * from D → A must be rejected as a cycle.
     */
    it("should reject cycle in a diamond after valid construction", () => {
      const { service } = setup(["A", "B", "C", "D"]);

      service.addDependency({
        taskId: "A",
        dependsOnTaskId: "B",
        dependencyType: DependencyType.BLOCKS,
      });
      service.addDependency({
        taskId: "A",
        dependsOnTaskId: "C",
        dependencyType: DependencyType.BLOCKS,
      });
      service.addDependency({
        taskId: "B",
        dependsOnTaskId: "D",
        dependencyType: DependencyType.BLOCKS,
      });
      service.addDependency({
        taskId: "C",
        dependsOnTaskId: "D",
        dependencyType: DependencyType.BLOCKS,
      });

      // D → A would create a cycle through both B and C paths
      expect(() =>
        service.addDependency({
          taskId: "D",
          dependsOnTaskId: "A",
          dependencyType: DependencyType.BLOCKS,
        }),
      ).toThrow(CyclicDependencyError);
    });
  });

  describe("addDependency — isHardBlock defaults", () => {
    /**
     * For `blocks` type, isHardBlock defaults to true per PRD §2.3:
     * "blocks: target task cannot enter READY until this dependency's
     * task reaches DONE (when is_hard_block is true)".
     */
    it("should default isHardBlock to true for BLOCKS type", () => {
      const { service } = setup(["A", "B"]);

      const result = service.addDependency({
        taskId: "A",
        dependsOnTaskId: "B",
        dependencyType: DependencyType.BLOCKS,
      });
      expect(result.dependency.isHardBlock).toBe(true);
    });

    /**
     * For `relates_to` type, isHardBlock defaults to false since
     * informational links don't affect readiness.
     */
    it("should default isHardBlock to false for RELATES_TO type", () => {
      const { service } = setup(["A", "B"]);

      const result = service.addDependency({
        taskId: "A",
        dependsOnTaskId: "B",
        dependencyType: DependencyType.RELATES_TO,
      });
      expect(result.dependency.isHardBlock).toBe(false);
    });

    /**
     * For `parent_child` type, isHardBlock defaults to false.
     */
    it("should default isHardBlock to false for PARENT_CHILD type", () => {
      const { service } = setup(["A", "B"]);

      const result = service.addDependency({
        taskId: "A",
        dependsOnTaskId: "B",
        dependencyType: DependencyType.PARENT_CHILD,
      });
      expect(result.dependency.isHardBlock).toBe(false);
    });

    /**
     * Explicit isHardBlock value should override the default,
     * allowing soft blocks for BLOCKS type when operators want it.
     */
    it("should respect explicit isHardBlock=false for BLOCKS type", () => {
      const { service } = setup(["A", "B"]);

      const result = service.addDependency({
        taskId: "A",
        dependsOnTaskId: "B",
        dependencyType: DependencyType.BLOCKS,
        isHardBlock: false,
      });
      expect(result.dependency.isHardBlock).toBe(false);
    });

    /**
     * Explicit isHardBlock=true should be honored for any dependency type,
     * including relates_to.
     */
    it("should respect explicit isHardBlock=true for RELATES_TO type", () => {
      const { service } = setup(["A", "B"]);

      const result = service.addDependency({
        taskId: "A",
        dependsOnTaskId: "B",
        dependencyType: DependencyType.RELATES_TO,
        isHardBlock: true,
      });
      expect(result.dependency.isHardBlock).toBe(true);
    });
  });

  describe("addDependency — returned edge", () => {
    /**
     * The returned edge should have all fields correctly populated,
     * including the generated ID and timestamps.
     */
    it("should return a complete dependency edge", () => {
      const { service } = setup(["A", "B"]);

      const result = service.addDependency({
        taskId: "A",
        dependsOnTaskId: "B",
        dependencyType: DependencyType.BLOCKS,
        isHardBlock: true,
      });

      expect(result.dependency.taskDependencyId).toBe("dep-001");
      expect(result.dependency.taskId).toBe("A");
      expect(result.dependency.dependsOnTaskId).toBe("B");
      expect(result.dependency.dependencyType).toBe(DependencyType.BLOCKS);
      expect(result.dependency.isHardBlock).toBe(true);
      expect(result.dependency.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("removeDependency", () => {
    /**
     * Removing an existing edge should succeed and return removed=true.
     */
    it("should remove an existing dependency edge", () => {
      const { service } = setup(
        ["A", "B"],
        [
          {
            taskDependencyId: "edge-1",
            taskId: "A",
            dependsOnTaskId: "B",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
        ],
      );

      const result = service.removeDependency("edge-1");
      expect(result.removed).toBe(true);
    });

    /**
     * Attempting to remove a non-existent edge should return removed=false
     * rather than throwing, since the desired state (edge absent) is achieved.
     */
    it("should return removed=false for non-existent edge", () => {
      const { service } = setup(["A", "B"]);

      const result = service.removeDependency("nonexistent");
      expect(result.removed).toBe(false);
    });

    /**
     * After removing an edge, the same edge should be re-addable.
     * This validates that removal fully cleans up the edge.
     */
    it("should allow re-adding a removed dependency", () => {
      const { service } = setup(
        ["A", "B"],
        [
          {
            taskDependencyId: "edge-1",
            taskId: "A",
            dependsOnTaskId: "B",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
        ],
      );

      service.removeDependency("edge-1");

      const result = service.addDependency({
        taskId: "A",
        dependsOnTaskId: "B",
        dependencyType: DependencyType.BLOCKS,
      });
      expect(result.dependency.taskId).toBe("A");
    });
  });

  describe("getDependencies (forward lookup)", () => {
    /**
     * Forward lookup returns edges where taskId is the dependent.
     * For task A depending on B and C, getDependencies("A") returns both edges.
     */
    it("should return all dependencies of a task", () => {
      const { service } = setup(
        ["A", "B", "C"],
        [
          {
            taskDependencyId: "e1",
            taskId: "A",
            dependsOnTaskId: "B",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
          {
            taskDependencyId: "e2",
            taskId: "A",
            dependsOnTaskId: "C",
            dependencyType: DependencyType.RELATES_TO,
            isHardBlock: false,
          },
        ],
      );

      const result = service.getDependencies("A");
      expect(result.dependencies).toHaveLength(2);
      expect(result.dependencies.map((d) => d.dependsOnTaskId)).toEqual(
        expect.arrayContaining(["B", "C"]),
      );
    });

    /**
     * Forward lookup returns empty array for tasks with no dependencies.
     */
    it("should return empty for task with no dependencies", () => {
      const { service } = setup(["A"]);

      const result = service.getDependencies("A");
      expect(result.dependencies).toHaveLength(0);
    });
  });

  describe("getDependents (reverse lookup)", () => {
    /**
     * Reverse lookup returns edges where dependsOnTaskId is the prerequisite.
     * For B and C depending on A, getDependents("A") returns both edges.
     */
    it("should return all dependents of a task", () => {
      const { service } = setup(
        ["A", "B", "C"],
        [
          {
            taskDependencyId: "e1",
            taskId: "B",
            dependsOnTaskId: "A",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
          {
            taskDependencyId: "e2",
            taskId: "C",
            dependsOnTaskId: "A",
            dependencyType: DependencyType.BLOCKS,
            isHardBlock: true,
          },
        ],
      );

      const result = service.getDependents("A");
      expect(result.dependents).toHaveLength(2);
      expect(result.dependents.map((d) => d.taskId)).toEqual(expect.arrayContaining(["B", "C"]));
    });

    /**
     * Reverse lookup returns empty for tasks with no dependents.
     */
    it("should return empty for task with no dependents", () => {
      const { service } = setup(["A"]);

      const result = service.getDependents("A");
      expect(result.dependents).toHaveLength(0);
    });
  });

  describe("complex graph scenarios", () => {
    /**
     * Build a complex valid DAG, then verify that only cycle-creating
     * edges are rejected while valid edges are accepted.
     *
     * Graph:
     *   A → B → D
     *   A → C → D
     *   D → E
     *   C → F → G
     *
     * Then try: G → A (should be rejected as cycle: A → C → F → G → A)
     * And: E → F (should succeed — doesn't create cycle)
     */
    it("should handle complex graph with mixed accept/reject", () => {
      const { service } = setup(["A", "B", "C", "D", "E", "F", "G"]);

      service.addDependency({
        taskId: "A",
        dependsOnTaskId: "B",
        dependencyType: DependencyType.BLOCKS,
      });
      service.addDependency({
        taskId: "A",
        dependsOnTaskId: "C",
        dependencyType: DependencyType.BLOCKS,
      });
      service.addDependency({
        taskId: "B",
        dependsOnTaskId: "D",
        dependencyType: DependencyType.BLOCKS,
      });
      service.addDependency({
        taskId: "C",
        dependsOnTaskId: "D",
        dependencyType: DependencyType.BLOCKS,
      });
      service.addDependency({
        taskId: "D",
        dependsOnTaskId: "E",
        dependencyType: DependencyType.BLOCKS,
      });
      service.addDependency({
        taskId: "C",
        dependsOnTaskId: "F",
        dependencyType: DependencyType.BLOCKS,
      });
      service.addDependency({
        taskId: "F",
        dependsOnTaskId: "G",
        dependencyType: DependencyType.BLOCKS,
      });

      // G → A would create cycle through C → F → G
      expect(() =>
        service.addDependency({
          taskId: "G",
          dependsOnTaskId: "A",
          dependencyType: DependencyType.BLOCKS,
        }),
      ).toThrow(CyclicDependencyError);

      // E → F is valid — E doesn't depend on F transitively
      const result = service.addDependency({
        taskId: "E",
        dependsOnTaskId: "F",
        dependencyType: DependencyType.BLOCKS,
      });
      expect(result.dependency.taskId).toBe("E");
    });

    /**
     * After removing an edge that was part of a potential cycle path,
     * the previously-rejected edge should now be accepted.
     */
    it("should allow previously-cyclic edge after removing blocking edge", () => {
      const { service } = setup(["A", "B", "C"]);

      service.addDependency({
        taskId: "A",
        dependsOnTaskId: "B",
        dependencyType: DependencyType.BLOCKS,
      });
      service.addDependency({
        taskId: "B",
        dependsOnTaskId: "C",
        dependencyType: DependencyType.BLOCKS,
      });

      // C → A would be a cycle
      expect(() =>
        service.addDependency({
          taskId: "C",
          dependsOnTaskId: "A",
          dependencyType: DependencyType.BLOCKS,
        }),
      ).toThrow(CyclicDependencyError);

      // Remove B → C
      service.removeDependency("dep-002");

      // Now C → A should succeed (no path from A to C anymore)
      const result = service.addDependency({
        taskId: "C",
        dependsOnTaskId: "A",
        dependencyType: DependencyType.BLOCKS,
      });
      expect(result.dependency.taskId).toBe("C");
    });
  });
});
