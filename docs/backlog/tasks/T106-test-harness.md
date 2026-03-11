# T106: Create test harness with fake runner and workspace

| Field                     | Value                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T106                                                                                                                                                                                    |
| **Epic**                  | [E022: Integration Testing & E2E](../epics/E022-integration-testing.md)                                                                                                                 |
| **Type**                  | test                                                                                                                                                                                    |
| **Status**                | done                                                                                                                                                                                    |
| **Priority**              | P0                                                                                                                                                                                      |
| **Owner**                 | backend-engineer                                                                                                                                                                        |
| **AI Executable**         | Yes                                                                                                                                                                                     |
| **Human Review Required** | Yes                                                                                                                                                                                     |
| **Dependencies**          | [T044](./T044-worker-supervisor.md), [T039](./T039-worktree-creation.md)                                                                                                                |
| **Blocks**                | [T107](./T107-e2e-full-lifecycle.md), [T108](./T108-e2e-review-rework.md), [T109](./T109-e2e-merge-failures.md), [T110](./T110-e2e-lease-recovery.md), [T111](./T111-e2e-escalation.md) |

---

## Description

Build the integration test harness with fake runner adapter, fake workspace manager, fake clock, and test database setup/teardown.

## Goal

Enable reliable, deterministic integration testing of the full system.

## Scope

### In Scope

- FakeRunnerAdapter implementing WorkerRuntime (returns configurable results)
- FakeWorkspaceManager (in-memory workspace state)
- FakeClock for time manipulation
- Test database setup (in-memory SQLite with migrations)
- Test fixture factories for all entities
- Test helper: runTaskToState(targetState) for common test setup

### Out of Scope

- UI tests
- Performance test harness

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Create packages/testing/src/ with all test doubles
2. FakeRunnerAdapter: configurable to return success, failure, partial, timeout
3. FakeWorkspaceManager: tracks created/cleaned workspaces in memory
4. FakeClock: wraps Date.now() with advanceable time
5. Test DB: create fresh SQLite in-memory per test, run all migrations
6. Entity factories: createTestProject(), createTestTask(), etc. with sensible defaults
7. runTaskToState: drives a task through the lifecycle to the desired state

## Acceptance Criteria

- [ ] All test doubles work correctly
- [ ] Test DB setup/teardown is fast
- [ ] Entity factories produce valid data
- [ ] runTaskToState helper works for all reachable states

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Use test harness in a sample integration test

### Suggested Validation Commands

```bash
pnpm test --filter @factory/testing
```

## Risks / Notes

Test doubles must accurately simulate real behavior. Validate against specs.

## Follow-on Tasks

T107, T108, T109, T110, T111
