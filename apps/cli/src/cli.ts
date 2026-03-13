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
 * - `factory init` — registers the current project with the factory
 *
 * @see docs/backlog/tasks/T121-cli-entry-point.md — CLI entry point spec
 * @see docs/backlog/tasks/T143-init-interactive-flow.md — init command spec
 * @see docs/prd/007-technical-architecture.md §7.1 — stack rationale
 * @module @copilot/factory
 */

import { buildProgram, resolveOptions, startServer } from "./startup.js";
import { setupShutdownHandlers, childPids } from "./shutdown.js";
import { runInit } from "./commands/init.js";

/**
 * CLI entry point — parses arguments, dispatches subcommands or starts
 * the server.
 *
 * When invoked without a subcommand, starts the control-plane server
 * with two-phase SIGINT/SIGTERM shutdown handlers. When `factory init`
 * is used, runs the interactive project registration flow instead.
 */
async function main(): Promise<void> {
  const program = buildProgram();
  let subcommandRan = false;

  program
    .command("init")
    .description("Register this project with the factory")
    .action(async () => {
      subcommandRan = true;
      await runInit(process.cwd());
    });

  await program.parseAsync(process.argv);

  if (!subcommandRan) {
    const options = resolveOptions(program);
    const { shutdown } = await startServer(options);

    setupShutdownHandlers({
      shutdown,
      dbPath: options.dbPath,
      childPids,
    });
  }
}

main().catch((err: unknown) => {
  console.error("\n  ❌ Failed to start:", err);
  process.exit(1);
});
