# T040: Implement workspace packet and config mounting

| Field                     | Value                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| **ID**                    | T040                                                                |
| **Epic**                  | [E008: Workspace Management](../epics/E008-workspace-management.md) |
| **Type**                  | feature                                                             |
| **Status**                | done                                                                |
| **Priority**              | P0                                                                  |
| **Owner**                 | backend-engineer                                                    |
| **AI Executable**         | Yes                                                                 |
| **Human Review Required** | Yes                                                                 |
| **Dependencies**          | [T039](./T039-worktree-creation.md)                                 |
| **Blocks**                | [T044](./T044-worker-supervisor.md)                                 |

---

## Description

Mount the task packet JSON, run config, and effective policy snapshot into the workspace directory before worker execution.

## Goal

Ensure the worker has all necessary context files when it starts.

## Scope

### In Scope

- Write task-packet.json to workspace root
- Write run-config.json with runtime settings
- Write effective-policy-snapshot.json with resolved policies
- Validate all files are valid JSON before mounting

### Out of Scope

- Credentials/secrets mounting (deferred)
- Tool configuration

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. mountPackets(workspacePath, taskPacket, runConfig, policySnapshot)
2. Write each as a JSON file in the workspace root directory (alongside worktree/)
3. Verify written files are readable and valid JSON
4. If any write fails, clean up partial files and throw

## Acceptance Criteria

- [ ] Task packet, run config, and policy snapshot written to workspace
- [ ] Files are valid, readable JSON
- [ ] Partial failures are cleaned up

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Mount packets and verify file contents

### Suggested Validation Commands

```bash
pnpm test --filter @factory/infrastructure -- --grep mount
```

## Risks / Notes

File write permissions could be an issue. Handle gracefully.

## Follow-on Tasks

T044
