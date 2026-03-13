# T124: Add Create Task dialog to Tasks page

| Field                     | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| **ID**                    | T124                                                                   |
| **Epic**                  | [E025: Web UI Creation & Editing Forms](../epics/E025-web-ui-forms.md) |
| **Type**                  | feature                                                                |
| **Status**                | done                                                                   |
| **Priority**              | P1                                                                     |
| **Owner**                 | frontend-engineer                                                      |
| **AI Executable**         | Yes                                                                    |
| **Human Review Required** | Yes                                                                    |
| **Dependencies**          | None                                                                   |
| **Blocks**                | None                                                                   |

---

## Description

The Tasks page (`/tasks`) has no UI for creating new tasks. Add a "Create Task" button that opens a dialog with fields for title, description, taskType, priority, riskLevel, acceptanceCriteria, and repositoryId. Wire it to the existing `useCreateTask` hook in `use-tasks.ts`.

## Goal

Allow operators to create tasks directly from the web UI without needing API calls.

## Scope

### In Scope

- "Create Task" button in the Tasks page header
- Dialog with form fields: title (required), description, taskType (select), priority (select), riskLevel (select), estimatedSize (select), acceptanceCriteria (textarea, one per line), repositoryId (select from existing repos)
- Form validation (title required, taskType required, priority required)
- Loading state during submission
- Success: close dialog, invalidate task list cache
- Error: display error message in dialog

### Out of Scope

- Batch creation (T130)
- Task editing (T129)
- Creating repositories inline (user selects existing)

## Context Files

The implementing agent should read these files before starting:

- `apps/web-ui/src/features/tasks/page.tsx`
- `apps/web-ui/src/api/hooks/use-tasks.ts` (useCreateTask hook)
- `apps/web-ui/src/features/config/components/policies-tab.tsx` (form pattern reference)
- `apps/web-ui/src/components/ui/dialog.tsx`

## Implementation Guidance

1. Create `apps/web-ui/src/features/tasks/components/CreateTaskDialog.tsx`
2. Use shadcn Dialog, Input, Textarea, Select, Button, Label components
3. Form state managed with React useState or a form library
4. TaskType options: feature, bug_fix, refactor, chore, documentation, test, spike
5. Priority options: critical, high, medium, low
6. RiskLevel options: high, medium, low
7. EstimatedSize options: xs, s, m, l, xl
8. RepositoryId: fetch repositories via existing hooks and render as select
9. On submit: call `useCreateTask` mutation with form data
10. On success: close dialog, toast/banner confirmation
11. Add the dialog trigger button to `features/tasks/page.tsx`
12. Write component tests with mocked API responses
13. Use `afterEach(cleanup)` in tests

## Acceptance Criteria

- [ ] "Create Task" button appears on the Tasks page
- [ ] Clicking opens a dialog with all required form fields
- [ ] Form validates that title, taskType, and priority are provided
- [ ] Submitting creates the task via the API
- [ ] Dialog closes on success and task list refreshes
- [ ] Errors are displayed clearly in the dialog
- [ ] Dialog can be cancelled without side effects

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Manually create a task via the dialog and verify it appears in the task list.

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm test -- --grep CreateTaskDialog
```

## Risks / Notes

The repositoryId select requires at least one repository to exist. Consider showing a helpful message if no repositories are available, guiding the user to create one first.

## Follow-on Tasks

None
