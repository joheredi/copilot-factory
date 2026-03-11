# T055: Implement test/lint/build command execution

| Field                     | Value                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------- |
| **ID**                    | T055                                                                               |
| **Epic**                  | [E011: Validation Runner](../epics/E011-validation-runner.md)                      |
| **Type**                  | feature                                                                            |
| **Status**                | done                                                                               |
| **Priority**              | P0                                                                                 |
| **Owner**                 | backend-engineer                                                                   |
| **AI Executable**         | Yes                                                                                |
| **Human Review Required** | Yes                                                                                |
| **Dependencies**          | [T054](./T054-validation-runner-abstraction.md), [T047](./T047-command-wrapper.md) |
| **Blocks**                | [T056](./T056-validation-packet-emission.md)                                       |

---

## Description

Implement the actual command execution for validation checks (test, lint, build, typecheck, security scan) within a workspace, using the policy-aware command wrapper.

## Goal

Execute validation commands and capture their results in a structured format.

## Scope

### In Scope

- Execute validation commands via command wrapper
- Capture exit code, stdout, stderr
- Parse timing information
- Handle command timeout
- Map results to ValidationCheckResult format

### Out of Scope

- Custom validation plugins
- Result interpretation (pass/fail is by exit code)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/009-policy-and-enforcement-spec.md`
- `docs/prd/008-packet-and-schema-spec.md`

## Implementation Guidance

1. Create packages/infrastructure/src/validation/check-executor.ts
2. executeCheck(checkType, command, workspacePath, timeout) -> ValidationCheckResult
3. Run command via command wrapper in the workspace directory
4. Measure execution time
5. Exit code 0 = passed, non-zero = failed
6. Capture stdout/stderr to artifact files
7. Handle timeout (kill process, mark as failed)

## Acceptance Criteria

- [ ] Commands execute in correct workspace directory
- [ ] Exit code correctly maps to pass/fail
- [ ] Timing captured accurately
- [ ] Timeouts handled gracefully
- [ ] Output captured as artifacts

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Tests with real commands (echo, false, sleep) in temp directories

### Suggested Validation Commands

```bash
pnpm test --filter @factory/infrastructure -- --grep check-executor
```

## Risks / Notes

Command execution is inherently risky. Rely on command wrapper for safety.

## Follow-on Tasks

T056
