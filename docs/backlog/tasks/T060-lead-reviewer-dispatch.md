# T060: Implement lead reviewer dispatch with dependencies

| Field                     | Value                                                                   |
| ------------------------- | ----------------------------------------------------------------------- |
| **ID**                    | T060                                                                    |
| **Epic**                  | [E012: Review Pipeline](../epics/E012-review-pipeline.md)               |
| **Type**                  | feature                                                                 |
| **Status**                | pending                                                                 |
| **Priority**              | P0                                                                      |
| **Owner**                 | backend-engineer                                                        |
| **AI Executable**         | Yes                                                                     |
| **Human Review Required** | Yes                                                                     |
| **Dependencies**          | [T026](./T026-job-dependencies.md), [T059](./T059-reviewer-dispatch.md) |
| **Blocks**                | [T061](./T061-review-decision-apply.md)                                 |

---

## Description

Create the lead_review_consolidation job that depends on all specialist reviewer jobs, so it only executes after all specialists have completed.

## Goal

Ensure lead reviewer sees all specialist reviews before making a decision.

## Scope

### In Scope

- Create lead_review_consolidation job with depends_on_job_ids listing all reviewer jobs
- Job only claimable when all dependencies are terminal
- Lead reviewer TaskPacket includes all specialist review packets

### Out of Scope

- Lead reviewer execution logic
- Lead consolidation rules (T061)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`
- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. During review dispatch (T059), after creating all specialist jobs, create the lead review job
2. Set depends_on_job_ids = [all specialist job IDs]
3. When lead job is dispatched, assemble TaskPacket with role=lead-reviewer
4. Include all ReviewPackets from completed specialist jobs in the context
5. Include review history for this task (prior review rounds)

## Acceptance Criteria

- [ ] Lead review job created with correct dependencies
- [ ] Job not claimable until all specialist jobs complete
- [ ] Lead reviewer receives all specialist review packets
- [ ] Review history included in context

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Integration test: complete all specialist reviews, verify lead job becomes claimable

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep lead-dispatch
```

## Risks / Notes

If a specialist job fails, lead review still triggers (reviews partial results).

## Follow-on Tasks

T061
