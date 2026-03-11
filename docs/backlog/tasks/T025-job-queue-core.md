# T025: Implement DB-backed job queue

| Field                     | Value                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ID**                    | T025                                                                                                                                                   |
| **Epic**                  | [E005: Job Queue & Scheduling](../epics/E005-job-queue-scheduling.md)                                                                                  |
| **Type**                  | foundation                                                                                                                                             |
| **Status**                | done                                                                                                                                                   |
| **Priority**              | P0                                                                                                                                                     |
| **Owner**                 | backend-engineer                                                                                                                                       |
| **AI Executable**         | Yes                                                                                                                                                    |
| **Human Review Required** | Yes                                                                                                                                                    |
| **Dependencies**          | [T012](./T012-migration-merge-job.md), [T014](./T014-entity-repositories.md)                                                                           |
| **Blocks**                | [T026](./T026-job-dependencies.md), [T027](./T027-scheduler-service.md), [T028](./T028-scheduler-tick-loop.md), [T029](./T029-reconciliation-sweep.md) |

---

## Description

Implement the core DB-backed job queue with create, claim, complete, and fail operations using the Job table. Claims must be atomic and prevent duplicate processing.

## Goal

Provide a reliable job processing mechanism backed by SQLite.

## Scope

### In Scope

- createJob(type, entityType, entityId, payload, runAfter)
- claimJob(jobType, leaseOwner) — atomic claim
- completeJob(jobId)
- failJob(jobId, error)
- Job status lifecycle: pending->claimed->running->completed|failed
- run_after respect for delayed jobs
- attempt_count increment on claim

### Out of Scope

- Job dependencies (T026)
- Specific job type handlers

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`
- `docs/prd/002-data-model.md`

## Implementation Guidance

1. Create packages/application/src/services/job-queue.service.ts
2. claimJob: UPDATE jobs SET status='claimed', lease_owner=?, attempt_count=attempt_count+1 WHERE job_id = (SELECT job_id FROM jobs WHERE status='pending' AND run_after <= now() AND job_type=? ORDER BY created_at LIMIT 1)
3. Use BEGIN IMMEDIATE for claim to prevent races
4. If no job found, return null
5. completeJob: verify status=claimed or running, set status=completed
6. failJob: set status=failed, optionally requeue based on retry policy
7. Write concurrent claim tests to verify no double-processing

## Acceptance Criteria

- [ ] Jobs can be created and claimed atomically
- [ ] No two workers can claim the same job
- [ ] run_after is respected (future jobs not claimed early)
- [ ] Complete and fail transitions work correctly

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Concurrent claim tests with multiple simulated workers

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep job-queue
```

## Risks / Notes

SQLite concurrent writes are serialized. This is fine for V1 but limits throughput.

## Follow-on Tasks

T026, T027, T028, T029
