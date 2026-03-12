#!/usr/bin/env node

/**
 * Entry point for the Autonomous Software Factory CLI.
 *
 * This module serves as the shebang-bearing executable that will be linked
 * as the `factory` command when the package is installed globally or via npx.
 *
 * Current scope: minimal startup message confirming the CLI is reachable.
 * Full CLI logic (argument parsing, server startup, web UI serving) is
 * implemented in T121 (cli-entry-point).
 */

const VERSION = "0.1.0";

/** Prints the CLI startup banner to stdout. */
function printBanner(): void {
  console.log(`🏭 Autonomous Software Factory CLI v${VERSION}`);
  console.log("   Ready for commands. Use --help for usage information.");
}

printBanner();
