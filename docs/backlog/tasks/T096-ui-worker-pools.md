# T096: Build worker pool monitoring panel

| Field                     | Value                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| **ID**                    | T096                                                               |
| **Epic**                  | [E020: Web UI Feature Views](../epics/E020-web-ui-features.md)     |
| **Type**                  | feature                                                            |
| **Status**                | done                                                               |
| **Priority**              | P2                                                                 |
| **Owner**                 | frontend-engineer                                                  |
| **AI Executable**         | Yes                                                                |
| **Human Review Required** | Yes                                                                |
| **Dependencies**          | [T090](./T090-api-client-tanstack.md), [T092](./T092-app-shell.md) |
| **Blocks**                | [T105](./T105-ui-operator-pool-merge.md)                           |

---

## Description

Build the worker pool monitoring view showing pool status, active workers, and configuration.

## Goal

Give operators visibility into worker pool health and utilization.

## Scope

### In Scope

- Pool list with status (enabled/disabled), active workers, max concurrency
- Pool detail: configuration, active workers, recent runs
- Worker status indicators
- Profile list per pool

### Out of Scope

- Pool configuration editing (T099)
- Performance metrics

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/001-architecture.md`

## Implementation Guidance

1. Create apps/web-ui/src/features/pools/PoolsPage.tsx
2. Pool cards: name, type, model, active/max workers, enabled status
3. Click-through to pool detail with worker list and config
4. Worker rows: ID, status, current task, last heartbeat

## Acceptance Criteria

- [ ] All pools displayed with correct status
- [ ] Active worker count accurate
- [ ] Pool detail shows configuration and workers

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

View pools page with active workers

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm dev
```

## Risks / Notes

Worker status must update in real time. Ensure WebSocket events work.

## Follow-on Tasks

T105
