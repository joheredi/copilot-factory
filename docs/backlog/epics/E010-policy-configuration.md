# E010: Policy & Configuration

## Summary

Implement the hierarchical configuration system, command/file/validation/retry/escalation policies, and effective policy snapshot generation.

## Why This Epic Exists

Policies govern all worker behavior and system safety. The configuration system must resolve hierarchical overrides deterministically.

## Goals

- Command policy enforcement
- File scope policy enforcement
- Validation policy with profile selection
- Retry and escalation policy evaluation
- Hierarchical config resolution
- Effective policy snapshot persistence

## Scope

### In Scope

- All policy types from docs/prd/009-policy-and-enforcement-spec.md
- Configuration precedence from §9.12
- Policy snapshot structure

### Out of Scope

- UI-based policy editing (E020)
- Runtime policy hot-reload

## Dependencies

**Depends on:** E002, E004

**Enables:** E009, E011, E012, E013

## Risks / Notes

Policy resolution precedence must exactly match the spec. Edge cases in file scope overlap require careful testing.

## Tasks

| ID | Title | Priority | Status |
|---|---|---|---|
| [T048](../tasks/T048-command-policy.md) | Implement command policy model and enforcement | P0 | pending |
| [T049](../tasks/T049-file-scope-policy.md) | Implement file scope policy model and enforcement | P0 | pending |
| [T050](../tasks/T050-validation-policy.md) | Implement validation policy with profile selection | P0 | pending |
| [T051](../tasks/T051-retry-escalation-policy.md) | Implement retry and escalation policy evaluation | P0 | pending |
| [T052](../tasks/T052-hierarchical-config.md) | Implement hierarchical configuration resolution | P0 | pending |
| [T053](../tasks/T053-policy-snapshot.md) | Implement effective policy snapshot generation | P0 | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

All policy types enforce correctly. Config resolution follows precedence order. Snapshots are persisted per run.
