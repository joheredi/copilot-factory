# T133: Unit tests for WorkerDispatchService

| Field                     | Value                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| **ID**                    | T133                                                                |
| **Epic**                  | [E009: Worker Runtime & Execution](../epics/E009-worker-runtime.md) |
| **Type**                  | feature                                                             |
| **Status**                | pending                                                             |
| **Priority**              | P0                                                                  |
| **Owner**                 | backend-engineer                                                    |
| **AI Executable**         | Yes                                                                 |
| **Human Review Required** | Yes                                                                 |
| **Dependencies**          | [T132](./T132-worker-dispatch-service.md)                           |
| **Blocks**                | [T138](./T138-dispatch-integration-test.md)                         |

---

## Description

Write comprehensive unit tests for the `WorkerDispatchService` created in T132. Tests should cover the full range of dispatch outcomes: no jobs available, successful spawn, failed spawn, payload extraction, and concurrent claim safety.

## Goal

Ensure the dispatch service correctly processes WORKER_DISPATCH jobs and handles all edge cases.

## Scope

### In Scope

- Test: no pending dispatch jobs → returns `{ processed: false, reason: "no_dispatch_job" }`
- Test: claims job → spawns worker successfully → completes job → returns success result
- Test: claims job → worker spawn throws → fails job with error message → returns failure result
- Test: job payload contains correct taskId, leaseId, poolId, workerId from scheduler
- Test: concurrent dispatch calls don't double-claim same job (claimJob atomicity)
- Test: SpawnWorkerParams correctly assembled from job payload and task context

### Out of Scope

- Integration tests with real database (T138)
- Testing infrastructure adapters (T136)

## Context Files

The implementing agent should read these files before starting:

- `packages/application/src/services/scheduler-tick.service.test.ts` — template for job-processing service tests
- `packages/application/src/services/worker-supervisor.service.test.ts` — patterns for supervisor mocking
- `packages/application/src/services/worker-dispatch.service.ts` — the service under test

## Implementation Guidance

1. Create `packages/application/src/services/worker-dispatch.service.test.ts`
2. Use the same test structure as `scheduler-tick.service.test.ts`:
   - Create mock/fake dependencies (jobQueueService, workerSupervisorService, unitOfWork)
   - Instantiate service via `createWorkerDispatchService()`
   - Test each outcome path
3. Use `FakeRunnerAdapter` from `@factory/testing` if needed for supervisor dependency mocking
4. Test the async nature: verify `processDispatch()` returns a Promise that resolves correctly

## Acceptance Criteria

- [ ] All happy-path and error-path scenarios tested
- [ ] Job claim → spawn → complete lifecycle verified
- [ ] Job claim → spawn failure → fail job lifecycle verified
- [ ] No-op when no jobs available verified
- [ ] Payload extraction tested with realistic scheduler output
- [ ] All tests pass

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep "worker-dispatch"
```

## Risks / Notes

Since `spawnWorker()` is async, tests need to handle Promise resolution. Use `async/await` in test bodies.

## Follow-on Tasks

T138
