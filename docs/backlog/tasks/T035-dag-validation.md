# T035: Implement DAG validation with circular dependency detection

| Field                     | Value                                                                         |
| ------------------------- | ----------------------------------------------------------------------------- |
| **ID**                    | T035                                                                          |
| **Epic**                  | [E007: Dependency & Readiness Engine](../epics/E007-dependency-readiness.md)  |
| **Type**                  | feature                                                                       |
| **Status**                | pending                                                                       |
| **Priority**              | P0                                                                            |
| **Owner**                 | backend-engineer                                                              |
| **AI Executable**         | Yes                                                                           |
| **Human Review Required** | Yes                                                                           |
| **Dependencies**          | [T014](./T014-entity-repositories.md)                                         |
| **Blocks**                | [T036](./T036-readiness-computation.md), [T037](./T037-reverse-dep-recalc.md) |

---

## Description

Implement circular dependency detection when adding task dependencies. The dependency graph must be validated as a DAG on every insert.

## Goal

Prevent circular dependencies that would make tasks permanently blocked.

## Scope

### In Scope

- addDependency(taskId, dependsOnTaskId, type, isHardBlock) with cycle check
- Graph traversal to detect cycles before insertion
- Rejection with descriptive error on cycle detection
- Support for all dependency types: blocks, relates_to, parent_child

### Out of Scope

- Cross-repo dependencies
- Automatic cycle resolution

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`

## Implementation Guidance

1. Create packages/application/src/services/dependency.service.ts
2. Before inserting a dependency, run DFS/BFS from dependsOnTaskId to check if taskId is reachable
3. If reachable, adding this edge would create a cycle — reject with CyclicDependencyError
4. relates_to dependencies don't affect readiness but should still be cycle-free for consistency
5. Write tests with various graph shapes: linear chains, diamonds, trees, and attempted cycles

## Acceptance Criteria

- [ ] Circular dependencies are detected and rejected
- [ ] Valid DAG structures are accepted
- [ ] All dependency types supported
- [ ] Descriptive error on cycle detection

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Unit tests with various graph topologies

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep dag
```

## Risks / Notes

DFS on large graphs could be slow. Acceptable for V1 task counts.

## Follow-on Tasks

T036, T037
