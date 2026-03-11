# T022: Define ReviewPacket and LeadReviewDecisionPacket schemas

| Field                     | Value                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------- |
| **ID**                    | T022                                                                               |
| **Epic**                  | [E004: Packet Schemas & Validation](../epics/E004-packet-schemas.md)               |
| **Type**                  | foundation                                                                         |
| **Status**                | pending                                                                            |
| **Priority**              | P0                                                                                 |
| **Owner**                 | backend-engineer                                                                   |
| **AI Executable**         | Yes                                                                                |
| **Human Review Required** | Yes                                                                                |
| **Dependencies**          | [T020](./T020-shared-zod-types.md)                                                 |
| **Blocks**                | [T024](./T024-schema-cross-validation.md), [T061](./T061-review-decision-apply.md) |

---

## Description

Create Zod schemas for ReviewPacket (§8.6) and LeadReviewDecisionPacket (§8.7).

## Goal

Machine-validate review and lead review decision outputs.

## Scope

### In Scope

- ReviewPacket with verdict, blocking/non-blocking issues, confidence
- LeadReviewDecisionPacket with decision, deduplication notes, follow-up refs
- Verdict and decision enum validation

### Out of Scope

- Cross-field validation rules (T024)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/008-packet-and-schema-spec.md`

## Implementation Guidance

1. Create packages/schemas/src/review-packet.ts and lead-review-decision-packet.ts
2. ReviewPacket verdict: approved|changes_requested|escalated
3. LeadReviewDecisionPacket decision: approved|approved_with_follow_up|changes_requested|escalated
4. Include risks and open_questions arrays (always present, may be empty)
5. Test with spec example JSON

## Acceptance Criteria

- [ ] Spec examples validate correctly
- [ ] Verdict and decision enums enforced
- [ ] Required fields validated

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

None significant.

## Follow-on Tasks

T024, T061
