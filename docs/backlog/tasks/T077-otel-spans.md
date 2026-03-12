# T077: Instrument core orchestration paths with spans

| Field                     | Value                                                 |
| ------------------------- | ----------------------------------------------------- |
| **ID**                    | T077                                                  |
| **Epic**                  | [E016: Observability](../epics/E016-observability.md) |
| **Type**                  | feature                                               |
| **Status**                | done                                                  |
| **Priority**              | P1                                                    |
| **Owner**                 | backend-engineer                                      |
| **AI Executable**         | Yes                                                   |
| **Human Review Required** | Yes                                                   |
| **Dependencies**          | [T076](./T076-otel-init.md)                           |
| **Blocks**                | None                                                  |

---

## Description

Add OpenTelemetry spans for the starter span tree from §10.13.2: task.assign, task.transition, worker.prepare, worker.run, validation.run, review.route, review.lead_decision, merge.prepare, merge.execute.

## Goal

Enable operators to trace a task's journey through all orchestration steps.

## Scope

### In Scope

- All starter spans from §10.13.2
- Recommended attributes from §10.13.2
- Parent-child span relationships matching §10.13.5 example
- Span status on success/failure

### Out of Scope

- Database operation spans
- Detailed sub-spans

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/010-integration-contracts.md`

## Implementation Guidance

1. Add spans in the key service methods:
2. TransitionService: task.transition span with from/to states
3. Scheduler: task.assign span wrapping pool match + lease
4. WorkerSupervisor: worker.prepare, worker.run spans
5. Heartbeat handler: worker.heartbeat span
6. ValidationRunner: validation.run span with profile attribute
7. ReviewRouter: review.route span
8. ReviewDecisionService: review.lead_decision span
9. MergeExecutor: merge.prepare, merge.execute spans
10. Follow the parent-child tree from §10.13.5

## Acceptance Criteria

- [ ] All starter spans created at correct points
- [ ] Spans include required attributes
- [ ] Parent-child relationships match example tree
- [ ] Span status reflects operation outcome

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run a task end-to-end and verify span tree matches §10.13.5

### Suggested Validation Commands

```bash
pnpm test --filter @factory/observability -- --grep spans
```

## Risks / Notes

Too many spans impacts performance. Stick to the starter set.

## Follow-on Tasks

None
