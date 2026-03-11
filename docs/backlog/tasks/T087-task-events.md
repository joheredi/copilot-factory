# T087: Implement task state change event broadcasting

| Field                     | Value                                                                     |
| ------------------------- | ------------------------------------------------------------------------- |
| **ID**                    | T087                                                                      |
| **Epic**                  | [E018: Real-time Events](../epics/E018-realtime-events.md)                |
| **Type**                  | feature                                                                   |
| **Status**                | pending                                                                   |
| **Priority**              | P1                                                                        |
| **Owner**                 | backend-engineer                                                          |
| **AI Executable**         | Yes                                                                       |
| **Human Review Required** | Yes                                                                       |
| **Dependencies**          | [T086](./T086-websocket-gateway.md), [T017](./T017-transition-service.md) |
| **Blocks**                | None                                                                      |

---

## Description

Broadcast task state change events via WebSocket when the transition service commits transitions.

## Goal

Keep the UI in sync with task state changes in real time.

## Scope

### In Scope

- Subscribe to transition service domain events
- Broadcast task state changes to /tasks namespace
- Event payload: taskId, oldState, newState, timestamp, actor

### Out of Scope

- Worker log streaming
- Detailed packet change events

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. In the TransitionService, after successful commit, call EventBroadcaster.emitTaskChange()
2. Event: { type: 'task.stateChanged', taskId, repositoryId, oldState, newState, timestamp }
3. Broadcast to /tasks namespace and task-specific room
4. Clients subscribed to a specific task get targeted updates

## Acceptance Criteria

- [ ] State changes broadcast within milliseconds of commit
- [ ] Events include all required fields
- [ ] Room-based targeting works for task-specific subscriptions

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Change task state and verify WebSocket event received

### Suggested Validation Commands

```bash
pnpm test --filter @factory/control-plane -- --grep task-event
```

## Risks / Notes

Event emission must be after commit, not before. Don't emit on rollback.

## Follow-on Tasks

None
