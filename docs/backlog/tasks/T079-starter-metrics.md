# T079: Implement starter metrics inventory

| Field | Value |
|---|---|
| **ID** | T079 |
| **Epic** | [E016: Observability](../epics/E016-observability.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P1 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T078](./T078-prometheus-endpoint.md) |
| **Blocks** | None |

---

## Description

Implement the starter metrics from §10.13.3: task transitions, worker runs, heartbeat timeouts, review cycles, merge attempts, validation runs, queue depth.

## Goal

Provide operators with key operational metrics from day one.

## Scope

### In Scope

- All metrics from §10.13.3
- Correct metric types (counter, histogram, gauge)
- Low-cardinality labels from §10.13.4
- Metric emission at correct instrumentation points

### Out of Scope

- Custom dashboards
- Alerting rules

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/010-integration-contracts.md`

## Implementation Guidance

1. Create metrics in packages/observability/src/metrics.ts:
2. factory_task_transitions_total: Counter with labels [repository_id, task_state, result]
3. factory_worker_runs_total, factory_worker_run_duration_seconds: Counter + Histogram
4. factory_worker_heartbeat_timeouts_total: Counter
5. factory_review_cycles_total, factory_review_rounds_total: Counters
6. factory_merge_attempts_total, factory_merge_failures_total: Counters
7. factory_validation_runs_total, factory_validation_duration_seconds: Counter + Histogram
8. factory_queue_depth: Gauge with label [job_type]
9. Emit metrics at instrumentation points: TransitionService, WorkerSupervisor, etc.
10. NO task_id, run_id, or branch_name as labels (unsafe cardinality)

## Acceptance Criteria

- [ ] All starter metrics from §10.13.3 implemented
- [ ] Correct metric types used
- [ ] Labels follow cardinality rules from §10.13.4
- [ ] Metrics update correctly during operations

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run operations and verify metrics increment

### Suggested Validation Commands

```bash
curl -s http://localhost:3000/metrics | grep factory_
```

## Risks / Notes

Adding too many labels creates cardinality explosion. Be strict about §10.13.4.

## Follow-on Tasks

None
