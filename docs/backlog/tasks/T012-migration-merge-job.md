# T012: Create migrations for MergeQueueItem, ValidationRun, Job tables

| Field                     | Value                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T012                                                                                                           |
| **Epic**                  | [E002: Domain Model & Persistence](../epics/E002-domain-model-persistence.md)                                  |
| **Type**                  | foundation                                                                                                     |
| **Status**                | done                                                                                                           |
| **Priority**              | P0                                                                                                             |
| **Owner**                 | backend-engineer                                                                                               |
| **AI Executable**         | Yes                                                                                                            |
| **Human Review Required** | Yes                                                                                                            |
| **Dependencies**          | [T006](./T006-sqlite-drizzle-setup.md), [T007](./T007-domain-enums-types.md), [T009](./T009-migration-task.md) |
| **Blocks**                | [T014](./T014-entity-repositories.md), [T025](./T025-job-queue-core.md), [T063](./T063-merge-queue.md)         |

---

## Description

Create Drizzle schema and migration for MergeQueueItem, ValidationRun, and Job tables.

## Goal

Enable merge queue tracking, validation result storage, and job queue persistence.

## Scope

### In Scope

- MergeQueueItem with position and status
- ValidationRun with run_scope and artifact_refs as JSON
- Job with all fields including parent_job_id, job_group_id, depends_on_job_ids as JSON
- Indexes on Job.status and Job.run_after for queue polling

### Out of Scope

- Merge queue logic (E013)
- Job queue logic (E005)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`
- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. MergeQueueItem: merge_queue_item_id PK, task_id FK, repository_id FK, status, position, approved_commit_sha, timestamps
2. ValidationRun: validation_run_id PK, task_id FK, run_scope enum, status, tool_name, summary, artifact_refs JSON
3. Job: job_id PK, job_type enum, entity_type, entity_id, payload_json, status, attempt_count, run_after, lease_owner
4. Job also: parent_job_id nullable FK, job_group_id nullable, depends_on_job_ids JSON array
5. Add index on (Job.status, Job.run_after) for efficient queue polling
6. Add index on MergeQueueItem(repository_id, status) for queue queries

## Acceptance Criteria

- [x] All three tables created with correct schemas
- [x] Job table supports dependency and group coordination fields
- [x] Indexes created for query performance

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run migration and verify table schemas and indexes

### Suggested Validation Commands

```bash
cd apps/control-plane && pnpm db:generate && pnpm db:migrate
```

## Risks / Notes

Job table is heavily used. Index design matters for performance.

## Follow-on Tasks

T014, T025, T063
