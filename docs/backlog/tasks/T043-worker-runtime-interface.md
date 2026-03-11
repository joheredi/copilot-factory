# T043: Define worker runtime interface

| Field                     | Value                                                                      |
| ------------------------- | -------------------------------------------------------------------------- |
| **ID**                    | T043                                                                       |
| **Epic**                  | [E009: Worker Runtime & Execution](../epics/E009-worker-runtime.md)        |
| **Type**                  | foundation                                                                 |
| **Status**                | pending                                                                    |
| **Priority**              | P0                                                                         |
| **Owner**                 | backend-engineer                                                           |
| **AI Executable**         | Yes                                                                        |
| **Human Review Required** | Yes                                                                        |
| **Dependencies**          | [T004](./T004-vitest-setup.md)                                             |
| **Blocks**                | [T044](./T044-worker-supervisor.md), [T045](./T045-copilot-cli-adapter.md) |

---

## Description

Define the TypeScript interface for worker runtime adapters: prepareRun, startRun, streamRun, cancelRun, collectArtifacts, finalizeRun.

## Goal

Establish a stable, pluggable contract so execution backends can be swapped without changing orchestration.

## Scope

### In Scope

- WorkerRuntime interface with all methods from §10.8.2
- RunContext type (task packet, policy snapshot, workspace paths, timeout settings)
- RunResult type (status, artifacts, structured output)
- Runtime registration mechanism

### Out of Scope

- Concrete adapter implementations (T045)
- Worker Supervisor (T044)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/010-integration-contracts.md`
- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Create packages/infrastructure/src/worker-runtime/runtime.interface.ts
2. Define WorkerRuntime interface with: prepareRun(ctx), startRun(ctx), streamRun(runId), cancelRun(runId), collectArtifacts(runId), finalizeRun(runId)
3. Define RunContext: taskPacket, effectivePolicySnapshot, workspacePaths, outputSchemaExpectation, timeoutSettings
4. Define RunResult: status (success|failed|partial|cancelled), packetOutput, artifactPaths, logs
5. Export types from package index

## Acceptance Criteria

- [ ] Interface defined with all required methods
- [ ] RunContext and RunResult types are comprehensive
- [ ] Types compile and are exportable

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

TypeScript compilation succeeds

### Suggested Validation Commands

```bash
pnpm -r build
```

## Risks / Notes

Interface must be stable — changes affect all adapters.

## Follow-on Tasks

T044, T045
