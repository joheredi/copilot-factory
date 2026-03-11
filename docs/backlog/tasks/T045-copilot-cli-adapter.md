# T045: Implement Copilot CLI execution adapter

| Field                     | Value                                                                         |
| ------------------------- | ----------------------------------------------------------------------------- |
| **ID**                    | T045                                                                          |
| **Epic**                  | [E009: Worker Runtime & Execution](../epics/E009-worker-runtime.md)           |
| **Type**                  | feature                                                                       |
| **Status**                | pending                                                                       |
| **Priority**              | P0                                                                            |
| **Owner**                 | backend-engineer                                                              |
| **AI Executable**         | Yes                                                                           |
| **Human Review Required** | Yes                                                                           |
| **Dependencies**          | [T043](./T043-worker-runtime-interface.md), [T047](./T047-command-wrapper.md) |
| **Blocks**                | [T107](./T107-e2e-full-lifecycle.md)                                          |

---

## Description

Implement the Copilot CLI adapter that translates the worker runtime interface into Copilot CLI invocations with proper prompt injection, output capture, and policy enforcement.

## Goal

Enable AI worker execution via GitHub Copilot CLI as the primary V1 execution backend.

## Scope

### In Scope

- Implement WorkerRuntime interface for Copilot CLI
- Prompt injection with role and task context
- stdout/stderr separation and capture
- Structured output extraction (delimiter-based or file-based)
- Policy-aware command execution via wrapper
- Schema validation of final output packet

### Out of Scope

- Other execution backends
- Model selection logic

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/010-integration-contracts.md`
- `docs/prd/004-agent-contracts.md`

## Implementation Guidance

1. Create packages/infrastructure/src/worker-runtime/copilot-cli-adapter.ts
2. prepareRun: write task packet and policy snapshot to workspace, generate prompt file
3. startRun: spawn copilot CLI process with appropriate flags, pipe stdin/stdout
4. Inject the system prompt based on role (developer, reviewer, lead-reviewer) from agent contracts
5. Capture stdout to log file, capture structured output to designated output file
6. streamRun: tail the output file for incremental updates
7. collectArtifacts: read output file, validate against expected schema, collect logs
8. Use the policy-aware command wrapper (T047) for any shell execution

## Acceptance Criteria

- [ ] Copilot CLI process spawned with correct arguments
- [ ] Prompt includes role, task context, and output schema expectations
- [ ] Structured output captured and schema-validated
- [ ] Logs captured separately from structured output

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

End-to-end test with Copilot CLI on a sample repo

### Suggested Validation Commands

```bash
pnpm test --filter @factory/infrastructure -- --grep copilot
```

## Risks / Notes

Copilot CLI interface details may require experimentation. Create a spike first if needed.

## Follow-on Tasks

T107
