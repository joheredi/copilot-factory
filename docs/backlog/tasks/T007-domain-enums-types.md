# T007: Define core domain enums and value objects

| Field | Value |
|---|---|
| **ID** | T007 |
| **Epic** | [E002: Domain Model & Persistence](../epics/E002-domain-model-persistence.md) |
| **Type** | foundation |
| **Status** | done |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T002](./T002-typescript-config.md) |
| **Blocks** | [T008](./T008-migration-project-repo.md), [T009](./T009-migration-task.md), [T010](./T010-migration-worker-pool.md), [T011](./T011-migration-lease-review.md), [T012](./T012-migration-merge-job.md), [T013](./T013-migration-audit-policy.md), [T015](./T015-task-state-machine.md), [T016](./T016-supporting-state-machines.md) |

---

## Description

Create TypeScript enums and types for all domain concepts: task states, worker lease states, review cycle states, merge queue item states, job types/statuses, dependency types, validation run scopes, and all other enumerated values from the data model.

## Goal

Establish the type-safe vocabulary for the entire domain.

## Scope

### In Scope

- Task states (BACKLOG through CANCELLED)
- Worker lease states
- Review cycle states
- Merge queue item states
- Job types and statuses
- Dependency types (blocks, relates_to, parent_child)
- Validation run scopes
- Packet statuses
- Review verdicts
- Lead review decisions
- All enums from docs/prd/002-data-model.md

### Out of Scope

- Entity interfaces (defined with migrations)
- Business logic

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`
- `docs/prd/008-packet-and-schema-spec.md`

## Implementation Guidance

1. Create packages/domain/src/enums.ts with all enumerations
2. Use TypeScript const enums or string literal unions for type safety
3. Add JSDoc comments referencing the PRD section for each enum
4. Export all types from packages/domain/src/index.ts
5. Add unit tests verifying all enum values match the spec

## Acceptance Criteria

- [ ] All domain enums from docs/prd/002-data-model.md are defined
- [ ] TypeScript compilation succeeds with strict mode
- [ ] Enum values exactly match the spec (case-sensitive)

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

pnpm -r build && pnpm test --filter @factory/domain

### Suggested Validation Commands

```bash
pnpm -r build
```

```bash
pnpm test --filter @factory/domain
```

## Risks / Notes

Must keep enums precisely aligned with docs/prd/002-data-model.md.

## Follow-on Tasks

T008, T009, T010, T011, T012, T013, T015, T016
