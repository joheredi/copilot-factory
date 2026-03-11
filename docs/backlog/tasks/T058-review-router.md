# T058: Implement Review Router with deterministic rules

| Field                     | Value                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T058                                                                                                                  |
| **Epic**                  | [E012: Review Pipeline](../epics/E012-review-pipeline.md)                                                             |
| **Type**                  | feature                                                                                                               |
| **Status**                | done                                                                                                                  |
| **Priority**              | P0                                                                                                                    |
| **Owner**                 | backend-engineer                                                                                                      |
| **AI Executable**         | Yes                                                                                                                   |
| **Human Review Required** | Yes                                                                                                                   |
| **Dependencies**          | [T011](./T011-migration-lease-review.md), [T014](./T014-entity-repositories.md), [T017](./T017-transition-service.md) |
| **Blocks**                | [T059](./T059-reviewer-dispatch.md), [T060](./T060-lead-reviewer-dispatch.md)                                         |

---

## Description

Build the Review Router that determines which specialist reviewers should review a task based on changed files, tags, risk level, and repository settings.

## Goal

Automatically route reviews to the right specialists based on deterministic rules.

## Scope

### In Scope

- Rule evaluation in deterministic order from §10.6.2
- Path-based rules, tag/domain rules, risk-based rules
- Required vs optional reviewer determination
- Review routing rule configuration (JSON structure from §10.6.3)
- Routing rationale output

### Out of Scope

- AI-suggested reviewers (optional enhancement)
- Custom review rubrics

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/010-integration-contracts.md`
- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. Create packages/application/src/services/review-router.service.ts
2. routeReview(devResult, task, repoSettings, workflowTemplate) -> RoutingDecision
3. Evaluate rules in order: 1) explicit repo-required, 2) path-based, 3) tag/domain, 4) risk-based
4. Path matching uses glob patterns against changed file paths
5. Output: required_reviewers, optional_reviewers, routing_rationale
6. General reviewer is always required per V1 scope
7. Write tests with various file change patterns and rule configurations

## Acceptance Criteria

- [ ] Rules evaluated in correct order
- [ ] Path-based matching works with globs
- [ ] Required and optional reviewers correctly determined
- [ ] Routing rationale explains each decision

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Tests with diverse rule configurations and file patterns

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep review-router
```

## Risks / Notes

Rule evaluation order matters. Must follow §10.6.2 exactly.

## Follow-on Tasks

T059, T060
