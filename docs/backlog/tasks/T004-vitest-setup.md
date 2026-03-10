# T004: Set up Vitest testing framework

| Field | Value |
|---|---|
| **ID** | T004 |
| **Epic** | [E001: Repository & Platform Foundation](../epics/E001-platform-foundation.md) |
| **Type** | foundation |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | platform-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T001](./T001-init-monorepo.md), [T002](./T002-typescript-config.md) |
| **Blocks** | [T005](./T005-ci-pipeline.md), [T015](./T015-task-state-machine.md), [T020](./T020-shared-zod-types.md) |

---

## Description

Configure Vitest as the test runner for the monorepo with workspace support, coverage reporting, and test path aliases.

## Goal

Provide a fast, TypeScript-native test framework for all packages.

## Scope

### In Scope

- Root vitest.workspace.ts
- Per-package vitest.config.ts
- Coverage configuration with v8
- Test scripts in root and per-package
- Shared test utilities in packages/testing

### Out of Scope

- E2E test framework (T106)
- UI component tests (added in T089)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Install vitest, @vitest/coverage-v8 as root devDependencies
2. Create vitest.workspace.ts referencing all packages
3. Each package gets vitest.config.ts with path aliases matching tsconfig
4. Add test, test:watch, test:coverage scripts
5. Create a sample test in packages/testing to verify setup
6. Configure coverage thresholds (start at 0, increase as code is added)

## Acceptance Criteria

- [ ] pnpm test runs successfully (even with 0 tests initially)
- [ ] pnpm test:coverage generates coverage report
- [ ] Test path aliases resolve correctly

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run pnpm test and verify framework initializes

### Suggested Validation Commands

```bash
pnpm test
```

```bash
pnpm test:coverage
```

## Risks / Notes

Vitest workspace configuration must align with pnpm workspaces.

## Follow-on Tasks

T005, T015, T020
