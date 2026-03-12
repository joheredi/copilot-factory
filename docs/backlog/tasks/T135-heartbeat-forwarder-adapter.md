# T135: Implement HeartbeatForwarderPort adapter

| Field                     | Value                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| **ID**                    | T135                                                                |
| **Epic**                  | [E009: Worker Runtime & Execution](../epics/E009-worker-runtime.md) |
| **Type**                  | infrastructure                                                      |
| **Status**                | done                                                                |
| **Priority**              | P0                                                                  |
| **Owner**                 | backend-engineer                                                    |
| **AI Executable**         | Yes                                                                 |
| **Human Review Required** | Yes                                                                 |
| **Dependencies**          | [T134](./T134-worker-dispatch-adapter.md)                           |
| **Blocks**                | [T137](./T137-wire-dispatch-automation.md)                          |

---

## Description

Implement a `HeartbeatForwarderPort` adapter that bridges to the `HeartbeatService.receiveHeartbeat()` method. The `WorkerSupervisorService` calls `heartbeatForwarder.forwardHeartbeat(leaseId, workerId, isTerminal)` during worker execution to keep the lease alive and signal completion. This adapter translates those calls into `HeartbeatService` invocations.

## Goal

Enable worker heartbeats to flow from the runtime adapter through the supervisor to the lease/heartbeat system, keeping leases alive and progressing the lease state machine (LEASED → STARTING → RUNNING → HEARTBEATING → COMPLETING).

## Scope

### In Scope

- Adapter class/factory implementing `HeartbeatForwarderPort`
- Translates `forwardHeartbeat(leaseId, workerId, isTerminal)` to `heartbeatService.receiveHeartbeat({ leaseId, completing: isTerminal, actor })`
- System actor identity for heartbeat forwarding
- Error handling (log and swallow vs propagate — heartbeat failures should not crash the worker)

### Out of Scope

- HeartbeatService itself (already implemented)
- Staleness detection (handled by reconciliation sweep)

## Context Files

The implementing agent should read these files before starting:

- `packages/application/src/ports/worker-supervisor.ports.ts` — `HeartbeatForwarderPort` interface
- `packages/application/src/services/heartbeat.service.ts` — `HeartbeatService` and `receiveHeartbeat()` API
- `packages/application/src/services/worker-supervisor.service.ts` — how the supervisor calls the forwarder (lines 339, 368)

## Implementation Guidance

1. Create the adapter in `apps/control-plane/src/automation/` (co-located with other adapters)
2. Constructor/factory takes `HeartbeatService` dependency
3. Implement `forwardHeartbeat()`:
   ```typescript
   forwardHeartbeat(leaseId: string, workerId: string, isTerminal: boolean): void {
     try {
       this.heartbeatService.receiveHeartbeat({
         leaseId,
         completing: isTerminal,
         actor: { type: "system", id: "worker-supervisor" },
       });
     } catch (error) {
       // Log but don't throw — heartbeat failure should not kill the worker
       this.logger.warn("Heartbeat forwarding failed", { leaseId, workerId, error });
     }
   }
   ```
4. Note: `forwardHeartbeat()` is synchronous (void return) while `receiveHeartbeat()` is also synchronous — no async mismatch

## Acceptance Criteria

- [ ] Adapter implements `HeartbeatForwarderPort` interface
- [ ] Calls `heartbeatService.receiveHeartbeat()` with correct params
- [ ] Maps `isTerminal` to `completing` field
- [ ] Errors are caught and logged, not propagated
- [ ] Unit tests verify forwarding and error handling

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

### Suggested Validation Commands

```bash
pnpm build --filter @factory/control-plane
```

## Risks / Notes

Heartbeat forwarding happens during the worker's async execution stream. If `receiveHeartbeat()` throws (e.g., lease expired, version conflict), the adapter must catch and log — not crash the worker process.

## Follow-on Tasks

T137
