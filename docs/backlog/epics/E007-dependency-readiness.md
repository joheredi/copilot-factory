# E007: Dependency & Readiness Engine

## Summary

Build the task dependency graph manager with DAG validation, readiness computation, and automatic recalculation.

## Why This Epic Exists

Dependency-aware scheduling is a core product feature. Tasks must not start until prerequisites are satisfied.

## Goals

- Circular dependency detection on insert
- Blocked/ready state computation
- Automatic readiness recalculation on task completion
- Reconciliation loop for missed recalculations

## Scope

### In Scope

- DAG validation
- Readiness computation
- Reverse-dependency unblocks
- Hard vs soft dependency semantics

### Out of Scope

- Cross-repo dependencies (future)
- Automatic task decomposition

## Dependencies

**Depends on:** E002, E003

**Enables:** E005

## Risks / Notes

Graph operations must be efficient. Reconciliation loop must be idempotent.

## Tasks

| ID | Title | Priority | Status |
|---|---|---|---|
| [T035](../tasks/T035-dag-validation.md) | Implement DAG validation with circular dependency detection | P0 | pending |
| [T036](../tasks/T036-readiness-computation.md) | Implement readiness computation | P0 | pending |
| [T037](../tasks/T037-reverse-dep-recalc.md) | Implement reverse-dependency recalculation | P0 | pending |
| [T038](../tasks/T038-dep-reconciliation.md) | Implement dependency reconciliation loop | P1 | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

Dependencies are validated as a DAG. Task readiness correctly reflects dependency status. Reconciliation catches missed updates.
