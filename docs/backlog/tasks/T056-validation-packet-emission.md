# T056: Implement ValidationResultPacket emission

| Field | Value |
|---|---|
| **ID** | T056 |
| **Epic** | [E011: Validation Runner](../epics/E011-validation-runner.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T023](./T023-schemas-merge-validation.md), [T055](./T055-validation-command-exec.md) |
| **Blocks** | [T057](./T057-validation-gates.md) |

---

## Description

After validation checks complete, emit a schema-valid ValidationResultPacket and persist it as an artifact.

## Goal

Produce machine-readable validation results for the orchestrator and audit trail.

## Scope

### In Scope

- Assemble ValidationResultPacket from check results
- Schema validation of emitted packet
- Persist packet as artifact
- Include run_scope in packet

### Out of Scope

- Validation result interpretation by orchestrator

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/008-packet-and-schema-spec.md`

## Implementation Guidance

1. After all checks complete, assemble the ValidationResultPacket
2. Set status: success if all required passed, failed otherwise
3. Include all check results in details.checks array
4. Set run_scope based on the stage (pre-review, pre-merge, post-merge)
5. Validate against Zod schema before persisting
6. Store via artifact service

## Acceptance Criteria

- [ ] Emitted packet validates against schema
- [ ] All check results included
- [ ] run_scope correctly reflects validation stage
- [ ] Packet persisted as artifact

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

End-to-end test: run validation, verify emitted packet matches schema

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep validation-packet
```

## Risks / Notes

None significant.

## Follow-on Tasks

T057
