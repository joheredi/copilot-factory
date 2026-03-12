# T131: Add Reassign Pool operator action to Task detail

| Field                     | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| **ID**                    | T131                                                                   |
| **Epic**                  | [E025: Web UI Creation & Editing Forms](../epics/E025-web-ui-forms.md) |
| **Type**                  | feature                                                                |
| **Status**                | pending                                                                |
| **Priority**              | P2                                                                     |
| **Owner**                 | frontend-engineer                                                      |
| **AI Executable**         | Yes                                                                    |
| **Human Review Required** | Yes                                                                    |
| **Dependencies**          | None                                                                   |
| **Blocks**                | None                                                                   |

---

## Description

The Reassign Pool operator action (`POST /tasks/:id/actions/reassign-pool`) exists in the API and has a `useReassignPool` hook, but is not wired into the `TaskActionBar` component. Add a "Reassign Pool" button with a pool selector dropdown to the task detail operator actions.

## Goal

Allow operators to move tasks between worker pools directly from the task detail page.

## Scope

### In Scope

- "Reassign Pool" button in the `TaskActionBar` component
- Pool selector dropdown (fetch available pools)
- Wire to existing `useReassignPool` hook
- Available for non-terminal task states
- Add to `action-definitions.ts` and `STATUS_ACTIONS` mapping

### Out of Scope

- Bulk reassignment
- Pool creation from this dialog

## Context Files

The implementing agent should read these files before starting:

- `apps/web-ui/src/features/task-detail/components/operator-actions/TaskActionBar.tsx`
- `apps/web-ui/src/features/task-detail/components/operator-actions/action-definitions.ts`
- `apps/web-ui/src/api/hooks/use-tasks.ts` (useReassignPool hook)
- `apps/web-ui/src/api/hooks/use-pools.ts` (usePoolsList for dropdown)

## Implementation Guidance

1. Add `reassignPool` action definition to `action-definitions.ts`
2. Add to `STATUS_ACTIONS` for relevant statuses (ASSIGNED, IN_DEVELOPMENT, ESCALATED, BACKLOG, READY, BLOCKED)
3. Create a small dialog or popover with a pool select dropdown
4. Fetch pools via existing `usePoolsList` hook
5. On confirm: call `useReassignPool` with the selected pool ID
6. Write component tests

## Acceptance Criteria

- [ ] "Reassign Pool" button appears for applicable task states
- [ ] Clicking shows a pool selector
- [ ] Selecting a pool and confirming calls the API
- [ ] Task detail refreshes after successful reassignment
- [ ] Not available for terminal states (DONE, FAILED, CANCELLED)

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Reassign a task to a different pool and verify the change.

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm test -- --grep reassign
```

## Risks / Notes

None significant. The hook and API endpoint already exist and are tested.

## Follow-on Tasks

None
