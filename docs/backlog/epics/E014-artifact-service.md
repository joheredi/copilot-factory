# E014: Artifact Service

## Summary

Implement filesystem-based artifact storage, reference resolution, summarization packet generation, and partial work snapshots.

## Why This Epic Exists

Artifacts are the audit trail and context transfer mechanism. Every packet, log, and output must be persisted and retrievable.

## Goals

- Structured filesystem storage layout
- Artifact reference resolution
- Summarization for retry context
- Partial work snapshot on crash

## Scope

### In Scope

- Storage layout from docs/prd/007-technical-architecture.md §7.11
- Packet storage and retrieval
- Log and output storage

### Out of Scope

- Object storage backend (future)
- Content-addressable storage

## Dependencies

**Depends on:** E002, E004

**Enables:** E009, E017

## Risks / Notes

Filesystem operations are not transactional. Must handle concurrent writes carefully.

## Tasks

| ID | Title | Priority | Status |
|---|---|---|---|
| [T069](../tasks/T069-artifact-storage.md) | Implement filesystem artifact storage | P0 | pending |
| [T070](../tasks/T070-artifact-retrieval.md) | Implement artifact reference resolution and retrieval | P0 | pending |
| [T071](../tasks/T071-retry-summarization.md) | Implement summarization packet generation for retries | P1 | pending |
| [T072](../tasks/T072-partial-work-snapshot.md) | Implement partial work snapshot on lease reclaim | P1 | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

Artifacts stored in correct directory structure. References resolve correctly. Summaries generated for retries.
