# T033: Implement stale lease reclaim and retry/escalation

| Field                     | Value                                                                            |
| ------------------------- | -------------------------------------------------------------------------------- |
| **ID**                    | T033                                                                             |
| **Epic**                  | [E006: Lease Management & Heartbeats](../epics/E006-lease-management.md)         |
| **Type**                  | feature                                                                          |
| **Status**                | pending                                                                          |
| **Priority**              | P0                                                                               |
| **Owner**                 | backend-engineer                                                                 |
| **AI Executable**         | Yes                                                                              |
| **Human Review Required** | Yes                                                                              |
| **Dependencies**          | [T031](./T031-heartbeat-staleness.md), [T051](./T051-retry-escalation-policy.md) |
| **Blocks**                | [T034](./T034-crash-recovery-artifacts.md)                                       |

---

## Description

Implement the lease reclaim flow: when a lease is detected as stale, reclaim the workspace, snapshot partial work, and apply retry or escalation policy.

## Goal

Recover from worker failures while preserving partial work for context.

## Scope

### In Scope

- reclaimLease(leaseId, reason) operation
- Lease status -> TIMED_OUT or CRASHED
- Task transition based on retry eligibility (FAILED or back to READY)
- Retry count increment
- Escalation when max retries exceeded
- Audit event for reclaim

### Out of Scope

- Partial artifact capture (T034)
- Worker process killing (T044)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`
- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. reclaimLease: set lease status to TIMED_OUT/CRASHED with reclaim_reason
2. Check retry policy: if retry_count < max_attempts, transition task to READY for re-scheduling
3. If retry_count >= max_attempts, check escalation policy: FAILED or ESCALATED
4. Increment task.retry_count
5. Create audit event with reclaim details
6. Create a reconciliation job to snapshot workspace artifacts

## Acceptance Criteria

- [ ] Stale leases are reclaimed with correct terminal state
- [ ] Retry-eligible tasks re-enter READY
- [ ] Retry-exhausted tasks move to FAILED or ESCALATED per policy
- [ ] retry_count incremented correctly
- [ ] Audit event records reclaim

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Test reclaim with various retry/escalation combinations

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep reclaim
```

## Risks / Notes

Must handle the edge case where a result arrives during reclaim processing.

## Follow-on Tasks

T034
