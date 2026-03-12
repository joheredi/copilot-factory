# T091: Implement WebSocket client for live updates

| Field                     | Value                                                                 |
| ------------------------- | --------------------------------------------------------------------- |
| **ID**                    | T091                                                                  |
| **Epic**                  | [E019: Web UI Foundation](../epics/E019-web-ui-foundation.md)         |
| **Type**                  | feature                                                               |
| **Status**                | done                                                                  |
| **Priority**              | P1                                                                    |
| **Owner**                 | frontend-engineer                                                     |
| **AI Executable**         | Yes                                                                   |
| **Human Review Required** | Yes                                                                   |
| **Dependencies**          | [T086](./T086-websocket-gateway.md), [T089](./T089-react-spa-init.md) |
| **Blocks**                | [T093](./T093-ui-dashboard.md), [T094](./T094-ui-task-board.md)       |

---

## Description

Create a WebSocket client that connects to the backend event gateway and invalidates TanStack Query caches on real-time events.

## Goal

Make the UI reactive to backend state changes without manual refresh.

## Scope

### In Scope

- WebSocket connection management (connect, reconnect, disconnect)
- Event subscription by namespace/room
- TanStack Query cache invalidation on events
- Connection status indicator

### Out of Scope

- Event history/replay
- Offline support

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Create apps/web-ui/src/lib/websocket.ts with socket.io-client
2. Auto-connect on app mount, reconnect on disconnect
3. Create useWebSocket hook that returns connection status
4. On task.stateChanged event: invalidate task queries in TanStack Query cache
5. On queue/worker events: invalidate relevant queries
6. Show connection indicator in app shell (green=connected, yellow=reconnecting, red=disconnected)

## Acceptance Criteria

- [ ] WebSocket connects on app start
- [ ] Events trigger cache invalidation
- [ ] Reconnection works after disconnect
- [ ] Connection status visible in UI

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Change task state via API, verify UI updates automatically

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm dev
```

## Risks / Notes

WebSocket reconnection must be robust. Use exponential backoff.

## Follow-on Tasks

T093, T094
