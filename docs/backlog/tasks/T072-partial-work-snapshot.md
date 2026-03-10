# T072: Implement partial work snapshot on lease reclaim

| Field | Value |
|---|---|
| **ID** | T072 |
| **Epic** | [E014: Artifact Service](../epics/E014-artifact-service.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P1 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T069](./T069-artifact-storage.md), [T034](./T034-crash-recovery-artifacts.md) |
| **Blocks** | None |

---

## Description

When a lease is reclaimed, capture the workspace state as partial artifacts for crash recovery context.

## Goal

Preserve whatever work was done before a crash for potential use in retries.

## Scope

### In Scope

- Capture git diff of workspace
- Capture any output files
- Store as partial_result_artifact_refs
- Handle missing/corrupted workspace gracefully

### Out of Scope

- Full workspace archiving
- Binary artifact capture

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`
- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. On lease reclaim, if workspace exists:
2. 1. Run git diff in worktree to capture uncommitted changes
3. 2. Copy any files in the output directory
4. 3. Store all captured artifacts via artifact service
5. 4. Record artifact refs in lease.partial_result_artifact_refs
6. If workspace is gone or corrupted, log and continue without artifacts

## Acceptance Criteria

- [ ] Partial artifacts captured when workspace is available
- [ ] Missing workspace handled gracefully
- [ ] Artifacts stored and referenced correctly

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Test with workspace in various states (clean, dirty, missing)

### Suggested Validation Commands

```bash
pnpm test --filter @factory/infrastructure -- --grep partial-snapshot
```

## Risks / Notes

Workspace may be in any state after a crash. Be maximally defensive.

## Follow-on Tasks

None
