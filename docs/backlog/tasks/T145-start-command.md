# T145: Build factory start command

| Field                     | Value                                                                             |
| ------------------------- | --------------------------------------------------------------------------------- |
| **ID**                    | T145                                                                              |
| **Epic**                  | [E027: Factory Lifecycle & Recovery](../epics/E027-factory-lifecycle.md)          |
| **Type**                  | feature                                                                           |
| **Status**                | pending                                                                           |
| **Priority**              | P0                                                                                |
| **Owner**                 | platform-engineer                                                                 |
| **AI Executable**         | Yes                                                                               |
| **Human Review Required** | Yes                                                                               |
| **Dependencies**          | [T141](./T141-programmatic-migrations.md), [T146](./T146-start-static-serving.md) |
| **Blocks**                | [T147](./T147-two-phase-shutdown.md)                                              |

---

## Description

Implement the `factory start` subcommand that launches the full factory stack as a foreground process. The command ensures the data directory exists, runs migrations, sets environment variables, starts the NestJS control-plane with static web-ui serving, prints a startup banner, and opens the browser. Supports `--port`, `--no-open`, and `--verbose` flags.

## Goal

Enable `npx @copilot/factory start` to launch the complete factory from anywhere, with zero prior setup.

## Scope

### In Scope

- Register `start` subcommand (default command if none specified) in `apps/cli/src/cli.ts`
- Flags: `--port <number>` (default 3000), `--no-open` (skip browser), `--verbose` (debug logging)
- Startup sequence:
  1. Call `ensureFactoryHome()` to create data directory
  2. Call `runMigrations()` to apply pending DB migrations
  3. Set `process.env.DATABASE_PATH` to `getDbPath()`
  4. Set `process.env.SERVE_STATIC` to `"true"`
  5. Set `process.env.WEB_UI_DIST` to resolved web-ui dist path
  6. Set `process.env.PORT` to the port flag value
  7. Import and call the control-plane `bootstrap()` function
  8. After server is listening, print startup banner (see below)
  9. Open browser to `http://localhost:{port}` unless `--no-open`
- Startup banner with box-drawing characters:
  ```
  ┌─────────────────────────────────────────────┐
  │  Autonomous Software Factory v0.1.0         │
  │                                             │
  │  Dashboard:  http://localhost:3000           │
  │  API docs:   http://localhost:3000/api/docs  │
  │  Data:       ~/.copilot-factory/             │
  │  Projects:   2 registered                   │
  │                                             │
  │  Press Ctrl+C to stop (graceful drain)      │
  │  Press Ctrl+C again to force stop           │
  └─────────────────────────────────────────────┘
  ```
- Query project count from DB for the banner
- Handle EADDRINUSE error with clear message: "Port 3000 is already in use. Use --port to specify another."

### Out of Scope

- Shutdown handling (T147)
- Recovery logging (T148)
- Background daemon mode

## Context Files

The implementing agent should read these files before starting:

- `apps/control-plane/src/main.ts` — `bootstrap()` function to reuse
- `apps/cli/src/paths.ts` — `getDbPath()`, `getFactoryHome()`, `ensureFactoryHome()` (from T140)
- `apps/cli/src/migrate.ts` — `runMigrations()` (from T141)
- `apps/cli/src/cli.ts` — CLI entry point (from T119)

## Implementation Guidance

1. Create `apps/cli/src/commands/start.ts`
2. Add `start` subcommand to Commander:
   ```typescript
   program
     .command("start", { isDefault: true })
     .description("Start the factory")
     .option("-p, --port <number>", "HTTP port", "3000")
     .option("--no-open", "Don't open browser")
     .option("--verbose", "Verbose logging")
     .action(async (opts) => {
       await runStart(opts);
     });
   ```
3. `runStart()` implementation:
   a. `ensureFactoryHome()`
   b. `await runMigrations(getDbPath(), migrationsFolder)`
   c. Set env vars
   d. Resolve web-ui dist path: `path.resolve(__dirname, "../../web-ui/dist")` or use `require.resolve`
   e. Dynamically import bootstrap: `const { bootstrap } = await import("@factory/control-plane")`
   f. `const app = await bootstrap()`
   g. Query project count: use DB connection to `SELECT COUNT(*) FROM project`
   h. Print banner
   i. Open browser: `const open = await import("open"); await open.default(\`http://localhost:${port}\`)`
4. Error handling: catch EADDRINUSE, migration errors, missing dist directory
5. Install `open` as a dependency: `cd apps/cli && pnpm add open`
6. For the banner, use simple string concatenation with box-drawing chars (no external lib needed)

## Acceptance Criteria

- [ ] `factory start` launches the control-plane and web UI on the same port
- [ ] Browser opens automatically to the dashboard
- [ ] `--port 8080` changes the listening port
- [ ] `--no-open` suppresses browser opening
- [ ] Startup banner shows URL, data path, and project count
- [ ] EADDRINUSE produces a clear error message
- [ ] Migrations run automatically before server starts
- [ ] Server responds to `GET /health` after startup

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

### Suggested Validation Commands

```bash
pnpm build && node apps/cli/dist/cli.js start --port 4000 --no-open
```

```bash
curl http://localhost:4000/health
```

## Risks / Notes

- Resolving the web-ui dist path is tricky across development (source) and production (npm install) contexts. Use `import.meta.url` for ESM-based resolution or a path relative to the CLI package.
- The `bootstrap()` function in main.ts may need to be exported. If it's currently the default export or called inline, refactor to export it as a named function.

## Follow-on Tasks

T147
