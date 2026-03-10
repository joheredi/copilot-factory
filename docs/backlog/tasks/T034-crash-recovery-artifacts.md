# T034: Implement crash recovery with partial artifact capture

| Field | Value |
|---|---|
| **ID** | T034 |
| **Epic** | [E006: Lease Management & Heartbeats](../epics/E006-lease-management.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P1 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T033](./T033-lease-reclaim.md), [T069](./T069-artifact-storage.md) |
| **Blocks** | None |

---

## Description

When a lease is reclaimed, capture partial work artifacts from the workspace for context in retry attempts.

## Goal

Preserve partial work so retry attempts have context about what was already done.

## Scope

### In Scope

- Workspace snapshot on reclaim
- Store snapshot as partial_result_artifact_refs in lease record
- Include partial artifacts in next TaskPacket via context.prior_partial_work
- Network partition handling: check workspace for filesystem-persisted result packet

### Out of Scope

- Full workspace archiving
- Automatic continuation from partial work

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/009-policy-and-enforcement-spec.md`
- `docs/prd/002-data-model.md`

## Implementation Guidance

1. On lease reclaim, check workspace for any result packet file (filesystem fallback from §9.8.2)
2. If valid result found on filesystem, process it normally instead of reclaiming
3. Otherwise, capture workspace state: list of modified files, git diff, any partial output files
4. Store artifact refs in lease record partial_result_artifact_refs
5. When building next TaskPacket for retry, include prior_partial_work referencing these artifacts

## Acceptance Criteria

- [ ] Partial artifacts captured on reclaim when no valid result found
- [ ] Filesystem-persisted results are checked before reclaim
- [ ] Prior partial work included in retry task packets

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Test crash recovery with and without filesystem-persisted results

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep crash-recovery
```

## Risks / Notes

Filesystem state may be inconsistent after a crash. Capture what's available, don't fail on errors.

## Follow-on Tasks

None
