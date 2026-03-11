# E005: Job Queue & Scheduling

## Summary

Build the DB-backed job queue with dependency coordination and the task scheduler that matches ready tasks to worker pools.

## Why This Epic Exists

The scheduler and job queue drive all automated workflow progression. Without them, nothing moves autonomously.

## Goals

- DB-backed job queue with claim/complete/fail
- Job dependency resolution
- Job group coordination for review fan-out
- Scheduler service with pool matching
- Background scheduler tick loop

## Scope

### In Scope

- Job table operations
- Job lifecycle
- Task selection algorithm
- Pool compatibility matching
- Scheduler tick as recurring job

### Out of Scope

- Worker execution (E009)
- Lease management (E006)

## Dependencies

**Depends on:** E002, E003

**Enables:** E006, E009, E012, E013

## Risks / Notes

Job queue must handle concurrent claims safely. Scheduler must respect all readiness constraints.

## Tasks

| ID                                            | Title                                           | Priority | Status  |
| --------------------------------------------- | ----------------------------------------------- | -------- | ------- |
| [T025](../tasks/T025-job-queue-core.md)       | Implement DB-backed job queue                   | P0       | pending |
| [T026](../tasks/T026-job-dependencies.md)     | Implement job dependency and group coordination | P0       | pending |
| [T027](../tasks/T027-scheduler-service.md)    | Implement Scheduler service                     | P0       | pending |
| [T028](../tasks/T028-scheduler-tick-loop.md)  | Implement scheduler tick loop                   | P1       | pending |
| [T029](../tasks/T029-reconciliation-sweep.md) | Implement reconciliation sweep job              | P1       | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

Jobs can be created, claimed, completed, and failed. Scheduler selects correct tasks and matches to pools.
