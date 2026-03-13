# T147: Implement two-phase Ctrl+C shutdown

| Field                     | Value                                                                    |
| ------------------------- | ------------------------------------------------------------------------ |
| **ID**                    | T147                                                                     |
| **Epic**                  | [E027: Factory Lifecycle & Recovery](../epics/E027-factory-lifecycle.md) |
| **Type**                  | feature                                                                  |
| **Status**                | done                                                                     |
| **Priority**              | P0                                                                       |
| **Owner**                 | platform-engineer                                                        |
| **AI Executable**         | Yes                                                                      |
| **Human Review Required** | Yes                                                                      |
| **Dependencies**          | [T145](./T145-start-command.md)                                          |
| **Blocks**                | [T148](./T148-startup-recovery-log.md)                                   |

---

## Description

Implement two-phase shutdown for the factory process. First Ctrl+C initiates a graceful drain: stop accepting new work, wait up to 30 seconds for active workers to finish, flush telemetry, close the database, and exit cleanly. Second Ctrl+C force-kills tracked child processes and exits immediately.

## Goal

Give operators a predictable shutdown experience: first attempt is graceful, second is immediate. On next restart, the reconciliation sweep recovers any interrupted work.

## Scope

### In Scope

- `apps/cli/src/shutdown.ts` module with `setupShutdownHandlers(app, childPids)`
- Track child process PIDs in a `Set<number>` (populated by worker supervisor when spawning)
- First SIGINT handler:
  - Log: "Shutting down gracefully... (30s drain, Ctrl+C again to force)"
  - Call a `drain()` function that: stops the scheduler, waits for active workers (poll DB for running leases), respects 30s timeout
  - Flush OpenTelemetry via `tracingHandle.shutdown()`
  - Close DB via `app.close()`
  - Exit with code 0
- Second SIGINT handler:
  - Log: "Force stopping..."
  - Send SIGKILL to all PIDs in the tracked set
  - Exit with code 1
- Replace the existing SIGTERM/SIGINT handlers in main.ts startup

### Out of Scope

- Background daemon management
- Process group management (setsid)
- Recovery on restart (existing reconciliation handles this)

## Context Files

The implementing agent should read these files before starting:

- `apps/control-plane/src/main.ts` — current SIGTERM/SIGINT handlers (line ~70)
- `packages/application/src/services/worker-supervisor.service.ts` — `spawnWorker()` where child PIDs originate
- `packages/application/src/services/reconciliation-sweep.service.ts` — how recovery works on restart
- `packages/application/src/services/heartbeat.service.ts` — `detectStaleLeases()` (recovery mechanism)

## Implementation Guidance

1. Create `apps/cli/src/shutdown.ts`:

   ```typescript
   export function setupShutdownHandlers(
     app: NestFastifyApplication,
     tracingHandle: TracingHandle,
     childPids: Set<number>,
     drainTimeoutMs = 30_000,
   ): void {
     let draining = false;

     process.on("SIGINT", () => {
       if (draining) {
         // Second Ctrl+C — force kill
         console.log("\nForce stopping...");
         for (const pid of childPids) {
           try {
             process.kill(pid, "SIGKILL");
           } catch {
             /* already dead */
           }
         }
         process.exit(1);
       }

       draining = true;
       console.log("\nShutting down gracefully... (30s drain, Ctrl+C again to force)");

       // Drain: stop accepting work, wait for active workers
       drain(app, drainTimeoutMs)
         .then(() => tracingHandle.shutdown())
         .then(() => app.close())
         .then(() => process.exit(0))
         .catch(() => process.exit(1));
     });

     process.on("SIGTERM", () => {
       /* same as first SIGINT */
     });
   }
   ```

2. `drain()` function:
   - Access the NestJS DI container to get the scheduler service
   - Call a method to pause scheduling (or set a flag that prevents new job claims)
   - Poll DB for active leases (status = RUNNING/HEARTBEATING) every 2 seconds
   - When count reaches 0 or timeout expires, resolve
3. The child PID set needs to be passed from the start command through to the worker supervisor. For V1, this can be a module-level Set exported from shutdown.ts.
4. Write tests: verify first SIGINT triggers drain, second triggers force kill

## Acceptance Criteria

- [ ] First Ctrl+C logs drain message and begins graceful shutdown
- [ ] Graceful shutdown waits up to 30s for active workers
- [ ] After drain timeout, exits even if workers are still running
- [ ] Second Ctrl+C during drain force-kills tracked child processes
- [ ] Second Ctrl+C exits immediately with code 1
- [ ] SIGTERM triggers the same graceful drain as first SIGINT
- [ ] Exit code is 0 for graceful, 1 for forced

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

### Suggested Validation Commands

```bash
# Start factory, then Ctrl+C
node apps/cli/dist/cli.js start --no-open
# Press Ctrl+C — should see drain message
# Press Ctrl+C again — should force exit
```

## Risks / Notes

- Child PID tracking requires the worker supervisor to register PIDs. If the supervisor doesn't expose this, the force-kill phase is best-effort (may not kill all workers).
- On next restart, the reconciliation sweep (60s) detects any abandoned workers via stale heartbeats and recovers the tasks.

## Follow-on Tasks

T148
