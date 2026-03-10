# T032: Implement graceful completion protocol

| Field | Value |
|---|---|
| **ID** | T032 |
| **Epic** | [E006: Lease Management & Heartbeats](../epics/E006-lease-management.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T031](./T031-heartbeat-staleness.md) |
| **Blocks** | [T046](./T046-output-capture-validation.md) |

---

## Description

Implement the terminal heartbeat protocol: workers send completing:true before emitting results, and the lease manager extends the grace window.

## Goal

Prevent race conditions where a result is submitted just as a lease is being reclaimed.

## Scope

### In Scope

- Terminal heartbeat handling (completing: true)
- Grace period extension on terminal heartbeat
- Result acceptance within grace period after stale marking
- Lease status transition to COMPLETING

### Out of Scope

- Result packet validation (T046)
- Worker-side implementation (T044)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/009-policy-and-enforcement-spec.md`
- `docs/prd/002-data-model.md`

## Implementation Guidance

1. On receiving heartbeat with completing:true, set lease status to COMPLETING
2. Extend stale detection window by grace_period_seconds
3. In result submission handler: if lease is TIMED_OUT but result arrives within grace_period, accept it
4. Verify IDs match and packet is schema-valid before accepting late results
5. Write test: worker sends terminal heartbeat, lease manager extends window, result accepted

## Acceptance Criteria

- [ ] Terminal heartbeat transitions lease to COMPLETING
- [ ] Grace period extended after terminal heartbeat
- [ ] Results within grace period are accepted even after stale marking
- [ ] Late results past grace period are rejected

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Race condition test with terminal heartbeat and result submission

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep graceful
```

## Risks / Notes

Grace period logic is the most subtle part of the lease protocol. Test thoroughly.

## Follow-on Tasks

T046
