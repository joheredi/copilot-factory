# T086: Implement WebSocket gateway for live events

| Field | Value |
|---|---|
| **ID** | T086 |
| **Epic** | [E018: Real-time Events](../epics/E018-realtime-events.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P1 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T080](./T080-nestjs-bootstrap.md) |
| **Blocks** | [T087](./T087-task-events.md), [T088](./T088-queue-worker-events.md), [T091](./T091-websocket-client.md) |

---

## Description

Create a WebSocket gateway using NestJS @WebSocketGateway for real-time event delivery to UI clients.

## Goal

Enable live UI updates without polling.

## Scope

### In Scope

- @nestjs/websockets + socket.io or ws
- Connection management
- Room/namespace per entity type
- Event serialization
- Connection auth (simple token for V1 local mode)

### Out of Scope

- SSE fallback (optional)
- Event persistence
- External pub/sub

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Install @nestjs/websockets and @nestjs/platform-socket.io (or ws)
2. Create EventsGateway with @WebSocketGateway decorator
3. Support namespaces: /tasks, /workers, /queue
4. Clients can subscribe to specific entity updates
5. Create EventBroadcaster service that the rest of the app uses to emit events
6. Serialize events as JSON with type, entityId, data fields

## Acceptance Criteria

- [ ] WebSocket connections accepted
- [ ] Events delivered to connected clients
- [ ] Namespace/room subscriptions work
- [ ] Disconnections handled gracefully

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Connect with a WebSocket client and verify event delivery

### Suggested Validation Commands

```bash
pnpm test --filter @factory/control-plane -- --grep websocket
```

## Risks / Notes

WebSocket scaling for V1 local mode is fine. Don't over-engineer.

## Follow-on Tasks

T087, T088, T091
