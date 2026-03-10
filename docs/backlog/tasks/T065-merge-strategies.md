# T065: Implement squash and merge-commit strategies

| Field | Value |
|---|---|
| **ID** | T065 |
| **Epic** | [E013: Merge Pipeline](../epics/E013-merge-pipeline.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P1 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T064](./T064-rebase-merge-exec.md) |
| **Blocks** | None |

---

## Description

Add squash and merge-commit strategies alongside the default rebase-and-merge.

## Goal

Support all three merge strategies specified in the architecture.

## Scope

### In Scope

- Squash merge: squash all commits into one
- Merge commit: create merge commit
- Strategy selection from effective policy
- MergePacket records chosen strategy

### Out of Scope

- Strategy recommendation logic
- Custom merge messages

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/010-integration-contracts.md`

## Implementation Guidance

1. Extend merge-executor with strategy dispatch
2. For squash: git merge --squash, then git commit
3. For merge-commit: git merge --no-ff
4. Strategy selected from policy: task override > repo workflow > system default
5. Record selected strategy in MergePacket.details.merge_strategy

## Acceptance Criteria

- [ ] All three strategies execute correctly
- [ ] Strategy selection follows policy precedence
- [ ] MergePacket reflects chosen strategy

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Tests for each merge strategy

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep merge-strat
```

## Risks / Notes

Squash loses individual commit history. Ensure this is acceptable per policy.

## Follow-on Tasks

None
