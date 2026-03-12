# E024: CLI Package & Single-Command Startup

## Summary

Package the factory as an npm CLI tool (`@copilot/factory`) that starts the control-plane, serves the pre-built web UI, and opens the browser — all from a single `npx @copilot/factory` command.

## Why This Epic Exists

Currently, running the factory requires cloning the repo, installing dependencies, running migrations, and starting two separate dev servers. A single npx command eliminates this friction and makes the factory distributable as a standalone tool.

## Goals

- Create an `apps/cli/` workspace with a publishable npm package
- Single command starts the full stack: database migrations, control-plane, and static web UI
- Serve the pre-built React SPA from the same Fastify server (no separate Vite process)
- Support configuration flags (--port, --db-path, --no-open)

## Scope

### In Scope

- New `apps/cli/` workspace with `@copilot/factory` package name and bin entry
- CLI entry point that orchestrates startup
- Fastify static file serving for the pre-built web UI
- Programmatic database migration
- Browser auto-open on startup
- CLI documentation

### Out of Scope

- Publishing to npm (separate release process)
- Docker packaging
- Multi-node deployment
- Daemon/background process management (systemd, pm2)

## Dependencies

**Depends on:** E001, E017, E019

**Enables:** None (standalone feature)

## Risks / Notes

- The CLI bundles a pre-built web UI, so the web-ui must be built before the CLI package is published.
- Static file serving from Fastify must coexist with the existing API routes without conflicts.
- The CLI needs to locate the web-ui dist directory relative to its own installation path.

## Tasks

| ID                                              | Title                                        | Priority | Status  |
| ----------------------------------------------- | -------------------------------------------- | -------- | ------- |
| [T119](../tasks/T119-scaffold-cli-workspace.md) | Scaffold apps/cli workspace                  | P0       | pending |
| [T120](../tasks/T120-bundle-web-ui.md)          | Serve web-ui static files from control-plane | P0       | pending |
| [T121](../tasks/T121-cli-entry-point.md)        | Build CLI entry point command                | P0       | pending |
| [T122](../tasks/T122-cli-readme.md)             | Write CLI and import documentation           | P2       | pending |

## Sequencing Notes

T119 (scaffold) must be first. T120 (static serving) and T121 (entry point) depend on T119 and should be done in that order since the entry point needs static serving. T122 (docs) comes last.

## Completion Criteria

Running `npx @copilot/factory` from any directory starts the full factory stack, serves the web UI, and opens a browser — with no prior setup required beyond Node.js ≥ 20.
