# T024: Implement cross-field validation and schema versioning

| Field | Value |
|---|---|
| **ID** | T024 |
| **Epic** | [E004: Packet Schemas & Validation](../epics/E004-packet-schemas.md) |
| **Type** | foundation |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T021](./T021-schemas-task-dev.md), [T022](./T022-schemas-review.md), [T023](./T023-schemas-merge-validation.md) |
| **Blocks** | [T046](./T046-output-capture-validation.md) |

---

## Description

Add cross-field validation rules from §8.13 to all packet schemas and implement schema version validation with multi-version support from §8.15.

## Goal

Ensure packet schemas enforce business rules that span multiple fields and support version evolution.

## Scope

### In Scope

- Cross-field rules: ReviewPacket blocking_issues empty when approved, LeadReviewDecision changes_requested requires blocking issues, etc.
- schema_version field validation
- Major version family acceptance
- Version compatibility checking

### Out of Scope

- Schema migration tooling
- JSON Schema export

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/008-packet-and-schema-spec.md`

## Implementation Guidance

1. Use Zod .refine() or .superRefine() for cross-field validation
2. ReviewPacket: when verdict=approved, blocking_issues must be empty array
3. LeadReviewDecisionPacket: when decision=changes_requested, blocking_issues must be non-empty
4. LeadReviewDecisionPacket: when decision=approved_with_follow_up, follow_up_task_refs must be non-empty
5. MergeAssistPacket: when confidence=low, recommendation must be reject_to_dev or escalate
6. PostMergeAnalysisPacket: when confidence=low, recommendation must be escalate
7. Create a validatePacketVersion(packet, expectedMajor) function
8. Write tests for every cross-field rule with both valid and invalid data

## Acceptance Criteria

- [ ] All cross-field rules from §8.13 are enforced
- [ ] Invalid cross-field combinations rejected with descriptive errors
- [ ] Schema version validation accepts same-major, rejects cross-major
- [ ] Comprehensive test coverage

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

pnpm test --filter @factory/schemas -- --grep cross-field

### Suggested Validation Commands

```bash
pnpm test --filter @factory/schemas
```

## Risks / Notes

Zod .refine() error messages must be clear for debugging schema validation failures.

## Follow-on Tasks

T046
