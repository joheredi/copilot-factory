# T125: Add Create Project dialog

| Field                     | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| **ID**                    | T125                                                                   |
| **Epic**                  | [E025: Web UI Creation & Editing Forms](../epics/E025-web-ui-forms.md) |
| **Type**                  | feature                                                                |
| **Status**                | pending                                                                |
| **Priority**              | P1                                                                     |
| **Owner**                 | frontend-engineer                                                      |
| **AI Executable**         | Yes                                                                    |
| **Human Review Required** | Yes                                                                    |
| **Dependencies**          | None                                                                   |
| **Blocks**                | None                                                                   |

---

## Description

There is no UI for creating projects. Add a "Create Project" button with a dialog containing fields for name, description, and owner. Wire it to the existing `useCreateProject` hook in `use-projects.ts`. Consider adding a dedicated `/projects` route if one does not exist, or place the button in the Configuration page.

## Goal

Allow operators to create projects from the web UI as part of the initial setup flow.

## Scope

### In Scope

- "Create Project" button accessible from the UI (dashboard or config page)
- Dialog with fields: name (required), description (optional), owner (required)
- Form validation
- Wire to existing `useCreateProject` hook
- Cache invalidation on success

### Out of Scope

- Project detail page
- Project editing or deletion via UI

## Context Files

The implementing agent should read these files before starting:

- `apps/web-ui/src/api/hooks/use-projects.ts` (useCreateProject hook)
- `apps/web-ui/src/features/config/components/pools-tab.tsx` (form pattern reference)
- `apps/web-ui/src/app/routes.tsx` (existing routes)

## Implementation Guidance

1. Create `apps/web-ui/src/features/projects/components/CreateProjectDialog.tsx`
2. Use shadcn Dialog, Input, Button, Label components
3. Fields: name (Input, required), description (Textarea, optional), owner (Input, required)
4. On submit: call `useCreateProject` mutation
5. On success: close dialog, invalidate project cache, show confirmation
6. Add the dialog to an appropriate location (dashboard or config page)
7. Write component tests

## Acceptance Criteria

- [ ] "Create Project" button is accessible from the UI
- [ ] Dialog contains name, description, and owner fields
- [ ] Submission creates the project and refreshes relevant data
- [ ] Validation prevents submission without required fields

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Create a project via the dialog and verify it appears in project listings.

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm test -- --grep CreateProjectDialog
```

## Risks / Notes

None significant. Straightforward form wiring.

## Follow-on Tasks

None
