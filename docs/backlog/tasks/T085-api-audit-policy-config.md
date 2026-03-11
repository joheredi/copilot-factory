# T085: Implement Audit, Policy, and Config endpoints

| Field                     | Value                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T085                                                                                                             |
| **Epic**                  | [E017: REST API Layer](../epics/E017-rest-api.md)                                                                |
| **Type**                  | feature                                                                                                          |
| **Status**                | pending                                                                                                          |
| **Priority**              | P1                                                                                                               |
| **Owner**                 | backend-engineer                                                                                                 |
| **AI Executable**         | Yes                                                                                                              |
| **Human Review Required** | Yes                                                                                                              |
| **Dependencies**          | [T074](./T074-audit-query-service.md), [T052](./T052-hierarchical-config.md), [T080](./T080-nestjs-bootstrap.md) |
| **Blocks**                | [T089](./T089-react-spa-init.md)                                                                                 |

---

## Description

Create REST endpoints for audit event queries, policy management, and configuration inspection.

## Goal

Expose audit trail, policy configuration, and system config through the API.

## Scope

### In Scope

- GET /api/audit?entity_type=&entity_id=&start=&end= (audit query)
- GET /api/tasks/:id/timeline (audit timeline for task)
- GET/PUT /api/policies/:id
- GET /api/config/effective?context=

### Out of Scope

- Policy versioning UI
- Config import/export

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`

## Implementation Guidance

1. Create AuditController, PoliciesController, ConfigController
2. Audit endpoint wraps the audit query service
3. Task timeline is a specialized audit query ordered by time
4. Policy endpoints allow viewing and updating PolicySet records
5. Config effective endpoint resolves hierarchical config for given context

## Acceptance Criteria

- [ ] Audit queries work with all filter combinations
- [ ] Task timeline shows complete history
- [ ] Policy updates persist correctly
- [ ] Effective config resolves correctly for given context

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

API tests for audit, policy, and config operations

### Suggested Validation Commands

```bash
pnpm test --filter @factory/control-plane -- --grep api/audit
```

## Risks / Notes

Audit queries on large datasets need pagination. Ensure it's included.

## Follow-on Tasks

T089
