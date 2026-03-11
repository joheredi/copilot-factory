# T108: Integration test: review rejection and rework loop

| Field                     | Value                                                                   |
| ------------------------- | ----------------------------------------------------------------------- |
| **ID**                    | T108                                                                    |
| **Epic**                  | [E022: Integration Testing & E2E](../epics/E022-integration-testing.md) |
| **Type**                  | test                                                                    |
| **Status**                | done                                                                    |
| **Priority**              | P0                                                                      |
| **Owner**                 | backend-engineer                                                        |
| **AI Executable**         | Yes                                                                     |
| **Human Review Required** | Yes                                                                     |
| **Dependencies**          | [T106](./T106-test-harness.md), [T062](./T062-rework-loop.md)           |
| **Blocks**                | None                                                                    |

---

## Description

Test the review rejection path: developer submits, reviewer rejects with blocking issues, task re-enters ASSIGNED with rejection context, developer fixes, reviewer approves.

## Goal

Verify the rework loop works correctly with rejection context propagation.

## Scope

### In Scope

- First dev attempt: submit valid but flawed code
- Review: reject with blocking issues
- Rework: verify rejection context in new TaskPacket
- Second dev attempt: fix issues
- Review: approve
- Verify review_round_count incremented

### Out of Scope

- Multiple rejection rounds
- Escalation from max rounds

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/003-v1-implementation-plan.md`

## Implementation Guidance

1. Configure FakeRunner to return different results per attempt
2. First run: success but reviewer finds blocking issue
3. Verify CHANGES_REQUESTED transition and ReviewCycle closure
4. Second run: verify TaskPacket includes rejection_context
5. Second review: approve
6. Verify review_round_count = 1 after rejection

## Acceptance Criteria

- [x] Rejection transitions task to CHANGES_REQUESTED
- [x] Rework TaskPacket includes rejection context with blocking issues
- [x] Second attempt can succeed
- [x] review_round_count tracks correctly

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run integration test

### Suggested Validation Commands

```bash
pnpm test --filter @factory/testing -- --grep review-rework
```

## Risks / Notes

Rejection context must be complete and accurate.

## Follow-on Tasks

None
