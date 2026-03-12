# T111: Integration test: escalation triggers and resolution

| Field                     | Value                                                                   |
| ------------------------- | ----------------------------------------------------------------------- |
| **ID**                    | T111                                                                    |
| **Epic**                  | [E022: Integration Testing & E2E](../epics/E022-integration-testing.md) |
| **Type**                  | test                                                                    |
| **Status**                | done                                                                    |
| **Priority**              | P1                                                                      |
| **Owner**                 | backend-engineer                                                        |
| **AI Executable**         | Yes                                                                     |
| **Human Review Required** | Yes                                                                     |
| **Dependencies**          | [T106](./T106-test-harness.md), [T103](./T103-escalation-resolution.md) |
| **Blocks**                | None                                                                    |

---

## Description

Test escalation trigger scenarios and operator resolution paths.

## Goal

Verify that escalation works correctly for all trigger conditions and resolution types.

## Scope

### In Scope

- Trigger: max retry exceeded → ESCALATED
- Trigger: max review rounds exceeded → ESCALATED
- Trigger: policy violation → ESCALATED
- Resolution: retry → ASSIGNED
- Resolution: cancel → CANCELLED
- Resolution: mark done → DONE

### Out of Scope

- Budget-based escalation
- Time-based escalation

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`
- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. Test 1: exhaust retries → verify ESCALATED with correct trigger
2. Test 2: exceed review rounds → verify ESCALATED
3. Test 3: operator resolves with retry → verify ASSIGNED transition
4. Test 4: operator resolves with cancel → verify CANCELLED
5. Test 5: operator resolves with mark_done → verify DONE
6. All transitions should have audit events with escalation context

## Acceptance Criteria

- [ ] All tested trigger conditions produce ESCALATED
- [ ] All resolution types work correctly
- [ ] Audit events capture escalation details
- [ ] State machine invariants maintained

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run integration tests for escalation scenarios

### Suggested Validation Commands

```bash
pnpm test --filter @factory/testing -- --grep escalation
```

## Risks / Notes

Escalation is a safety mechanism. Must work reliably.

## Follow-on Tasks

None
