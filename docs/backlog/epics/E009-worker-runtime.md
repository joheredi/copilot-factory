# E009: Worker Runtime & Execution

## Summary

Define the worker runtime interface, build the Worker Supervisor, implement the Copilot CLI adapter, and the policy-aware command wrapper.

## Why This Epic Exists

Workers execute the actual AI agent work. The runtime abstraction enables pluggable execution backends while enforcing policies.

## Goals

- Stable worker runtime interface
- Worker Supervisor for process lifecycle
- Copilot CLI execution adapter
- Structured output capture and schema validation
- Policy-aware command wrapper

## Scope

### In Scope

- Runtime interface from docs/prd/010-integration-contracts.md §10.8
- Process spawn/monitor/teardown
- stdout/stderr capture
- Result packet validation

### Out of Scope

- Local LLM adapter (future)
- Remote API adapter (future)

## Dependencies

**Depends on:** E004, E005, E006, E008, E010

**Enables:** E012, E013, E022

## Risks / Notes

Copilot CLI integration details may require experimentation. Command wrapper must be comprehensive.

## Tasks

| ID                                                 | Title                                              | Priority | Status  |
| -------------------------------------------------- | -------------------------------------------------- | -------- | ------- |
| [T043](../tasks/T043-worker-runtime-interface.md)  | Define worker runtime interface                    | P0       | pending |
| [T044](../tasks/T044-worker-supervisor.md)         | Implement Worker Supervisor                        | P0       | pending |
| [T045](../tasks/T045-copilot-cli-adapter.md)       | Implement Copilot CLI execution adapter            | P0       | pending |
| [T046](../tasks/T046-output-capture-validation.md) | Implement structured output capture and validation | P0       | pending |
| [T047](../tasks/T047-command-wrapper.md)           | Implement policy-aware command wrapper             | P0       | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

Worker Supervisor can spawn, monitor, and teardown worker processes. Copilot CLI adapter executes tasks and captures structured output.
