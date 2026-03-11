# Progress Log

## 2026-03-11 — T001: Initialize pnpm monorepo workspace

**Status:** Done

**What was done:**
- Created root `package.json` with `private: true`, `engines.node >= 20`, `packageManager: pnpm@10.12.1`, and workspace-level script stubs (`build`, `test`, `lint`, `format`, `clean`, `dev`) that delegate to `pnpm -r run`.
- Created `pnpm-workspace.yaml` listing `apps/*` and `packages/*`.
- Scaffolded 3 apps: `control-plane`, `web-ui`, `worker-runner`.
- Scaffolded 8 packages: `domain`, `application`, `infrastructure`, `schemas`, `config`, `observability`, `ui-components`, `testing`.
- Each workspace has a `package.json` with `@factory/` scoped name and version `0.1.0`.
- Added `.gitignore` (node_modules, dist, .env, *.db, /workspaces, /artifacts, IDE, OS, logs, coverage).
- Added `.editorconfig` (2-space indent, LF, UTF-8, trim trailing whitespace).
- Added `.nvmrc` (Node 20).
- Added `README.md` with project overview, structure, and setup instructions.

**Patterns established:**
- All packages use `@factory/` npm scope.
- Root scripts delegate to workspaces via `pnpm -r run`.
- pnpm version pinned via `packageManager` field in root `package.json`.

**Next steps:**
- T002: Configure TypeScript for all packages.
- T003: Set up ESLint and Prettier.
- T004: Set up Vitest testing framework.
- T005: Create CI pipeline with GitHub Actions.
- T006: Set up SQLite with Drizzle ORM and migrations.
