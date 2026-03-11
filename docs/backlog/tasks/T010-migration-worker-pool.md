# T010: Create migrations for WorkerPool, Worker, AgentProfile, PromptTemplate tables

| Field                     | Value                                                                         |
| ------------------------- | ----------------------------------------------------------------------------- |
| **ID**                    | T010                                                                          |
| **Epic**                  | [E002: Domain Model & Persistence](../epics/E002-domain-model-persistence.md) |
| **Type**                  | foundation                                                                    |
| **Status**                | done                                                                          |
| **Priority**              | P0                                                                            |
| **Owner**                 | backend-engineer                                                              |
| **AI Executable**         | Yes                                                                           |
| **Human Review Required** | Yes                                                                           |
| **Dependencies**          | [T006](./T006-sqlite-drizzle-setup.md), [T007](./T007-domain-enums-types.md)  |
| **Blocks**                | [T014](./T014-entity-repositories.md), [T083](./T083-api-worker-pool.md)      |

---

## Description

Create Drizzle schema and migration for WorkerPool, Worker, AgentProfile, and PromptTemplate tables from docs/prd/002-data-model.md §2.3.

## Goal

Enable worker pool management and agent profile configuration persistence.

## Scope

### In Scope

- WorkerPool with all fields including capabilities as JSON
- Worker with status and health metadata
- AgentProfile with all policy reference IDs
- PromptTemplate with template_text and schemas as JSON
- Foreign keys between Worker->WorkerPool and AgentProfile->WorkerPool

### Out of Scope

- Worker runtime logic (E009)
- Pool management API (T083)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`
- `docs/prd/010-integration-contracts.md`

## Implementation Guidance

1. Define WorkerPool with pool_type enum (developer/reviewer/lead-reviewer/merge-assist/planner)
2. capabilities, repo_scope_rules stored as JSON
3. Worker table with current_task_id, current_run_id as nullable FKs
4. AgentProfile references pool_id and multiple policy/template IDs
5. PromptTemplate stores input_schema and output_schema as JSON text

## Acceptance Criteria

- [x] All four tables created with correct schemas
- [x] Foreign key relationships enforced
- [x] JSON columns serialize/deserialize correctly

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run migration and test insert/select for each table

### Suggested Validation Commands

```bash
cd apps/control-plane && pnpm db:generate && pnpm db:migrate
```

## Risks / Notes

Many JSON columns — ensure consistent serialization approach.

## Follow-on Tasks

T014, T083
