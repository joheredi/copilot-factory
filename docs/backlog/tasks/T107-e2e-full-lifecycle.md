# T107: Integration test: full task lifecycle BACKLOG to DONE

| Field                     | Value                                                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T107                                                                                                                                                                                          |
| **Epic**                  | [E022: Integration Testing & E2E](../epics/E022-integration-testing.md)                                                                                                                       |
| **Type**                  | test                                                                                                                                                                                          |
| **Status**                | pending                                                                                                                                                                                       |
| **Priority**              | P0                                                                                                                                                                                            |
| **Owner**                 | backend-engineer                                                                                                                                                                              |
| **AI Executable**         | Yes                                                                                                                                                                                           |
| **Human Review Required** | Yes                                                                                                                                                                                           |
| **Dependencies**          | [T106](./T106-test-harness.md), [T046](./T046-output-capture-validation.md), [T057](./T057-validation-gates.md), [T061](./T061-review-decision-apply.md), [T064](./T064-rebase-merge-exec.md) |
| **Blocks**                | None                                                                                                                                                                                          |

---

## Description

Build an integration test that drives a task through the complete happy path: BACKLOG → READY → ASSIGNED → IN_DEVELOPMENT → DEV_COMPLETE → IN_REVIEW → APPROVED → QUEUED_FOR_MERGE → MERGING → POST_MERGE_VALIDATION → DONE.

## Goal

Verify that the entire orchestration pipeline works end-to-end. This corresponds to V1 Milestone 1.

## Scope

### In Scope

- Create project, repo, task
- Task becomes READY (no deps)
- Scheduler assigns to pool
- Worker executes and submits valid DevResultPacket
- Review router dispatches reviewers
- Lead reviewer approves
- Merge queue processes and merges
- Post-merge validation passes
- Task reaches DONE
- Audit trail complete

### Out of Scope

- Failure paths (separate tests)
- UI verification

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/003-v1-implementation-plan.md`

## Implementation Guidance

1. Use test harness from T106
2. Configure FakeRunner to return a valid DevResultPacket on first run
3. Configure FakeRunner to return approved ReviewPackets and LeadReviewDecisionPacket
4. Step through each state transition and verify:
5. - Correct state after each transition
6. - Audit event created for each transition
7. - Packets created and stored as artifacts
8. - Lease acquired and released correctly
9. - Merge completes and branch is integrated

## Acceptance Criteria

- [ ] Task completes full lifecycle to DONE
- [ ] Every state transition produces an audit event
- [ ] All packets are schema-valid
- [ ] Artifacts stored correctly
- [ ] No duplicate assignments or race conditions

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run integration test and verify all assertions

### Suggested Validation Commands

```bash
pnpm test --filter @factory/testing -- --grep full-lifecycle
```

## Risks / Notes

This is the most complex test. Debug failures carefully.

## Follow-on Tasks

None
