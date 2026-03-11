# T046: Implement structured output capture and validation

| Field                     | Value                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T046                                                                                                                  |
| **Epic**                  | [E009: Worker Runtime & Execution](../epics/E009-worker-runtime.md)                                                   |
| **Type**                  | feature                                                                                                               |
| **Status**                | pending                                                                                                               |
| **Priority**              | P0                                                                                                                    |
| **Owner**                 | backend-engineer                                                                                                      |
| **AI Executable**         | Yes                                                                                                                   |
| **Human Review Required** | Yes                                                                                                                   |
| **Dependencies**          | [T024](./T024-schema-cross-validation.md), [T032](./T032-graceful-completion.md), [T044](./T044-worker-supervisor.md) |
| **Blocks**                | [T107](./T107-e2e-full-lifecycle.md)                                                                                  |

---

## Description

Implement the result packet extraction, schema validation, and acceptance logic that runs after a worker completes. Enforce the rule that no result is accepted without valid schema.

## Goal

Ensure all worker outputs meet the schema contract before being accepted into the system.

## Scope

### In Scope

- Extract structured packet from worker output (file or delimiter-based)
- Validate against declared schema version
- Verify all IDs match orchestrator context
- Verify referenced artifacts exist
- Schema repair attempt for minor violations
- Rejection and failure handling for invalid output

### Out of Scope

- Worker-side output formatting
- Schema migration

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/008-packet-and-schema-spec.md`
- `docs/prd/004-agent-contracts.md`

## Implementation Guidance

1. Create packages/application/src/services/output-validator.service.ts
2. extractPacket(workerOutput): parse JSON from designated output file or delimited section
3. validatePacket(packet, expectedType, runContext): 1) parse JSON, 2) validate schema, 3) check IDs match, 4) check artifact refs
4. On parse failure: fatal error, mark run FAILED
5. On schema validation failure: attempt repair (apply defaults for optional fields), if repair fails mark FAILED
6. Track consecutive schema failures per agent profile (3 consecutive = disable profile per §4.10)
7. All validation failures produce schema_violation audit event

## Acceptance Criteria

- [ ] Valid packets accepted correctly
- [ ] Invalid JSON rejected as fatal
- [ ] Schema violations handled with repair attempt
- [ ] ID mismatches rejected
- [ ] Consecutive failure tracking works

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Tests with valid, invalid, and repairable packet outputs

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep output-valid
```

## Risks / Notes

Schema repair logic must be conservative — don't accept clearly wrong data.

## Follow-on Tasks

T107
