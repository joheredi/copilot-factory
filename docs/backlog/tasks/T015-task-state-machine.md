# T015: Implement Task state machine with transition validation

| Field | Value |
|---|---|
| **ID** | T015 |
| **Epic** | [E003: State Machine & Transition Engine](../epics/E003-state-machine-transition.md) |
| **Type** | foundation |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T007](./T007-domain-enums-types.md), [T014](./T014-entity-repositories.md) |
| **Blocks** | [T017](./T017-transition-service.md), [T018](./T018-atomic-transition-audit.md) |

---

## Description

Implement the Task state machine as a pure domain module. Define all valid transitions, preconditions for each transition, and transition validation logic. This is the core correctness mechanism of the system.

## Goal

Ensure only valid state transitions can occur, matching the spec in docs/prd/002-data-model.md §2.1 exactly.

## Scope

### In Scope

- All 16 task states
- All transition rules from §2.1
- Transition precondition checks
- Validation that current state allows target state
- Guard clause functions per transition

### Out of Scope

- Persistence (T018)
- Audit events (T073)
- Scheduling triggers

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`
- `docs/prd/010-integration-contracts.md`

## Implementation Guidance

1. Create packages/domain/src/state-machines/task-state-machine.ts
2. Define a transition map: Map<TaskState, Set<TaskState>>
3. Each transition has a guard function that checks preconditions
4. Export validateTransition(current, target, context) -> {valid, reason}
5. Write exhaustive unit tests for every valid transition
6. Write tests for every invalid transition (should reject)
7. Include the module-ownership context from docs/prd/010-integration-contracts.md §10.2

## Acceptance Criteria

- [ ] All valid transitions from §2.1 are allowed
- [ ] All invalid transitions are rejected with descriptive reasons
- [ ] Guard functions check preconditions (e.g., READY->ASSIGNED requires lease)
- [ ] 100% test coverage on transition validation

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run domain package tests

### Suggested Validation Commands

```bash
pnpm test --filter @factory/domain
```

## Risks / Notes

Transition rules are complex. Must exactly match the spec.

## Follow-on Tasks

T017, T018
