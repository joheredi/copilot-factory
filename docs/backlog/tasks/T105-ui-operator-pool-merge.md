# T105: Integrate operator controls into pool and merge queue UI

| Field | Value |
|---|---|
| **ID** | T105 |
| **Epic** | [E021: Operator Actions & Overrides](../epics/E021-operator-actions.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P2 |
| **Owner** | frontend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T096](./T096-ui-worker-pools.md), [T098](./T098-ui-merge-queue.md), [T101](./T101-api-operator-actions.md) |
| **Blocks** | None |

---

## Description

Add operator controls to pool management and merge queue views.

## Goal

Enable operators to manage pools and merge queue from the UI.

## Scope

### In Scope

- Pool: enable/disable toggle, edit concurrency
- Pool: move task to different pool
- Merge queue: resume paused queue
- Merge queue: reorder items
- Confirmation dialogs for all actions

### Out of Scope

- Pool creation wizard
- Merge queue batch operations

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/006-additional-refinements.md`

## Implementation Guidance

1. Add enable/disable toggle to pool cards
2. Add concurrency limit editor (inline edit)
3. Merge queue: resume button when queue is paused (with confirmation)
4. All actions use operator action API endpoints
5. Success/error feedback via toasts

## Acceptance Criteria

- [ ] Pool toggle works
- [ ] Queue resume works
- [ ] Confirmations shown for state-changing actions
- [ ] UI updates after actions

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Test operator actions in pool and merge queue views

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm dev
```

## Risks / Notes

Pool changes affect scheduling. Show impact warnings.

## Follow-on Tasks

None
