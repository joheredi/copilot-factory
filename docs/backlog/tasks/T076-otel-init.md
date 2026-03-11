# T076: Initialize OpenTelemetry TracerProvider

| Field                     | Value                                                 |
| ------------------------- | ----------------------------------------------------- |
| **ID**                    | T076                                                  |
| **Epic**                  | [E016: Observability](../epics/E016-observability.md) |
| **Type**                  | feature                                               |
| **Status**                | pending                                               |
| **Priority**              | P1                                                    |
| **Owner**                 | backend-engineer                                      |
| **AI Executable**         | Yes                                                   |
| **Human Review Required** | Yes                                                   |
| **Dependencies**          | [T075](./T075-structured-logging.md)                  |
| **Blocks**                | [T077](./T077-otel-spans.md)                          |

---

## Description

Set up the OpenTelemetry SDK with TracerProvider, span exporters, and context propagation for the control plane service.

## Goal

Establish the tracing foundation for observability across orchestration steps.

## Scope

### In Scope

- @opentelemetry/sdk-node setup
- TracerProvider configuration
- OTLP exporter (configurable endpoint)
- Console exporter for development
- W3C trace context propagation
- Automatic HTTP instrumentation

### Out of Scope

- Custom spans (T077)
- Metrics (T078)
- Grafana/Jaeger setup

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/010-integration-contracts.md`
- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Create packages/observability/src/tracing.ts
2. Install @opentelemetry/sdk-node, @opentelemetry/api, @opentelemetry/exporter-trace-otlp-http
3. Configure TracerProvider with service name 'factory-control-plane'
4. Add OTLP exporter with configurable endpoint (default: http://localhost:4318)
5. Add console exporter for dev mode
6. Auto-instrument HTTP with @opentelemetry/instrumentation-http
7. Export a getTracer(moduleName) function for creating spans

## Acceptance Criteria

- [ ] TracerProvider initializes on app start
- [ ] HTTP requests generate automatic spans
- [ ] Trace context propagates across calls
- [ ] Exporter is configurable

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Start app, make API call, verify trace output

### Suggested Validation Commands

```bash
pnpm test --filter @factory/observability -- --grep tracing
```

## Risks / Notes

OpenTelemetry SDK adds startup overhead. Keep it minimal for V1.

## Follow-on Tasks

T077
