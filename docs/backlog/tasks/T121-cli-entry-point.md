# T121: Build CLI entry point command

| Field                     | Value                                                                      |
| ------------------------- | -------------------------------------------------------------------------- |
| **ID**                    | T121                                                                       |
| **Epic**                  | [E024: CLI Package & Single-Command Startup](../epics/E024-cli-package.md) |
| **Type**                  | feature                                                                    |
| **Status**                | done                                                                       |
| **Priority**              | P0                                                                         |
| **Owner**                 | platform-engineer                                                          |
| **AI Executable**         | Yes                                                                        |
| **Human Review Required** | Yes                                                                        |
| **Dependencies**          | [T119](./T119-scaffold-cli-workspace.md), [T120](./T120-bundle-web-ui.md)  |
| **Blocks**                | [T122](./T122-cli-readme.md)                                               |

---

## Description

Implement the main CLI entry point for `npx @copilot/factory`. The command runs database migrations, starts the NestJS control-plane with static file serving enabled, and opens the browser to the web UI. Supports configuration flags for port, database path, and browser behavior.

## Goal

Enable a zero-setup single-command startup experience: `npx @copilot/factory` → full factory running in the browser.

## Scope

### In Scope

- CLI argument parsing with `--port` (default 3000), `--db-path` (default `./data/factory.db`), `--no-open` (skip browser)
- Run Drizzle migrations programmatically before starting the server
- Set environment variables (`PORT`, `DATABASE_PATH`, `SERVE_STATIC=true`, `WEB_UI_DIST`)
- Resolve the web-ui dist path relative to the CLI package location
- Start the NestJS application programmatically (import and call bootstrap)
- Open the default browser to `http://localhost:{port}` (use `open` npm package or `node:child_process`)
- Print a startup banner with URL, database path, and version
- Handle SIGINT/SIGTERM for graceful shutdown
- Handle errors (port in use, migration failure) with clear messages

### Out of Scope

- Daemonization / background process management
- Hot reload / watch mode (use `pnpm dev` for development)
- Publishing to npm
- Docker support

## Context Files

The implementing agent should read these files before starting:

- `apps/control-plane/src/main.ts` (bootstrap function to reuse/adapt)
- `apps/control-plane/drizzle.config.ts` (migration config)
- `apps/cli/src/cli.ts` (stub from T119)

## Implementation Guidance

1. Install CLI dependencies: `cd apps/cli && pnpm add commander open`
2. Implement `apps/cli/src/cli.ts`:
   ```typescript
   #!/usr/bin/env node
   import { Command } from "commander";
   const program = new Command();
   program
     .name("factory")
     .description("Autonomous Software Factory")
     .option("-p, --port <number>", "HTTP port", "3000")
     .option("--db-path <path>", "SQLite database path", "./data/factory.db")
     .option("--no-open", "Don't open browser on startup")
     .action(async (opts) => {
       /* startup logic */
     });
   program.parse();
   ```
3. Startup sequence:
   a. Set `process.env.PORT`, `process.env.DATABASE_PATH`, `process.env.SERVE_STATIC = "true"`
   b. Resolve web-ui dist path: `path.resolve(__dirname, "../../web-ui/dist")` (or use package.json exports)
   c. Set `process.env.WEB_UI_DIST` to the resolved path
   d. Run migrations: import drizzle-kit migrate programmatically or shell out to `drizzle-kit migrate`
   e. Import and call the control-plane bootstrap function
   f. After server is listening, open browser if `--open` is true
   g. Print banner: `Factory running at http://localhost:{port}`
4. Graceful shutdown: listen for SIGINT/SIGTERM, call `app.close()`
5. Error handling: catch EADDRINUSE, migration errors, missing dist directory

## Acceptance Criteria

- [ ] `node apps/cli/dist/cli.js` starts the full factory (API + web UI)
- [ ] Browser opens automatically to the correct URL
- [ ] `--port 8080` changes the listening port
- [ ] `--db-path ./custom.db` changes the database location
- [ ] `--no-open` suppresses browser opening
- [ ] Database migrations run automatically on startup
- [ ] Ctrl+C gracefully shuts down the server
- [ ] Clear error message if port is already in use
- [ ] Startup banner shows URL, DB path, and version

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Build everything and run the CLI.

### Suggested Validation Commands

```bash
pnpm build
```

```bash
node apps/cli/dist/cli.js --port 4000 --no-open
```

```bash
curl http://localhost:4000/health
```

## Risks / Notes

- Resolving the web-ui dist path is tricky when the package is installed via npm (node_modules layout). Use `require.resolve` or `import.meta.url` relative paths.
- The control-plane's bootstrap function may need to be refactored to accept configuration programmatically instead of only from environment variables.

## Follow-on Tasks

T122
