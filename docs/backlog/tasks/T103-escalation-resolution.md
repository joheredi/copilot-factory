# T103: Implement escalation resolution flow

| Field | Value |
|---|---|
| **ID** | T103 |
| **Epic** | [E021: Operator Actions & Overrides](../epics/E021-operator-actions.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P1 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T101](./T101-api-operator-actions.md), [T102](./T102-operator-guards.md) |
| **Blocks** | [T104](./T104-ui-operator-task.md) |

---

## Description

Implement the escalation resolution flow: operators can retry, cancel, or mark as externally completed for ESCALATED tasks.

## Goal

Provide a clear path for operators to resolve tasks that require human judgment.

## Scope

### In Scope

- POST /api/tasks/:id/actions/resolve_escalation with resolution type
- Resolution types: retry (→ ASSIGNED), cancel (→ CANCELLED), mark_done (→ DONE)
- Retry: clear escalation reason, create new scheduling job
- Cancel: preserve escalation context in audit
- Mark done: require reason/evidence for external completion

### Out of Scope

- Escalation notification system
- Escalation SLA tracking

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`

## Implementation Guidance

1. Add resolve_escalation action to OperatorActionsController
2. Validate task is in ESCALATED state
3. For retry: transition ESCALATED → ASSIGNED, create scheduler job, optionally change pool
4. For cancel: transition ESCALATED → CANCELLED with operator reason
5. For mark_done: transition ESCALATED → DONE with external completion evidence
6. All resolutions create detailed audit events

## Acceptance Criteria

- [ ] All three resolution types work correctly
- [ ] State transitions are valid
- [ ] Audit events capture resolution details
- [ ] Invalid resolutions rejected

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Test each escalation resolution path

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep escalation-resol
```

## Risks / Notes

mark_done bypasses normal quality checks. Require explicit reason.

## Follow-on Tasks

T104
