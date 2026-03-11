# T028: Implement scheduler tick loop

| Field                     | Value                                                                 |
| ------------------------- | --------------------------------------------------------------------- |
| **ID**                    | T028                                                                  |
| **Epic**                  | [E005: Job Queue & Scheduling](../epics/E005-job-queue-scheduling.md) |
| **Type**                  | feature                                                               |
| **Status**                | pending                                                               |
| **Priority**              | P1                                                                    |
| **Owner**                 | backend-engineer                                                      |
| **AI Executable**         | Yes                                                                   |
| **Human Review Required** | Yes                                                                   |
| **Dependencies**          | [T027](./T027-scheduler-service.md), [T025](./T025-job-queue-core.md) |
| **Blocks**                | None                                                                  |

---

## Description

Create the scheduler tick as a recurring background job that periodically invokes the Scheduler service to process ready tasks.

## Goal

Make scheduling automatic rather than requiring manual triggers.

## Scope

### In Scope

- Scheduler tick job creation on application start
- Configurable tick interval (default: 5s)
- Tick handler calls scheduler.processReadyTasks()
- Self-rescheduling after completion

### Out of Scope

- External job broker
- Multi-instance scheduling coordination

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. On app startup, create a scheduler_tick job if one doesn't exist
2. Tick handler: claim job -> call scheduler.processReadyTasks() -> complete job -> create next tick job with run_after = now + interval
3. processReadyTasks: loop calling findNextAssignableTask + assignTask until no more tasks or pools available
4. Make interval configurable via config

## Acceptance Criteria

- [ ] Scheduler runs periodically without manual intervention
- [ ] Tick interval is configurable
- [ ] Scheduler stops trying when no tasks or pools are available

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Start app and observe scheduler processing tasks

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep tick
```

## Risks / Notes

Tick must be idempotent. Multiple ticks running concurrently must not cause issues.

## Follow-on Tasks

None
