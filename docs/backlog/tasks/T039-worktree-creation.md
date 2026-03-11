# T039: Implement git worktree creation per task

| Field                     | Value                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T039                                                                                                           |
| **Epic**                  | [E008: Workspace Management](../epics/E008-workspace-management.md)                                            |
| **Type**                  | feature                                                                                                        |
| **Status**                | done                                                                                                           |
| **Priority**              | P0                                                                                                             |
| **Owner**                 | backend-engineer                                                                                               |
| **AI Executable**         | Yes                                                                                                            |
| **Human Review Required** | Yes                                                                                                            |
| **Dependencies**          | [T006](./T006-sqlite-drizzle-setup.md)                                                                         |
| **Blocks**                | [T040](./T040-workspace-mounting.md), [T041](./T041-workspace-cleanup.md), [T044](./T044-worker-supervisor.md) |

---

## Description

Implement workspace provisioning using git worktrees. Each task gets an isolated worktree with a dedicated branch following the factory/{task_id} naming convention.

## Goal

Provide isolated workspaces so workers cannot interfere with each other.

## Scope

### In Scope

- createWorkspace(taskId, repoPath, branchName) -> workspacePath
- Git worktree add with branch creation
- Branch naming: factory/{task_id} and factory/{task_id}/r{attempt}
- Workspace directory structure from §7.10
- Workspace reuse for retries if available

### Out of Scope

- Packet mounting (T040)
- Cleanup (T041)
- Container isolation

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`
- `docs/prd/010-integration-contracts.md`

## Implementation Guidance

1. Create packages/infrastructure/src/workspace/workspace-manager.ts
2. Workspace path: /workspaces/{repoId}/{taskId}/worktree/
3. Execute: git worktree add <path> -b factory/{taskId} origin/{defaultBranch}
4. For retries: check if workspace exists and is clean; reuse if possible, else create new with /r{attempt} suffix
5. Create logs/ and outputs/ subdirectories alongside worktree/
6. Handle errors: repo not cloned, branch exists, disk full

## Acceptance Criteria

- [x] Worktree created in correct location
- [x] Branch follows naming convention
- [x] Retry branches use /r{attempt} suffix
- [x] Existing workspaces reused when possible
- [x] Errors produce clear failure messages

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Create and verify worktrees against a test git repo

### Suggested Validation Commands

```bash
pnpm test --filter @factory/infrastructure -- --grep worktree
```

## Risks / Notes

Git worktree requires the main repo to be checked out. Test with a real git repo.

## Follow-on Tasks

T040, T041, T044
