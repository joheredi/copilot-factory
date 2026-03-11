# T044: Implement Worker Supervisor

| Field                     | Value                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T044                                                                                                                                                       |
| **Epic**                  | [E009: Worker Runtime & Execution](../epics/E009-worker-runtime.md)                                                                                        |
| **Type**                  | feature                                                                                                                                                    |
| **Status**                | pending                                                                                                                                                    |
| **Priority**              | P0                                                                                                                                                         |
| **Owner**                 | backend-engineer                                                                                                                                           |
| **AI Executable**         | Yes                                                                                                                                                        |
| **Human Review Required** | Yes                                                                                                                                                        |
| **Dependencies**          | [T030](./T030-lease-acquisition.md), [T039](./T039-worktree-creation.md), [T040](./T040-workspace-mounting.md), [T043](./T043-worker-runtime-interface.md) |
| **Blocks**                | [T045](./T045-copilot-cli-adapter.md), [T046](./T046-output-capture-validation.md), [T106](./T106-test-harness.md)                                         |

---

## Description

Build the Worker Supervisor that spawns worker processes, monitors their lifecycle, tracks heartbeats, mediates workspace access, and handles process termination.

## Goal

Manage the full lifecycle of worker processes from spawn to cleanup.

## Scope

### In Scope

- spawnWorker(runContext) — create workspace, mount packets, start adapter
- Process monitoring (exit codes, signals)
- Heartbeat forwarding to lease service
- Run ID and budget tracking
- Process termination on cancel/timeout
- Worker entity creation and status updates

### Out of Scope

- Specific adapter logic (T045)
- Remote worker management

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`
- `docs/prd/010-integration-contracts.md`

## Implementation Guidance

1. Create packages/application/src/services/worker-supervisor.service.ts
2. spawnWorker: 1) create Worker record, 2) create workspace, 3) mount packets, 4) call adapter.prepareRun, 5) call adapter.startRun
3. Monitor: track process via adapter.streamRun, forward heartbeats
4. On process exit: call adapter.collectArtifacts, adapter.finalizeRun
5. On timeout/cancel: call adapter.cancelRun, force kill if needed
6. Update Worker entity status throughout lifecycle

## Acceptance Criteria

- [ ] Workers spawn correctly with workspace and packets
- [ ] Process exit detected and handled
- [ ] Heartbeats forwarded to lease service
- [ ] Cancel/timeout terminates the process
- [ ] Worker entity reflects actual status

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Integration test with a mock adapter

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep supervisor
```

## Risks / Notes

Process management is OS-dependent. Test on target platform.

## Follow-on Tasks

T045, T046, T106
