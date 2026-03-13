# T127: Add Create Worker Pool dialog to Pools page

| Field                     | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| **ID**                    | T127                                                                   |
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

The Pools page shows existing pools but has no way to create new ones. Add a "Create Pool" button that opens a dialog with fields for name, poolType, provider, model, maxConcurrency, and defaultTimeoutSec. Wire it to the existing `useCreatePool` hook in `use-pools.ts`.

## Goal

Allow operators to create worker pools from the web UI for configuring the worker infrastructure.

## Scope

### In Scope

- "Create Pool" button on the Pools page header
- Dialog with fields: name (required), poolType (select: developer/reviewer/lead-reviewer/merge-assist/planner), provider (input), model (input), maxConcurrency (number input), defaultTimeoutSec (number input)
- Wire to existing `useCreatePool` hook
- Cache invalidation on success

### Out of Scope

- Pool editing (existing in config page)
- Pool deletion via dialog

## Context Files

The implementing agent should read these files before starting:

- `apps/web-ui/src/features/pools/PoolsPage.tsx`
- `apps/web-ui/src/api/hooks/use-pools.ts` (useCreatePool hook)

## Implementation Guidance

1. Create `apps/web-ui/src/features/pools/components/CreatePoolDialog.tsx`
2. PoolType options: developer, reviewer, lead-reviewer, merge-assist, planner
3. maxConcurrency default: 3, defaultTimeoutSec default: 3600
4. On submit: call `useCreatePool` mutation
5. Add trigger button to `PoolsPage.tsx` header
6. Write component tests

## Acceptance Criteria

- [ ] "Create Pool" button appears on the Pools page
- [ ] Dialog contains all required fields with sensible defaults
- [ ] Submission creates the pool and refreshes the pool list
- [ ] Validation prevents submission without required fields

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Create a pool via the dialog and verify it appears in the pools list.

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm test -- --grep CreatePoolDialog
```

## Risks / Notes

None significant.

## Follow-on Tasks

None
