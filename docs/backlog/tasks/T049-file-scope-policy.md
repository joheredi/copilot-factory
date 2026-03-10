# T049: Implement file scope policy model and enforcement

| Field | Value |
|---|---|
| **ID** | T049 |
| **Epic** | [E010: Policy & Configuration](../epics/E010-policy-configuration.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T013](./T013-migration-audit-policy.md), [T014](./T014-entity-repositories.md) |
| **Blocks** | [T053](./T053-policy-snapshot.md) |

---

## Description

Define the file scope policy data model and enforcement from §9.4, including read/write roots, deny roots, and precedence rules.

## Goal

Control which files workers can read and write to prevent unauthorized modifications.

## Scope

### In Scope

- FileScopePolicy type matching §9.4.1
- Precedence rules: deny > write > read > outside
- checkReadAccess(path, policy) and checkWriteAccess(path, policy)
- Default V1 policy
- Post-run diff validation (check modified files against write_roots)

### Out of Scope

- Runtime filesystem monitoring
- Sandboxing

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. Create packages/domain/src/policies/file-scope-policy.ts
2. Implement path matching against read_roots, write_roots, deny_roots using glob patterns
3. Precedence: deny_roots always wins, then write_roots (read+write), then read_roots (read only)
4. Post-run validation: compare git diff file list against write_roots
5. Default policy: allow read everywhere, write within apps/ and packages/, deny .github/ and secrets/

## Acceptance Criteria

- [ ] Path access checks follow precedence rules exactly
- [ ] Deny roots always block access
- [ ] Post-run diff validation catches out-of-scope writes
- [ ] Default policy is reasonable for V1

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Tests with various path/policy combinations

### Suggested Validation Commands

```bash
pnpm test --filter @factory/domain -- --grep file-scope
```

## Risks / Notes

Glob matching edge cases. Test with tricky paths.

## Follow-on Tasks

T053
