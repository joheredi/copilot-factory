# T073: Implement audit event recording on state transitions

| Field                     | Value                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T073                                                                                                                       |
| **Epic**                  | [E015: Audit & Event System](../epics/E015-audit-events.md)                                                                |
| **Type**                  | feature                                                                                                                    |
| **Status**                | pending                                                                                                                    |
| **Priority**              | P0                                                                                                                         |
| **Owner**                 | backend-engineer                                                                                                           |
| **AI Executable**         | Yes                                                                                                                        |
| **Human Review Required** | Yes                                                                                                                        |
| **Dependencies**          | [T013](./T013-migration-audit-policy.md), [T014](./T014-entity-repositories.md), [T018](./T018-atomic-transition-audit.md) |
| **Blocks**                | [T074](./T074-audit-query-service.md), [T100](./T100-ui-audit-explorer.md)                                                 |

---

## Description

Ensure every state transition creates an AuditEvent record atomically within the same transaction. Record entity type, old/new state, actor, and metadata.

## Goal

Maintain a complete, tamper-evident audit trail of all state changes.

## Scope

### In Scope

- AuditEvent creation in TransitionService (already sketched in T018)
- All required fields: entity_type, entity_id, event_type, actor_type, actor_id, old_state, new_state
- Metadata capturing transition context (trigger reason, policy applied, etc.)
- Actor types: system, scheduler, worker, operator, policy

### Out of Scope

- Audit query API (T074)
- Audit retention policy

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`

## Implementation Guidance

1. Ensure TransitionService creates AuditEvent for every transition (building on T018)
2. Set actor_type based on who triggered: scheduler=system, worker result=worker, operator action=operator
3. Include metadata_json with relevant context: lease_id, review_cycle_id, policy applied, reason
4. Verify atomicity: audit event is in same transaction as state change
5. Write tests verifying every transition type produces an audit event

## Acceptance Criteria

- [ ] Every state transition has an audit event
- [ ] Audit events have correct actor and metadata
- [ ] Events are atomic with transitions
- [ ] No transition can occur without an audit event

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run full lifecycle test, verify audit trail is complete

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep audit
```

## Risks / Notes

Must not miss any transition. Ensure new transitions added later also create audits.

## Follow-on Tasks

T074, T100
