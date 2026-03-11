# T074: Implement audit event query service

| Field                     | Value                                                                          |
| ------------------------- | ------------------------------------------------------------------------------ |
| **ID**                    | T074                                                                           |
| **Epic**                  | [E015: Audit & Event System](../epics/E015-audit-events.md)                    |
| **Type**                  | feature                                                                        |
| **Status**                | pending                                                                        |
| **Priority**              | P1                                                                             |
| **Owner**                 | backend-engineer                                                               |
| **AI Executable**         | Yes                                                                            |
| **Human Review Required** | Yes                                                                            |
| **Dependencies**          | [T073](./T073-audit-event-recording.md)                                        |
| **Blocks**                | [T085](./T085-api-audit-policy-config.md), [T100](./T100-ui-audit-explorer.md) |

---

## Description

Build the query service for audit events supporting filtering by entity, time range, actor, and event type.

## Goal

Enable operators to reconstruct what happened for any task or entity.

## Scope

### In Scope

- Query by entity_type + entity_id (timeline for a task)
- Query by time range
- Query by actor
- Query by event_type
- Pagination support
- Ordering by created_at

### Out of Scope

- Full-text search on metadata
- Audit analytics

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`

## Implementation Guidance

1. Create packages/application/src/services/audit-query.service.ts
2. getEntityTimeline(entityType, entityId, pagination): all events for an entity, ordered by time
3. searchAuditEvents(filters, pagination): flexible search with multiple filter criteria
4. Filters: entityType, entityId, eventType, actorType, actorId, startTime, endTime
5. Use SQL indexes for performance (entity_type+entity_id, created_at)

## Acceptance Criteria

- [ ] Entity timeline returns all events in order
- [ ] Filters work correctly in combination
- [ ] Pagination works for large result sets
- [ ] Performance acceptable for typical query patterns

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Seed audit events and test various query patterns

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep audit-query
```

## Risks / Notes

Large audit tables may slow queries. Ensure indexes are used.

## Follow-on Tasks

T085, T100
