# T059: Implement specialist reviewer job dispatch

| Field                     | Value                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| **ID**                    | T059                                                                |
| **Epic**                  | [E012: Review Pipeline](../epics/E012-review-pipeline.md)           |
| **Type**                  | feature                                                             |
| **Status**                | done                                                                |
| **Priority**              | P0                                                                  |
| **Owner**                 | backend-engineer                                                    |
| **AI Executable**         | Yes                                                                 |
| **Human Review Required** | Yes                                                                 |
| **Dependencies**          | [T026](./T026-job-dependencies.md), [T058](./T058-review-router.md) |
| **Blocks**                | [T060](./T060-lead-reviewer-dispatch.md)                            |

---

## Description

After review routing, create reviewer_dispatch jobs for each specialist reviewer, all sharing the same job_group_id for coordination.

## Goal

Fan out review work to specialist reviewers in parallel via the job queue.

## Scope

### In Scope

- Create ReviewCycle record
- Create one reviewer_dispatch job per specialist
- All jobs share job_group_id
- Task transition DEV_COMPLETE → IN_REVIEW
- TaskPacket assembly for reviewer role

### Out of Scope

- Lead reviewer dispatch (T060)
- Reviewer execution

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`
- `docs/prd/010-integration-contracts.md`

## Implementation Guidance

1. On DEV_COMPLETE event: call review router to get routing decision
2. Create ReviewCycle record with required_reviewers and optional_reviewers
3. For each reviewer: create a reviewer_dispatch job with same job_group_id
4. Job payload includes task packet assembled with role=reviewer and reviewer_type
5. Transition task to IN_REVIEW and update current_review_cycle_id
6. Handle case where no reviewers are required (unlikely but defensive)

## Acceptance Criteria

- [ ] ReviewCycle created with correct reviewers
- [ ] One job per specialist reviewer with shared group ID
- [ ] Task transitions to IN_REVIEW
- [ ] Job payloads include reviewer-specific task packets

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Integration test: complete dev, verify review jobs created

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep reviewer-dispatch
```

## Risks / Notes

Review fan-out creates multiple jobs atomically. Use a transaction.

## Follow-on Tasks

T060
