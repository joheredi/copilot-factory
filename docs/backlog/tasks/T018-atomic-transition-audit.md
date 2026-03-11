# T018: Implement atomic transition + audit persistence

| Field                     | Value                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------ |
| **ID**                    | T018                                                                                 |
| **Epic**                  | [E003: State Machine & Transition Engine](../epics/E003-state-machine-transition.md) |
| **Type**                  | foundation                                                                           |
| **Status**                | done                                                                                 |
| **Priority**              | P0                                                                                   |
| **Owner**                 | backend-engineer                                                                     |
| **AI Executable**         | Yes                                                                                  |
| **Human Review Required** | Yes                                                                                  |
| **Dependencies**          | [T017](./T017-transition-service.md)                                                 |
| **Blocks**                | [T073](./T073-audit-event-recording.md)                                              |

---

## Description

Ensure that state transitions and their corresponding audit events are persisted atomically in a single database transaction using BEGIN IMMEDIATE.

## Goal

Guarantee that no state change can occur without an audit record, and no audit record exists without a committed state change.

## Scope

### In Scope

- Transaction wrapper with BEGIN IMMEDIATE
- Rollback on audit event write failure
- Integration test proving atomicity
- Error handling for transaction conflicts

### Out of Scope

- Audit query service (T074)
- Metrics emission

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/010-integration-contracts.md`

## Implementation Guidance

1. Wrap TransitionService methods in SQLite BEGIN IMMEDIATE transactions
2. Within the transaction: 1) validate state, 2) update entity with version check, 3) insert audit event, 4) commit
3. If any step fails, roll back everything
4. Write an integration test that verifies: after a transition, both entity state and audit event exist; after a failed transition, neither exists
5. Test concurrent transitions to verify optimistic concurrency rejection

## Acceptance Criteria

- [ ] State change and audit event are in the same transaction
- [ ] Failed transitions leave no partial state
- [ ] Concurrent conflicting transitions are safely rejected

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Integration test with concurrent transition attempts

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep atomic
```

## Risks / Notes

SQLite concurrency is limited. BEGIN IMMEDIATE helps but must be tested.

## Follow-on Tasks

T073
