# T082: Implement Task management endpoints

| Field                     | Value                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **ID**                    | T082                                                                                                        |
| **Epic**                  | [E017: REST API Layer](../epics/E017-rest-api.md)                                                           |
| **Type**                  | feature                                                                                                     |
| **Status**                | done                                                                                                        |
| **Priority**              | P0                                                                                                          |
| **Owner**                 | backend-engineer                                                                                            |
| **AI Executable**         | Yes                                                                                                         |
| **Human Review Required** | Yes                                                                                                         |
| **Dependencies**          | [T009](./T009-migration-task.md), [T014](./T014-entity-repositories.md), [T080](./T080-nestjs-bootstrap.md) |
| **Blocks**                | [T089](./T089-react-spa-init.md)                                                                            |

---

## Description

Create REST endpoints for Task CRUD, status queries, and filtering.

## Goal

Enable task management and visibility through the API.

## Scope

### In Scope

- POST /api/tasks (create)
- GET /api/tasks (list with filtering)
- GET /api/tasks/:id (detail)
- PUT /api/tasks/:id (update metadata)
- Filtering: by status, repository, priority, task_type
- Include dependency information in detail response

### Out of Scope

- Operator state transitions (T101)
- Task import from external sources

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`

## Implementation Guidance

1. Create TasksController with CRUD and query endpoints
2. List endpoint filters: status, repository_id, priority, task_type
3. Detail endpoint includes: task fields, current lease info, current review cycle, dependencies
4. Create endpoint initializes task in BACKLOG state
5. Support batch task creation for convenience

## Acceptance Criteria

- [ ] All Task CRUD operations work
- [ ] Filtering works for all supported fields
- [ ] Detail includes related entity information
- [ ] New tasks start in BACKLOG state

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

API tests for task operations and filtering

### Suggested Validation Commands

```bash
pnpm test --filter @factory/control-plane -- --grep api/task
```

## Risks / Notes

Task query performance may need optimization for large datasets. Add indexes early.

## Follow-on Tasks

T089
