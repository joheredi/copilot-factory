# T031: Implement heartbeat receive and staleness detection

| Field | Value |
|---|---|
| **ID** | T031 |
| **Epic** | [E006: Lease Management & Heartbeats](../epics/E006-lease-management.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T030](./T030-lease-acquisition.md) |
| **Blocks** | [T033](./T033-lease-reclaim.md) |

---

## Description

Implement heartbeat reception from workers and staleness detection based on missed heartbeat thresholds.

## Goal

Enable the control plane to detect unresponsive workers and trigger recovery.

## Scope

### In Scope

- receiveHeartbeat(leaseId, workerMetadata) endpoint
- Update lease heartbeat_at timestamp
- Staleness calculation: missed > threshold + grace
- detectStaleLeases() query for background reconciliation

### Out of Scope

- Worker-side heartbeat sending (T044)
- Reclaim logic (T033)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/009-policy-and-enforcement-spec.md`
- `docs/prd/002-data-model.md`

## Implementation Guidance

1. receiveHeartbeat: verify lease is active, update heartbeat_at and lease status if needed
2. detectStaleLeases: query active leases WHERE heartbeat_at < now - (heartbeat_interval * missed_threshold + grace_period)
3. Also detect leases past absolute TTL (expires_at < now)
4. Use configurable thresholds from lease policy defaults (30s interval, 2 missed, 15s grace)

## Acceptance Criteria

- [ ] Heartbeats update lease timestamp
- [ ] Stale leases detected after missed threshold + grace
- [ ] TTL expiry detected regardless of heartbeat status
- [ ] Invalid heartbeats (wrong lease, completed lease) are rejected

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Test staleness detection with time manipulation

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep heartbeat
```

## Risks / Notes

Time-based tests can be flaky. Use a fake clock for deterministic testing.

## Follow-on Tasks

T033
