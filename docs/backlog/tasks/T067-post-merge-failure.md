# T067: Implement post-merge validation and failure policy

| Field                     | Value                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T067                                                                                                                         |
| **Epic**                  | [E013: Merge Pipeline](../epics/E013-merge-pipeline.md)                                                                      |
| **Type**                  | feature                                                                                                                      |
| **Status**                | pending                                                                                                                      |
| **Priority**              | P0                                                                                                                           |
| **Owner**                 | backend-engineer                                                                                                             |
| **AI Executable**         | Yes                                                                                                                          |
| **Human Review Required** | Yes                                                                                                                          |
| **Dependencies**          | [T056](./T056-validation-packet-emission.md), [T064](./T064-rebase-merge-exec.md), [T066](./T066-conflict-classification.md) |
| **Blocks**                | [T068](./T068-followup-task-gen.md)                                                                                          |

---

## Description

Implement post-merge validation triggering and the severity-based failure policy from §9.11 for handling post-merge failures.

## Goal

Detect and respond to regressions after merge.

## Scope

### In Scope

- Trigger merge-gate validation after successful merge
- POST_MERGE_VALIDATION → DONE on success
- Failure severity classification (critical/high/low)
- Response by severity: revert task, analysis agent, diagnostic task
- Merge queue pause on critical failures
- Default post-merge failure policy from §9.11.4

### Out of Scope

- Post-merge analysis AI agent (optional)
- Automatic revert execution

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. After merge completes: transition to POST_MERGE_VALIDATION, run merge-gate validation
2. If validation passes: transition to DONE
3. If validation fails: classify severity per §9.11.1
4. Critical: generate revert task, pause merge queue for repo, alert operator
5. High: if analysis agent enabled create analysis job, else generate revert task and alert
6. Low: create diagnostic follow-up task, continue queue
7. Implement queue pause/resume for critical failures

## Acceptance Criteria

- [ ] Post-merge validation runs after merge
- [ ] Success → DONE transition
- [ ] Failure classified by severity
- [ ] Correct response per severity level
- [ ] Merge queue pauses on critical
- [ ] Revert tasks generated with correct scope

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Tests for each severity level and response

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep post-merge
```

## Risks / Notes

Post-merge failures are high-impact. Response must be correct and timely.

## Follow-on Tasks

T068
