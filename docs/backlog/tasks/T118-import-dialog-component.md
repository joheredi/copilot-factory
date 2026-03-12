# T118: Build Import Tasks multi-step dialog

| Field                     | Value                                                      |
| ------------------------- | ---------------------------------------------------------- |
| **ID**                    | T118                                                       |
| **Epic**                  | [E023: Task Import Pipeline](../epics/E023-task-import.md) |
| **Type**                  | feature                                                    |
| **Status**                | pending                                                    |
| **Priority**              | P1                                                         |
| **Owner**                 | frontend-engineer                                          |
| **AI Executable**         | Yes                                                        |
| **Human Review Required** | Yes                                                        |
| **Dependencies**          | [T117](./T117-import-api-hooks.md)                         |
| **Blocks**                | None                                                       |

---

## Description

Build a multi-step dialog component for importing tasks from a local directory. The dialog guides users through: entering a path → scanning/previewing discovered tasks → confirming the import → viewing results. Add an "Import Tasks" button to the tasks list page header.

## Goal

Give operators a visual, guided flow for importing backlogs into the factory, with full preview and control before committing.

## Scope

### In Scope

- Multi-step dialog using shadcn Dialog component
- Step 1 — Path Input: text field for local directory path, optional glob pattern, "Scan" button
- Step 2 — Preview: table of discovered tasks (title, type, priority, externalRef), parse warnings displayed, checkboxes to include/exclude tasks, editable project/repository name fields
- Step 3 — Confirm: summary of what will be created (N tasks, project name, repo name), "Import" button
- Step 4 — Result: success/error summary with counts (created, skipped, errors), link to tasks list
- Loading states during scan and import
- Error handling with clear messages
- "Import Tasks" button on the Tasks page (`features/tasks/page.tsx`)
- Responsive layout

### Out of Scope

- File upload (path-based only)
- Drag and drop
- Task editing within the preview (future enhancement)
- AI-powered format conversion

## Context Files

The implementing agent should read these files before starting:

- `apps/web-ui/src/features/config/components/policies-tab.tsx` (form pattern reference)
- `apps/web-ui/src/components/ui/dialog.tsx` (Dialog component)
- `apps/web-ui/src/components/ui/` (available shadcn components)
- `apps/web-ui/src/api/hooks/use-import.ts` (hooks from T117)

## Implementation Guidance

1. Create `apps/web-ui/src/features/tasks/components/ImportTasksDialog.tsx`
2. Use React state to track current step (1-4) and accumulated data
3. Step 1: Input + Button, call `useDiscoverTasks` mutation on scan, transition to step 2 on success
4. Step 2: Render tasks in a Table with Checkbox column. Show warnings as alert banners. Allow editing suggestedProjectName/suggestedRepositoryName. "Continue" button.
5. Step 3: Summary card with counts. "Import" button calls `useExecuteImport` mutation.
6. Step 4: Result card with created/skipped/error counts. "View Tasks" link navigates to `/tasks`. "Close" button resets dialog.
7. Add `<ImportTasksDialog />` to the tasks page header area with a trigger Button labeled "Import Tasks"
8. Write component tests for each step transition
9. Use `afterEach(cleanup)` in tests (web-ui test requirement)

## Acceptance Criteria

- [ ] "Import Tasks" button appears on the Tasks page
- [ ] Clicking opens a dialog with path input step
- [ ] Entering a valid path and clicking "Scan" shows discovered tasks in preview
- [ ] Parse warnings are displayed clearly
- [ ] Users can include/exclude tasks via checkboxes
- [ ] Confirming the import creates tasks and shows result summary
- [ ] Errors are handled gracefully with clear messages
- [ ] Dialog can be closed and reopened without state leaks

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Manually test the full flow: scan this repo's `docs/backlog`, preview, import, verify tasks appear in the list.

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm test -- --grep ImportTasksDialog
```

## Risks / Notes

- The dialog should remain usable even with large task lists (100+ tasks). Consider virtualized scrolling if the preview table is slow.
- Path input is a plain text field — no file picker (browsers can't access arbitrary local paths).

## Follow-on Tasks

None
