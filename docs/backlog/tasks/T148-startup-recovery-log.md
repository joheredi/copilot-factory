# T148: Log recovery status on startup

| Field                     | Value                                                                    |
| ------------------------- | ------------------------------------------------------------------------ |
| **ID**                    | T148                                                                     |
| **Epic**                  | [E027: Factory Lifecycle & Recovery](../epics/E027-factory-lifecycle.md) |
| **Type**                  | feature                                                                  |
| **Status**                | done                                                                     |
| **Priority**              | P1                                                                       |
| **Owner**                 | backend-engineer                                                         |
| **AI Executable**         | Yes                                                                      |
| **Human Review Required** | Yes                                                                      |
| **Dependencies**          | [T147](./T147-two-phase-shutdown.md)                                     |
| **Blocks**                | [T149](./T149-workspace-cleanup.md)                                      |

---

## Description

After the NestJS application starts and the reconciliation sweep initializes, log a diagnostic summary of pending recovery items. This gives operators immediate visibility into what the factory is cleaning up from a previous unclean shutdown.

## Goal

Provide clear startup feedback so operators know if the factory is recovering from interrupted work.

## Scope

### In Scope

- Query DB on startup for: stale leases (heartbeat > 75s ago), orphaned jobs (CLAIMED > 10min), stuck tasks (ASSIGNED without active lease > 5min)
- Log a summary line: "Startup recovery: 3 stale leases, 1 orphaned job, 0 stuck tasks — reconciliation will process within 60s"
- If all counts are zero: "Clean startup — no pending recovery items"
- Hook into NestJS lifecycle (`OnApplicationBootstrap` or similar) to run after all modules initialize

### Out of Scope

- New recovery mechanisms (existing reconciliation sweep handles everything)
- UI display of recovery status (future enhancement)

## Context Files

The implementing agent should read these files before starting:

- `packages/application/src/services/reconciliation-sweep.service.ts` — sweep logic and detection queries
- `packages/application/src/services/heartbeat.service.ts` — `detectStaleLeases()` query
- `apps/control-plane/src/infrastructure/database/schema.ts` — task_lease, job, task tables

## Implementation Guidance

1. Create `apps/control-plane/src/startup-diagnostics.service.ts` (or add to an existing startup service)
2. Inject `DATABASE_CONNECTION`
3. In `onApplicationBootstrap()`:
   ```typescript
   const staleLeases = db
     .prepare(
       "SELECT COUNT(*) as count FROM task_lease WHERE status IN ('RUNNING', 'HEARTBEATING') AND heartbeat_at < ?",
     )
     .get(cutoff);
   const orphanedJobs = db
     .prepare(
       "SELECT COUNT(*) as count FROM job WHERE status IN ('claimed', 'running') AND created_at < ?",
     )
     .get(jobCutoff);
   const stuckTasks = db
     .prepare("SELECT COUNT(*) as count FROM task WHERE status = 'ASSIGNED' AND updated_at < ?")
     .get(taskCutoff);
   ```
4. Log using the structured logger from `@factory/observability`
5. Register in AppModule
6. Add `@Inject(DATABASE_CONNECTION)` (tsx compatibility)

## Acceptance Criteria

- [ ] On startup after unclean shutdown, logs recovery item counts
- [ ] On clean startup, logs "no pending recovery items"
- [ ] Does not interfere with the reconciliation sweep's actual recovery
- [ ] Uses structured logging

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

### Suggested Validation Commands

```bash
cd apps/control-plane && pnpm test -- --grep startup-diagnostics
```

## Risks / Notes

Read-only diagnostic — no state changes. The reconciliation sweep handles all actual recovery.

## Follow-on Tasks

T149
