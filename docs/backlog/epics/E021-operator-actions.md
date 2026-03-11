# E021: Operator Actions & Overrides

## Summary

Implement the operator action API, state transition guards for manual actions, escalation resolution, and UI controls.

## Why This Epic Exists

Operators need to intervene in automated workflows. This epic provides safe, audited manual override capabilities.

## Goals

- Operator action API from docs/prd/006-additional-refinements.md §6.2
- Transition guards for safety
- Escalation resolution flow
- UI controls in task detail, pool, and merge views

## Scope

### In Scope

- All operator actions from §6.2
- Audit trail for operator actions
- Authorization policy for sensitive actions

### Out of Scope

- RBAC (future)
- Approval workflows between operators

## Dependencies

**Depends on:** E003, E017, E020

**Enables:** E022

## Risks / Notes

Manual overrides must respect state machine invariants. Must prevent unsafe transitions.

## Tasks

| ID                                              | Title                                                    | Priority | Status  |
| ----------------------------------------------- | -------------------------------------------------------- | -------- | ------- |
| [T101](../tasks/T101-api-operator-actions.md)   | Implement operator action API endpoints                  | P1       | pending |
| [T102](../tasks/T102-operator-guards.md)        | Implement state transition guards for manual actions     | P1       | pending |
| [T103](../tasks/T103-escalation-resolution.md)  | Implement escalation resolution flow                     | P1       | pending |
| [T104](../tasks/T104-ui-operator-task.md)       | Integrate operator controls into task detail UI          | P2       | pending |
| [T105](../tasks/T105-ui-operator-pool-merge.md) | Integrate operator controls into pool and merge queue UI | P2       | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

All operator actions available via API and UI. Actions audited. Guards prevent invalid transitions.
