# T027: Implement Scheduler service

| Field | Value |
|---|---|
| **ID** | T027 |
| **Epic** | [E005: Job Queue & Scheduling](../epics/E005-job-queue-scheduling.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T014](./T014-entity-repositories.md), [T017](./T017-transition-service.md), [T025](./T025-job-queue-core.md) |
| **Blocks** | [T028](./T028-scheduler-tick-loop.md) |

---

## Description

Build the Scheduler that selects the next ready task, matches it to a compatible worker pool, and triggers lease acquisition.

## Goal

Automate task-to-worker assignment based on readiness, priority, and pool compatibility.

## Scope

### In Scope

- Query ready tasks ordered by priority
- Pool compatibility matching (capabilities, repo scope, pool type)
- Task selection respecting dependency readiness
- Lease request via Lease Module
- Duplicate assignment prevention

### Out of Scope

- Pool management CRUD (T083)
- Worker process spawning (T044)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/001-architecture.md`
- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Create packages/application/src/services/scheduler.service.ts
2. findNextAssignableTask(): query tasks WHERE status=READY ORDER BY priority DESC, created_at ASC
3. matchPool(task): find enabled pools where pool_type matches task needs and capabilities satisfy required_capabilities
4. assignTask(task, pool): call transition service READY->ASSIGNED, create lease, create worker_dispatch job
5. Handle case where no pool matches (leave task in READY)
6. Handle case where pool is at max_concurrency (skip, try next task)

## Acceptance Criteria

- [ ] Scheduler selects highest-priority ready task
- [ ] Pool matching respects capabilities and concurrency limits
- [ ] Lease acquired atomically with state transition
- [ ] No duplicate assignments possible

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Integration test with multiple tasks and pools

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep scheduler
```

## Risks / Notes

Pool matching logic must be extensible. Start simple, evolve.

## Follow-on Tasks

T028
