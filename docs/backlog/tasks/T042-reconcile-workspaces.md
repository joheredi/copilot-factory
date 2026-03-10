# T042: Implement ReconcileWorkspacesCommand

| Field | Value |
|---|---|
| **ID** | T042 |
| **Epic** | [E008: Workspace Management](../epics/E008-workspace-management.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P1 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T041](./T041-workspace-cleanup.md), [T029](./T029-reconciliation-sweep.md) |
| **Blocks** | None |

---

## Description

Create a scheduled job that periodically scans for expired workspaces and cleans them up.

## Goal

Automate workspace cleanup so operators don't need to manage disk space manually.

## Scope

### In Scope

- Periodic cleanup job (recommended hourly)
- Scan for workspaces past retention period
- Delete expired workspaces and branches
- Log all cleanup actions

### Out of Scope

- Artifact cleanup
- Disk space monitoring

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`
- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Add to reconciliation sweep or create a dedicated cleanup job type
2. Query tasks in terminal states where completed_at + retention_hours < now
3. For each, check if workspace directory exists and clean up
4. Also scan /workspaces/ directory for orphaned directories not matching any task
5. Log cleaned workspaces for debugging

## Acceptance Criteria

- [ ] Expired workspaces cleaned up automatically
- [ ] Orphaned workspaces detected and removed
- [ ] Cleanup runs periodically without manual intervention

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Create expired workspaces and verify cleanup job removes them

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep workspace-reconcil
```

## Risks / Notes

Must not clean up workspaces for active tasks. Double-check task state.

## Follow-on Tasks

None
