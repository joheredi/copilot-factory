# T104: Integrate operator controls into task detail UI

| Field                     | Value                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T104                                                                                                              |
| **Epic**                  | [E021: Operator Actions & Overrides](../epics/E021-operator-actions.md)                                           |
| **Type**                  | feature                                                                                                           |
| **Status**                | pending                                                                                                           |
| **Priority**              | P2                                                                                                                |
| **Owner**                 | frontend-engineer                                                                                                 |
| **AI Executable**         | Yes                                                                                                               |
| **Human Review Required** | Yes                                                                                                               |
| **Dependencies**          | [T095](./T095-ui-task-detail.md), [T101](./T101-api-operator-actions.md), [T103](./T103-escalation-resolution.md) |
| **Blocks**                | None                                                                                                              |

---

## Description

Add operator action controls to the task detail view: state-dependent action buttons, confirmation dialogs, and result feedback.

## Goal

Enable operators to take actions directly from the task inspection view.

## Scope

### In Scope

- Context-sensitive action buttons (only show valid actions for current state)
- Confirmation dialogs with reason text input for destructive actions
- Success/error feedback
- Escalation resolution UI
- Priority change dropdown

### Out of Scope

- Bulk task actions
- Keyboard shortcuts

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/006-additional-refinements.md`

## Implementation Guidance

1. Add action bar to TaskDetailPage with state-dependent buttons
2. Use the operator action API (T101) for all actions
3. Show only actions valid for the current state (e.g., 'Pause' only for active tasks)
4. Confirmation dialog for: cancel, force_unblock, reopen
5. Escalation resolution: three-button choice (Retry, Cancel, Mark Done) with reason input
6. After action: refresh task data and show success/error toast

## Acceptance Criteria

- [ ] Only valid actions shown per state
- [ ] Confirmation required for destructive actions
- [ ] Actions update UI immediately
- [ ] Error handling shows clear messages

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Test operator actions from task detail view

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm dev
```

## Risks / Notes

State changes may be concurrent with UI. Handle optimistic concurrency gracefully.

## Follow-on Tasks

None
