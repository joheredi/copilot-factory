# T068: Implement follow-up task generation

| Field                     | Value                                                                         |
| ------------------------- | ----------------------------------------------------------------------------- |
| **ID**                    | T068                                                                          |
| **Epic**                  | [E013: Merge Pipeline](../epics/E013-merge-pipeline.md)                       |
| **Type**                  | feature                                                                       |
| **Status**                | pending                                                                       |
| **Priority**              | P1                                                                            |
| **Owner**                 | backend-engineer                                                              |
| **AI Executable**         | Yes                                                                           |
| **Human Review Required** | Yes                                                                           |
| **Dependencies**          | [T067](./T067-post-merge-failure.md), [T061](./T061-review-decision-apply.md) |
| **Blocks**                | None                                                                          |

---

## Description

Implement creation of follow-up tasks from approved_with_follow_up decisions, post-merge revert tasks, and diagnostic tasks.

## Goal

Automatically create follow-up work items so nothing is lost.

## Scope

### In Scope

- Follow-up from approved_with_follow_up: create tasks from follow_up_task_refs
- Revert tasks from post-merge failures
- Diagnostic tasks from low-severity failures
- Hotfix tasks from analysis agent recommendations
- Auto-set dependencies: follow-up depends on original task

### Out of Scope

- Automatic priority assignment for follow-ups
- Follow-up grouping

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/008-packet-and-schema-spec.md`
- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. Create packages/application/src/services/followup-task.service.ts
2. createFollowUpTasks(sourceTaskId, followUpRefs, type): create Task records
3. Set source='system', task_type based on context (follow_up, revert, diagnostic, hotfix)
4. For reverts: include revert scope in description
5. For follow-ups from review: include the suggestion from lead reviewer
6. Add dependency: follow-up depends_on source task (informational, not hard-block)

## Acceptance Criteria

- [ ] Follow-up tasks created with correct metadata
- [ ] Revert tasks include scope information
- [ ] Dependencies link follow-ups to source tasks
- [ ] Tasks enter BACKLOG state for scheduling

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Test follow-up creation from various sources

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep followup
```

## Risks / Notes

Follow-up task descriptions must be actionable. Include sufficient context.

## Follow-on Tasks

None
