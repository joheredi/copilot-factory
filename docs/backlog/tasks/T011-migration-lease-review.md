# T011: Create migrations for TaskLease, ReviewCycle, ReviewPacket, LeadReviewDecision tables

| Field                     | Value                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T011                                                                                                           |
| **Epic**                  | [E002: Domain Model & Persistence](../epics/E002-domain-model-persistence.md)                                  |
| **Type**                  | foundation                                                                                                     |
| **Status**                | done                                                                                                           |
| **Priority**              | P0                                                                                                             |
| **Owner**                 | backend-engineer                                                                                               |
| **AI Executable**         | Yes                                                                                                            |
| **Human Review Required** | Yes                                                                                                            |
| **Dependencies**          | [T006](./T006-sqlite-drizzle-setup.md), [T007](./T007-domain-enums-types.md), [T009](./T009-migration-task.md) |
| **Blocks**                | [T014](./T014-entity-repositories.md), [T030](./T030-lease-acquisition.md), [T058](./T058-review-router.md)    |

---

## Description

Create Drizzle schema and migration for TaskLease, ReviewCycle, ReviewPacket, and LeadReviewDecision tables.

## Goal

Enable lease tracking, review cycle management, and review decision persistence.

## Scope

### In Scope

- TaskLease with partial_result_artifact_refs as JSON
- ReviewCycle with required/optional reviewers as JSON
- ReviewPacket with severity_summary and packet_json
- LeadReviewDecision with follow_up_task_refs as JSON
- Foreign keys to Task

### Out of Scope

- Lease management logic (E006)
- Review pipeline logic (E012)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`

## Implementation Guidance

1. TaskLease: lease_id PK, task_id FK, worker_id, pool_id, timestamps, status, reclaim_reason
2. partial_result_artifact_refs stored as JSON array
3. ReviewCycle: review_cycle_id PK, task_id FK, status, required_reviewers JSON, optional_reviewers JSON
4. ReviewPacket: review_packet_id PK, task_id FK, review_cycle_id FK, reviewer_type, verdict, packet_json
5. LeadReviewDecision: lead_review_decision_id PK, task_id FK, review_cycle_id FK, decision, counts, packet_json

## Acceptance Criteria

- [ ] All four tables created with correct schemas
- [ ] Foreign keys reference Task table correctly
- [ ] JSON columns handle array and object types

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run migration and verify table schemas

### Suggested Validation Commands

```bash
cd apps/control-plane && pnpm db:generate && pnpm db:migrate
```

## Risks / Notes

Review tables have complex relationships. Ensure FK integrity.

## Follow-on Tasks

T014, T030, T058
