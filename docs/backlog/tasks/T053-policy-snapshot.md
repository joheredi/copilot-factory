# T053: Implement effective policy snapshot generation

| Field                     | Value                                                                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T053                                                                                                                                                                                         |
| **Epic**                  | [E010: Policy & Configuration](../epics/E010-policy-configuration.md)                                                                                                                        |
| **Type**                  | feature                                                                                                                                                                                      |
| **Status**                | done                                                                                                                                                                                         |
| **Priority**              | P0                                                                                                                                                                                           |
| **Owner**                 | backend-engineer                                                                                                                                                                             |
| **AI Executable**         | Yes                                                                                                                                                                                          |
| **Human Review Required** | Yes                                                                                                                                                                                          |
| **Dependencies**          | [T048](./T048-command-policy.md), [T049](./T049-file-scope-policy.md), [T050](./T050-validation-policy.md), [T051](./T051-retry-escalation-policy.md), [T052](./T052-hierarchical-config.md) |
| **Blocks**                | [T040](./T040-workspace-mounting.md), [T045](./T045-copilot-cli-adapter.md)                                                                                                                  |

---

## Description

Implement the generation and persistence of effective policy snapshots that capture the resolved configuration for each worker run.

## Goal

Ensure every worker run has an immutable, reproducible policy snapshot.

## Scope

### In Scope

- generatePolicySnapshot(taskId, poolId, runId) -> PolicySnapshot
- Snapshot includes: command_policy, file_scope_policy, validation_policy, retry_policy, escalation_policy, lease_policy, review_policy, retention_policy
- Persist snapshot as artifact
- Snapshot is immutable for life of run

### Out of Scope

- Snapshot comparison tools
- Policy drift detection

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. Create packages/application/src/services/policy-snapshot.service.ts
2. Use the hierarchical config resolver to produce each policy section
3. Assemble into the PolicySnapshot structure from §9.2
4. Persist as an artifact at the run level
5. Validate the snapshot against the PolicySnapshot Zod schema
6. Make snapshot immutable (no updates once created)

## Acceptance Criteria

- [ ] Snapshot includes all policy sections
- [ ] Snapshot validates against schema
- [ ] Snapshot persisted as artifact
- [ ] Snapshot reflects hierarchical resolution correctly

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Test snapshot generation with various config overrides

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep snapshot
```

## Risks / Notes

Snapshot must capture the EXACT config used. Any mismatch breaks reproducibility.

## Follow-on Tasks

T040, T045
