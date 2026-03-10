# T002: Configure TypeScript for all packages

| Field | Value |
|---|---|
| **ID** | T002 |
| **Epic** | [E001: Repository & Platform Foundation](../epics/E001-platform-foundation.md) |
| **Type** | foundation |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | platform-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T001](./T001-init-monorepo.md) |
| **Blocks** | [T007](./T007-domain-enums-types.md), [T008](./T008-migration-project-repo.md), [T009](./T009-migration-task.md), [T010](./T010-migration-worker-pool.md), [T011](./T011-migration-lease-review.md), [T012](./T012-migration-merge-job.md), [T013](./T013-migration-audit-policy.md) |

---

## Description

Set up TypeScript configuration with a root tsconfig.json base and per-package tsconfig.json files. Configure path aliases, strict mode, and project references for incremental builds.

## Goal

Enable TypeScript compilation across all workspace packages with consistent settings.

## Scope

### In Scope

- Root tsconfig.base.json with strict settings
- Per-package tsconfig.json extending base
- Path aliases for @factory/* packages
- TypeScript as devDependency in root
- Build scripts in each package.json

### Out of Scope

- NestJS-specific config (T080)
- React/Vite-specific config (T089)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Create tsconfig.base.json with strict:true, esModuleInterop:true, target ES2022, module NodeNext
2. Each package extends root: {extends: '../../tsconfig.base.json'}
3. Configure project references for incremental builds
4. Add typescript and tsx as root devDependencies
5. Add build scripts: tsc --build for library packages

## Acceptance Criteria

- [ ] pnpm --recursive run build succeeds (even if output is empty)
- [ ] TypeScript strict mode enabled globally
- [ ] Path aliases resolve correctly across packages

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run pnpm -r build and verify no TypeScript errors

### Suggested Validation Commands

```bash
pnpm -r build
```

```bash
pnpm exec tsc --noEmit
```

## Risks / Notes

Path alias configuration can be tricky in monorepos. Test cross-package imports.

## Follow-on Tasks

T007, T008, T009, T010, T011, T012, T013
