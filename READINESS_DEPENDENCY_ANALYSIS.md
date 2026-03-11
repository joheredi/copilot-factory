# Dependency and Readiness Engine - Comprehensive Codebase Analysis

## Overview

The copilot-factory implements a sophisticated dependency graph and readiness computation engine based on a Directed Acyclic Graph (DAG) data model. The system ensures deterministic orchestration by centralizing all state transitions through a single transition service, while decoupling readiness computation (a pure query) from the actual state changes.

## Core Architecture

### Key Design Principles

1. **Deterministic Orchestration**: The Dependency Module runs as part of the reconciliation loop (not only on individual transitions) to catch any missed recalculations. All state transitions flow through a single `TransitionService`.

2. **Pure Query Pattern**: The `ReadinessService` is a pure query service that DOES NOT perform state transitions. It only evaluates current state and returns readiness results. The caller (e.g., reconciliation loop or dependency module) is responsible for acting on the result.

3. **DAG Invariant**: The dependency graph must remain acyclic at all times. Circular dependencies are rejected at creation time through depth-first search (DFS) cycle detection.

4. **Transaction Boundaries**: All operations run within transaction boundaries for consistent reads and atomic writes.

---

## 1. Domain Model (packages/domain/src)

### Enums (packages/domain/src/enums.ts)

#### TaskStatus

```typescript
(BACKLOG,
  READY,
  BLOCKED,
  ASSIGNED,
  IN_DEVELOPMENT,
  DEV_COMPLETE,
  IN_REVIEW,
  CHANGES_REQUESTED,
  APPROVED,
  QUEUED_FOR_MERGE,
  MERGING,
  POST_MERGE_VALIDATION,
  DONE,
  FAILED,
  ESCALATED,
  CANCELLED);
```

#### DependencyType (from enums.ts:222-229)

```typescript
export const DependencyType = {
  BLOCKS: "blocks",
  RELATES_TO: "relates_to",
  PARENT_CHILD: "parent_child",
} as const;
```

**Dependency Type Semantics:**

- **`blocks`**: Target task cannot enter READY until prerequisite reaches DONE (when `is_hard_block=true`) or is merely informed (when `is_hard_block=false`)
- **`relates_to`**: Informational link; does NOT affect readiness computation
- **`parent_child`**: Hierarchical grouping; parent task cannot reach DONE until all children are DONE or CANCELLED

#### TaskDependency Entity (PRD 002 §2.3)

Fields:

- `task_dependency_id`
- `task_id` (the dependent/waiting task)
- `depends_on_task_id` (the prerequisite task)
- `dependency_type` (one of: blocks, relates_to, parent_child)
- `is_hard_block` (boolean; only relevant for blocks type)
- `created_at` (timestamp)

---

## 2. Application Layer Services

### 2.1 Readiness Service (packages/application/src/services/readiness.service.ts)

**Purpose**: Computes whether a task should be READY or BLOCKED based on hard-block dependencies.

#### Key Rules (PRD §2.3)

1. **Hard-block `blocks` edges** (with `is_hard_block=true`): The dependent task cannot enter READY until the prerequisite reaches DONE.
2. **Soft-block edges** (with `is_hard_block=false`): Informational only — do NOT affect readiness.
3. **`relates_to` edges**: Purely informational links — NO effect on readiness.
4. **`parent_child` edges**: Do NOT affect READY readiness (checked separately for DONE→completion).
5. **Terminal states** (FAILED, CANCELLED): Do NOT satisfy hard-block dependencies.

#### Main Methods

##### computeReadiness(taskId: string): ReadinessResult

**Algorithm**:

1. Verify the task exists
2. Get all forward dependencies for this task
3. Filter to only hard-block edges (DependencyType.BLOCKS && isHardBlock=true)
4. For each hard-block prerequisite, check if it has reached DONE
5. Return READY if all hard-block prerequisites are DONE; otherwise BLOCKED with reasons

**Result Types**:

```typescript
interface ReadinessResultReady {
  readonly status: "READY";
  readonly taskId: string;
}

interface ReadinessResultBlocked {
  readonly status: "BLOCKED";
  readonly taskId: string;
  readonly blockingReasons: readonly BlockingReason[];
}

interface BlockingReason {
  readonly dependsOnTaskId: string;
  readonly prerequisiteStatus: TaskStatus;
  readonly dependencyType: DependencyType;
  readonly taskDependencyId: string;
}
```

##### checkParentChildReadiness(parentTaskId: string): ParentReadinessResult

**Algorithm**:

1. Verify the parent task exists
2. Find all parent_child edges where this task is the parent
3. Check each child's status — must be DONE or CANCELLED
4. Return COMPLETE if all children are terminal; otherwise INCOMPLETE with reasons

