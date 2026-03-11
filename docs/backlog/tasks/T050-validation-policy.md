# T050: Implement validation policy with profile selection

| Field                     | Value                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------- |
| **ID**                    | T050                                                                               |
| **Epic**                  | [E010: Policy & Configuration](../epics/E010-policy-configuration.md)              |
| **Type**                  | feature                                                                            |
| **Status**                | pending                                                                            |
| **Priority**              | P0                                                                                 |
| **Owner**                 | backend-engineer                                                                   |
| **AI Executable**         | Yes                                                                                |
| **Human Review Required** | Yes                                                                                |
| **Dependencies**          | [T013](./T013-migration-audit-policy.md), [T014](./T014-entity-repositories.md)    |
| **Blocks**                | [T053](./T053-policy-snapshot.md), [T054](./T054-validation-runner-abstraction.md) |

---

## Description

Implement validation policy and the profile selection algorithm from §9.5.

## Goal

Determine which validation checks are required at each stage transition.

## Scope

### In Scope

- ValidationPolicy type with profiles map
- Profile: required_checks, optional_checks, commands
- Profile selection algorithm (task override > workflow template > task type > system default)
- Default profiles: default-dev and merge-gate
- Missing profile error handling

### Out of Scope

- Validation execution (T055)
- Custom profiles via UI

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. Create packages/domain/src/policies/validation-policy.ts
2. selectProfile(taskPacket, workflowTemplate, repoConfig, stage): follow §9.5.3 precedence
3. Default 'default-dev': required=[test, lint], optional=[build]
4. Default 'merge-gate': required=[test, build], optional=[lint]
5. If resolved profile name not in policy, throw MissingValidationProfileError and emit audit event

## Acceptance Criteria

- [ ] Profile selection follows §9.5.3 precedence exactly
- [ ] Default profiles match spec
- [ ] Missing profile produces clear error
- [ ] All profile fields accessible

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Tests for profile selection with various input combinations

### Suggested Validation Commands

```bash
pnpm test --filter @factory/domain -- --grep validation-policy
```

## Risks / Notes

Profile selection precedence must be exact. Test all paths.

## Follow-on Tasks

T053, T054
