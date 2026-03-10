# T038: Implement dependency reconciliation loop

| Field | Value |
|---|---|
| **ID** | T038 |
| **Epic** | [E007: Dependency & Readiness Engine](../epics/E007-dependency-readiness.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P1 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T037](./T037-reverse-dep-recalc.md), [T029](./T029-reconciliation-sweep.md) |
| **Blocks** | None |

---

## Description

Add dependency readiness recalculation to the reconciliation sweep to catch any missed recalculations.

## Goal

Ensure no task stays incorrectly BLOCKED due to a missed event.

## Scope

### In Scope

- Periodic scan of all BLOCKED tasks
- Recalculate readiness for each
- Transition BLOCKED->READY if dependencies now satisfied
- Include in reconciliation sweep job

### Out of Scope

- Performance optimization for large task sets

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`

## Implementation Guidance

1. Add to the reconciliation sweep (T029): query all tasks in BLOCKED state
2. For each, run computeReadiness() and transition if needed
3. This is a safety net — most recalculations happen via events (T037)
4. Log any tasks that were incorrectly BLOCKED (indicates a missed event)

## Acceptance Criteria

- [ ] Reconciliation catches incorrectly BLOCKED tasks
- [ ] Tasks are transitioned to READY when eligible
- [ ] Reconciliation is idempotent and safe to run frequently

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Create a BLOCKED task with satisfied deps, verify reconciliation unblocks it

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep reconcil
```

## Risks / Notes

Full scan of BLOCKED tasks could be slow with many tasks. Acceptable for V1.

## Follow-on Tasks

None
