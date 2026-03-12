# T134: Wire WorkerDispatch unit-of-work adapter in control-plane

| Field                     | Value                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **ID**                    | T134                                                                                                                                       |
| **Epic**                  | [E009: Worker Runtime & Execution](../epics/E009-worker-runtime.md)                                                                        |
| **Type**                  | infrastructure                                                                                                                             |
| **Status**                | pending                                                                                                                                    |
| **Priority**              | P0                                                                                                                                         |
| **Owner**                 | backend-engineer                                                                                                                           |
| **AI Executable**         | Yes                                                                                                                                        |
| **Human Review Required** | Yes                                                                                                                                        |
| **Dependencies**          | [T132](./T132-worker-dispatch-service.md)                                                                                                  |
| **Blocks**                | [T135](./T135-heartbeat-forwarder-adapter.md), [T136](./T136-infrastructure-adapter-wiring.md), [T137](./T137-wire-dispatch-automation.md) |

---

## Description

Add a `createWorkerDispatchUnitOfWork()` factory to the control-plane's application-adapters module. This bridges the infrastructure database repositories to the `WorkerDispatchUnitOfWork` port defined in T132, following the exact pattern of existing adapters (createSchedulerUnitOfWork, createReadinessUnitOfWork, etc.).

## Goal

Provide the database access layer for the WorkerDispatchService to read job payloads and task/project context.

## Scope

### In Scope

- `createWorkerDispatchUnitOfWork(conn: DatabaseConnection)` factory function
- Bridge to task, project, and repository infrastructure repos as needed
- Read-only access for building `SpawnWorkerParams` (repoPath, runContext, etc.)

### Out of Scope

- Write operations (handled by JobQueueService and WorkerSupervisorService)
- The dispatch service itself (T132)
- NestJS module wiring (T137)

## Context Files

The implementing agent should read these files before starting:

- `apps/control-plane/src/automation/application-adapters.ts` — existing adapter patterns
- `packages/application/src/services/worker-dispatch.service.ts` — the UoW port definition
- `apps/control-plane/src/infrastructure/repositories/` — available repositories

## Implementation Guidance

1. Open `apps/control-plane/src/automation/application-adapters.ts`
2. Add `createWorkerDispatchUnitOfWork()` following the pattern of `createSchedulerUnitOfWork()`
3. Map the infrastructure repos to the `WorkerDispatchUnitOfWork` port's repository interfaces
4. The adapter needs to provide enough context for building `SpawnWorkerParams`:
   - Task info (taskId, type, priority)
   - Project/repository info (repoPath for worktree creation)
   - Any run context data (task packet, policy snapshot)
5. Export the factory from the module

## Acceptance Criteria

- [ ] `createWorkerDispatchUnitOfWork()` factory implemented
- [ ] Follows existing adapter pattern (transaction boundary, repo mapping)
- [ ] Provides read access to task and project/repository context
- [ ] Exported and usable by AutomationService

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

### Suggested Validation Commands

```bash
pnpm build --filter @factory/control-plane
```

## Risks / Notes

The exact shape of `WorkerDispatchUnitOfWork` depends on what context `SpawnWorkerParams` needs. This task may need to iterate with T132 to finalize the port interface.

## Follow-on Tasks

T135, T136, T137
