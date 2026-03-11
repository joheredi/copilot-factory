# T088: Implement queue and worker status broadcasting

| Field                     | Value                                                      |
| ------------------------- | ---------------------------------------------------------- |
| **ID**                    | T088                                                       |
| **Epic**                  | [E018: Real-time Events](../epics/E018-realtime-events.md) |
| **Type**                  | feature                                                    |
| **Status**                | pending                                                    |
| **Priority**              | P2                                                         |
| **Owner**                 | backend-engineer                                           |
| **AI Executable**         | Yes                                                        |
| **Human Review Required** | Yes                                                        |
| **Dependencies**          | [T086](./T086-websocket-gateway.md)                        |
| **Blocks**                | None                                                       |

---

## Description

Broadcast worker pool status updates and merge queue changes via WebSocket.

## Goal

Keep the UI pool and queue views updated in real time.

## Scope

### In Scope

- Worker heartbeat status broadcasting
- Pool active worker count updates
- Merge queue position changes
- Job queue depth updates

### Out of Scope

- Log streaming
- Detailed worker telemetry

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Emit events when: worker status changes, heartbeat received, queue item enqueued/dequeued
2. Broadcast to /workers and /queue namespaces
3. Throttle heartbeat events (broadcast at most every 5s per worker to avoid flooding)
4. Queue depth can be polled periodically (every 5s) and broadcast as gauge

## Acceptance Criteria

- [ ] Worker status changes broadcast
- [ ] Queue changes broadcast
- [ ] Event throttling prevents flooding
- [ ] Namespace targeting correct

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Monitor WebSocket events during task execution

### Suggested Validation Commands

```bash
pnpm test --filter @factory/control-plane -- --grep queue-event
```

## Risks / Notes

Too many events can overwhelm the UI. Throttle appropriately.

## Follow-on Tasks

None
