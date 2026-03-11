# T048: Implement command policy model and enforcement

| Field                     | Value                                                                           |
| ------------------------- | ------------------------------------------------------------------------------- |
| **ID**                    | T048                                                                            |
| **Epic**                  | [E010: Policy & Configuration](../epics/E010-policy-configuration.md)           |
| **Type**                  | feature                                                                         |
| **Status**                | done                                                                            |
| **Priority**              | P0                                                                              |
| **Owner**                 | backend-engineer                                                                |
| **AI Executable**         | Yes                                                                             |
| **Human Review Required** | Yes                                                                             |
| **Dependencies**          | [T013](./T013-migration-audit-policy.md), [T014](./T014-entity-repositories.md) |
| **Blocks**                | [T047](./T047-command-wrapper.md), [T053](./T053-policy-snapshot.md)            |

---

## Description

Define the command policy data model and enforcement logic from docs/prd/009-policy-and-enforcement-spec.md §9.3.

## Goal

Establish command execution governance that workers must respect.

## Scope

### In Scope

- CommandPolicy type with mode, allowed_commands, denied_patterns, forbidden_arg_patterns
- Policy loading from DB/config
- Policy resolution for a given run
- Default V1 command policy with reasonable allowlist

### Out of Scope

- Command wrapper implementation (T047, depends on this)
- Network policy

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. Create packages/domain/src/policies/command-policy.ts with the type definition matching §9.3.2
2. Create packages/config/src/defaults/command-policy.ts with default V1 policy
3. Default allowlist: pnpm (install/test/lint/build), git (status/diff/show/add/commit/checkout/branch)
4. Default denied: rm -rf /, curl|sh, sudo, ssh
5. Create resolution function that merges defaults with overrides

## Acceptance Criteria

- [ ] Command policy type matches spec §9.3.2
- [ ] Default policy provides reasonable V1 allowlist
- [ ] Policy can be loaded and resolved

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Unit tests for policy type and resolution

### Suggested Validation Commands

```bash
pnpm test --filter @factory/domain -- --grep command-policy
```

## Risks / Notes

Default allowlist must be carefully curated — too restrictive blocks work, too permissive is unsafe.

## Follow-on Tasks

T047, T053
