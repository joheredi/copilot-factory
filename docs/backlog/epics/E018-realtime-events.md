# E018: Real-time Events

## Summary

Implement WebSocket/SSE gateway for live task state updates, worker heartbeats, and queue status broadcasting.

## Why This Epic Exists

The UI needs real-time updates to show live system state without polling.

## Goals

- WebSocket gateway
- Task state change broadcasting
- Queue and worker status events

## Scope

### In Scope

- Event types from docs/prd/007-technical-architecture.md §7.7
- Connection management
- Event serialization

### Out of Scope

- Client reconnection logic (UI responsibility)
- Event persistence

## Dependencies

**Depends on:** E017

**Enables:** E019

## Risks / Notes

WebSocket connections need lifecycle management. Must handle disconnects gracefully.

## Tasks

| ID                                           | Title                                          | Priority | Status  |
| -------------------------------------------- | ---------------------------------------------- | -------- | ------- |
| [T086](../tasks/T086-websocket-gateway.md)   | Implement WebSocket gateway for live events    | P1       | pending |
| [T087](../tasks/T087-task-events.md)         | Implement task state change event broadcasting | P1       | pending |
| [T088](../tasks/T088-queue-worker-events.md) | Implement queue and worker status broadcasting | P2       | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

Clients receive real-time updates for state changes, heartbeats, and queue movements.
