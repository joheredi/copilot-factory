# T030: Implement lease acquisition with exclusivity

| Field | Value |
|---|---|
| **ID** | T030 |
| **Epic** | [E006: Lease Management & Heartbeats](../epics/E006-lease-management.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T011](./T011-migration-lease-review.md), [T014](./T014-entity-repositories.md), [T017](./T017-transition-service.md) |
| **Blocks** | [T031](./T031-heartbeat-staleness.md), [T032](./T032-graceful-completion.md), [T033](./T033-lease-reclaim.md), [T044](./T044-worker-supervisor.md) |

---

## Description

Implement lease acquisition that enforces the one-active-lease-per-task invariant. Use atomic DB operations to prevent duplicate leases.

## Goal

Guarantee that exactly one worker can be assigned to a task at any time.

## Scope

### In Scope

- acquireLease(taskId, workerId, poolId, ttlSeconds) -> Lease
- Check no active lease exists for the task
- Set lease expiry from TTL
- Update Task.current_lease_id
- Reject if task not in READY state

### Out of Scope

- Heartbeat processing (T031)
- Lease reclaim (T033)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`
- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. Create packages/application/src/services/lease.service.ts
2. acquireLease must be atomic: check no active lease + create lease + update task in one transaction
3. Active lease = status in (LEASED, STARTING, RUNNING, HEARTBEATING, COMPLETING)
4. Set expires_at = now + lease_ttl_seconds from lease policy
5. Return the created lease or throw ExclusivityViolationError
6. Write concurrent acquisition tests

## Acceptance Criteria

- [ ] Only one active lease per task at any time
- [ ] Concurrent acquisition attempts: exactly one succeeds
- [ ] Lease has correct TTL and expiry
- [ ] Task.current_lease_id updated atomically

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Concurrent lease acquisition tests

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep lease
```

## Risks / Notes

Critical invariant. Must be thoroughly tested with concurrent scenarios.

## Follow-on Tasks

T031, T032, T033, T044
