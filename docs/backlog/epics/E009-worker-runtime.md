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

| ID                                                     | Title                                              | Priority | Status  |
| ------------------------------------------------------ | -------------------------------------------------- | -------- | ------- |
| [T043](../tasks/T043-worker-runtime-interface.md)      | Define worker runtime interface                    | P0       | done    |
| [T044](../tasks/T044-worker-supervisor.md)             | Implement Worker Supervisor                        | P0       | done    |
| [T045](../tasks/T045-copilot-cli-adapter.md)           | Implement Copilot CLI execution adapter            | P0       | done    |
| [T046](../tasks/T046-output-capture-validation.md)     | Implement structured output capture and validation | P0       | pending |
| [T047](../tasks/T047-command-wrapper.md)               | Implement policy-aware command wrapper             | P0       | pending |
| [T132](../tasks/T132-worker-dispatch-service.md)       | Implement WorkerDispatchService                    | P0       | pending |
| [T133](../tasks/T133-worker-dispatch-tests.md)         | Unit tests for WorkerDispatchService               | P0       | pending |
| [T134](../tasks/T134-worker-dispatch-adapter.md)       | Wire dispatch unit-of-work adapter                 | P0       | pending |
| [T135](../tasks/T135-heartbeat-forwarder-adapter.md)   | Implement HeartbeatForwarderPort adapter           | P0       | pending |
| [T136](../tasks/T136-infrastructure-adapter-wiring.md) | Wire workspace/runtime/packet adapters             | P0       | pending |
| [T137](../tasks/T137-wire-dispatch-automation.md)      | Integrate dispatch into AutomationService          | P0       | pending |
| [T138](../tasks/T138-dispatch-integration-test.md)     | End-to-end dispatch integration test               | P0       | pending |
| [T139](../tasks/T139-worker-runner-exports.md)         | Update worker-runner package exports               | P2       | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

Worker Supervisor can spawn, monitor, and teardown worker processes. Copilot CLI adapter executes tasks and captures structured output.
