# E016: Observability

## Summary

Integrate OpenTelemetry tracing, implement Prometheus metrics endpoint, and instrument core orchestration paths.

## Why This Epic Exists

Operators need to trace task execution across services, monitor system health, and detect problems proactively.

## Goals

- OpenTelemetry TracerProvider initialized
- Starter spans from docs/prd/010-integration-contracts.md §10.13
- Prometheus-compatible metrics endpoint
- Starter metrics inventory

## Scope

### In Scope

- Trace propagation
- Span tree from §10.13.5
- Metric names from §10.13.3
- Label rules from §10.13.4

### Out of Scope

- Grafana dashboards
- Alerting rules
- Log-to-trace correlation

## Dependencies

**Depends on:** E001, E015

**Enables:** E022

## Risks / Notes

Instrumentation adds overhead. Must keep cardinality low per label rules.

## Tasks

| ID                                           | Title                                          | Priority | Status  |
| -------------------------------------------- | ---------------------------------------------- | -------- | ------- |
| [T076](../tasks/T076-otel-init.md)           | Initialize OpenTelemetry TracerProvider        | P1       | pending |
| [T077](../tasks/T077-otel-spans.md)          | Instrument core orchestration paths with spans | P1       | pending |
| [T078](../tasks/T078-prometheus-endpoint.md) | Implement Prometheus metrics endpoint          | P1       | pending |
| [T079](../tasks/T079-starter-metrics.md)     | Implement starter metrics inventory            | P1       | done    |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

Traces cover task lifecycle. Metrics endpoint returns expected counters/histograms/gauges.
