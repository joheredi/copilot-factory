# T130: Add Batch Task Import UI to Tasks page

| Field                     | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| **ID**                    | T130                                                                   |
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

Add an "Import Tasks" or "Create Batch" button to the Tasks page that allows creating multiple tasks at once via a JSON textarea or file upload. Wire it to the existing `useCreateTaskBatch` hook in `use-tasks.ts`.

## Goal

Enable operators to quickly populate the backlog with multiple tasks without creating them one by one.

## Scope

### In Scope

- "Create Batch" button on the Tasks page
- Dialog with a JSON textarea for pasting an array of task objects
- Preview/validation of the JSON before submission
- Wire to existing `useCreateTaskBatch` hook
- Success/error feedback with count of created tasks

### Out of Scope

- File upload parsing (covered by the import pipeline E023)
- CSV format support

## Context Files

The implementing agent should read these files before starting:

- `apps/web-ui/src/api/hooks/use-tasks.ts` (useCreateTaskBatch hook)
- `apps/control-plane/src/tasks/dtos/create-task.dto.ts` (required fields)

## Implementation Guidance

1. Create `apps/web-ui/src/features/tasks/components/BatchCreateDialog.tsx`
2. Textarea for JSON input with syntax highlighting or at minimum monospace font
3. "Validate" button parses JSON and shows count + any validation errors
4. "Create" button submits the batch
5. On success: show created count, close dialog, refresh task list
6. Write component tests

## Acceptance Criteria

- [ ] "Create Batch" button appears on the Tasks page
- [ ] JSON textarea accepts an array of task objects
- [ ] Validation catches malformed JSON and missing required fields
- [ ] Batch creation succeeds and task list refreshes

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Paste a JSON array of 3 tasks, submit, verify all appear in the task list.

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm test -- --grep BatchCreateDialog
```

## Risks / Notes

None significant. This is a simple JSON-in, tasks-out dialog.

## Follow-on Tasks

None
