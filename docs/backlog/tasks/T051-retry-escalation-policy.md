# T051: Implement retry and escalation policy evaluation

| Field                     | Value                                                                           |
| ------------------------- | ------------------------------------------------------------------------------- |
| **ID**                    | T051                                                                            |
| **Epic**                  | [E010: Policy & Configuration](../epics/E010-policy-configuration.md)           |
| **Type**                  | feature                                                                         |
| **Status**                | done                                                                            |
| **Priority**              | P0                                                                              |
| **Owner**                 | backend-engineer                                                                |
| **AI Executable**         | Yes                                                                             |
| **Human Review Required** | Yes                                                                             |
| **Dependencies**          | [T013](./T013-migration-audit-policy.md), [T014](./T014-entity-repositories.md) |
| **Blocks**                | [T033](./T033-lease-reclaim.md), [T053](./T053-policy-snapshot.md)              |

---

## Description

Implement retry policy and escalation policy evaluation from §9.6 and §9.7. Determine whether a failed task should retry, escalate, or fail permanently.

## Goal

Automate failure recovery decisions based on configurable thresholds.

## Scope

### In Scope

- RetryPolicy type and evaluation
- EscalationPolicy type with all trigger cases from §9.7.2
- shouldRetry(task, policy) -> boolean with backoff calculation
- shouldEscalate(task, policy, triggerType) -> boolean
- Backoff calculation (exponential with max)
- Default V1 policies

### Out of Scope

- Actual retry execution (T033)
- Escalation UI (T103)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. Create packages/domain/src/policies/retry-policy.ts and escalation-policy.ts
2. shouldRetry: check retry_count < max_attempts, calculate next backoff
3. Backoff: initial \* 2^(attempt-1), capped at max_backoff_seconds
4. shouldEscalate: check all triggers from §9.7.1 (max_retry, max_review_rounds, policy_violation, etc.)
5. Return the escalation action: escalate, fail_then_escalate, etc.
6. Default retry: max_attempts=2, exponential backoff 60s-900s
7. Default escalation: escalate on max retry, max review rounds, policy violation

## Acceptance Criteria

- [ ] Retry eligibility determined correctly
- [ ] Backoff calculated with exponential formula and cap
- [ ] All escalation triggers from §9.7.2 evaluated
- [ ] Default policies match spec

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Tests for various retry and escalation scenarios

### Suggested Validation Commands

```bash
pnpm test --filter @factory/domain -- --grep retry-escalation
```

## Risks / Notes

Escalation triggers are numerous. Ensure all are covered.

## Follow-on Tasks

T033, T053