**Note**: CANCELLED is accepted for children (allows parent to proceed), but FAILED is NOT accepted.

**Result Types**:

```typescript
interface ParentReadinessResultComplete {
  readonly status: "COMPLETE";
  readonly parentTaskId: string;
}

interface ParentReadinessResultIncomplete {
  readonly status: "INCOMPLETE";
  readonly parentTaskId: string;
  readonly incompleteChildren: readonly ChildBlockingReason[];
}
```

#### Port Interfaces (packages/application/src/ports/readiness.ports.ts)

**ReadinessDependencyEdge**:

```typescript
interface ReadinessDependencyEdge {
  readonly taskDependencyId: string;
  readonly taskId: string;
  readonly dependsOnTaskId: string;
  readonly dependencyType: DependencyType;
  readonly isHardBlock: boolean;
}
```

**ReadinessTaskDependencyRepositoryPort**:

- `findByTaskId(taskId: string)`: Forward lookup - find all deps of a task
- `findByDependsOnTaskId(dependsOnTaskId: string)`: Reverse lookup - find all tasks depending on this one

**ReadinessUnitOfWork**:

```typescript
interface ReadinessUnitOfWork {
  runInTransaction<T>(fn: (repos: ReadinessTransactionRepositories) => T): T;
}
```

#### Test Coverage (packages/application/src/services/readiness.service.test.ts - 814 lines)

Test categories:

