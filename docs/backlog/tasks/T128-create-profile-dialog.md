# T128: Add Create Agent Profile dialog to Pool detail

| Field                     | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| **ID**                    | T128                                                                   |
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

Pool detail pages show agent profiles but have no way to create new ones. Add an "Add Agent Profile" button that opens a dialog for creating a new profile within a pool. Wire it to the existing `useCreateAgentProfile` hook in `use-pools.ts`.

## Goal

Allow operators to configure agent behavioral contracts directly from the pool detail UI.

## Scope

### In Scope

- "Add Agent Profile" button on pool detail page in the agent profiles section
- Dialog with relevant profile fields
- Wire to existing `useCreateAgentProfile` hook
- Cache invalidation on success

### Out of Scope

- Profile editing (future enhancement)
- Prompt template management

## Context Files

The implementing agent should read these files before starting:

- `apps/web-ui/src/api/hooks/use-pools.ts` (useCreateAgentProfile hook)
- `apps/control-plane/src/infrastructure/database/schema.ts` (agent_profile table)

## Implementation Guidance

1. Create `apps/web-ui/src/features/pools/components/CreateProfileDialog.tsx`
2. On submit: call `useCreateAgentProfile` with poolId and form data
3. Add trigger button to pool detail profile section
4. Write component tests

## Acceptance Criteria

- [ ] "Add Agent Profile" button appears on pool detail page
- [ ] Dialog creates a profile within the selected pool
- [ ] Profile list refreshes on success

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Create a profile via the dialog and verify it appears in the pool's profile list.

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm test -- --grep CreateProfileDialog
```

## Risks / Notes

None significant.

## Follow-on Tasks

None
