# T006: Set up SQLite with Drizzle ORM and migrations

| Field | Value |
|---|---|
| **ID** | T006 |
| **Epic** | [E001: Repository & Platform Foundation](../epics/E001-platform-foundation.md) |
| **Type** | foundation |
| **Status** | done |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T001](./T001-init-monorepo.md), [T002](./T002-typescript-config.md) |
| **Blocks** | [T008](./T008-migration-project-repo.md), [T009](./T009-migration-task.md), [T010](./T010-migration-worker-pool.md), [T011](./T011-migration-lease-review.md), [T012](./T012-migration-merge-job.md), [T013](./T013-migration-audit-policy.md) |

---

## Description

Configure SQLite with WAL mode and Drizzle ORM in the control-plane app. Set up the migration system and database connection management.

## Goal

Establish the persistence foundation so domain entities can be stored and queried.

## Scope

### In Scope

- better-sqlite3 driver with WAL mode
- Drizzle ORM configuration in apps/control-plane
- Migration system with drizzle-kit
- Database connection factory with WAL and BEGIN IMMEDIATE
- db:migrate, db:generate, db:studio scripts

### Out of Scope

- Actual entity schemas (E002)
- Postgres support (future)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`
- `docs/prd/010-integration-contracts.md`

## Implementation Guidance

1. Install drizzle-orm, better-sqlite3, drizzle-kit in apps/control-plane
2. Create src/infrastructure/database/connection.ts with WAL mode enabled
3. Configure drizzle-kit for SQLite with migrations directory
4. Add pragmas: journal_mode=WAL, busy_timeout=5000, foreign_keys=ON
5. Create db:migrate and db:generate scripts in package.json
6. Add a health-check query to verify DB connection

## Acceptance Criteria

- [ ] SQLite database file is created with WAL mode
- [ ] drizzle-kit generate produces migration files
- [ ] drizzle-kit migrate runs successfully
- [ ] Connection uses BEGIN IMMEDIATE for write transactions

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run db:migrate and verify database is created with WAL mode

### Suggested Validation Commands

```bash
cd apps/control-plane && pnpm db:migrate
```

## Risks / Notes

better-sqlite3 requires native compilation. Ensure build tools are available.

## Follow-on Tasks

T008, T009, T010, T011, T012, T013
