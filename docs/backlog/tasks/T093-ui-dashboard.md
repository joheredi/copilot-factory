# T093: Build dashboard view with system health summary

| Field                     | Value                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| **ID**                    | T093                                                                                                   |
| **Epic**                  | [E020: Web UI Feature Views](../epics/E020-web-ui-features.md)                                         |
| **Type**                  | feature                                                                                                |
| **Status**                | done                                                                                                   |
| **Priority**              | P1                                                                                                     |
| **Owner**                 | frontend-engineer                                                                                      |
| **AI Executable**         | Yes                                                                                                    |
| **Human Review Required** | Yes                                                                                                    |
| **Dependencies**          | [T090](./T090-api-client-tanstack.md), [T091](./T091-websocket-client.md), [T092](./T092-app-shell.md) |
| **Blocks**                | None                                                                                                   |

---

## Description

Build the dashboard view showing system health: task state summary, queue depths, worker pool status, and recent activity.

## Goal

Give operators an at-a-glance view of system status.

## Scope

### In Scope

- Task count by state (card grid)
- Active worker count by pool
- Merge queue depth
- Recent task completions and failures
- Live updates via WebSocket
- Empty state handling

### Out of Scope

- Metrics charts (future)
- Historical trends

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/001-architecture.md`

## Implementation Guidance

1. Create apps/web-ui/src/features/dashboard/DashboardPage.tsx
2. Summary cards: total tasks by state, active workers, queue depth
3. Recent activity list: last 10 task state changes with timestamps
4. Use TanStack Query hooks for data fetching
5. Responsive grid layout with shadcn/ui Card components

## Acceptance Criteria

- [ ] Dashboard shows task counts by state
- [ ] Worker pool status visible
- [ ] Queue depth shown
- [ ] Recent activity updates in real time

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

View dashboard with real data from backend

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm dev
```

## Risks / Notes

Dashboard queries may be slow. Use appropriate aggregation endpoints.

## Follow-on Tasks

None
