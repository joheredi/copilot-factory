# T016: Implement supporting state machines

| Field | Value |
|---|---|
| **ID** | T016 |
| **Epic** | [E003: State Machine & Transition Engine](../epics/E003-state-machine-transition.md) |
| **Type** | foundation |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T007](./T007-domain-enums-types.md) |
| **Blocks** | [T017](./T017-transition-service.md) |

---

## Description

Implement state machines for Worker Lease (§2.2), Review Cycle (§2.2), and Merge Queue Item (§2.2) with transition validation.

## Goal

Provide validated state management for all supporting lifecycle entities.

## Scope

### In Scope

- Worker Lease states: IDLE through RECLAIMED
- Review Cycle states: NOT_STARTED through ESCALATED
- Merge Queue Item states: ENQUEUED through FAILED
- Transition validation for each

### Out of Scope

- Integration with main Task state machine
- Persistence layer

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`

## Implementation Guidance

1. Create separate state machine modules in packages/domain/src/state-machines/
2. worker-lease-state-machine.ts, review-cycle-state-machine.ts, merge-queue-item-state-machine.ts
3. Follow the same pattern as the Task state machine: transition map + guard functions
4. Unit test every valid and invalid transition

## Acceptance Criteria

- [ ] All three state machines implemented with correct transitions
- [ ] Invalid transitions rejected
- [ ] Unit tests pass

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

pnpm test --filter @factory/domain

### Suggested Validation Commands

```bash
pnpm test --filter @factory/domain
```

## Risks / Notes

Supporting state machines are simpler but must stay consistent with the main task state machine.

## Follow-on Tasks

T017
