# T063: Implement merge queue with ordering contract

| Field                     | Value                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **ID**                    | T063                                                                                                               |
| **Epic**                  | [E013: Merge Pipeline](../epics/E013-merge-pipeline.md)                                                            |
| **Type**                  | feature                                                                                                            |
| **Status**                | pending                                                                                                            |
| **Priority**              | P0                                                                                                                 |
| **Owner**                 | backend-engineer                                                                                                   |
| **AI Executable**         | Yes                                                                                                                |
| **Human Review Required** | Yes                                                                                                                |
| **Dependencies**          | [T012](./T012-migration-merge-job.md), [T014](./T014-entity-repositories.md), [T017](./T017-transition-service.md) |
| **Blocks**                | [T064](./T064-rebase-merge-exec.md), [T065](./T065-merge-strategies.md), [T066](./T066-conflict-classification.md) |

---

## Description

Implement the merge queue that accepts approved tasks, maintains ordering per §10.10, and dispatches merge work.

## Goal

Serialize merge operations to prevent integration conflicts.

## Scope

### In Scope

- enqueueForMerge(taskId, approvedCommitSha) — create MergeQueueItem
- Queue ordering: priority > enqueue time > item ID
- dequeueNext(repositoryId) — get next item for processing
- Position recalculation
- Task transition APPROVED → QUEUED_FOR_MERGE

### Out of Scope

- Merge execution (T064)
- Batching (future)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/010-integration-contracts.md`

## Implementation Guidance

1. Create packages/application/src/services/merge-queue.service.ts
2. enqueueForMerge: create MergeQueueItem with status=ENQUEUED, transition task to QUEUED_FOR_MERGE
3. dequeueNext: SELECT from MergeQueueItem WHERE status=ENQUEUED AND repository_id=? ORDER BY priority DESC, enqueued_at ASC, merge_queue_item_id ASC LIMIT 1
4. Claim the item (status -> PREPARING) atomically
5. Recalculate position as display field after enqueue/dequeue

## Acceptance Criteria

- [ ] Items enqueued with correct ordering
- [ ] dequeueNext returns correct next item
- [ ] Atomic claim prevents duplicate merge processing
- [ ] Task transitions to QUEUED_FOR_MERGE

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Tests with multiple items and priority ordering

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep merge-queue
```

## Risks / Notes

Queue ordering must be deterministic. Test tie-breaking carefully.

## Follow-on Tasks

T064, T065, T066
