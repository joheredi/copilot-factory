# T023: Define remaining packet schemas

| Field | Value |
|---|---|
| **ID** | T023 |
| **Epic** | [E004: Packet Schemas & Validation](../epics/E004-packet-schemas.md) |
| **Type** | foundation |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T020](./T020-shared-zod-types.md) |
| **Blocks** | [T024](./T024-schema-cross-validation.md), [T056](./T056-validation-packet-emission.md), [T064](./T064-rebase-merge-exec.md), [T067](./T067-post-merge-failure.md) |

---

## Description

Create Zod schemas for MergePacket (§8.8), MergeAssistPacket (§8.9), ValidationResultPacket (§8.10), PostMergeAnalysisPacket (§8.11), and the PolicySnapshot schema.

## Goal

Complete the packet schema library covering all artifact types.

## Scope

### In Scope

- MergePacket with details structure
- MergeAssistPacket with recommendation and confidence
- ValidationResultPacket with run_scope and checks array
- PostMergeAnalysisPacket with recommendation and attribution
- PolicySnapshot schema from docs/prd/009-policy-and-enforcement-spec.md §9.2

### Out of Scope

- Cross-field validation (T024)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/008-packet-and-schema-spec.md`
- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. Create one file per schema in packages/schemas/src/
2. MergeAssistPacket recommendation: auto_resolve|reject_to_dev|escalate
3. PostMergeAnalysisPacket recommendation: revert|hotfix_task|escalate|pre_existing
4. ValidationResultPacket run_scope: pre-dev|during-dev|pre-review|pre-merge|post-merge
5. PolicySnapshot: top-level structure with all policy sub-objects as optional
6. Test all with spec examples

## Acceptance Criteria

- [ ] All five schemas defined and tested
- [ ] Spec example data validates
- [ ] Invalid data rejected

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

pnpm test --filter @factory/schemas

### Suggested Validation Commands

```bash
pnpm test --filter @factory/schemas
```

## Risks / Notes

PolicySnapshot is complex with many nested policy objects.

## Follow-on Tasks

T024, T056, T064, T067
