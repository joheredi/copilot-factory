# T052: Implement hierarchical configuration resolution

| Field                     | Value                                                                           |
| ------------------------- | ------------------------------------------------------------------------------- |
| **ID**                    | T052                                                                            |
| **Epic**                  | [E010: Policy & Configuration](../epics/E010-policy-configuration.md)           |
| **Type**                  | feature                                                                         |
| **Status**                | done                                                                            |
| **Priority**              | P0                                                                              |
| **Owner**                 | backend-engineer                                                                |
| **AI Executable**         | Yes                                                                             |
| **Human Review Required** | Yes                                                                             |
| **Dependencies**          | [T013](./T013-migration-audit-policy.md), [T014](./T014-entity-repositories.md) |
| **Blocks**                | [T053](./T053-policy-snapshot.md)                                               |

---

## Description

Implement the 8-layer hierarchical configuration resolution from §9.12: system defaults through operator emergency override.

## Goal

Enable flexible configuration where any level can override lower-level defaults.

## Scope

### In Scope

- 8-layer precedence: system > environment > org > repo workflow > pool > task-type > task > operator override
- resolveConfig(context) -> resolvedConfig with source tracking
- Each resolved value records which layer supplied it
- Config loading from code defaults and DB

### Out of Scope

- UI config editor (T099)
- Hot-reload of config changes

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/009-policy-and-enforcement-spec.md`
- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Create packages/config/src/resolver.ts
2. Define ConfigContext: projectId, repoId, poolId, taskType, taskId, operatorOverrides
3. Layer resolution: start with system defaults, overlay each higher-precedence layer
4. Track source layer for each resolved value (for debugging and auditing)
5. System defaults defined in code, DB stores overrides per entity
6. Use deep merge for nested config objects

## Acceptance Criteria

- [ ] All 8 precedence layers supported
- [ ] Higher-precedence layers override lower ones
- [ ] Source tracking records which layer provided each value
- [ ] Missing layers are skipped gracefully

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Tests with various override combinations

### Suggested Validation Commands

```bash
pnpm test --filter @factory/config -- --grep resolver
```

## Risks / Notes

Deep merge of nested config objects must handle arrays and nulls correctly.

## Follow-on Tasks

T053
