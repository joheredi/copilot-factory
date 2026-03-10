# T098: Build merge queue view

| Field | Value |
|---|---|
| **ID** | T098 |
| **Epic** | [E020: Web UI Feature Views](../epics/E020-web-ui-features.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P2 |
| **Owner** | frontend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T090](./T090-api-client-tanstack.md), [T092](./T092-app-shell.md) |
| **Blocks** | [T105](./T105-ui-operator-pool-merge.md) |

---

## Description

Build the merge queue view showing queued items, their position, and merge execution status.

## Goal

Enable operators to monitor the merge pipeline.

## Scope

### In Scope

- Merge queue table: position, task, status, enqueued time
- Active merge progress
- Merge result display (success, conflict, failure)
- Queue pause indicator for critical failures

### Out of Scope

- Merge ordering controls (T105)
- Merge history analytics

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/001-architecture.md`

## Implementation Guidance

1. Create apps/web-ui/src/features/merge-queue/MergeQueuePage.tsx
2. Ordered table of merge queue items with position, task link, status
3. Active item highlighted with progress indicator
4. Queue pause state shown prominently with reason
5. Click-through to merge details: MergePacket, validation results

## Acceptance Criteria

- [ ] Queue items in correct order
- [ ] Active merge visible
- [ ] Queue pause state displayed
- [ ] Merge results accessible

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

View merge queue during active merge processing

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm dev
```

## Risks / Notes

Queue updates must be real-time. Ensure WebSocket events propagate.

## Follow-on Tasks

T105
