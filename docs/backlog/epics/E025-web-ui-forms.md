# E025: Web UI Creation & Editing Forms

## Summary

Add missing CRUD forms and dialogs to the web UI so operators can create and edit projects, repositories, tasks, worker pools, and agent profiles directly from the browser — without needing API calls.

## Why This Epic Exists

The web UI currently displays data but has no creation or editing forms. All mutation hooks exist (`useCreateTask`, `useCreateProject`, `useCreatePool`, etc.) but are not wired to any UI components. Operators must use curl or external tools to create entities, which defeats the purpose of a visual control interface.

## Goals

- Add creation dialogs for all core entities (projects, repositories, tasks, pools, profiles)
- Add task editing capability on the task detail page
- Add the missing "Reassign Pool" operator action to the task action bar
- Wire all forms to existing mutation hooks with proper cache invalidation

## Scope

### In Scope

- Create Task dialog on the Tasks page
- Create Project dialog
- Create Repository dialog on the Project detail
- Create Worker Pool dialog on the Pools page
- Create Agent Profile dialog on Pool detail
- Edit Task form on the Task detail page
- Batch Task Import UI on the Tasks page
- Reassign Pool operator action on the Task detail page

### Out of Scope

- New API endpoints (all required endpoints already exist)
- New mutation hooks (all required hooks already exist)
- Bulk editing or deletion

## Dependencies

**Depends on:** E019, E020, E021

**Enables:** None (standalone feature)

## Risks / Notes

All mutation hooks are already implemented and tested. This epic is purely UI work — forms, dialogs, and wiring to existing hooks.

## Tasks

| ID                                                | Title                                            | Priority | Status  |
| ------------------------------------------------- | ------------------------------------------------ | -------- | ------- |
| [T124](../tasks/T124-create-task-dialog.md)       | Add Create Task dialog to Tasks page             | P0       | pending |
| [T125](../tasks/T125-create-project-dialog.md)    | Add Create Project dialog                        | P1       | pending |
| [T126](../tasks/T126-create-repository-dialog.md) | Add Create Repository dialog to Project detail   | P1       | pending |
| [T127](../tasks/T127-create-pool-dialog.md)       | Add Create Worker Pool dialog to Pools page      | P1       | pending |
| [T128](../tasks/T128-create-profile-dialog.md)    | Add Create Agent Profile dialog to Pool detail   | P2       | pending |
| [T129](../tasks/T129-edit-task-form.md)           | Add Edit Task form to Task detail page           | P2       | pending |
| [T130](../tasks/T130-batch-task-import-ui.md)     | Add Batch Task Import UI to Tasks page           | P2       | pending |
| [T131](../tasks/T131-reassign-pool-action.md)     | Add Reassign Pool operator action to Task detail | P2       | pending |

## Sequencing Notes

T124 (Create Task) is highest priority and can start immediately. All other tasks are independent and can be done in any order.

## Completion Criteria

All core entities can be created from the web UI. Tasks can be edited. All operator actions including Reassign Pool are available on the task detail page.
