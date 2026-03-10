# T003: Set up ESLint and Prettier

| Field | Value |
|---|---|
| **ID** | T003 |
| **Epic** | [E001: Repository & Platform Foundation](../epics/E001-platform-foundation.md) |
| **Type** | foundation |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | platform-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T001](./T001-init-monorepo.md), [T002](./T002-typescript-config.md) |
| **Blocks** | [T005](./T005-ci-pipeline.md) |

---

## Description

Configure ESLint with TypeScript support and Prettier for consistent code formatting across the monorepo.

## Goal

Enforce consistent code style and catch common errors across all packages.

## Scope

### In Scope

- Root eslint.config.js (flat config)
- Prettier configuration
- @typescript-eslint/eslint-plugin
- lint and format scripts in root package.json
- lint-staged with husky for pre-commit

### Out of Scope

- Custom lint rules
- React-specific ESLint config (added in T089)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Install eslint, @typescript-eslint/parser, @typescript-eslint/eslint-plugin, prettier, eslint-config-prettier
2. Create eslint.config.js using flat config format
3. Create .prettierrc with consistent settings (singleQuote, semi, trailingComma)
4. Add root scripts: lint, lint:fix, format, format:check
5. Install husky and lint-staged for pre-commit hooks

## Acceptance Criteria

- [ ] pnpm lint runs without errors on existing code
- [ ] pnpm format:check passes
- [ ] Pre-commit hook runs lint-staged

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run pnpm lint && pnpm format:check

### Suggested Validation Commands

```bash
pnpm lint
```

```bash
pnpm format:check
```

## Risks / Notes

ESLint flat config is relatively new. Ensure compatibility with TypeScript plugin.

## Follow-on Tasks

T005
