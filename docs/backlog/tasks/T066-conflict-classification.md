# T066: Implement merge conflict classification

| Field | Value |
|---|---|
| **ID** | T066 |
| **Epic** | [E013: Merge Pipeline](../epics/E013-merge-pipeline.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T064](./T064-rebase-merge-exec.md) |
| **Blocks** | [T067](./T067-post-merge-failure.md) |

---

## Description

Implement the conflict classification logic from §10.10.2 that determines whether a merge conflict is reworkable or non-reworkable.

## Goal

Automatically classify merge failures to determine the correct recovery action.

## Scope

### In Scope

- Count conflicting files
- Check conflicts against protected_paths
- Classification: reworkable (fewer than max files, no protected paths) vs non-reworkable
- Reworkable → CHANGES_REQUESTED, non-reworkable → FAILED
- Configurable thresholds from merge_policy

### Out of Scope

- Merge assist AI agent
- Automatic conflict resolution

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/010-integration-contracts.md`
- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. Create packages/application/src/services/conflict-classifier.service.ts
2. classifyConflict(conflictFiles, mergePolicy) -> {classification, reason}
3. If conflictFiles.length >= max_conflict_files: non-reworkable
4. If any file matches protected_paths patterns: non-reworkable
5. Otherwise: reworkable
6. Default thresholds: max_conflict_files=5, protected_paths=['.github/', 'package.json', 'pnpm-lock.yaml']

## Acceptance Criteria

- [ ] Conflict count threshold enforced
- [ ] Protected paths detected correctly
- [ ] Classification determines correct task transition
- [ ] Thresholds configurable via policy

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Tests with various conflict scenarios

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep conflict-class
```

## Risks / Notes

Protected path matching must use correct glob/prefix patterns.

## Follow-on Tasks

T067
