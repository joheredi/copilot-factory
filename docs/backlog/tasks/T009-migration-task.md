# T009: Create migrations for Task and TaskDependency tables

| Field | Value |
|---|---|
| **ID** | T009 |
| **Epic** | [E002: Domain Model & Persistence](../epics/E002-domain-model-persistence.md) |
| **Type** | foundation |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T006](./T006-sqlite-drizzle-setup.md), [T007](./T007-domain-enums-types.md), [T008](./T008-migration-project-repo.md) |
| **Blocks** | [T014](./T014-entity-repositories.md), [T015](./T015-task-state-machine.md), [T082](./T082-api-task-management.md) |

---

## Description

Create Drizzle schema and migration for the Task and TaskDependency tables with all fields from docs/prd/002-data-model.md §2.3, including the version column for optimistic concurrency.

## Goal

Enable task persistence with full lifecycle metadata and dependency tracking.

## Scope

### In Scope

- Task table with ALL fields from §2.3 including version, retry_count, review_round_count
- TaskDependency table with dependency_type and is_hard_block
- Indexes on status, repository_id, priority
- Unique constraint considerations

### Out of Scope

- Task state machine logic (T015)
- Dependency graph operations (T035)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`

## Implementation Guidance

1. Define Task table with all columns from the entity spec
2. version column: integer, default 1, NOT NULL — used for optimistic concurrency
3. suggested_file_scope stored as JSON text array
4. acceptance_criteria and definition_of_done stored as JSON text arrays
5. required_capabilities stored as JSON text array
6. Add composite index on (repository_id, status) for query performance
7. Define TaskDependency with task_id, depends_on_task_id, dependency_type, is_hard_block
8. Add unique constraint on (task_id, depends_on_task_id) to prevent duplicates

## Acceptance Criteria

- [ ] Task table has all fields from docs/prd/002-data-model.md
- [ ] version column exists with default 1
- [ ] TaskDependency table supports all dependency types
- [ ] Migration runs without errors

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run migration and verify table schemas match spec

### Suggested Validation Commands

```bash
cd apps/control-plane && pnpm db:generate && pnpm db:migrate
```

## Risks / Notes

Task table has many columns. Ensure all are included per spec.

## Follow-on Tasks

T014, T015, T082
