#!/usr/bin/env node

/**
 * Entry point for the Autonomous Software Factory CLI.
 *
 * This module is the shebang-bearing executable linked as the `factory`
 * command. It delegates all logic to `startup.ts` to keep side effects
 * isolated from testable code.
 *
 * Single command that boots the full stack: runs database migrations, starts
 * the control-plane API server with static web-UI serving, and optionally
 * opens a browser window. Designed for `npx @copilot/factory` ergonomics.
 *
 * @see docs/backlog/tasks/T121-cli-entry-point.md — task specification
 * @see docs/prd/007-technical-architecture.md §7.1 — stack rationale
 * @module @copilot/factory
 */

import { buildProgram, resolveOptions, startServer } from "./startup.js";
import { setupShutdownHandlers, childPids } from "./shutdown.js";

/**
 * CLI entry point — parses arguments and starts the server.
 *
 * Wires up two-phase SIGINT/SIGTERM handlers for graceful shutdown:
 * first signal drains active workers and shuts down cleanly; second
 * signal force-kills tracked child processes and exits immediately.
 */
async function main(): Promise<void> {
  const program = buildProgram();
  program.parse(process.argv);

  const options = resolveOptions(program);
  const { shutdown } = await startServer(options);

  setupShutdownHandlers({
    shutdown,
    dbPath: options.dbPath,
    childPids,
  });
}

main().catch((err: unknown) => {
  console.error("\n  ❌ Failed to start:", err);
  process.exit(1);
});
