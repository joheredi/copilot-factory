# T119: Scaffold apps/cli workspace

| Field                     | Value                                                                      |
| ------------------------- | -------------------------------------------------------------------------- |
| **ID**                    | T119                                                                       |
| **Epic**                  | [E024: CLI Package & Single-Command Startup](../epics/E024-cli-package.md) |
| **Type**                  | foundation                                                                 |
| **Status**                | pending                                                                    |
| **Priority**              | P0                                                                         |
| **Owner**                 | platform-engineer                                                          |
| **AI Executable**         | Yes                                                                        |
| **Human Review Required** | Yes                                                                        |
| **Dependencies**          | None                                                                       |
| **Blocks**                | [T120](./T120-bundle-web-ui.md), [T121](./T121-cli-entry-point.md)         |

---

## Description

Create the `apps/cli/` workspace that will become the `@copilot/factory` npm package. Set up the package.json with a bin entry, TypeScript config, and dependencies on the control-plane and web-ui packages.

## Goal

Establish the package structure so the CLI entry point and static file serving can be built on top.

## Scope

### In Scope

- `apps/cli/package.json` with name `@copilot/factory`, bin entry pointing to `./dist/cli.js`, dependencies on `@factory/control-plane`
- `apps/cli/tsconfig.json` extending base config
- `apps/cli/src/cli.ts` minimal entry point with shebang (`#!/usr/bin/env node`)
- Add `apps/cli` to `pnpm-workspace.yaml` (already covered by `apps/*` glob)
- `pnpm install` succeeds with the new workspace

### Out of Scope

- CLI logic (T121)
- Static file serving (T120)
- Publishing to npm

## Context Files

The implementing agent should read these files before starting:

- `apps/control-plane/package.json` (reference for workspace structure)
- `tsconfig.base.json` (base TypeScript config)
- `pnpm-workspace.yaml`

## Implementation Guidance

1. Create `apps/cli/package.json`:
   ```json
   {
     "name": "@copilot/factory",
     "version": "0.1.0",
     "type": "module",
     "bin": { "factory": "./dist/cli.js" },
     "files": ["dist"],
     "scripts": {
       "build": "tsc --build",
       "dev": "tsx src/cli.ts"
     },
     "dependencies": {
       "@factory/control-plane": "workspace:*"
     },
     "devDependencies": {
       "typescript": "catalog:"
     }
   }
   ```
2. Create `apps/cli/tsconfig.json` extending `../../tsconfig.base.json` with composite:true, outDir/rootDir
3. Create `apps/cli/src/cli.ts` with shebang and a minimal `console.log("@copilot/factory starting...")`
4. Add `{ "path": "apps/cli" }` to root `tsconfig.json` references
5. Run `pnpm install` to link the workspace
6. Verify `pnpm build` includes the new workspace

## Acceptance Criteria

- [ ] `apps/cli/` directory exists with package.json, tsconfig.json, and src/cli.ts
- [ ] `pnpm install` succeeds
- [ ] `pnpm build` compiles the CLI workspace
- [ ] `node apps/cli/dist/cli.js` runs without errors (prints startup message)
- [ ] Package name is `@copilot/factory` with a bin entry

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Build and run the CLI stub.

### Suggested Validation Commands

```bash
pnpm install && pnpm build
```

```bash
node apps/cli/dist/cli.js
```

## Risks / Notes

- The bin entry `"factory"` means users will run `npx @copilot/factory` or `npx factory`. Choose the command name carefully.
- The CLI workspace depends on `@factory/control-plane` as a workspace dependency, which means the control-plane must be built first.

## Follow-on Tasks

T120, T121
