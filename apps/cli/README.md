# @copilot/factory CLI

**Single-command startup for the Autonomous Software Factory.**

The `@copilot/factory` CLI registers projects, launches the full factory stack (control plane + operator dashboard), and manages lifecycle operations — all from one terminal command.

---

## Quick Start

```bash
# Register your project
npx @copilot/factory init

# Launch the factory
npx @copilot/factory start
```

---

## Installation

The CLI is designed for `npx` usage — no global install required:

```bash
npx @copilot/factory <command>
```

Requires **Node.js ≥ 20**.

---

## Commands

### `factory init`

Registers the current directory as a factory project. Auto-detects metadata from your environment and prompts only when values cannot be determined automatically.

```bash
npx @copilot/factory init
```

#### Auto-Detection

| Field              | Detection Method                            | Fallback                               |
| ------------------ | ------------------------------------------- | -------------------------------------- |
| **Project name**   | `name` field in `package.json`              | Directory basename                     |
| **Git remote URL** | `git remote get-url origin`                 | Skipped (no repository record created) |
| **Default branch** | `git symbolic-ref refs/remotes/origin/HEAD` | `main`                                 |
| **Owner**          | `git config user.name` → OS username        | Interactive prompt                     |

#### What It Does

1. Detects project metadata from the environment
2. Prompts for any values that could not be auto-detected
3. Creates the global data directory (`~/.copilot-factory/`) if it doesn't exist
4. Runs database migrations (idempotent)
5. Registers the project and repository in the factory database
6. Optionally imports tasks from a local directory (see [Task Import](#task-import-during-init))
7. Writes a `.copilot-factory.json` marker file to the project root

#### Idempotency

Running `factory init` again in the same directory is safe. It detects the existing `.copilot-factory.json` marker file and updates the project metadata rather than creating duplicates.

#### Task Import During Init

After registering the project, `factory init` offers to import tasks from a local directory:

```
Import tasks from a local directory? (y/N)
```

If you confirm, it prompts for a path to scan:

```
Path to scan for tasks: docs/backlog/tasks
```

The import system auto-detects the format:

- **`backlog.json`** — structured JSON with task definitions and optional epic groupings
- **Markdown files** (`*.md`) — one task per file with a metadata table and headed sections

Tasks are imported in `BACKLOG` status. Duplicate tasks (matched by external reference ID) are skipped. Dependencies between imported tasks are wired automatically.

For full format documentation, see [docs/TASK_FORMAT.md](../../docs/TASK_FORMAT.md).

---

### `factory start`

Launches the full factory stack as a foreground process on a single port.

```bash
npx @copilot/factory start [options]
```

#### Flags

| Flag                | Default                         | Description                                   |
| ------------------- | ------------------------------- | --------------------------------------------- |
| `-p, --port <port>` | `4100`                          | HTTP port for the control plane and dashboard |
| `--db-path <path>`  | `~/.copilot-factory/factory.db` | Path to the SQLite database file              |
| `--no-open`         | —                               | Do not open the browser on startup            |
| `--no-ui`           | —                               | API-only mode — do not serve the web UI       |
| `--verbose`         | —                               | Enable debug-level logging during startup     |
| `-V, --version`     | —                               | Print the CLI version and exit                |
| `-h, --help`        | —                               | Display help for the command                  |

#### Startup Sequence

1. Creates the data directory (`~/.copilot-factory/`) if it doesn't exist
2. Runs database migrations (safe to run every time)
3. Initializes OpenTelemetry tracing (console exporter in verbose mode)
4. Starts the NestJS control plane (REST API, WebSocket events, scheduling)
5. Serves the web UI as static files from the same port (unless `--no-ui`)
6. Runs startup diagnostics — detects stale leases, orphaned jobs, stuck tasks
7. Cleans orphaned worktrees from crashed workers (7-day retention)
8. Prints the startup banner
9. Opens the browser to the dashboard (unless `--no-open`)

#### Startup Banner

```
  ┌───────────────────────────────────────────────┐
  │  Autonomous Software Factory v0.1.0           │
  │                                               │
  │  Dashboard:  http://localhost:4100             │
  │  API docs:   http://localhost:4100/api/docs    │
  │  Data:       ~/.copilot-factory/               │
  │  Projects:   2 registered                      │
  │                                               │
  │  Press Ctrl+C to stop                          │
  └───────────────────────────────────────────────┘
```

---

## Examples

```bash
# Register and start with defaults
npx @copilot/factory init
npx @copilot/factory start

# Start on a custom port, skip opening the browser
npx @copilot/factory start --port 5000 --no-open

# API-only mode (no web UI static files served)
npx @copilot/factory start --no-ui

# Verbose logging with a custom database path
npx @copilot/factory start --verbose --db-path /mnt/factory.db

# Use a custom data directory via environment variable
export FACTORY_HOME=/mnt/factory-data
npx @copilot/factory start
```

---

## Environment Variables

| Variable                      | Default                     | Description                                        |
| ----------------------------- | --------------------------- | -------------------------------------------------- |
| `FACTORY_HOME`                | `~/.copilot-factory`        | Global data directory for DB, worktrees, artifacts |
| `DATABASE_PATH`               | `{FACTORY_HOME}/factory.db` | SQLite database file path                          |
| `SERVE_STATIC`                | —                           | Set to `true` to serve web UI from control plane   |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318`     | OpenTelemetry collector endpoint                   |
| `OTEL_TRACING_ENABLED`        | `true`                      | Set to `"false"` to disable tracing                |
| `NODE_ENV`                    | `production`                | Set to `"development"` for console trace output    |
| `WORKSPACE_RETENTION_DAYS`    | `7`                         | Days before orphaned worktrees are cleaned up      |

---

## Data Directory

All persistent data is stored in the global data directory (default `~/.copilot-factory/`):

```
~/.copilot-factory/
├── factory.db          # SQLite database (WAL mode)
├── workspaces/         # Git worktrees for active tasks
│   └── {repoId}/
│       └── {taskId}/   # Isolated worktree per task
└── artifacts/          # Task outputs, review packets, crash recovery
    └── repositories/
        └── {repoId}/
            └── tasks/
                └── {taskId}/
                    └── runs/
                        └── {runId}/
                            ├── outputs/
                            ├── review/
                            └── merge/
```

Override the location with the `FACTORY_HOME` environment variable.

---

## Shutdown

The factory uses a two-phase shutdown sequence:

**First Ctrl+C** — Graceful drain (up to 30 seconds). Stops accepting new work, waits for active workers to finish, flushes telemetry, and exits cleanly (code 0).

**Second Ctrl+C** — Force kill. Sends SIGKILL to all tracked worker processes and exits immediately (code 1).

On the next startup, any interrupted work is automatically recovered by the reconciliation sweep.

---

## The `.copilot-factory.json` Marker File

After `factory init`, a marker file is written to the project root:

```json
{
  "projectId": "550e8400-e29b-41d4-a716-446655440000",
  "repositoryId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "factoryHome": "/home/user/.copilot-factory"
}
```

This file links the project directory to its factory registration and enables safe re-runs of `factory init`.

> **Tip:** Add `.copilot-factory.json` to your `.gitignore` — it contains machine-specific paths and UUIDs.

---

## Troubleshooting

### Port already in use

```
❌ Failed to start: listen EADDRINUSE: address already in use :::4100
```

Another process is using the port. Use `--port` to specify a different one:

```bash
npx @copilot/factory start --port 4200
```

### Database migration failure

If migrations fail, the most common cause is a corrupted or incompatible database file. Remove or rename the database and try again:

```bash
mv ~/.copilot-factory/factory.db ~/.copilot-factory/factory.db.bak
npx @copilot/factory start
```

### Web UI not loading

If the dashboard shows a blank page, ensure the web UI was built:

```bash
cd apps/web-ui && pnpm build
```

When using `--no-ui`, the dashboard is not served — access the API directly at the configured port.

### Init fails to detect Git remote

If `factory init` cannot find the Git remote, ensure the `origin` remote is configured:

```bash
git remote -v
```

If no remote exists, `init` skips creating the repository record. You can add a remote and re-run `factory init` — it will update the project to include the repository.

---

## Further Reading

- [User Guide](../../docs/user-guide.md) — complete operator documentation
- [Task Format Reference](../../docs/TASK_FORMAT.md) — supported import formats
- [API Documentation](http://localhost:4100/api/docs) — Swagger/OpenAPI docs (when the server is running)
