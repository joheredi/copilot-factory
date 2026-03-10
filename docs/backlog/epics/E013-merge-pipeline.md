# E013: Merge Pipeline

## Summary

Build the merge queue, merge execution (rebase/squash/merge-commit), conflict classification, post-merge validation, and failure handling.

## Why This Epic Exists

The merge pipeline is the final integration step. It must be reliable, serialized, and recover gracefully from failures.

## Goals

- Merge queue with ordering contract
- Rebase-and-merge execution
- Additional merge strategies
- Conflict classification (reworkable vs non-reworkable)
- Post-merge validation and failure policy
- Follow-up task generation

## Scope

### In Scope

- Merge queue ordering from docs/prd/010-integration-contracts.md §10.10
- Merge strategies from §10.10.1
- Conflict classification from §10.10.2
- Post-merge failure policy from docs/prd/009-policy-and-enforcement-spec.md §9.11

### Out of Scope

- Merge assist AI agent (optional V1)
- Batched merges (future)

## Dependencies

**Depends on:** E003, E005, E008, E011

**Enables:** E022

## Risks / Notes

Git merge operations are inherently complex. Post-merge validation failures require careful handling.

## Tasks

| ID | Title | Priority | Status |
|---|---|---|---|
| [T063](../tasks/T063-merge-queue.md) | Implement merge queue with ordering contract | P0 | pending |
| [T064](../tasks/T064-rebase-merge-exec.md) | Implement rebase-and-merge execution | P0 | pending |
| [T065](../tasks/T065-merge-strategies.md) | Implement squash and merge-commit strategies | P1 | pending |
| [T066](../tasks/T066-conflict-classification.md) | Implement merge conflict classification | P0 | pending |
| [T067](../tasks/T067-post-merge-failure.md) | Implement post-merge validation and failure policy | P0 | pending |
| [T068](../tasks/T068-followup-task-gen.md) | Implement follow-up task generation | P1 | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

Merge queue processes items in correct order. Merges execute with chosen strategy. Conflicts classified correctly. Post-merge failures handled per policy.
