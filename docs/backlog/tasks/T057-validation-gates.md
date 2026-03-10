# T057: Implement validation gate checking for state transitions

| Field | Value |
|---|---|
| **ID** | T057 |
| **Epic** | [E011: Validation Runner](../epics/E011-validation-runner.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T054](./T054-validation-runner-abstraction.md), [T056](./T056-validation-packet-emission.md), [T017](./T017-transition-service.md) |
| **Blocks** | [T107](./T107-e2e-full-lifecycle.md) |

---

## Description

Integrate validation gates into the state transition service. Block transitions when required validation checks have not passed.

## Goal

Enforce quality gates at every stage transition that requires validation.

## Scope

### In Scope

- IN_DEVELOPMENT → DEV_COMPLETE requires default-dev profile checks pass
- MERGING → POST_MERGE_VALIDATION triggers merge-gate profile
- POST_MERGE_VALIDATION → DONE requires merge-gate checks pass
- Failed required validations block transition with validation_result_packet

### Out of Scope

- APPROVED → QUEUED_FOR_MERGE does NOT re-validate (per spec)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`
- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. Add gate checks to TransitionService for gated transitions
2. Before committing IN_DEV→DEV_COMPLETE: verify latest validation run for default-dev profile has status=success
3. For POST_MERGE_VALIDATION→DONE: verify merge-gate validation has status=success
4. If no validation run exists or latest is failed, reject transition
5. Emit validation_result_packet on failure

## Acceptance Criteria

- [ ] Gated transitions blocked without passing validation
- [ ] Correct profile required at each gate
- [ ] APPROVED→QUEUED_FOR_MERGE does not re-validate
- [ ] Clear error when validation missing or failed

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Tests for each gated transition with passing and failing validations

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep validation-gate
```

## Risks / Notes

Must not accidentally block non-gated transitions.

## Follow-on Tasks

T107
