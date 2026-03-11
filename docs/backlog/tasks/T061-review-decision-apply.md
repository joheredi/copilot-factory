# T061: Implement review decision application

| Field                     | Value                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T061                                                                                                             |
| **Epic**                  | [E012: Review Pipeline](../epics/E012-review-pipeline.md)                                                        |
| **Type**                  | feature                                                                                                          |
| **Status**                | done                                                                                                             |
| **Priority**              | P0                                                                                                               |
| **Owner**                 | backend-engineer                                                                                                 |
| **AI Executable**         | Yes                                                                                                              |
| **Human Review Required** | Yes                                                                                                              |
| **Dependencies**          | [T022](./T022-schemas-review.md), [T060](./T060-lead-reviewer-dispatch.md), [T017](./T017-transition-service.md) |
| **Blocks**                | [T062](./T062-rework-loop.md)                                                                                    |

---

## Description

Process the LeadReviewDecisionPacket and apply the decision: approved, approved_with_follow_up, changes_requested, or escalated.

## Goal

Translate lead reviewer decisions into task state transitions and follow-up actions.

## Scope

### In Scope

- Parse and validate LeadReviewDecisionPacket
- Apply decision to task state:
- approved → APPROVED
- approved_with_follow_up → APPROVED + create follow-up tasks
- changes_requested → CHANGES_REQUESTED
- escalated → ESCALATED
- Persist LeadReviewDecision record
- Close ReviewCycle with appropriate status

### Out of Scope

- Rework loop (T062)
- Follow-up task creation details

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/008-packet-and-schema-spec.md`
- `docs/prd/002-data-model.md`

## Implementation Guidance

1. Create packages/application/src/services/review-decision.service.ts
2. applyDecision(leadReviewPacket, taskId, reviewCycleId)
3. Validate packet against schema
4. Match decision to task transition
5. For approved_with_follow_up: create skeleton tasks from follow_up_task_refs
6. For changes_requested: close ReviewCycle as REJECTED, increment task.review_round_count
7. Check review round limit against escalation policy — escalate if exceeded
8. Persist LeadReviewDecision record

## Acceptance Criteria

- [ ] All four decision types handled correctly
- [ ] Task state transitions match decision
- [ ] Follow-up tasks created for approved_with_follow_up
- [ ] review_round_count incremented on rejection
- [ ] Escalation triggered when review round limit exceeded

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Tests for each decision type including escalation trigger

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep review-decision
```

## Risks / Notes

Review round limit check must use escalation policy. Don't hard-code.

## Follow-on Tasks

T062
