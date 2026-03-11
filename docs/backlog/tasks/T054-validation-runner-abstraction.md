# T054: Implement validation runner abstraction

| Field                     | Value                                                                         |
| ------------------------- | ----------------------------------------------------------------------------- |
| **ID**                    | T054                                                                          |
| **Epic**                  | [E011: Validation Runner](../epics/E011-validation-runner.md)                 |
| **Type**                  | feature                                                                       |
| **Status**                | pending                                                                       |
| **Priority**              | P0                                                                            |
| **Owner**                 | backend-engineer                                                              |
| **AI Executable**         | Yes                                                                           |
| **Human Review Required** | Yes                                                                           |
| **Dependencies**          | [T050](./T050-validation-policy.md)                                           |
| **Blocks**                | [T055](./T055-validation-command-exec.md), [T057](./T057-validation-gates.md) |

---

## Description

Create the validation runner abstraction that manages validation profiles, selects checks, and orchestrates their execution.

## Goal

Provide a single entry point for running validation checks against any validation profile.

## Scope

### In Scope

- ValidationRunner service
- Profile-based check selection (required vs optional)
- Sequential check execution
- Aggregate result computation
- Skipped check handling per fail_on_skipped_required_check

### Out of Scope

- Actual command execution (T055)
- Parallel check execution

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. Create packages/application/src/services/validation-runner.service.ts
2. runValidation(taskId, profileName, policySnapshot, workspacePath) -> ValidationResult
3. Load profile from policy snapshot
4. Execute each required check, then optional checks
5. If a required check fails, record failure but continue remaining checks
6. Aggregate: overall status is failed if any required check failed
7. Return structured result with per-check outcomes

## Acceptance Criteria

- [ ] Validation runs all checks in profile
- [ ] Required check failure makes overall result fail
- [ ] Optional check failure doesn't fail overall
- [ ] Skipped required checks handled per policy

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Tests with mock check executors

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep validation-runner
```

## Risks / Notes

Check execution order may matter for some repos. Execute sequentially for V1.

## Follow-on Tasks

T055, T057
