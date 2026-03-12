# T109: Integration test: merge conflict and failure paths

| Field                     | Value                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T109                                                                                                            |
| **Epic**                  | [E022: Integration Testing & E2E](../epics/E022-integration-testing.md)                                         |
| **Type**                  | test                                                                                                            |
| **Status**                | done                                                                                                            |
| **Priority**              | P1                                                                                                              |
| **Owner**                 | backend-engineer                                                                                                |
| **AI Executable**         | Yes                                                                                                             |
| **Human Review Required** | Yes                                                                                                             |
| **Dependencies**          | [T106](./T106-test-harness.md), [T066](./T066-conflict-classification.md), [T067](./T067-post-merge-failure.md) |
| **Blocks**                | None                                                                                                            |

---

## Description

Test merge failure scenarios: reworkable conflict (→ CHANGES_REQUESTED), non-reworkable conflict (→ FAILED), and post-merge validation failure.

## Goal

Verify merge failure handling per the conflict classification and post-merge failure policies.

## Scope

### In Scope

- Reworkable conflict: few files, no protected paths → CHANGES_REQUESTED
- Non-reworkable conflict: many files or protected paths → FAILED
- Post-merge validation failure: severity classification and response
- Revert task generation for critical failures

### Out of Scope

- Merge assist AI agent
- Actual git conflicts (use fake workspace)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/010-integration-contracts.md`
- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. Configure FakeWorkspace to simulate merge conflicts
2. Test 1: reworkable conflict (2 files, no protected) → verify CHANGES_REQUESTED
3. Test 2: non-reworkable conflict (6 files) → verify FAILED
4. Test 3: merge succeeds but post-merge validation fails (high severity) → verify failure handling
5. Test 4: critical post-merge failure → verify revert task created and queue paused

## Acceptance Criteria

- [ ] Conflict classification matches thresholds
- [ ] State transitions correct for each scenario
- [ ] Revert tasks created for critical failures
- [ ] Queue paused on critical

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run integration tests for each merge failure scenario

### Suggested Validation Commands

```bash
pnpm test --filter @factory/testing -- --grep merge-failure
```

## Risks / Notes

Merge failure simulation must be realistic enough to exercise classification logic.

## Follow-on Tasks

None
