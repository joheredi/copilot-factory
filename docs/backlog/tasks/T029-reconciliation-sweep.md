# T029: Implement reconciliation sweep job

| Field                     | Value                                                                 |
| ------------------------- | --------------------------------------------------------------------- |
| **ID**                    | T029                                                                  |
| **Epic**                  | [E005: Job Queue & Scheduling](../epics/E005-job-queue-scheduling.md) |
| **Type**                  | feature                                                               |
| **Status**                | done                                                                  |
| **Priority**              | P1                                                                    |
| **Owner**                 | backend-engineer                                                      |
| **AI Executable**         | Yes                                                                   |
| **Human Review Required** | Yes                                                                   |
| **Dependencies**          | [T025](./T025-job-queue-core.md), [T027](./T027-scheduler-service.md) |
| **Blocks**                | None                                                                  |

---

## Description

Create the reconciliation sweep as a recurring background job that detects and fixes inconsistent state: stale leases, orphaned jobs, tasks stuck in transitional states, and dependency recalculation.

## Goal

Ensure the system self-heals from transient failures and missed events.

## Scope

### In Scope

- Stale lease detection and reclaim
- Orphaned job detection
- Tasks stuck in ASSIGNED without heartbeat
- Dependency readiness recalculation
- Configurable sweep interval (default: 60s)

### Out of Scope

- Workspace cleanup (T042)
- Branch cleanup

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`
- `docs/prd/002-data-model.md`

## Implementation Guidance

1. Create a reconciliation_sweep job type that runs periodically
2. Check for leases past expires_at with status not terminal
3. Check for jobs in claimed/running state past a timeout threshold
4. Recalculate readiness for all BLOCKED tasks
5. Log all reconciliation actions for debugging

## Acceptance Criteria

- [x] Stale leases are detected and reclaimed
- [x] Stuck tasks are recovered
- [x] Reconciliation is idempotent
- [x] Actions are logged

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Create intentionally stale leases and verify reconciliation

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep reconcil
```

## Risks / Notes

Reconciliation must not interfere with in-progress work. Check carefully.

## Follow-on Tasks

None
