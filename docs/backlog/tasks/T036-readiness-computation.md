# T036: Implement readiness computation

| Field                     | Value                                                                        |
| ------------------------- | ---------------------------------------------------------------------------- |
| **ID**                    | T036                                                                         |
| **Epic**                  | [E007: Dependency & Readiness Engine](../epics/E007-dependency-readiness.md) |
| **Type**                  | feature                                                                      |
| **Status**                | pending                                                                      |
| **Priority**              | P0                                                                           |
| **Owner**                 | backend-engineer                                                             |
| **AI Executable**         | Yes                                                                          |
| **Human Review Required** | Yes                                                                          |
| **Dependencies**          | [T035](./T035-dag-validation.md)                                             |
| **Blocks**                | [T037](./T037-reverse-dep-recalc.md), [T027](./T027-scheduler-service.md)    |

---

## Description

Implement the readiness computation that determines whether a task should be READY or BLOCKED based on its hard-block dependencies.

## Goal

Ensure tasks only become READY when all hard-block prerequisites are DONE.

## Scope

### In Scope

- computeReadiness(taskId) -> READY | BLOCKED with reasons
- Hard-block: task can't be READY until dependency reaches DONE
- Soft-block (is_hard_block=false): informational only, doesn't affect readiness
- relates_to: no effect on readiness
- parent_child: parent blocks until all children DONE/CANCELLED

### Out of Scope

- Policy blockers (future)
- Risk-based blocking

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`

## Implementation Guidance

1. Query all hard-block dependencies for the task
2. If any hard-block dependency is not in DONE state, task is BLOCKED
3. For parent_child: parent can't reach DONE until all children are DONE or CANCELLED
4. Return blocking reasons (which dependencies are not done)
5. Transition task BACKLOG->READY or BACKLOG->BLOCKED via transition service

## Acceptance Criteria

- [ ] Tasks with unsatisfied hard-block deps are BLOCKED
- [ ] Tasks with all hard-block deps DONE are READY
- [ ] Soft-block deps don't affect readiness
- [ ] parent_child semantics enforced

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Tests with various dependency configurations

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep readiness
```

## Risks / Notes

Must handle FAILED and CANCELLED dependency states correctly per spec.

## Follow-on Tasks

T037, T027
