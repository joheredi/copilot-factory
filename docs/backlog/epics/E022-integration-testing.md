# E022: Integration Testing & E2E

## Summary

Build the integration test harness and comprehensive end-to-end tests for all critical paths.

## Why This Epic Exists

End-to-end tests validate that all components work together correctly. Critical for confidence in autonomous operation.

## Goals

- Test harness with fake runner and workspace
- Full task lifecycle test
- Review rejection and rework test
- Merge failure test
- Lease timeout and recovery test
- Escalation test

## Scope

### In Scope

- Test doubles from docs/prd/007-technical-architecture.md §7.17
- Happy path and failure scenarios
- V1 milestone verification tests

### Out of Scope

- Performance testing
- Load testing
- UI end-to-end tests

## Dependencies

**Depends on:** E009, E012, E013, E021

**Enables:** None

## Risks / Notes

Integration tests are brittle if not designed carefully. Must use proper test doubles.

## Tasks

| ID                                          | Title                                                 | Priority | Status  |
| ------------------------------------------- | ----------------------------------------------------- | -------- | ------- |
| [T106](../tasks/T106-test-harness.md)       | Create test harness with fake runner and workspace    | P0       | pending |
| [T107](../tasks/T107-e2e-full-lifecycle.md) | Integration test: full task lifecycle BACKLOG to DONE | P0       | pending |
| [T108](../tasks/T108-e2e-review-rework.md)  | Integration test: review rejection and rework loop    | P0       | pending |
| [T109](../tasks/T109-e2e-merge-failures.md) | Integration test: merge conflict and failure paths    | P1       | pending |
| [T110](../tasks/T110-e2e-lease-recovery.md) | Integration test: lease timeout and crash recovery    | P1       | pending |
| [T111](../tasks/T111-e2e-escalation.md)     | Integration test: escalation triggers and resolution  | P1       | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

All critical paths tested end-to-end. Tests pass reliably. Milestone acceptance criteria verified.
