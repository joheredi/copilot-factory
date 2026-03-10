# P01: Foundation

## Goal

Establish the monorepo, toolchain, database, domain types, and core infrastructure so all subsequent work can proceed safely.

## Why This Phase Exists

Nothing can be built without a working monorepo, database, type system, and test framework. This phase has zero product functionality but enables everything.

## Included Epics

- [E001](../epics/E001-platform-foundation.md): Repository & Platform Foundation
- [E002](../epics/E002-domain-model-persistence.md): Domain Model & Persistence
- [E004](../epics/E004-packet-schemas.md): Packet Schemas & Validation

## Included Tasks

T001, T002, T003, T004, T005, T006, T007, T008, T009, T010, T011, T012, T013, T014, T020, T021, T022, T023, T024

## Exit Criteria

- Monorepo builds, lints, and tests
- All database tables created via migrations
- All repositories pass CRUD tests
- All packet schemas validate against spec examples
- CI pipeline runs green

## Risks

Stack decisions (NestJS, Drizzle, etc.) must be finalized before starting.
