# T101: Implement operator action API endpoints

| Field                     | Value                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T101                                                                                                           |
| **Epic**                  | [E021: Operator Actions & Overrides](../epics/E021-operator-actions.md)                                        |
| **Type**                  | feature                                                                                                        |
| **Status**                | done                                                                                                           |
| **Priority**              | P1                                                                                                             |
| **Owner**                 | backend-engineer                                                                                               |
| **AI Executable**         | Yes                                                                                                            |
| **Human Review Required** | Yes                                                                                                            |
| **Dependencies**          | [T017](./T017-transition-service.md), [T080](./T080-nestjs-bootstrap.md)                                       |
| **Blocks**                | [T102](./T102-operator-guards.md), [T103](./T103-escalation-resolution.md), [T104](./T104-ui-operator-task.md) |

---

## Description

Create API endpoints for all operator actions from §6.2: pause/resume, requeue, force unblock, change priority, reassign pool, rerun reviewer, override merge order, reopen task.

## Goal

Give operators programmatic control over the automated workflow.

## Scope

### In Scope

- POST /api/tasks/:id/actions/{action} for each action type
- Action payload validation
- Action audit trail
- All actions from docs/prd/006-additional-refinements.md §6.2

### Out of Scope

- UI controls (T104, T105)
- Bulk actions

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/006-additional-refinements.md`

## Implementation Guidance

1. Create OperatorActionsController
2. Each action type: pause, resume, requeue, force_unblock, change_priority, reassign_pool, rerun_review, override_merge_order, reopen, cancel
3. Each action validates preconditions via state machine
4. Each action creates an audit event with actor_type=operator
5. Return the updated entity state after action

## Acceptance Criteria

- [ ] All operator actions from §6.2 have endpoints
- [ ] Actions validate preconditions
- [ ] Actions create audit events
- [ ] Invalid actions return descriptive errors

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Test each operator action via API

### Suggested Validation Commands

```bash
pnpm test --filter @factory/control-plane -- --grep operator-action
```

## Risks / Notes

Operator actions bypass normal flow. Must still respect state machine invariants.

## Follow-on Tasks

T102, T103, T104
