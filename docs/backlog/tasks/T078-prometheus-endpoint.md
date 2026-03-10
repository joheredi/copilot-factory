# T078: Implement Prometheus metrics endpoint

| Field | Value |
|---|---|
| **ID** | T078 |
| **Epic** | [E016: Observability](../epics/E016-observability.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P1 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T080](./T080-nestjs-bootstrap.md) |
| **Blocks** | [T079](./T079-starter-metrics.md) |

---

## Description

Create a /metrics endpoint that exposes Prometheus-compatible metrics.

## Goal

Enable metrics scraping for monitoring and alerting.

## Scope

### In Scope

- GET /metrics endpoint returning Prometheus text format
- prom-client library integration
- Default metrics (process, nodejs)
- Custom metric registry

### Out of Scope

- Custom business metrics (T079)
- Grafana dashboards

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/010-integration-contracts.md`

## Implementation Guidance

1. Install prom-client
2. Create packages/observability/src/metrics.ts
3. Initialize a custom Registry
4. Create a NestJS controller for GET /metrics that returns registry.metrics()
5. Enable default metrics (CPU, memory, event loop)
6. Export metric factory functions for use by other modules

## Acceptance Criteria

- [ ] /metrics endpoint returns valid Prometheus format
- [ ] Default Node.js metrics included
- [ ] Custom metrics can be registered

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

curl http://localhost:3000/metrics and verify format

### Suggested Validation Commands

```bash
curl -s http://localhost:3000/metrics | head -20
```

## Risks / Notes

Metric cardinality must stay low. Follow label rules from §10.13.4.

## Follow-on Tasks

T079
