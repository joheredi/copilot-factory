# T017: Build centralized State Transition Service

| Field                     | Value                                                                                                                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T017                                                                                                                                                                                                                                                                   |
| **Epic**                  | [E003: State Machine & Transition Engine](../epics/E003-state-machine-transition.md)                                                                                                                                                                                   |
| **Type**                  | foundation                                                                                                                                                                                                                                                             |
| **Status**                | done                                                                                                                                                                                                                                                                   |
| **Priority**              | P0                                                                                                                                                                                                                                                                     |
| **Owner**                 | backend-engineer                                                                                                                                                                                                                                                       |
| **AI Executable**         | Yes                                                                                                                                                                                                                                                                    |
| **Human Review Required** | Yes                                                                                                                                                                                                                                                                    |
| **Dependencies**          | [T015](./T015-task-state-machine.md), [T016](./T016-supporting-state-machines.md), [T014](./T014-entity-repositories.md)                                                                                                                                               |
| **Blocks**                | [T018](./T018-atomic-transition-audit.md), [T019](./T019-optimistic-concurrency.md), [T027](./T027-scheduler-service.md), [T030](./T030-lease-acquisition.md), [T058](./T058-review-router.md), [T061](./T061-review-decision-apply.md), [T063](./T063-merge-queue.md) |

---

## Description

Create the centralized State Transition Service that is the single authority for committing state changes. All modules must call this service rather than updating state directly.

## Goal

Centralize state mutation to enforce invariants, emit events, and maintain audit trail atomically.

## Scope

### In Scope

- TransitionService with transitionTask(), transitionLease(), transitionReviewCycle(), transitionMergeQueueItem()
- Precondition validation via state machine modules
- Optimistic concurrency check
- Audit event emission within same transaction
- Event publication for downstream consumers

### Out of Scope

- Specific transition triggers (those belong in application services)
- API endpoints

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/010-integration-contracts.md`
- `docs/prd/002-data-model.md`

## Implementation Guidance

1. Create packages/application/src/services/transition.service.ts
2. Each transition method: validate state machine -> check version -> update entity -> create audit event -> all in one DB transaction
3. Return the updated entity and audit event
4. Emit a domain event after successful commit for async subscribers
5. Use the module ownership map from §10.2 to document which modules call which transitions

## Acceptance Criteria

- [ ] All state transitions go through this service
- [ ] Optimistic concurrency rejects stale updates
- [ ] Audit event created atomically with state change
- [ ] Domain events emitted after commit

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Integration tests with real SQLite database

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application
```

## Risks / Notes

Transaction boundaries must be correct. Events must not fire on rollback.

## Follow-on Tasks

T018, T019, T027, T030, T058, T061, T063
