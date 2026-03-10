# E008: Workspace Management

## Summary

Implement git worktree-based workspace provisioning, packet/config mounting, cleanup, and reconciliation.

## Why This Epic Exists

Each worker needs an isolated workspace. The workspace manager provides reproducible, policy-governed execution environments.

## Goals

- Git worktree creation per task
- Task packet and config mounting into workspace
- Workspace cleanup for terminal states
- Scheduled workspace reconciliation

## Scope

### In Scope

- Worktree lifecycle from docs/prd/007-technical-architecture.md §7.10
- Branch naming per docs/prd/010-integration-contracts.md §10.9
- Cleanup and retention rules

### Out of Scope

- Container-based isolation (future)
- Warm worktree cache

## Dependencies

**Depends on:** E001, E002

**Enables:** E009

## Risks / Notes

Git worktree operations can fail if the repo state is unexpected. Cleanup must handle edge cases.

## Tasks

| ID | Title | Priority | Status |
|---|---|---|---|
| [T039](../tasks/T039-worktree-creation.md) | Implement git worktree creation per task | P0 | pending |
| [T040](../tasks/T040-workspace-mounting.md) | Implement workspace packet and config mounting | P0 | pending |
| [T041](../tasks/T041-workspace-cleanup.md) | Implement workspace cleanup for terminal states | P1 | pending |
| [T042](../tasks/T042-reconcile-workspaces.md) | Implement ReconcileWorkspacesCommand | P1 | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

Worktrees created and cleaned up correctly. Packets mounted into workspace. Reconciliation removes expired workspaces.
