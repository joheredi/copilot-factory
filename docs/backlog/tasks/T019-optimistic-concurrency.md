# T019: Implement optimistic concurrency control

| Field | Value |
|---|---|
| **ID** | T019 |
| **Epic** | [E003: State Machine & Transition Engine](../epics/E003-state-machine-transition.md) |
| **Type** | foundation |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T017](./T017-transition-service.md) |
| **Blocks** | None |

---

## Description

Implement and thoroughly test the optimistic concurrency control mechanism on Task entities. Every state transition must check Task.version matches expected value and increment it atomically.

## Goal

Prevent race conditions where two actors attempt to transition the same task simultaneously.

## Scope

### In Scope

- Version check in UPDATE WHERE clause
- Version increment on success
- Conflict detection and rejection
- Conflict resolution priority rules from §10.2.3

### Out of Scope

- Pessimistic locking
- Distributed locking

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/010-integration-contracts.md`

## Implementation Guidance

1. In the Task repository update method: UPDATE tasks SET ... version = version + 1 WHERE task_id = ? AND version = ?
2. Check affected rows count — if 0, the version was stale, reject the transition
3. Return a clear error type (VersionConflictError) for callers to handle
4. Implement conflict priority: operator actions > lease expiry > worker results (except grace period)
5. Write tests with simulated concurrent updates to verify conflict detection

## Acceptance Criteria

- [ ] Concurrent transitions to the same task are safely handled
- [ ] Only one transition succeeds when two race
- [ ] Conflict produces a clear, typed error
- [ ] Priority rules are enforced per §10.2.3

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Concurrent update tests

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep concurrency
```

## Risks / Notes

Testing concurrency in SQLite requires careful setup. Use real file-based DB for these tests.

## Follow-on Tasks

None
