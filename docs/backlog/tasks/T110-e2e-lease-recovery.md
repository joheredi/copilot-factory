# T110: Integration test: lease timeout and crash recovery

| Field | Value |
|---|---|
| **ID** | T110 |
| **Epic** | [E022: Integration Testing & E2E](../epics/E022-integration-testing.md) |
| **Type** | test |
| **Status** | pending |
| **Priority** | P1 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T106](./T106-test-harness.md), [T033](./T033-lease-reclaim.md), [T034](./T034-crash-recovery-artifacts.md) |
| **Blocks** | None |

---

## Description

Test worker failure scenarios: heartbeat timeout, process crash, and graceful completion edge cases.

## Goal

Verify that lease management correctly recovers from worker failures.

## Scope

### In Scope

- Heartbeat timeout: worker stops sending heartbeats → lease reclaim → retry
- Process crash: worker exits non-zero → lease status CRASHED → retry or escalate
- Grace period: result arrives just after timeout → accepted
- Retry exhaustion: max retries exceeded → ESCALATED

### Out of Scope

- Actual process killing
- Network partition simulation

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`
- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. Use FakeClock to advance time past heartbeat thresholds
2. Test 1: advance clock past heartbeat timeout, verify lease reclaimed, task re-enters READY
3. Test 2: simulate crash (FakeRunner returns crash), verify CRASHED state, retry scheduled
4. Test 3: advance clock past timeout, then submit result within grace period, verify accepted
5. Test 4: exhaust retries (retry_count >= max_attempts), verify ESCALATED

## Acceptance Criteria

- [ ] Heartbeat timeout correctly detected
- [ ] Crash recovery captures partial work
- [ ] Grace period acceptance works
- [ ] Retry exhaustion triggers escalation

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run integration tests

### Suggested Validation Commands

```bash
pnpm test --filter @factory/testing -- --grep lease-recovery
```

## Risks / Notes

Time-based tests are inherently tricky. Ensure FakeClock is used consistently.

## Follow-on Tasks

None
