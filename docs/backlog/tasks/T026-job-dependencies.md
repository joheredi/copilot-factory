# T026: Implement job dependency and group coordination

| Field | Value |
|---|---|
| **ID** | T026 |
| **Epic** | [E005: Job Queue & Scheduling](../epics/E005-job-queue-scheduling.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T025](./T025-job-queue-core.md) |
| **Blocks** | [T059](./T059-reviewer-dispatch.md), [T060](./T060-lead-reviewer-dispatch.md) |

---

## Description

Extend the job queue to support depends_on_job_ids and job_group_id coordination. A job with dependencies cannot be claimed until all dependency jobs reach terminal status.

## Goal

Enable review fan-out where specialist reviewer jobs run in parallel and the lead reviewer job waits for all to complete.

## Scope

### In Scope

- Job dependency checking before claim
- Job group queries (find all jobs in group)
- Terminal status detection for dependency jobs (completed or failed)
- Automatic dependency resolution on job completion

### Out of Scope

- Job cancellation cascading
- Job priority within groups

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`
- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Modify claimJob to check: if depends_on_job_ids is non-null, verify all referenced jobs are in terminal status
2. Add findJobsByGroup(groupId) method
3. Add areJobDependenciesMet(jobId) helper
4. When a job completes, check if any pending jobs with depends_on_job_ids including this job_id are now unblocked
5. Test: create 3 reviewer jobs + 1 lead job depending on all 3. Verify lead only claimable after all 3 complete

## Acceptance Criteria

- [ ] Jobs with unmet dependencies cannot be claimed
- [ ] Jobs become claimable when all dependencies reach terminal status
- [ ] Job groups can be queried
- [ ] Review fan-out pattern works correctly

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Integration test with review fan-out scenario

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep job-dep
```

## Risks / Notes

Dependency check adds a query per claim. Acceptable for V1.

## Follow-on Tasks

T059, T060
