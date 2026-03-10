# E004: Packet Schemas & Validation

## Summary

Define Zod schemas for all packet types (TaskPacket, DevResultPacket, ReviewPacket, etc.) with cross-field validation.

## Why This Epic Exists

Packet schemas are the contracts between control plane and workers. They must be machine-validated before any worker integration.

## Goals

- Zod schemas for all 8 packet types
- Shared types (Issue, FileChangeSummary, ValidationCheckResult)
- Cross-field invariant validation
- Schema versioning support

## Scope

### In Scope

- All packet schemas from docs/prd/008-packet-and-schema-spec.md
- RejectionContext schema
- Policy snapshot schema
- Schema version validation

### Out of Scope

- JSON Schema export
- Schema migration tooling

## Dependencies

**Depends on:** E001

**Enables:** E009, E011, E012, E013, E014

## Risks / Notes

Schemas must exactly match the spec. Cross-field rules are tricky to implement in Zod.

## Tasks

| ID | Title | Priority | Status |
|---|---|---|---|
| [T020](../tasks/T020-shared-zod-types.md) | Define shared Zod types for packets | P0 | pending |
| [T021](../tasks/T021-schemas-task-dev.md) | Define TaskPacket and DevResultPacket Zod schemas | P0 | pending |
| [T022](../tasks/T022-schemas-review.md) | Define ReviewPacket and LeadReviewDecisionPacket schemas | P0 | pending |
| [T023](../tasks/T023-schemas-merge-validation.md) | Define remaining packet schemas | P0 | pending |
| [T024](../tasks/T024-schema-cross-validation.md) | Implement cross-field validation and schema versioning | P0 | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

All packet schemas validate correctly against spec examples. Cross-field rules enforced. 100% test coverage on schemas.
