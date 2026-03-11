# E001: Repository & Platform Foundation

## Summary

Bootstrap the pnpm monorepo, TypeScript toolchain, linting, testing framework, CI pipeline, and SQLite persistence layer.

## Why This Epic Exists

Every subsequent task depends on a working monorepo with build, test, and lint infrastructure. This epic establishes the development platform.

## Goals

- Working pnpm monorepo with all workspace directories
- TypeScript compilation for all packages
- Vitest test runner configured
- ESLint + Prettier enforced
- CI pipeline running lint/typecheck/test
- SQLite with Drizzle ORM and migration tooling

## Scope

### In Scope

- Monorepo structure
- TypeScript config
- Linting
- Testing framework
- CI pipeline
- Database tooling

### Out of Scope

- Domain logic
- API endpoints
- UI code

## Dependencies

**Depends on:** None

**Enables:** E002, E003, E004, E005

## Risks / Notes

Stack choices (NestJS vs Fastify, Drizzle vs Kysely) must be finalized before starting. PRD recommends NestJS + Drizzle/Kysely.

## Tasks

| ID                                            | Title                                         | Priority | Status  |
| --------------------------------------------- | --------------------------------------------- | -------- | ------- |
| [T001](../tasks/T001-init-monorepo.md)        | Initialize pnpm monorepo workspace            | P0       | done    |
| [T002](../tasks/T002-typescript-config.md)    | Configure TypeScript for all packages         | P0       | pending |
| [T003](../tasks/T003-eslint-prettier.md)      | Set up ESLint and Prettier                    | P0       | pending |
| [T004](../tasks/T004-vitest-setup.md)         | Set up Vitest testing framework               | P0       | pending |
| [T005](../tasks/T005-ci-pipeline.md)          | Create CI pipeline with GitHub Actions        | P0       | pending |
| [T006](../tasks/T006-sqlite-drizzle-setup.md) | Set up SQLite with Drizzle ORM and migrations | P0       | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

All workspace packages build, lint, and pass an empty test suite. CI pipeline runs green.
