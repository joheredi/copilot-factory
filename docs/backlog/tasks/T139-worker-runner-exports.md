# T139: Update worker-runner package to re-export dispatch types

| Field                     | Value                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| **ID**                    | T139                                                                |
| **Epic**                  | [E009: Worker Runtime & Execution](../epics/E009-worker-runtime.md) |
| **Type**                  | refactor                                                            |
| **Status**                | done                                                                |
| **Priority**              | P1                                                                  |
| **Owner**                 | backend-engineer                                                    |
| **AI Executable**         | Yes                                                                 |
| **Human Review Required** | Yes                                                                 |
| **Dependencies**          | [T132](./T132-worker-dispatch-service.md)                           |
| **Blocks**                | None                                                                |

---

## Description

Update `apps/worker-runner/src/index.ts` (currently `export {};`) to re-export the dispatch service types from `@factory/application`. This gives the `@factory/worker-runner` package a meaningful public API surface as the entry point for worker dispatch functionality, even though V1 execution happens in-process within the control-plane.

## Goal

Give the worker-runner package a purpose as the public API surface for worker dispatch, preparing for future extraction into a standalone process.

## Scope

### In Scope

- Add `@factory/application` as a dependency of `@factory/worker-runner`
- Re-export `WorkerDispatchService`, `createWorkerDispatchService`, and related types
- Re-export `WorkerSupervisorService`, `createWorkerSupervisorService`, and related types
- Update tsconfig references if needed

### Out of Scope

- Standalone process implementation (future work)
- Moving implementation code into worker-runner

## Context Files

The implementing agent should read these files before starting:

- `apps/worker-runner/src/index.ts` — current empty export
- `apps/worker-runner/package.json` — package configuration
- `packages/application/src/index.ts` — available exports

## Implementation Guidance

1. Add `@factory/application` to worker-runner's `package.json` dependencies
2. Update `apps/worker-runner/src/index.ts`:

   ```typescript
   /** @module @factory/worker-runner — Worker process supervisor for spawning and managing ephemeral worker processes. */

   export {
     createWorkerDispatchService,
     type WorkerDispatchService,
     type WorkerDispatchDependencies,
     type WorkerDispatchConfig,
     type ProcessDispatchResult,
   } from "@factory/application";

   export {
     createWorkerSupervisorService,
     type WorkerSupervisorService,
     type WorkerSupervisorDependencies,
     type SpawnWorkerParams,
     type SpawnWorkerResult,
   } from "@factory/application";
   ```

3. Update tsconfig.json references if needed for the new dependency
4. Verify build succeeds

## Acceptance Criteria

- [ ] `@factory/worker-runner` re-exports dispatch and supervisor types
- [ ] Package builds successfully
- [ ] Consumers can import from `@factory/worker-runner` instead of `@factory/application` directly

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

### Suggested Validation Commands

```bash
pnpm build --filter @factory/worker-runner
```

## Risks / Notes

Low-priority task. The re-exports are a convenience — all functionality is available directly from `@factory/application`. This is primarily about giving the worker-runner package a meaningful role in the monorepo.

## Follow-on Tasks

None
