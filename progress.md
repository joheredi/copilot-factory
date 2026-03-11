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
- T003: Set up ESLint and Prettier.
- T004: Set up Vitest testing framework.
- T005: Create CI pipeline with GitHub Actions.
- T006: Set up SQLite with Drizzle ORM and migrations.

## 2026-03-11 — T002: Configure TypeScript for all packages

**Status:** Done

**What was done:**
- Created `tsconfig.base.json` at repo root with strict TypeScript settings: `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `verbatimModuleSyntax: true`, plus additional strictness flags (`noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature`).
- Created root `tsconfig.json` with project references to all 11 workspaces (8 packages + 3 apps).
- Created per-workspace `tsconfig.json` files extending `tsconfig.base.json` with `composite: true`, `outDir: dist`, `rootDir: src`, `include: [src]`.
- Added `src/index.ts` entry points for all 11 workspaces with JSDoc module descriptions.
- Updated all 11 workspace `package.json` files with: `type: module`, `main`, `types`, `exports` (with types + import conditions), `build` script (`tsc --build`), `clean` script, and `files: [dist]`.
- Installed `typescript`, `tsx`, and `@types/node` as root devDependencies.
- Verified cross-package import resolution works via pnpm workspace symlinks + package.json exports with `moduleResolution: NodeNext`.

**Patterns established:**
- All packages use ESM (`"type": "module"` in package.json).
- `module: NodeNext` with `moduleResolution: NodeNext` — imports must use file extensions (`.js`) and `import type` for type-only imports.
- `verbatimModuleSyntax: true` — enforces explicit `import type` syntax.
- Cross-package imports resolve via pnpm workspace protocol + package.json `exports` field (no tsconfig `paths` needed).
- Build via `tsc --build` (composite project references) for incremental builds.
- `outDir` and `rootDir` are set per-package (not in base config) since tsconfig `extends` resolves relative paths from the originating config file.

**Next steps:**
- T003: Set up ESLint and Prettier.
- T004: Set up Vitest testing framework.
- T005: Create CI pipeline with GitHub Actions.
- T006: Set up SQLite with Drizzle ORM and migrations (depends on T002 ✅).
