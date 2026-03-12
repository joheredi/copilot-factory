# T136: Wire workspace, runtime, and packet infrastructure adapters

| Field                     | Value                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| **ID**                    | T136                                                                |
| **Epic**                  | [E009: Worker Runtime & Execution](../epics/E009-worker-runtime.md) |
| **Type**                  | infrastructure                                                      |
| **Status**                | pending                                                             |
| **Priority**              | P0                                                                  |
| **Owner**                 | backend-engineer                                                    |
| **AI Executable**         | Yes                                                                 |
| **Human Review Required** | Yes                                                                 |
| **Dependencies**          | [T134](./T134-worker-dispatch-adapter.md)                           |
| **Blocks**                | [T137](./T137-wire-dispatch-automation.md)                          |

---

## Description

Wire the existing infrastructure adapter implementations (`WorkspaceManager`, `WorkspacePacketMounter`, `CopilotCliAdapter`) into the control-plane's automation module so they can be injected into the `WorkerSupervisorService`. These adapters already exist in `@factory/infrastructure` — this task is about instantiating and configuring them for use in the control-plane process.

## Goal

Provide concrete implementations of `WorkspaceProviderPort`, `PacketMounterPort`, and `RuntimeAdapterPort` for the Worker Supervisor to use when spawning workers.

## Scope

### In Scope

- Instantiate `WorkspaceManager` with configured paths (workspacesRoot, git operations, filesystem)
- Instantiate `WorkspacePacketMounter` with filesystem dependency
- Instantiate `CopilotCliAdapter` with process spawner and filesystem
- Configure paths from environment or project configuration (repo path, workspaces root directory)
- Create factory functions or NestJS providers for each adapter

### Out of Scope

- Modifying the adapter implementations themselves (already done in T039-T045)
- Worker Supervisor unit-of-work (T134)
- HeartbeatForwarder (T135)
- AutomationService integration (T137)

## Context Files

The implementing agent should read these files before starting:

- `packages/infrastructure/src/workspace/workspace-manager.ts` — WorkspaceProviderPort implementation
- `packages/infrastructure/src/workspace/workspace-packet-mounter.ts` — PacketMounterPort implementation
- `packages/infrastructure/src/worker-runtime/copilot-cli-adapter.ts` — RuntimeAdapterPort implementation
- `packages/infrastructure/src/workspace/exec-git-operations.ts` — Git operations factory
- `packages/infrastructure/src/workspace/node-fs.ts` — Filesystem factory

## Implementation Guidance

1. Create a factory module or file in `apps/control-plane/src/automation/` for infrastructure wiring
2. Workspace paths should come from environment/config:
   - `WORKSPACES_ROOT` — base directory for all worktrees (default: `./data/workspaces`)
   - Repository path comes from the task's project/repository entity
3. Wire dependencies:
   ```typescript
   const fs = createNodeFileSystem();
   const git = createExecGitOperations();
   const workspaceManager = new WorkspaceManager({ workspacesRoot, git, fs });
   const packetMounter = new WorkspacePacketMounter({ fs });
   const runtimeAdapter = new CopilotCliAdapter({
     fs,
     processSpawner: createDefaultProcessSpawner(),
   });
   ```
4. These can be NestJS providers or simple factory functions called from AutomationService constructor

## Acceptance Criteria

- [ ] WorkspaceManager instantiated with correct configuration
- [ ] WorkspacePacketMounter instantiated with filesystem
- [ ] CopilotCliAdapter instantiated with process spawner
- [ ] All adapters satisfy their respective port interfaces
- [ ] Configuration is externalized (env vars or config module)
- [ ] Build succeeds with all imports resolved

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

- `@factory/infrastructure` must be added as a dependency of `apps/control-plane` if not already present.
- The `CopilotCliAdapter` requires `gh copilot` CLI to be available on the system PATH. For development/testing, use `FakeRunnerAdapter` from `@factory/testing`.
- Workspace root directory must exist and be writable. Consider creating it on startup if missing.

## Follow-on Tasks

T137
