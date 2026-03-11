# E011: Validation Runner

## Summary

Build the validation runner that executes test/lint/build checks, emits ValidationResultPackets, and enforces validation gates.

## Why This Epic Exists

Validation gates enforce quality at every stage transition. No task can progress without passing required checks.

## Goals

- Validation runner abstraction
- Command execution for test/lint/build
- ValidationResultPacket emission
- Gate checking for state transitions

## Scope

### In Scope

- Validation profiles from docs/prd/009-policy-and-enforcement-spec.md §9.5
- Required vs optional checks
- Profile selection algorithm

### Out of Scope

- Custom validator plugins
- Parallel validation execution

## Dependencies

**Depends on:** E004, E010

**Enables:** E009, E013

## Risks / Notes

Validation commands may fail for environment-specific reasons. Must handle timeouts and partial results.

## Tasks

| ID                                                     | Title                                                    | Priority | Status  |
| ------------------------------------------------------ | -------------------------------------------------------- | -------- | ------- |
| [T054](../tasks/T054-validation-runner-abstraction.md) | Implement validation runner abstraction                  | P0       | pending |
| [T055](../tasks/T055-validation-command-exec.md)       | Implement test/lint/build command execution              | P0       | pending |
| [T056](../tasks/T056-validation-packet-emission.md)    | Implement ValidationResultPacket emission                | P0       | pending |
| [T057](../tasks/T057-validation-gates.md)              | Implement validation gate checking for state transitions | P0       | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

Validation runner executes checks per profile. Results emitted as valid packets. Gates block invalid transitions.
