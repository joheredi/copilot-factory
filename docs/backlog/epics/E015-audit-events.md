# E015: Audit & Event System

## Summary

Implement audit event recording on every state transition, audit query service, and structured logging with correlation.

## Why This Epic Exists

Complete audit trail is a product requirement. Operators must be able to reconstruct what happened for any task.

## Goals

- Audit event on every state transition
- Query by entity, time, actor
- Structured logging with task/run/worker correlation

## Scope

### In Scope

- AuditEvent entity from docs/prd/002-data-model.md
- Structured log fields from docs/prd/007-technical-architecture.md §7.14

### Out of Scope

- Search indexing (future)
- Log aggregation service

## Dependencies

**Depends on:** E002, E003

**Enables:** E016, E017

## Risks / Notes

Audit events must be written atomically with state transitions. Logging must not impact performance.

## Tasks

| ID | Title | Priority | Status |
|---|---|---|---|
| [T073](../tasks/T073-audit-event-recording.md) | Implement audit event recording on state transitions | P0 | pending |
| [T074](../tasks/T074-audit-query-service.md) | Implement audit event query service | P1 | pending |
| [T075](../tasks/T075-structured-logging.md) | Implement structured logging with correlation IDs | P1 | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

Every state transition produces an audit event. Events queryable by entity and time range. Logs are structured and correlated.
