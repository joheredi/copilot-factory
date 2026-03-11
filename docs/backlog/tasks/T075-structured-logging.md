# T075: Implement structured logging with correlation IDs

| Field                     | Value                                                       |
| ------------------------- | ----------------------------------------------------------- |
| **ID**                    | T075                                                        |
| **Epic**                  | [E015: Audit & Event System](../epics/E015-audit-events.md) |
| **Type**                  | feature                                                     |
| **Status**                | pending                                                     |
| **Priority**              | P1                                                          |
| **Owner**                 | backend-engineer                                            |
| **AI Executable**         | Yes                                                         |
| **Human Review Required** | Yes                                                         |
| **Dependencies**          | [T004](./T004-vitest-setup.md)                              |
| **Blocks**                | [T076](./T076-otel-init.md)                                 |

---

## Description

Set up structured JSON logging with correlation fields (taskId, runId, workerId, reviewCycleId, etc.) throughout the application.

## Goal

Enable log-based debugging and tracing across all system components.

## Scope

### In Scope

- Structured JSON logger (pino or winston)
- Common fields from §7.14
- Request-scoped correlation IDs
- Log levels per module
- Log output to stdout (containerization-friendly)

### Out of Scope

- Log aggregation service
- Log-to-trace correlation

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Install pino as the logger (fast structured JSON logging)
2. Create packages/observability/src/logger.ts with factory function
3. Default fields: timestamp, level, module
4. Context fields: taskId, runId, workerId, etc.
5. Create a middleware/interceptor to inject request-scoped IDs
6. Configure log levels per module via config

## Acceptance Criteria

- [ ] All logs are structured JSON
- [ ] Correlation fields present when available
- [ ] Log levels configurable per module
- [ ] Output goes to stdout

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run application and verify log output format

### Suggested Validation Commands

```bash
pnpm test --filter @factory/observability -- --grep logger
```

## Risks / Notes

Logging must not impact performance. Use async logging.

## Follow-on Tasks

T076
