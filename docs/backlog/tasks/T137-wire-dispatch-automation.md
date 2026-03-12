# T137: Integrate WorkerDispatchService into AutomationService

| Field                     | Value                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T137                                                                                                                                      |
| **Epic**                  | [E009: Worker Runtime & Execution](../epics/E009-worker-runtime.md)                                                                       |
| **Type**                  | feature                                                                                                                                   |
| **Status**                | pending                                                                                                                                   |
| **Priority**              | P0                                                                                                                                        |
| **Owner**                 | backend-engineer                                                                                                                          |
| **AI Executable**         | Yes                                                                                                                                       |
| **Human Review Required** | Yes                                                                                                                                       |
| **Dependencies**          | [T134](./T134-worker-dispatch-adapter.md), [T135](./T135-heartbeat-forwarder-adapter.md), [T136](./T136-infrastructure-adapter-wiring.md) |
| **Blocks**                | [T138](./T138-dispatch-integration-test.md)                                                                                               |

---

## Description

Wire the `WorkerDispatchService` into the `AutomationService` so that each automation cycle attempts to process pending `WORKER_DISPATCH` jobs. This is the final integration step that closes the gap between task scheduling and worker execution.

The key design challenge is that `spawnWorker()` is async and long-running, while the automation cycle is currently synchronous. The dispatch must be fire-and-forget: start the worker process without blocking the readiness reconciliation and scheduler tick processing.

## Goal

Complete the task lifecycle by connecting scheduling (READY → ASSIGNED) to execution (ASSIGNED → IN_DEVELOPMENT → DEV_COMPLETE).

## Scope

### In Scope

- Instantiate `WorkerDispatchService` in `AutomationService` constructor
- Instantiate `WorkerSupervisorService` with all infrastructure dependencies
- Add `processWorkerDispatches()` step to `runCycle()`
- Fire-and-forget async dispatch (don't block the sync cycle)
- Track active dispatches to prevent exceeding concurrency limits
- Error logging for failed dispatches
- Update logging to include dispatch activity

### Out of Scope

- Modifying the dispatch service itself (T132)
- Infrastructure adapters (T135, T136)
- Integration tests (T138)

## Context Files

The implementing agent should read these files before starting:

- `apps/control-plane/src/automation/automation.service.ts` — the automation cycle to modify
- `apps/control-plane/src/automation/automation.module.ts` — NestJS module registration
- `packages/application/src/services/worker-dispatch.service.ts` — the dispatch service to wire
- `packages/application/src/services/worker-supervisor.service.ts` — supervisor dependencies

## Implementation Guidance

1. In `AutomationService` constructor:
   - Create HeartbeatService, HeartbeatForwarderAdapter
   - Create infrastructure adapters (WorkspaceManager, PacketMounter, RuntimeAdapter)
   - Create WorkerSupervisorService with all dependencies
   - Create WorkerDispatchService with supervisor + job queue + unit of work
2. Add dispatch to `runCycle()`:

   ```typescript
   private runCycle(): void {
     try {
       const readiness = this.reconcileTaskReadiness();
       const tickResult = this.processSchedulerTick();

       // Fire-and-forget: dispatch pending worker jobs
       this.processWorkerDispatches();

       // ... existing logging
     } catch (error) { ... }
   }

   private processWorkerDispatches(): void {
     // Claim and dispatch in a non-blocking manner
     // Use Promise tracking to respect concurrency limits
     this.dispatchService.processDispatch()
       .then(result => {
         if (result.processed) {
           this.logger.info("Worker dispatched", { taskId: result.taskId });
         }
       })
       .catch(error => {
         this.logger.error("Worker dispatch failed", { error: error.message });
       });
   }
   ```

3. Consider processing multiple dispatch jobs per cycle (loop until no more jobs or concurrency limit reached)
4. Track active `Promise` instances to avoid unbounded concurrency

## Acceptance Criteria

- [ ] WorkerDispatchService instantiated with all dependencies in constructor
- [ ] `runCycle()` calls dispatch processing alongside readiness and scheduler tick
- [ ] Dispatch is non-blocking (doesn't delay readiness/scheduling)
- [ ] Active dispatch count tracked and logged
- [ ] Failed dispatches logged with error details
- [ ] Successful dispatches logged with taskId and workerId
- [ ] AutomationModule still compiles and starts

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Start the control-plane dev server and verify automation cycle logs include dispatch processing.

### Suggested Validation Commands

```bash
cd apps/control-plane && pnpm build
```

```bash
cd apps/control-plane && pnpm test -- --grep "automation"
```

## Risks / Notes

- **Async fire-and-forget**: Unhandled promise rejections must be caught. Every `.then()` chain must have a `.catch()`.
- **Concurrency**: Without limits, the automation could spawn dozens of workers simultaneously. Use pool `maxConcurrency` as the bound.
- **Memory**: Long-running worker promises are held in memory. Track and clean up completed promises each cycle.
- **NestJS DI**: The AutomationService constructor already injects `DATABASE_CONNECTION` and `DomainEventBroadcasterAdapter`. Additional infrastructure deps may need to be added to the module's providers or imported from other modules.

## Follow-on Tasks

T138
