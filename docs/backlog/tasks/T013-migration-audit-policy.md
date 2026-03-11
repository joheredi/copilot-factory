# T013: Create migrations for AuditEvent and PolicySet tables

| Field                     | Value                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T013                                                                                                             |
| **Epic**                  | [E002: Domain Model & Persistence](../epics/E002-domain-model-persistence.md)                                    |
| **Type**                  | foundation                                                                                                       |
| **Status**                | done                                                                                                             |
| **Priority**              | P0                                                                                                               |
| **Owner**                 | backend-engineer                                                                                                 |
| **AI Executable**         | Yes                                                                                                              |
| **Human Review Required** | Yes                                                                                                              |
| **Dependencies**          | [T006](./T006-sqlite-drizzle-setup.md), [T007](./T007-domain-enums-types.md)                                     |
| **Blocks**                | [T014](./T014-entity-repositories.md), [T073](./T073-audit-event-recording.md), [T048](./T048-command-policy.md) |

---

## Description

Create Drizzle schema and migration for AuditEvent and PolicySet tables.

## Goal

Enable audit trail persistence and policy set storage.

## Scope

### In Scope

- AuditEvent with all fields from §2.3 including metadata_json
- PolicySet with all policy JSON columns
- Indexes on AuditEvent(entity_type, entity_id) and (created_at)

### Out of Scope

- Audit query service (T074)
- Policy resolution logic (T052)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`

## Implementation Guidance

1. AuditEvent: audit_event_id PK, entity_type, entity_id, event_type, actor_type, actor_id, old_state, new_state, metadata_json, created_at
2. PolicySet: policy_set_id PK, name, version, scheduling_policy_json, review_policy_json, merge_policy_json, security_policy_json, validation_policy_json, budget_policy_json, created_at
3. Add indexes on AuditEvent for entity lookups and time-range queries
4. AuditEvent is append-only — no update/delete operations needed

## Acceptance Criteria

- [ ] Both tables created with correct schemas
- [ ] AuditEvent indexes support entity and time range queries
- [ ] PolicySet JSON columns handle complex policy objects

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run migration and verify table schemas

### Suggested Validation Commands

```bash
cd apps/control-plane && pnpm db:generate && pnpm db:migrate
```

## Risks / Notes

AuditEvent table will grow large. Consider retention policies early.

## Follow-on Tasks

T014, T073, T048
