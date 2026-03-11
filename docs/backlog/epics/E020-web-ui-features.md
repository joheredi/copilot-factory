# E020: Web UI Feature Views

## Summary

Build all primary UI views: dashboard, task board, task detail, worker pools, reviews, merge queue, config editor, audit explorer.

## Why This Epic Exists

These views provide the operational visibility that is a core product goal.

## Goals

- Dashboard with system health
- Task board with filtering
- Task detail timeline
- Worker pool monitoring
- Review center
- Merge queue view
- Config editor
- Audit explorer

## Scope

### In Scope

- All primary views from docs/prd/001-architecture.md §1.9
- Real-time updates in all views
- Pagination and filtering

### Out of Scope

- Operator action controls (E021)
- Advanced analytics
- Simulation mode

## Dependencies

**Depends on:** E019

**Enables:** E021

## Risks / Notes

UI complexity is high. Must prioritize views that enable operational oversight.

## Tasks

| ID                                         | Title                                                 | Priority | Status  |
| ------------------------------------------ | ----------------------------------------------------- | -------- | ------- |
| [T093](../tasks/T093-ui-dashboard.md)      | Build dashboard view with system health summary       | P1       | pending |
| [T094](../tasks/T094-ui-task-board.md)     | Build task board with status filtering and pagination | P1       | pending |
| [T095](../tasks/T095-ui-task-detail.md)    | Build task detail timeline view                       | P1       | pending |
| [T096](../tasks/T096-ui-worker-pools.md)   | Build worker pool monitoring panel                    | P2       | pending |
| [T097](../tasks/T097-ui-review-center.md)  | Build review center view                              | P2       | pending |
| [T098](../tasks/T098-ui-merge-queue.md)    | Build merge queue view                                | P2       | pending |
| [T099](../tasks/T099-ui-config-editor.md)  | Build configuration editor view                       | P2       | pending |
| [T100](../tasks/T100-ui-audit-explorer.md) | Build audit explorer view                             | P2       | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

All primary views render correctly with real and empty data states.
