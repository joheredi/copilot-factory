# T132: Implement WorkerDispatchService in application layer

| Field                     | Value                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T132                                                                                                                        |
| **Epic**                  | [E009: Worker Runtime & Execution](../epics/E009-worker-runtime.md)                                                         |
| **Type**                  | feature                                                                                                                     |
| **Status**                | done                                                                                                                        |
| **Priority**              | P0                                                                                                                          |
| **Owner**                 | backend-engineer                                                                                                            |
| **AI Executable**         | Yes                                                                                                                         |
| **Human Review Required** | Yes                                                                                                                         |
| **Dependencies**          | [T044](./T044-worker-supervisor.md)                                                                                         |
| **Blocks**                | [T133](./T133-worker-dispatch-tests.md), [T134](./T134-worker-dispatch-adapter.md), [T139](./T139-worker-runner-exports.md) |

---

## Description

Create the `WorkerDispatchService` in `packages/application` that processes `WORKER_DISPATCH` jobs from the job queue. Currently the scheduler creates these jobs when assigning tasks to pools, but **no service consumes them**, causing all tasks to get stuck in `ASSIGNED` state indefinitely.

This service follows the same pattern as `SchedulerTickService` and `ReconciliationSweepService`: claim a job → do work → complete/fail the job.

The key difference is that WORKER_DISPATCH jobs are **not self-rescheduling** — each job is created by the scheduler for a specific task assignment. The dispatch service simply consumes them.

## Goal

Enable the task lifecycle to progress past `ASSIGNED` by processing `WORKER_DISPATCH` jobs and spawning worker processes via the `WorkerSupervisorService`.

## Scope

### In Scope

- `WorkerDispatchUnitOfWork` port interface (job payload reading, task context)
- `WorkerDispatchDependencies` interface (unitOfWork, jobQueueService, workerSupervisorService, clock)
- `WorkerDispatchConfig` interface (leaseOwner, optional concurrency settings)
- `createWorkerDispatchService()` factory function
- `processDispatch()` method: claims one WORKER_DISPATCH job, extracts payload (taskId, leaseId, poolId, workerId), calls `workerSupervisorService.spawnWorker()`, completes or fails the job
- Result types: `ProcessDispatchResult` (processed/not-processed with details)
- Export all types and factory from `packages/application/src/index.ts`

### Out of Scope

- NestJS wiring (T137)
- Infrastructure adapter implementations (T134, T135, T136)
- Integration tests (T138)
- Self-rescheduling (not needed — scheduler creates dispatch jobs on demand)

## Context Files

The implementing agent should read these files before starting:

- `packages/application/src/services/scheduler-tick.service.ts` — template pattern for job processing
- `packages/application/src/services/worker-supervisor.service.ts` — the service this dispatches to
- `packages/application/src/services/job-queue.service.ts` — job claim/complete/fail API
- `packages/application/src/ports/worker-supervisor.ports.ts` — port interfaces for supervisor deps
- `packages/application/src/services/scheduler.service.ts` — where WORKER_DISPATCH jobs are created (see payload shape)

## Implementation Guidance

1. Create `packages/application/src/services/worker-dispatch.service.ts`
2. Define `WorkerDispatchUnitOfWork` port — needs a read-only transaction that can look up task and repository info for building `SpawnWorkerParams`
3. Define `ProcessDispatchResult` as a discriminated union (like `ProcessTickResult`):
   - `{ processed: false, reason: "no_dispatch_job" }`
   - `{ processed: true, dispatchJobId, taskId, workerId, outcome: "success" | "failed" }`
4. Implement `processDispatch()`:

   ```typescript
   // 1. Claim a WORKER_DISPATCH job
   const claimed = jobQueueService.claimJob(JobType.WORKER_DISPATCH, leaseOwner);
   if (!claimed) return { processed: false, reason: "no_dispatch_job" };

   // 2. Parse job payload (taskId, leaseId, poolId, workerId)
   const payload = claimed.job.payloadJson;

   // 3. Build SpawnWorkerParams from payload + task/repo context
   // 4. Call workerSupervisorService.spawnWorker(params)
   // 5. On success: jobQueueService.completeJob(jobId)
   // 6. On failure: jobQueueService.failJob(jobId, error)
   ```

5. Note: `spawnWorker()` is async — the service's `processDispatch()` must also be async
6. Export from `packages/application/src/index.ts`

## Acceptance Criteria

- [ ] `WorkerDispatchService` interface defined with `processDispatch()` method
- [ ] `createWorkerDispatchService()` factory function implemented
- [ ] Claims `WORKER_DISPATCH` jobs via `JobQueueService.claimJob()`
- [ ] Extracts payload and builds `SpawnWorkerParams` correctly
- [ ] Calls `WorkerSupervisorService.spawnWorker()` with correct params
- [ ] Completes the job on successful spawn
- [ ] Fails the job with error details on spawn failure
- [ ] Returns discriminated union result type
- [ ] All types and factory exported from package index

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Build the package and verify exports are available.

### Suggested Validation Commands

```bash
pnpm build --filter @factory/application
```

## Risks / Notes

- The dispatch service is async (unlike sync tick/sweep services) because `spawnWorker()` returns a Promise. The caller (AutomationService) must handle this appropriately (fire-and-forget with error logging).
- Job payload shape comes from the scheduler service (line ~351 of scheduler.service.ts): `{ taskId, leaseId, poolId, workerId, priority, requiredCapabilities }`.
- The `SpawnWorkerParams` requires additional context (repoPath, runContext, workerName) that may need to be looked up from the task/project entities via the UnitOfWork.

## Follow-on Tasks

T133, T134, T139
