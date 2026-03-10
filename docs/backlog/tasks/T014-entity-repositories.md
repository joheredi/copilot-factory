# T014: Implement data access repositories for all entities

| Field | Value |
|---|---|
| **ID** | T014 |
| **Epic** | [E002: Domain Model & Persistence](../epics/E002-domain-model-persistence.md) |
| **Type** | foundation |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T008](./T008-migration-project-repo.md), [T009](./T009-migration-task.md), [T010](./T010-migration-worker-pool.md), [T011](./T011-migration-lease-review.md), [T012](./T012-migration-merge-job.md), [T013](./T013-migration-audit-policy.md) |
| **Blocks** | [T015](./T015-task-state-machine.md), [T025](./T025-job-queue-core.md), [T030](./T030-lease-acquisition.md), [T035](./T035-dag-validation.md), [T058](./T058-review-router.md), [T063](./T063-merge-queue.md), [T069](./T069-artifact-storage.md), [T073](./T073-audit-event-recording.md) |

---

## Description

Implement the data access (repository) layer for all entities using Drizzle ORM. Each repository provides typed CRUD operations, query methods, and transaction support. The Task repository must include optimistic concurrency via the version column.

## Goal

Provide a clean, tested data access layer that all application services build upon.

## Scope

### In Scope

- Repository classes for: Project, Repository, Task (with version check), TaskDependency, WorkerPool, Worker, AgentProfile, PromptTemplate, TaskLease, ReviewCycle, ReviewPacket, LeadReviewDecision, MergeQueueItem, ValidationRun, Job, AuditEvent, PolicySet
- CRUD operations per entity
- Common query methods (findByStatus, findByEntityId, etc.)
- Transaction helper for atomic operations
- Task.version increment on update

### Out of Scope

- Business logic in repositories
- Complex query optimization

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`
- `docs/prd/010-integration-contracts.md`

## Implementation Guidance

1. Create apps/control-plane/src/infrastructure/repositories/ directory
2. One file per entity repository (e.g., task.repository.ts)
3. Use Drizzle's query builder for type-safe operations
4. Task repository: update method must check version matches expected, increment version, reject on conflict
5. Job repository: include claimJob method that atomically sets status=claimed and lease_owner
6. AuditEvent repository: insert-only, query by entity_type+entity_id and by time range
7. Write unit tests for each repository using an in-memory SQLite database
8. Export all repositories from a central index

## Acceptance Criteria

- [ ] Repository exists for every entity in the data model
- [ ] Task repository enforces optimistic concurrency
- [ ] Job repository supports atomic claim operation
- [ ] All repositories have passing unit tests with in-memory SQLite

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run unit tests for all repositories

### Suggested Validation Commands

```bash
pnpm test --filter @factory/control-plane -- --grep repository
```

## Risks / Notes

In-memory SQLite may behave slightly differently from file-based. Test both if possible.

## Follow-on Tasks

T015, T025, T030, T035, T058, T063, T069, T073
