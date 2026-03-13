#!/usr/bin/env node

/**
 * Entry point for the Autonomous Software Factory CLI.
 *
 * This module is the shebang-bearing executable linked as the `factory`
 * command. It delegates all logic to `startup.ts` and `commands/` to keep
 * side effects isolated from testable code.
 *
 * Supports subcommands:
 * - `factory` (default) — boots the full stack (migrations, API server, web UI)
 * - `factory start` — explicit alias for the default startup behavior
 * - `factory init` — registers the current project with the factory
 *
 * @see docs/backlog/tasks/T121-cli-entry-point.md — CLI entry point spec
 * @see docs/backlog/tasks/T143-init-interactive-flow.md — init command spec
 * @see docs/prd/007-technical-architecture.md §7.1 — stack rationale
 * @module @copilot/factory
 */

import { buildProgram, addServerOptions, resolveOptions, startServer } from "./startup.js";
import { setupShutdownHandlers, childPids } from "./shutdown.js";
import { runInit } from "./commands/init.js";

/**
 * Starts the full server stack and installs shutdown handlers.
 *
 * Shared between the default (no-subcommand) path and the explicit
 * `factory start` subcommand so both behave identically.
 *
 * @param cmd - The Commander `Command` whose options to resolve.
 */
async function runStart(cmd: import("commander").Command): Promise<void> {
  const options = resolveOptions(cmd);
  const { shutdown } = await startServer(options);

  setupShutdownHandlers({
    shutdown,
    dbPath: options.dbPath,
    childPids,
  });
}

/**
 * CLI entry point — parses arguments, dispatches subcommands or starts
 * the server.
 *
 * When invoked without a subcommand (or with `factory start`), starts the
 * control-plane server with two-phase SIGINT/SIGTERM shutdown handlers.
 * When `factory init` is used, runs the interactive project registration
 * flow instead.
 */
async function main(): Promise<void> {
  const program = buildProgram();
  let subcommandRan = false;

  const startCmd = program
    .command("start")
    .description("Start the control plane, operator UI, and all factory services");
  addServerOptions(startCmd);
  startCmd.action(async () => {
    subcommandRan = true;
    await runStart(startCmd);
  });

  program
    .command("init")
    .description("Register this project with the factory")
    .action(async () => {
      subcommandRan = true;
      await runInit(process.cwd());
    });

  await program.parseAsync(process.argv);

  if (!subcommandRan) {
    await runStart(program);
  }
}

main().catch((err: unknown) => {
  console.error("\n  ❌ Failed to start:", err);
  process.exit(1);
});
