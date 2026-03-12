# E027: Factory Lifecycle & Recovery

## Summary

Implement robust startup, shutdown, and self-healing for the factory process. This covers the `factory start` command (foreground, serves API + web UI on one port), two-phase Ctrl+C shutdown (graceful drain then force kill), startup recovery logging, orphaned worktree cleanup, and a multi-project dashboard filter.

## Why This Epic Exists

Operators need a predictable, reliable experience when starting and stopping the factory — especially when workers are active. The factory must self-heal on restart: detect stale leases, orphaned jobs, and stuck tasks, then recover gracefully. The dashboard must support multiple registered projects.

## Goals

- `factory start` runs the full stack as a foreground process on a single port
- Two-phase Ctrl+C: first = graceful drain (30s), second = force kill
- On restart, log what the reconciliation sweep will recover
- Clean up orphaned worktrees from crashed workers
- Dashboard supports filtering by project for multi-project operators

## Scope

### In Scope

- `factory start` command with `--port`, `--no-open`, `--verbose` flags
- Static web-ui serving from Fastify (same port as API)
- Two-phase shutdown with drain timeout and force kill
- Startup recovery diagnostics (log stale leases, orphaned jobs, stuck tasks)
- Orphaned worktree detection and cleanup
- Multi-project filter in the dashboard
- Hero experience documentation

### Out of Scope

- Background daemon mode (foreground only for V1)
- Remote/multi-node deployment
- Worker process management beyond child PID tracking

## Dependencies

**Depends on:** E024 (CLI scaffolding, static serving), E026 (global data dir, migrations)

**Enables:** None (end-user feature)

## Risks / Notes

- The existing reconciliation sweep (60s interval) handles all state recovery automatically. This epic adds visibility (logging) and cleanup (worktrees), not new recovery mechanisms.
- Two-phase shutdown relies on tracking child PIDs. If a worker is spawned as a deeply nested subprocess, the PID tracking may not cover it — this is acceptable for V1.
- Orphaned worktree cleanup must be conservative: never delete a worktree with an active lease.

## Tasks

| ID                                                  | Title                                      | Priority | Status  |
| --------------------------------------------------- | ------------------------------------------ | -------- | ------- |
| [T145](../tasks/T145-start-command.md)              | Build factory start command                | P0       | pending |
| [T146](../tasks/T146-start-static-serving.md)       | Serve web-ui static files from same server | P0       | pending |
| [T147](../tasks/T147-two-phase-shutdown.md)         | Implement two-phase Ctrl+C shutdown        | P0       | pending |
| [T148](../tasks/T148-startup-recovery-log.md)       | Log recovery status on startup             | P1       | pending |
| [T149](../tasks/T149-workspace-cleanup.md)          | Clean orphaned worktrees on start          | P2       | pending |
| [T150](../tasks/T150-dashboard-project-selector.md) | Add multi-project filter to dashboard      | P1       | pending |
| [T151](../tasks/T151-cli-hero-docs.md)              | Document the CLI hero experience           | P2       | pending |

## Sequencing Notes

T146 (static serving) is independent and can start immediately. T145 (start command) depends on T146 and on E026 (global data dir + migrations). T147 (shutdown) depends on T145. T148 and T149 depend on T147. T150 (dashboard) is independent. T151 (docs) is last.

## Completion Criteria

Running `npx @copilot/factory start` launches the full stack, serves the dashboard, handles Ctrl+C gracefully, and on restart detects/recovers from any interrupted work. The dashboard shows all registered projects with filtering.
