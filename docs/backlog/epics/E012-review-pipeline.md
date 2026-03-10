# E012: Review Pipeline

## Summary

Implement the review router, specialist reviewer dispatch, lead reviewer consolidation, decision application, and rework loop.

## Why This Epic Exists

The review pipeline provides quality assurance for all autonomous work. It prevents bad code from reaching the merge queue.

## Goals

- Deterministic review routing
- Specialist reviewer dispatch via job queue
- Lead reviewer consolidation with job dependencies
- Decision application (approve/reject/escalate)
- Rework loop with rejection context

## Scope

### In Scope

- Review routing rules from docs/prd/010-integration-contracts.md §10.6
- Lead consolidation rules from §10.7
- ReviewCycle lifecycle

### Out of Scope

- AI-suggested reviewers (optional enhancement)
- Custom review rubrics

## Dependencies

**Depends on:** E003, E004, E005, E009, E010

**Enables:** E013

## Risks / Notes

Review fan-out coordination is complex. Must handle partial reviewer failures.

## Tasks

| ID | Title | Priority | Status |
|---|---|---|---|
| [T058](../tasks/T058-review-router.md) | Implement Review Router with deterministic rules | P0 | pending |
| [T059](../tasks/T059-reviewer-dispatch.md) | Implement specialist reviewer job dispatch | P0 | pending |
| [T060](../tasks/T060-lead-reviewer-dispatch.md) | Implement lead reviewer dispatch with dependencies | P0 | pending |
| [T061](../tasks/T061-review-decision-apply.md) | Implement review decision application | P0 | pending |
| [T062](../tasks/T062-rework-loop.md) | Implement rework loop with rejection context | P1 | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

Reviews route correctly by file/tag/risk. Lead reviewer consolidates and emits decisions. Rework loop feeds rejection context.
