# T149: Clean orphaned worktrees on start

| Field                     | Value                                                                    |
| ------------------------- | ------------------------------------------------------------------------ |
| **ID**                    | T149                                                                     |
| **Epic**                  | [E027: Factory Lifecycle & Recovery](../epics/E027-factory-lifecycle.md) |
| **Type**                  | feature                                                                  |
| **Status**                | done                                                                     |
| **Priority**              | P2                                                                       |
| **Owner**                 | backend-engineer                                                         |
| **AI Executable**         | Yes                                                                      |
| **Human Review Required** | Yes                                                                      |
| **Dependencies**          | [T148](./T148-startup-recovery-log.md)                                   |
| **Blocks**                | [T151](./T151-cli-hero-docs.md)                                          |

---

## Description

On factory startup, scan the `~/.copilot-factory/workspaces/` directory for git worktrees, cross-reference with active leases in the database, and identify orphaned worktrees (no active lease and no pending retry). Log them as cleanup candidates and auto-clean those older than a configurable retention period (default 7 days).

## Goal

Prevent unbounded disk growth from crashed worker worktrees that are never cleaned up.

## Scope

### In Scope

- Scan `{workspacesRoot}/{repoId}/{taskId}/` directories
- Query DB for active leases by taskId
- Worktrees with no active lease AND last modified > 7 days → auto-delete
- Worktrees with no active lease AND < 7 days → log as "pending cleanup in N days"
- Never delete a worktree that has an active or pending lease
- Log cleanup summary: "Cleaned N orphaned worktrees (freed ~X MB)"
- Configurable retention via `WORKSPACE_RETENTION_DAYS` env var

### Out of Scope

- Real-time cleanup (only runs on startup)
- Git worktree deregistration (just delete the directory; git handles the rest)

## Context Files

The implementing agent should read these files before starting:

- `packages/infrastructure/src/workspace/workspace-manager.ts` — workspace directory layout
- `apps/control-plane/src/infrastructure/database/schema.ts` — task_lease table
- `apps/cli/src/paths.ts` — `getWorkspacesRoot()` (from T140)

## Implementation Guidance

1. Create `apps/control-plane/src/workspace-cleanup.service.ts`
2. In `onApplicationBootstrap()` (after startup diagnostics):
   - Read `getWorkspacesRoot()` directory structure
   - For each `{repoId}/{taskId}/` directory, check if a non-terminal lease exists for that taskId
   - If no active lease and `mtime` > retention period → `rm -rf` the directory
   - Log summary
3. Use `fs.readdirSync` and `fs.statSync` for scanning
4. Be defensive: catch errors for missing dirs, permission issues

## Acceptance Criteria

- [ ] Orphaned worktrees older than retention period are deleted on startup
- [ ] Worktrees with active leases are never deleted
- [ ] Recent orphaned worktrees are logged but not deleted
- [ ] Cleanup summary is logged
- [ ] No errors if workspaces directory is empty or missing

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

### Suggested Validation Commands

```bash
cd apps/control-plane && pnpm test -- --grep workspace-cleanup
```

## Risks / Notes

Must be conservative — never delete a worktree that might have active or pending work. When in doubt, keep the worktree.

## Follow-on Tasks

T151
