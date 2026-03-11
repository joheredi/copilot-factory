# T020: Define shared Zod types for packets

| Field                     | Value                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T020                                                                                                                                                        |
| **Epic**                  | [E004: Packet Schemas & Validation](../epics/E004-packet-schemas.md)                                                                                        |
| **Type**                  | foundation                                                                                                                                                  |
| **Status**                | pending                                                                                                                                                     |
| **Priority**              | P0                                                                                                                                                          |
| **Owner**                 | backend-engineer                                                                                                                                            |
| **AI Executable**         | Yes                                                                                                                                                         |
| **Human Review Required** | Yes                                                                                                                                                         |
| **Dependencies**          | [T004](./T004-vitest-setup.md)                                                                                                                              |
| **Blocks**                | [T021](./T021-schemas-task-dev.md), [T022](./T022-schemas-review.md), [T023](./T023-schemas-merge-validation.md), [T024](./T024-schema-cross-validation.md) |

---

## Description

Create the shared Zod type definitions used across all packet schemas: FileChangeSummary, Issue, ValidationCheckResult, and common enums.

## Goal

Establish reusable schema building blocks for all packet types.

## Scope

### In Scope

- FileChangeSummary schema from §8.3.1
- Issue schema from §8.3.2
- ValidationCheckResult schema from §8.3.3
- Common enums (status, severity, verdict, decision, confidence)

### Out of Scope

- Full packet schemas (T021-T023)
- Schema versioning (T024)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/008-packet-and-schema-spec.md`

## Implementation Guidance

1. Create packages/schemas/src/shared.ts
2. Use Zod for all definitions (z.object, z.enum, z.array etc.)
3. FileChangeSummary: path (string), change_type (enum: added|modified|deleted|renamed), summary (string)
4. Issue: severity (critical|high|medium|low), code (string), title, description, file_path (optional), line (optional), blocking (boolean)
5. ValidationCheckResult: check_type enum, tool_name, command, status (passed|failed|skipped), duration_ms, summary, artifact_refs (optional)
6. Export both the Zod schemas and inferred TypeScript types
7. Write tests validating example data from the spec

## Acceptance Criteria

- [ ] All three shared types defined with Zod
- [ ] Example data from §8.3 validates correctly
- [ ] Invalid data is rejected with clear errors
- [ ] TypeScript types are exported

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Schema validation tests

### Suggested Validation Commands

```bash
pnpm test --filter @factory/schemas
```

## Risks / Notes

Zod version matters — use v3.x for stability.

## Follow-on Tasks

T021, T022, T023, T024
