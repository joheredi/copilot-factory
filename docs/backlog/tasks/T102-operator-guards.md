# T102: Implement state transition guards for manual actions

| Field                     | Value                                                                   |
| ------------------------- | ----------------------------------------------------------------------- |
| **ID**                    | T102                                                                    |
| **Epic**                  | [E021: Operator Actions & Overrides](../epics/E021-operator-actions.md) |
| **Type**                  | feature                                                                 |
| **Status**                | pending                                                                 |
| **Priority**              | P1                                                                      |
| **Owner**                 | backend-engineer                                                        |
| **AI Executable**         | Yes                                                                     |
| **Human Review Required** | Yes                                                                     |
| **Dependencies**          | [T101](./T101-api-operator-actions.md)                                  |
| **Blocks**                | [T103](./T103-escalation-resolution.md)                                 |

---

## Description

Add safety guards for operator actions that ensure manual overrides respect state machine invariants and system safety constraints.

## Goal

Prevent operators from putting the system in an inconsistent state.

## Scope

### In Scope

- Validate that force_unblock has a reason
- Validate reopen doesn't violate active lease
- Validate merge order override doesn't skip required validations
- Validate cancel doesn't lose in-progress work without confirmation
- Authorization checks for sensitive actions

### Out of Scope

- RBAC (future)
- Multi-operator approval

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/006-additional-refinements.md`
- `docs/prd/002-data-model.md`

## Implementation Guidance

1. For each operator action, add guard checks before execution
2. force_unblock: require reason text, verify task is actually BLOCKED
3. reopen: verify no active lease, verify task was in terminal state
4. cancel: verify no active merge in progress for this task
5. Sensitive actions (force_unblock, override_merge_order, reopen): log with elevated audit level

## Acceptance Criteria

- [ ] Guards prevent invalid manual actions
- [ ] Descriptive error messages for guard failures
- [ ] Sensitive actions logged with elevated audit

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Test guard enforcement for each operator action

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep operator-guard
```

## Risks / Notes

Guards must balance safety with operator flexibility. Don't be too restrictive.

## Follow-on Tasks

T103
