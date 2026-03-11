# T041: Implement workspace cleanup for terminal states

| Field                     | Value                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| **ID**                    | T041                                                                |
| **Epic**                  | [E008: Workspace Management](../epics/E008-workspace-management.md) |
| **Type**                  | feature                                                             |
| **Status**                | pending                                                             |
| **Priority**              | P1                                                                  |
| **Owner**                 | backend-engineer                                                    |
| **AI Executable**         | Yes                                                                 |
| **Human Review Required** | Yes                                                                 |
| **Dependencies**          | [T039](./T039-worktree-creation.md)                                 |
| **Blocks**                | [T042](./T042-reconcile-workspaces.md)                              |

---

## Description

Implement workspace cleanup that removes worktrees and branches for tasks in terminal states (DONE, FAILED, CANCELLED) after the retention period.

## Goal

Prevent disk space exhaustion from accumulated workspaces.

## Scope

### In Scope

- cleanupWorkspace(taskId) — remove worktree, delete branch
- Respect retention_policy.workspace_retention_hours (default 24h)
- Retain ESCALATED workspaces until resolution
- Retain FAILED workspaces per retain_failed_workspaces policy

### Out of Scope

- Automated scheduling (T042)
- Artifact cleanup

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`
- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. git worktree remove <path> to clean up worktree
2. git branch -d factory/{taskId} to remove branch (only after merge or for terminal states)
3. Check task state before cleanup: skip ESCALATED unless operator resolved
4. Check retention period: only cleanup after workspace_retention_hours since terminal state
5. Handle case where worktree is already gone

## Acceptance Criteria

- [ ] Workspaces cleaned up after retention period
- [ ] ESCALATED workspaces retained
- [ ] Branches deleted for merged tasks
- [ ] Missing workspaces handled gracefully

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Test cleanup with various task states and retention periods

### Suggested Validation Commands

```bash
pnpm test --filter @factory/infrastructure -- --grep cleanup
```

## Risks / Notes

Branch deletion must be careful — only delete branches for terminal tasks.

## Follow-on Tasks

T042
