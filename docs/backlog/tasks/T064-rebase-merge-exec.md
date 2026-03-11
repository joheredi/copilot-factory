# T064: Implement rebase-and-merge execution

| Field                     | Value                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T064                                                                                                                |
| **Epic**                  | [E013: Merge Pipeline](../epics/E013-merge-pipeline.md)                                                             |
| **Type**                  | feature                                                                                                             |
| **Status**                | pending                                                                                                             |
| **Priority**              | P0                                                                                                                  |
| **Owner**                 | backend-engineer                                                                                                    |
| **AI Executable**         | Yes                                                                                                                 |
| **Human Review Required** | Yes                                                                                                                 |
| **Dependencies**          | [T023](./T023-schemas-merge-validation.md), [T063](./T063-merge-queue.md), [T039](./T039-worktree-creation.md)      |
| **Blocks**                | [T065](./T065-merge-strategies.md), [T066](./T066-conflict-classification.md), [T067](./T067-post-merge-failure.md) |

---

## Description

Implement the rebase-and-merge strategy: rebase the task branch on latest main, run merge-gate validation, and merge if successful.

## Goal

Execute the default merge strategy reliably and capture results.

## Scope

### In Scope

- git rebase on target branch
- Run merge-gate validation profile
- git merge (fast-forward after rebase)
- MergePacket emission
- Handle rebase conflicts (delegate to classifier T066)
- Task transition QUEUED_FOR_MERGE → MERGING → POST_MERGE_VALIDATION

### Out of Scope

- Squash strategy (T065)
- Merge assist AI
- Post-merge failure handling (T067)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/010-integration-contracts.md`

## Implementation Guidance

1. Create packages/application/src/services/merge-executor.service.ts
2. executeMerge(mergeQueueItem, policySnapshot):
3. 1. Transition to MERGING
4. 2. git fetch origin, git rebase origin/{target}
5. 3. If rebase succeeds: run merge-gate validation
6. 4. If validation passes: git push, transition to POST_MERGE_VALIDATION
7. 5. If rebase fails: delegate to conflict classifier
8. 6. Emit MergePacket with all details
9. Record merge_strategy, rebase_performed, merged_commit_sha

## Acceptance Criteria

- [ ] Rebase executes on latest target branch
- [ ] Validation runs after successful rebase
- [ ] MergePacket emitted with correct details
- [ ] Rebase failures handled gracefully

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Integration test with clean and conflicting merges

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep merge-exec
```

## Risks / Notes

Git operations can fail in unexpected ways. Handle all error cases.

## Follow-on Tasks

T065, T066, T067
