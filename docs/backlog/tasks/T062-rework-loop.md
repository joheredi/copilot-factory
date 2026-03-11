# T062: Implement rework loop with rejection context

| Field                     | Value                                                     |
| ------------------------- | --------------------------------------------------------- |
| **ID**                    | T062                                                      |
| **Epic**                  | [E012: Review Pipeline](../epics/E012-review-pipeline.md) |
| **Type**                  | feature                                                   |
| **Status**                | pending                                                   |
| **Priority**              | P1                                                        |
| **Owner**                 | backend-engineer                                          |
| **AI Executable**         | Yes                                                       |
| **Human Review Required** | Yes                                                       |
| **Dependencies**          | [T061](./T061-review-decision-apply.md)                   |
| **Blocks**                | None                                                      |

---

## Description

Implement the CHANGES_REQUESTED → ASSIGNED rework loop. When rework is scheduled, the new TaskPacket includes rejection context with blocking issues and lead decision summary.

## Goal

Give reworking developers clear context about what needs to change.

## Scope

### In Scope

- Build RejectionContext from lead review decision and blocking issues
- Include rejection_context in next TaskPacket.context
- Task re-enters scheduling flow (CHANGES_REQUESTED → ASSIGNED via scheduler)
- RejectionContext from §8.12

### Out of Scope

- Automatic rework execution
- Partial rework (redo only failing parts)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/008-packet-and-schema-spec.md`

## Implementation Guidance

1. When review decision is changes_requested, build RejectionContext
2. Include prior_review_cycle_id, blocking_issues, lead_decision_summary
3. Store rejection context so the next TaskPacket builder can include it
4. When scheduler assigns the rework task, TaskPacket includes context.rejection_context
5. Also include dev_result.unresolved_issues from prior attempt

## Acceptance Criteria

- [ ] RejectionContext correctly assembled from review decision
- [ ] Next TaskPacket includes rejection_context
- [ ] Blocking issues preserved from specialist and lead reviews
- [ ] Prior unresolved issues included

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

End-to-end test: reject task, verify rework packet includes rejection context

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep rework
```

## Risks / Notes

Must not lose information between review rounds. Preserve full rejection context.

## Follow-on Tasks

None
