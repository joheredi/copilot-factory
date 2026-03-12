# T126: Add Create Repository dialog to Project detail

| Field                     | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| **ID**                    | T126                                                                   |
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

There is no UI for creating repositories within a project. Add an "Add Repository" button with a dialog containing fields for name, remoteUrl, defaultBranch, and localCheckoutStrategy. Wire it to the existing `useCreateRepository` hook in `use-repositories.ts`.

## Goal

Allow operators to register Git repositories for projects directly from the web UI.

## Scope

### In Scope

- "Add Repository" button accessible from project context
- Dialog with fields: name (required), remoteUrl (required, URL validation), defaultBranch (default "main"), localCheckoutStrategy (select: worktree/clone)
- Wire to existing `useCreateRepository` hook
- Cache invalidation on success

### Out of Scope

- Repository detail page
- Git credential management

## Context Files

The implementing agent should read these files before starting:

- `apps/web-ui/src/api/hooks/use-repositories.ts` (useCreateRepository hook)
- `apps/control-plane/src/projects/dtos/create-repository.dto.ts` (required fields)

## Implementation Guidance

1. Create `apps/web-ui/src/features/projects/components/CreateRepositoryDialog.tsx`
2. Fields: name (Input), remoteUrl (Input with URL validation), defaultBranch (Input, default "main"), localCheckoutStrategy (Select: worktree/clone)
3. On submit: call `useCreateRepository` with projectId and form data
4. Write component tests

## Acceptance Criteria

- [ ] "Add Repository" button is accessible from project context
- [ ] Dialog contains all required fields with appropriate validation
- [ ] Submission creates the repository and refreshes relevant data
- [ ] localCheckoutStrategy defaults to "worktree"

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Create a repository via the dialog and verify it appears in repository listings.

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm test -- --grep CreateRepositoryDialog
```

## Risks / Notes

None significant.

## Follow-on Tasks

None
