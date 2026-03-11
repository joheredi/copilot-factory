# T021: Define TaskPacket and DevResultPacket Zod schemas

| Field                     | Value                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------- |
| **ID**                    | T021                                                                                   |
| **Epic**                  | [E004: Packet Schemas & Validation](../epics/E004-packet-schemas.md)                   |
| **Type**                  | foundation                                                                             |
| **Status**                | pending                                                                                |
| **Priority**              | P0                                                                                     |
| **Owner**                 | backend-engineer                                                                       |
| **AI Executable**         | Yes                                                                                    |
| **Human Review Required** | Yes                                                                                    |
| **Dependencies**          | [T020](./T020-shared-zod-types.md)                                                     |
| **Blocks**                | [T024](./T024-schema-cross-validation.md), [T046](./T046-output-capture-validation.md) |

---

## Description

Create Zod schemas for TaskPacket (§8.4) and DevResultPacket (§8.5) with all required fields and nested structures.

## Goal

Machine-validate the primary input and output contracts for developer workers.

## Scope

### In Scope

- TaskPacket with all required top-level fields from §8.4.3
- DevResultPacket with all required fields from §8.5.3
- Nested structures (task, repository, workspace, context, policies, validation_requirements)
- RejectionContext schema from §8.12

### Out of Scope

- Cross-field validation (T024)
- Schema versioning (T024)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/008-packet-and-schema-spec.md`

## Implementation Guidance

1. Create packages/schemas/src/task-packet.ts and dev-result-packet.ts
2. Follow the canonical shapes exactly from §8.4.2 and §8.5.2
3. TaskPacket role enum: planner|developer|reviewer|lead-reviewer|merge-assist|post-merge-analysis
4. DevResultPacket status enum: success|failed|partial|blocked
5. Create RejectionContext schema in packages/schemas/src/rejection-context.ts
6. Test with the exact example JSON from the spec

## Acceptance Criteria

- [ ] Spec example data validates successfully
- [ ] Missing required fields are rejected
- [ ] Invalid enum values are rejected
- [ ] TypeScript types are correctly inferred

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Schema validation tests with spec examples

### Suggested Validation Commands

```bash
pnpm test --filter @factory/schemas
```

## Risks / Notes

Spec examples are extensive. Must match exactly.

## Follow-on Tasks

T024, T046
