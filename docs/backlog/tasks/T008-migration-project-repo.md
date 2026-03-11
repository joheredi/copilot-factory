# T008: Create migrations for Project, Repository, WorkflowTemplate tables

| Field                     | Value                                                                         |
| ------------------------- | ----------------------------------------------------------------------------- |
| **ID**                    | T008                                                                          |
| **Epic**                  | [E002: Domain Model & Persistence](../epics/E002-domain-model-persistence.md) |
| **Type**                  | foundation                                                                    |
| **Status**                | pending                                                                       |
| **Priority**              | P0                                                                            |
| **Owner**                 | backend-engineer                                                              |
| **AI Executable**         | Yes                                                                           |
| **Human Review Required** | Yes                                                                           |
| **Dependencies**          | [T006](./T006-sqlite-drizzle-setup.md), [T007](./T007-domain-enums-types.md)  |
| **Blocks**                | [T014](./T014-entity-repositories.md), [T081](./T081-api-project-repo.md)     |

---

## Description

Create the Drizzle schema definitions and migration for Project, Repository, and WorkflowTemplate tables as specified in docs/prd/002-data-model.md §2.3.

## Goal

Persist project and repository metadata so tasks can be scoped to repositories.

## Scope

### In Scope

- Project table with all fields from §2.3
- Repository table with all fields
- WorkflowTemplate table with all fields
- Foreign key relationships
- Indexes on commonly queried fields
- created_at/updated_at with defaults

### Out of Scope

- Repository data access layer (T014)
- API endpoints (T081)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`

## Implementation Guidance

1. Create Drizzle schema in apps/control-plane/src/infrastructure/database/schema/
2. Define Project table with project_id as primary key, name, description, owner, default_workflow_template_id, default_policy_set_id, timestamps
3. Define Repository table with repository_id, project_id FK, name, remote_url, default_branch, local_checkout_strategy, credential_profile_id, status, timestamps
4. Define WorkflowTemplate table with all policy reference fields as JSON columns
5. Generate migration with drizzle-kit generate
6. Run migration and verify tables exist

## Acceptance Criteria

- [ ] Migration creates all three tables with correct columns and types
- [ ] Foreign key from Repository to Project is enforced
- [ ] drizzle-kit migrate runs without errors

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run migration and query sqlite_master to verify tables

### Suggested Validation Commands

```bash
cd apps/control-plane && pnpm db:generate && pnpm db:migrate
```

## Risks / Notes

JSON column types in SQLite are text. Ensure Drizzle handles serialization.

## Follow-on Tasks

T014, T081
