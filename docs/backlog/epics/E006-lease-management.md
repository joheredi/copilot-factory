# E006: Lease Management & Heartbeats

## Summary

Implement task lease acquisition, heartbeat protocol, graceful completion, stale detection, and crash recovery.

## Why This Epic Exists

Leases enforce exclusive task ownership and prevent duplicate work. Heartbeats enable failure detection and recovery.

## Goals

- Exclusive lease acquisition per task
- Push-based heartbeat protocol
- Graceful completion protocol
- Stale lease detection and reclaim
- Crash recovery with partial artifacts

## Scope

### In Scope

- Lease lifecycle from docs/prd/002-data-model.md §2.8
- Heartbeat interval and staleness thresholds
- Terminal heartbeat handling
- Partial work snapshot

### Out of Scope

- Worker process management (E009)
- Bidirectional heartbeats (future)

## Dependencies

**Depends on:** E002, E003, E005

**Enables:** E009

## Risks / Notes

Race conditions between heartbeat timeout and result submission. Grace period logic is subtle.

## Tasks

| ID                                                | Title                                                  | Priority | Status  |
| ------------------------------------------------- | ------------------------------------------------------ | -------- | ------- |
| [T030](../tasks/T030-lease-acquisition.md)        | Implement lease acquisition with exclusivity           | P0       | pending |
| [T031](../tasks/T031-heartbeat-staleness.md)      | Implement heartbeat receive and staleness detection    | P0       | pending |
| [T032](../tasks/T032-graceful-completion.md)      | Implement graceful completion protocol                 | P0       | pending |
| [T033](../tasks/T033-lease-reclaim.md)            | Implement stale lease reclaim and retry/escalation     | P0       | pending |
| [T034](../tasks/T034-crash-recovery-artifacts.md) | Implement crash recovery with partial artifact capture | P1       | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

Leases enforce exclusivity. Heartbeat timeouts correctly reclaim work. Grace period prevents result loss.
