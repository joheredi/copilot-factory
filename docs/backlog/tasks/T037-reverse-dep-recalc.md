# T037: Implement reverse-dependency recalculation

| Field                     | Value                                                                        |
| ------------------------- | ---------------------------------------------------------------------------- |
| **ID**                    | T037                                                                         |
| **Epic**                  | [E007: Dependency & Readiness Engine](../epics/E007-dependency-readiness.md) |
| **Type**                  | feature                                                                      |
| **Status**                | done                                                                         |
| **Priority**              | P0                                                                           |
| **Owner**                 | backend-engineer                                                             |
| **AI Executable**         | Yes                                                                          |
| **Human Review Required** | Yes                                                                          |
| **Dependencies**          | [T036](./T036-readiness-computation.md)                                      |
| **Blocks**                | [T038](./T038-dep-reconciliation.md)                                         |

---

## Description

When a task transitions to DONE, automatically recalculate readiness for all reverse-dependent tasks and transition them from BLOCKED to READY as appropriate.

## Goal

Automatically unblock downstream tasks when their prerequisites complete.

## Scope

### In Scope

- On task DONE: find all tasks that depend on this task
- Recalculate readiness for each dependent
- Transition BLOCKED->READY for newly eligible tasks
- Handle FAILED/CANCELLED: hard-blocked dependents remain BLOCKED

### Out of Scope

- Notification to operators about newly ready tasks

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`

## Implementation Guidance

1. Subscribe to task state change events (from transition service)
2. On DONE event: query TaskDependency WHERE depends_on_task_id = completedTaskId
3. For each dependent task in BLOCKED state: recompute readiness
4. If now ready, transition BLOCKED->READY
5. On FAILED/CANCELLED: dependents with hard-blocks remain BLOCKED (per spec)

## Acceptance Criteria

- [x] Completing a task unblocks ready dependents automatically
- [x] Only hard-block dependencies are considered
- [x] Multiple dependencies correctly evaluated (all must be satisfied)
- [x] FAILED dependencies keep dependents BLOCKED

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Integration test with dependency chains

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep reverse-dep
```

## Risks / Notes

Must be idempotent — safe to recalculate multiple times.

## Follow-on Tasks

T038