- Basic readiness (no deps, all deps DONE, some deps not DONE)
- Hard-block vs soft-block distinction
- Dependency type filtering (blocks vs relates_to vs parent_child)
- Terminal state handling (FAILED, CANCELLED don't satisfy hard blocks)
- Complex graph topologies (diamond, long chains)
- Parent-child readiness with all TaskStatus values
- Edge cases (missing tasks, mixed edge types)

Example test:

```typescript
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
});
```

---

### 2.2 Dependency Service (packages/application/src/services/dependency.service.ts)

**Purpose**: DAG validation and dependency graph management. Validates that the dependency graph remains acyclic on every insert using depth-first search (DFS) cycle detection.

#### Main Methods

##### addDependency(params: AddDependencyParams): AddDependencyResult

**Algorithm**:

1. Reject self-dependencies
2. Validate both tasks exist (EntityNotFoundError)
3. Reject duplicate edges (DuplicateDependencyError)
4. **Cycle Detection**: Run DFS from `dependsOnTaskId` to check if `taskId` is reachable
   - If reachable, adding the edge would create a cycle
   - Return cycle path for diagnostics
5. Insert the edge atomically within the same transaction as the check

**Parameters**:

```typescript
interface AddDependencyParams {
  readonly taskId: string; // dependent task
  readonly dependsOnTaskId: string; // prerequisite task
  readonly dependencyType: DependencyType;
  readonly isHardBlock?: boolean; // defaults to true for BLOCKS, false for others
}
```

**Error Handling**:

- `EntityNotFoundError`: If either task doesn't exist
- `SelfDependencyError`: If taskId === dependsOnTaskId
- `DuplicateDependencyError`: If edge already exists
- `CyclicDependencyError`: If would create a cycle (includes cycle path)

##### Cycle Detection Algorithm (detectCycle function, lines 140-188)

```typescript
function detectCycle(
  startTaskId: string,
  targetTaskId: string,
  repo: TaskDependencyRepositoryPort,
): readonly string[] | null;
```

Strategy:

- Start DFS from `startTaskId`'s dependencies (follow forward edges)
- For each dependency, recursively check if `targetTaskId` is reachable
- If found, return the cycle path
- Use visited set to prevent infinite loops
- ALL dependency types (blocks, relates_to, parent_child) participate in cycle detection

##### getDependencies(taskId: string): GetDependenciesResult

Forward lookup: Get all tasks that a given task depends on.

##### getDependents(taskId: string): GetDependentsResult

Reverse lookup: Get all tasks that depend on a given task.

##### removeDependency(taskDependencyId: string): RemoveDependencyResult

Removing edges cannot create cycles, so no DAG validation is needed.

#### Port Interfaces (packages/application/src/ports/dependency.ports.ts)

**DependencyEdge**:

```typescript
interface DependencyEdge {
  readonly taskDependencyId: string;
  readonly taskId: string;
  readonly dependsOnTaskId: string;
  readonly dependencyType: DependencyType;
  readonly isHardBlock: boolean;
  readonly createdAt: Date;
}
```

**TaskDependencyRepositoryPort**:

- `findByTaskId(taskId: string)`: Forward lookup
- `findByDependsOnTaskId(dependsOnTaskId: string)`: Reverse lookup
- `findByTaskIdPair(taskId, dependsOnTaskId)`: Find specific edge
- `create(data: NewDependencyEdge)`: Insert edge
- `delete(taskDependencyId: string)`: Delete edge

**DependencyUnitOfWork**:

```typescript
interface DependencyUnitOfWork {
  runInTransaction<T>(fn: (repos: DependencyTransactionRepositories) => T): T;
}
```

#### isHardBlock Default Resolution (lines 209-210)

```typescript
const resolvedIsHardBlock =
  isHardBlock !== undefined ? isHardBlock : dependencyType === ("blocks" as DependencyType);
```

Defaults:

- **BLOCKS type**: true (hard block by default)
- **RELATES_TO type**: false (informational only)
- **PARENT_CHILD type**: false (doesn't affect readiness)

#### Test Coverage (packages/application/src/services/dependency.service.test.ts - 1008 lines)

Test categories:

- Input validation (self-dependency, missing tasks, duplicate edges)
- Cycle detection (direct, transitive, long chains, complex topologies, mixed types)
- Valid DAG structures (linear, diamond, tree, disconnected components, fan-out, fan-in)
- isHardBlock defaults for all dependency types
- Edge removal and re-adding
- Forward/reverse lookups

Example tests:

```typescript
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

it("should detect transitive three-node cycle", () => {
  const { service } = setup(
    ["A", "B", "C"],
    [
      /* A → B → C */
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

it("should detect cycle across mixed dependency types", () => {
  // A blocks→B relates_to→C, then C parent_child→A = cycle
  // All types participate in cycle detection
});
```

---

### 2.3 Transition Service (packages/application/src/services/transition.service.ts)

**Purpose**: Centralized state transition service — the SINGLE authority for committing state changes. Enforces all state machine rules, optimistic concurrency, audit logging, and domain event publication.

#### Key Pattern (Per transition method)

1. **Fetch** the entity via repository
2. **Validate** the transition via domain-layer state machine
3. **Update** with optimistic concurrency (version-based for tasks, status-based for others)
4. **Create** an audit event — atomically in the same transaction
5. **Emit** a domain event AFTER the transaction commits

#### Optimistic Concurrency

- **Tasks**: Use explicit `version` column (incremented on every update)
- **Other entities**: Use status-based checks — update verifies current status matches expectations

#### Main Methods

```typescript
interface TransitionService {
  transitionTask(taskId, targetStatus, context, actor, metadata?): TransitionResult;
  transitionLease(leaseId, targetStatus, context, actor, metadata?): TransitionResult;
  transitionReviewCycle(reviewCycleId, targetStatus, context, actor, metadata?): TransitionResult;
  transitionMergeQueueItem(itemId, targetStatus, context, actor, metadata?): TransitionResult;
}

interface TransitionResult<T> {
  readonly entity: T;
  readonly auditEvent: AuditEventRecord;
}
```

#### Responsibility Assignment

**The Transition Service DOES NOT:**

- Compute readiness (that's ReadinessService)
- Validate dependencies (that's DependencyService)
- Determine if a transition should happen (caller responsibility)

**The Transition Service DOES:**

- Validate the transition is allowed by the state machine
- Apply optimistic concurrency checks
- Persist the change atomically with an audit event
- Emit domain events for downstream consumers

---

## 3. Error Types (packages/application/src/errors.ts)

Key custom errors used throughout:

1. **`EntityNotFoundError`**: Entity doesn't exist
2. **`InvalidTransitionError`**: State machine rejected the transition
3. **`VersionConflictError`**: Optimistic concurrency conflict
4. **`CyclicDependencyError`**: Adding edge would create a cycle (includes cycle path)
5. **`DuplicateDependencyError`**: Edge already exists
6. **`SelfDependencyError`**: Task cannot depend on itself

---

## 4. Integration Points

### Readiness Computation Flow

1. **Reconciliation Loop** (part of orchestration):
   - When a task transitions to DONE, trigger readiness recalculation for all reverse-dependent tasks
   - When a task transitions to FAILED or CANCELLED, hard-blocked dependents remain BLOCKED
2. **Dependency Module Integration**:
   - Call `computeReadiness(taskId)` to check if a task should transition BLOCKED→READY
   - Call `checkParentChildReadiness(parentTaskId)` to check if parent can transition to DONE

3. **Task Transition**:
   - Readiness Service determines IF a transition is allowed
   - Transition Service executes the transition and records audit trail

---

## 5. Test Infrastructure

### Mock Implementations

Both services include comprehensive mock implementations for testing:

**MockState Pattern**:

```typescript
interface MockState {
  tasks: Map<string, Task> | Set<string>;
  edges: ReadinessDependencyEdge[] | Map<string, DependencyEdge>;
}

// Mock repositories implement the ports
// Mock unit of work runs transactions in-memory
```

### Test Helpers

**Shorthand creators** for common edge types:

```typescript
hardBlock(id, taskId, dependsOnTaskId); // BLOCKS, isHardBlock=true
softBlock(id, taskId, dependsOnTaskId); // BLOCKS, isHardBlock=false
relatesTo(id, taskId, dependsOnTaskId); // RELATES_TO
parentChild(id, parentId, childId); // PARENT_CHILD
```

---

## 6. Key Invariants & Constraints

### DAG Invariant

- The dependency graph must be acyclic at all times
- Circular dependencies are rejected at creation time
- ALL dependency types (blocks, relates_to, parent_child) participate in cycle detection

### Readiness Rules

- Only hard-block edges affect READY readiness
- Soft-block and relates_to edges are informational
- Parent-child edges are evaluated separately via `checkParentChildReadiness`
- Only DONE satisfies hard-block dependencies
- FAILED and CANCELLED do NOT satisfy hard-block dependencies
- CANCELLED IS accepted for parent-child completion

### State Machine Invariants

- Only one active development lease per task
- Every state transition includes an optimistic version check
- Tasks in DONE are immutable except via reopen operation
- Approved tasks cannot re-enter review without invalidation event

### Deterministic Orchestration

- All state transitions MUST flow through the TransitionService
- Readiness computation is a pure query (no side effects)
- The reconciliation loop (not individual transitions) is responsible for acting on readiness results

---

## 7. File Structure Summary

```
packages/application/src/
├── services/
│   ├── readiness.service.ts              (307 lines - service + factory)
│   ├── readiness.service.test.ts         (814 lines - comprehensive tests)
│   ├── dependency.service.ts             (274 lines - service + factory)
│   ├── dependency.service.test.ts        (1008 lines - comprehensive tests)
│   ├── transition.service.ts             (451 lines - all 4 entity types)
│   └── transition.service.test.ts        (500+ lines - transition tests)
├── ports/
│   ├── readiness.ports.ts                (103 lines - service contracts)
│   ├── dependency.ports.ts               (116 lines - service contracts)
│   └── repository.ports.ts               (various entity types)
└── errors.ts                              (custom error types)

packages/domain/src/
├── enums.ts                               (618 lines - all domain enums)
├── state-machines/                        (task, worker-lease, review-cycle, merge-queue-item)
└── index.ts                               (exports)

docs/prd/
└── 002-data-model.md                      (authoritative specification)
```

---

## 8. Implementation Notes

### Pure Query vs. Mutation

The ReadinessService is strictly a **pure query**:

- Takes no write-side inputs
- Performs no database mutations
- Returns results based on current state only
- Called repeatedly with no state change

The DependencyService is **mutation-heavy**:

- Modifies the dependency graph
- Validates mutations (cycle detection)
- Runs within transactions for atomicity

The TransitionService is **mutation authority**:

- Single point for all state changes
- Enforces domain invariants
- Publishes events for downstream consumers

### Testing Strategy

1. **In-memory mocks** for all tests (no database dependency)
2. **Parametric tests** for exhaustive coverage (e.g., all TaskStatus values)
3. **Graph topology tests** for cycle detection (linear, diamond, tree, etc.)
4. **Edge case tests** (missing entities, mixed types, long chains)
5. **Integration tests** for service interactions

---

## 9. PRD References

All implementations are sourced from authoritative PRD specifications:

- **PRD 002 §2.1**: Task State Machine
- **PRD 002 §2.3**: Core Data Model, TaskDependency entity, Dependency rules
- **PRD 005**: Deterministic Transition Ownership
- **PRD 007 §7.13**: State Transition Engine

Key Rules from PRD 002 §2.3:

> "Circular dependencies are rejected at creation time. The Dependency Module validates the graph is a DAG on every insert."
>
> "When a dependency task transitions to DONE, the Dependency Module recalculates readiness for all reverse-dependent tasks."
>
> "When a dependency task transitions to FAILED or CANCELLED, hard-blocked dependents remain in BLOCKED."

---

## 10. Recommended Next Steps

For T036 (readiness computation implementation):

1. **Port the ReadinessService** to your infrastructure (connect real repository implementations)
2. **Wire into reconciliation loop**: Call `computeReadiness()` after each dependency change
3. **Implement state machine transitions**: Use `checkParentChildReadiness()` for DONE eligibility
4. **Add monitoring**: Log readiness computations and blocking reasons for observability
5. **Write integration tests**: Test with real task/dependency data from your repository layer
6. **Implement reconciliation trigger**: Ensure readiness recalculation on all relevant state changes
