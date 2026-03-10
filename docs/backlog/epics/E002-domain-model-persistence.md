# E002: Domain Model & Persistence

## Summary

Define all core domain types, database schema, migrations, and data-access repositories for the control-plane entities.

## Why This Epic Exists

The data model is the foundation of the entire system. Every service depends on well-typed entities and reliable persistence.

## Goals

- All entity tables created via migrations
- Repository layer for every entity
- Optimistic concurrency on Task table
- Type-safe domain enums and value objects

## Scope

### In Scope

- Database migrations for all entities in docs/prd/002-data-model.md
- Repository implementations
- Domain enums and types

### Out of Scope

- State machine logic (E003)
- API endpoints (E017)
- Business orchestration logic

## Dependencies

**Depends on:** E001

**Enables:** E003, E004, E005, E006, E007, E014, E015

## Risks / Notes

Schema must precisely match the data model spec. Changes later require migrations.

## Tasks

| ID | Title | Priority | Status |
|---|---|---|---|
| [T007](../tasks/T007-domain-enums-types.md) | Define core domain enums and value objects | P0 | pending |
| [T008](../tasks/T008-migration-project-repo.md) | Create migrations for Project, Repository, WorkflowTemplate tables | P0 | pending |
| [T009](../tasks/T009-migration-task.md) | Create migrations for Task and TaskDependency tables | P0 | pending |
| [T010](../tasks/T010-migration-worker-pool.md) | Create migrations for WorkerPool, Worker, AgentProfile, PromptTemplate tables | P0 | pending |
| [T011](../tasks/T011-migration-lease-review.md) | Create migrations for TaskLease, ReviewCycle, ReviewPacket, LeadReviewDecision tables | P0 | pending |
| [T012](../tasks/T012-migration-merge-job.md) | Create migrations for MergeQueueItem, ValidationRun, Job tables | P0 | pending |
| [T013](../tasks/T013-migration-audit-policy.md) | Create migrations for AuditEvent and PolicySet tables | P0 | pending |
| [T014](../tasks/T014-entity-repositories.md) | Implement data access repositories for all entities | P0 | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

All migrations run cleanly. All repositories pass CRUD tests. Domain types compile.
