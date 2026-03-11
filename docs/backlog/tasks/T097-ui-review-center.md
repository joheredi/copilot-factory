# T097: Build review center view

| Field                     | Value                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| **ID**                    | T097                                                               |
| **Epic**                  | [E020: Web UI Feature Views](../epics/E020-web-ui-features.md)     |
| **Type**                  | feature                                                            |
| **Status**                | pending                                                            |
| **Priority**              | P2                                                                 |
| **Owner**                 | frontend-engineer                                                  |
| **AI Executable**         | Yes                                                                |
| **Human Review Required** | Yes                                                                |
| **Dependencies**          | [T090](./T090-api-client-tanstack.md), [T092](./T092-app-shell.md) |
| **Blocks**                | None                                                               |

---

## Description

Build the review center showing tasks in review, review decisions, blocking issues, and review cycle history.

## Goal

Enable operators to monitor review quality and identify bottlenecks.

## Scope

### In Scope

- Tasks in IN_REVIEW and CHANGES_REQUESTED states
- Review cycle details per task
- Specialist review packets with issue lists
- Lead review decisions
- Review round count and escalation warnings

### Out of Scope

- Review assignment controls
- Review quality analytics

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/001-architecture.md`

## Implementation Guidance

1. Create apps/web-ui/src/features/reviews/ReviewCenterPage.tsx
2. Table of tasks in review states with review round count
3. Click-through to review detail: specialist reviews, issues, lead decision
4. Issues displayed with severity badges and blocking indicators
5. Warn when approaching max review rounds

## Acceptance Criteria

- [ ] Tasks in review displayed correctly
- [ ] Review packets readable
- [ ] Issues clearly categorized by severity
- [ ] Round count visible

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

View review center with tasks in various review states

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm dev
```

## Risks / Notes

Review data is complex. Focus on clarity over completeness initially.

## Follow-on Tasks

None
