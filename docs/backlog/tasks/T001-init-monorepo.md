# T001: Initialize pnpm monorepo workspace

| Field | Value |
|---|---|
| **ID** | T001 |
| **Epic** | [E001: Repository & Platform Foundation](../epics/E001-platform-foundation.md) |
| **Type** | foundation |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | platform-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | None |
| **Blocks** | [T002](./T002-typescript-config.md), [T003](./T003-eslint-prettier.md), [T004](./T004-vitest-setup.md), [T005](./T005-ci-pipeline.md), [T006](./T006-sqlite-drizzle-setup.md) |

---

## Description

Create the root pnpm monorepo with workspace definitions for apps/control-plane, apps/web-ui, apps/worker-runner, and shared packages (domain, application, infrastructure, schemas, config, observability, ui-components, testing). Establishes the project layout described in docs/prd/007-technical-architecture.md §7.4.

## Goal

Establish the foundational monorepo structure so all subsequent packages can be developed in parallel.

## Scope

### In Scope

- Root package.json with private:true and pnpm workspace config
- pnpm-workspace.yaml listing apps/* and packages/*
- Directory scaffolding for all apps and packages
- Minimal package.json for each workspace with @factory/ scope
- .gitignore, .editorconfig, .nvmrc (Node 20+)
- README.md with project overview

### Out of Scope

- TypeScript configuration (T002)
- Linting (T003)
- Test framework (T004)
- CI pipeline (T005)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Create root package.json with private:true, engines.node>=20, and packageManager field for pnpm
2. Create pnpm-workspace.yaml with packages: ['apps/*', 'packages/*']
3. Scaffold directories: apps/control-plane, apps/web-ui, apps/worker-runner
4. Scaffold directories: packages/domain, packages/application, packages/infrastructure, packages/schemas, packages/config, packages/observability, packages/ui-components, packages/testing
5. Each workspace gets package.json with name (@factory/control-plane etc.), version 0.1.0
6. Add .gitignore covering node_modules, dist, .env, *.db, /workspaces, /artifacts
7. Add .editorconfig and .nvmrc

## Acceptance Criteria

- [ ] pnpm install succeeds with no errors
- [ ] pnpm ls --recursive shows all workspace packages
- [ ] Directory structure matches docs/prd/007-technical-architecture.md §7.4
- [ ] All package.json files have @factory/ scoped names

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run pnpm install and verify workspace linking

### Suggested Validation Commands

```bash
pnpm install
```

```bash
pnpm ls --recursive --depth 0
```

## Risks / Notes

None significant. This is purely scaffolding.

## Follow-on Tasks

T002, T003, T004, T005, T006
