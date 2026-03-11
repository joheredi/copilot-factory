# E003: State Machine & Transition Engine

## Summary

Implement the Task, Worker Lease, Review Cycle, and Merge Queue Item state machines with a centralized transition service.

## Why This Epic Exists

The state machine is the core correctness mechanism. All orchestration depends on validated, atomic state transitions.

## Goals

- Task state machine with all transitions from §2.1
- Supporting state machines (lease, review, merge)
- Centralized transition service
- Optimistic concurrency control
- Atomic transition + audit event persistence

## Scope

### In Scope

- State machine validation logic
- Transition preconditions
- Concurrency control
- Audit event emission on transition

### Out of Scope

- Scheduling logic
- Worker execution
- Review routing

## Dependencies

**Depends on:** E002

**Enables:** E005, E006, E007, E012, E013

## Risks / Notes

State machine must exactly match docs/prd/002-data-model.md. Transition preconditions are complex.

## Tasks

| ID                                                 | Title                                                   | Priority | Status  |
| -------------------------------------------------- | ------------------------------------------------------- | -------- | ------- |
| [T015](../tasks/T015-task-state-machine.md)        | Implement Task state machine with transition validation | P0       | pending |
| [T016](../tasks/T016-supporting-state-machines.md) | Implement supporting state machines                     | P0       | pending |
| [T017](../tasks/T017-transition-service.md)        | Build centralized State Transition Service              | P0       | pending |
| [T018](../tasks/T018-atomic-transition-audit.md)   | Implement atomic transition + audit persistence         | P0       | pending |
| [T019](../tasks/T019-optimistic-concurrency.md)    | Implement optimistic concurrency control                | P0       | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

All state machine transitions are validated. Integration tests cover every valid and invalid transition path.
