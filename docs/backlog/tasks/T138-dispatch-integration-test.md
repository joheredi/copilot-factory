# T138: End-to-end dispatch integration test

| Field                     | Value                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------- |
| **ID**                    | T138                                                                                |
| **Epic**                  | [E009: Worker Runtime & Execution](../epics/E009-worker-runtime.md)                 |
| **Type**                  | feature                                                                             |
| **Status**                | done                                                                                |
| **Priority**              | P0                                                                                  |
| **Owner**                 | backend-engineer                                                                    |
| **AI Executable**         | Yes                                                                                 |
| **Human Review Required** | Yes                                                                                 |
| **Dependencies**          | [T133](./T133-worker-dispatch-tests.md), [T137](./T137-wire-dispatch-automation.md) |
| **Blocks**                | None                                                                                |

---

## Description

Write an end-to-end integration test that verifies the complete task lifecycle from `READY` through worker dispatch to `DEV_COMPLETE`. This test exercises the full automation cycle: readiness reconciliation → scheduler assignment → WORKER_DISPATCH job creation → dispatch processing → worker spawn → heartbeats → completion.

## Goal

Prove that the entire scheduling-to-execution pipeline works end-to-end with no gaps.

## Scope

### In Scope

- Integration test in `apps/control-plane/src/automation/automation.service.test.ts` (or new file)
- Set up: project, repository, worker pool, task in READY state
- Run automation cycles until task reaches DEV_COMPLETE (or IN_DEVELOPMENT at minimum)
- Use `FakeRunnerAdapter` from `@factory/testing` for deterministic worker behavior
- Verify state transitions: READY → ASSIGNED → IN_DEVELOPMENT → DEV_COMPLETE
- Verify WORKER_DISPATCH job lifecycle: PENDING → CLAIMED → COMPLETED
- Verify lease state: LEASED → STARTING → RUNNING → HEARTBEATING → COMPLETING

### Out of Scope

- Real Copilot CLI execution
- Review pipeline (post DEV_COMPLETE)
- Performance testing

## Context Files

The implementing agent should read these files before starting:

- `apps/control-plane/src/automation/automation.service.test.ts` — existing automation tests
- `packages/testing/src/` — available test fakes (FakeRunnerAdapter, FakeWorkspaceManager, entity factories)
- `packages/application/src/services/worker-supervisor.service.test.ts` — supervisor test patterns

## Implementation Guidance

1. Extend or create integration test that:
   ```typescript
   it("drives task from READY through worker dispatch to DEV_COMPLETE", async () => {
     // Setup: create project, repo, pool (maxConcurrency: 1), task in BACKLOG
     // Cycle 1: readiness → task becomes READY
     // Cycle 2: scheduler tick → task becomes ASSIGNED, WORKER_DISPATCH job created
     // Cycle 3+: dispatch processes job → worker spawns → heartbeats → completion
     // Assert: task status is DEV_COMPLETE (or IN_DEVELOPMENT)
     // Assert: WORKER_DISPATCH job is COMPLETED
     // Assert: lease progressed through expected states
   });
   ```
2. Use `FakeRunnerAdapter` configured with `outcomesByRun` to return a successful result
3. Use `createTestDatabase({ migrationsFolder })` for in-memory DB
4. May need to run multiple automation cycles with `await` between them for async dispatch

## Acceptance Criteria

- [ ] Test verifies READY → ASSIGNED transition via scheduler
- [ ] Test verifies WORKER_DISPATCH job creation and consumption
- [ ] Test verifies worker process spawned via supervisor
- [ ] Test verifies task reaches IN_DEVELOPMENT or DEV_COMPLETE
- [ ] Test verifies WORKER_DISPATCH job reaches COMPLETED status
- [ ] Test uses FakeRunnerAdapter (no real CLI execution)
- [ ] Test passes consistently (no timing-dependent flakiness)

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

### Suggested Validation Commands

```bash
cd apps/control-plane && pnpm test -- --grep "dispatch"
```

```bash
pnpm test
```

## Risks / Notes

- Async dispatch with fire-and-forget means the test may need to poll or wait for worker completion. Use `await sleep()` from `@factory/testing` or event-based synchronization.
- The `FakeRunnerAdapter` must emit heartbeat events in its `streamRun()` to trigger lease state progression.
- Ensure the test cleans up properly (no leaked timers from AutomationService polling).

## Follow-on Tasks

None — this validates the complete pipeline.
