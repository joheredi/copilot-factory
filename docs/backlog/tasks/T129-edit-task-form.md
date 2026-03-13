# T129: Add Edit Task form to Task detail page

| Field                     | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| **ID**                    | T129                                                                   |
| **Epic**                  | [E025: Web UI Creation & Editing Forms](../epics/E025-web-ui-forms.md) |
| **Type**                  | feature                                                                |
| **Status**                | done                                                                   |
| **Priority**              | P2                                                                     |
| **Owner**                 | frontend-engineer                                                      |
| **AI Executable**         | Yes                                                                    |
| **Human Review Required** | Yes                                                                    |
| **Dependencies**          | None                                                                   |
| **Blocks**                | None                                                                   |

---

## Description

The task detail page has no way to edit task metadata (title, description, priority, etc.) after creation. Add an "Edit" button that shows an inline form or dialog for updating task fields. Wire it to the existing `useUpdateTask` hook in `use-tasks.ts`.

## Goal

Allow operators to correct or refine task details without needing API calls.

## Scope

### In Scope

- "Edit" button on the task detail page
- Editable fields: title, description, priority, riskLevel, estimatedSize, acceptanceCriteria, definitionOfDone, suggestedFileScope
- Optimistic concurrency: include task version in update request
- Wire to existing `useUpdateTask` hook
- Cache invalidation on success

### Out of Scope

- Editing task status (handled by operator actions)
- Editing repositoryId (immutable after creation)

## Context Files

The implementing agent should read these files before starting:

- `apps/web-ui/src/features/task-detail/TaskDetailPage.tsx`
- `apps/web-ui/src/api/hooks/use-tasks.ts` (useUpdateTask hook)
- `apps/control-plane/src/tasks/dtos/update-task.dto.ts` (updatable fields)

## Implementation Guidance

1. Create `apps/web-ui/src/features/task-detail/components/EditTaskDialog.tsx`
2. Pre-populate form with current task data
3. On submit: call `useUpdateTask` with task ID, version, and changed fields
4. Handle 409 Conflict (version mismatch) with a clear message
5. Add "Edit" button to the task detail header
6. Write component tests

## Acceptance Criteria

- [ ] "Edit" button appears on the task detail page
- [ ] Dialog pre-populates with current task data
- [ ] Changes are saved via the API with version checking
- [ ] Version conflicts are handled gracefully
- [ ] Task detail refreshes after successful edit

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Edit a task's title and priority, verify changes persist.

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm test -- --grep EditTaskDialog
```

## Risks / Notes

Optimistic concurrency via the `version` field prevents lost updates when multiple operators edit the same task. The UI should clearly indicate when a conflict occurs and offer a refresh.

## Follow-on Tasks

None
