/**
 * Core startup logic for the Autonomous Software Factory CLI.
 *
 * Contains all the pure functions and injectable startup logic that can
 * be tested without triggering side effects. The shebang entry point
 * (`cli.ts`) imports from this module and wires up the actual execution.
 *
 * Exports:
 * - {@link buildProgram} — Commander configuration
 * - {@link resolveOptions} — Option validation and defaults
 * - {@link startServer} — Full startup sequence (injectable deps)
 * - {@link getWebUiDistPath} — Web-UI dist path resolution
 * - {@link getMigrationsPath} — Drizzle migrations path resolution
 *
 * @see docs/backlog/tasks/T121-cli-entry-point.md — task specification
 * @see docs/prd/007-technical-architecture.md §7.1 — stack rationale
 * @module @copilot/factory
 */

import { join } from "node:path";
import { existsSync } from "node:fs";

import { Command } from "commander";
import { initTracing } from "@factory/observability";
import type { TracingHandle } from "@factory/observability";

import { createApp, configureStaticServing } from "@factory/control-plane";
import { runMigrations } from "./migrate.js";
import { ensureFactoryHome, getDbPath } from "./paths.js";

/** CLI version — kept in sync with package.json. */
export const VERSION = "0.1.0";

/** Default HTTP port for the control-plane server. */
export const DEFAULT_PORT = 4100;

/**
 * Parsed CLI options produced by Commander.
 *
 * These are the user-facing knobs for controlling the factory server
 * startup behavior.
 */
export interface CliOptions {
  /** TCP port for the HTTP server. */
  port: number;
  /** Absolute path to the SQLite database file. */
  dbPath: string;
  /** When false, skip opening the browser after startup. */
  open: boolean;
  /** When false, skip static web-UI serving (API-only mode). */
  ui: boolean;
}

/**
 * Builds the Commander program with all CLI options.
 *
 * Separated from execution to enable unit testing of argument parsing
 * without triggering server startup side effects.
 *
 * @returns A configured Commander `Command` instance (not yet parsed).
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("factory")
    .description("Autonomous Software Factory — single-command startup")
    .version(VERSION)
    .option("-p, --port <port>", "HTTP port for the control-plane server", String(DEFAULT_PORT))
    .option("--db-path <path>", "path to SQLite database file", "")
    .option("--no-open", "do not open the browser on startup")
    .option("--no-ui", "API-only mode — do not serve the web UI");

  return program;
}

/**
 * Resolves and validates the CLI options from Commander's parsed output.
 *
 * Applies defaults (e.g., `getDbPath()` for database location) and
 * validates the port number. Throws on invalid input so errors surface
 * early, before any server resources are allocated.
 *
 * @param program - A Commander `Command` that has already called `.parse()`.
 * @returns Fully resolved CLI options ready for use in `startServer()`.
 * @throws {Error} If the port number is outside the valid TCP range.
 */
export function resolveOptions(program: Command): CliOptions {
  const opts = program.opts<{ port: string; dbPath: string; open: boolean; ui: boolean }>();

  const port = Number(opts.port);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port number: ${opts.port}. Must be between 1 and 65535.`);
  }

  const dbPath = opts.dbPath || getDbPath();

  return {
    port,
    dbPath,
    open: opts.open,
    ui: opts.ui,
  };
}

/**
 * Resolves the absolute path to the web-UI dist directory.
 *
 * In the monorepo layout, the web-UI build output lives at
 * `apps/web-ui/dist/` relative to the CLI source. This function resolves
 * that path from the current module's location.
 *
 * @returns Absolute path to the web-ui dist directory.
 */
export function getWebUiDistPath(): string {
  return join(import.meta.dirname, "..", "..", "web-ui", "dist");
}

/**
 * Resolves the absolute path to the Drizzle migrations directory.
 *
 * In the monorepo layout, migrations live at `apps/control-plane/drizzle/`
 * relative to the CLI source. This mirrors the pattern used in
 * `migrate.test.ts`.
 *
 * @returns Absolute path to the control-plane drizzle migrations directory.
 */
export function getMigrationsPath(): string {
  return join(import.meta.dirname, "..", "..", "control-plane", "drizzle");
}

/**
 * Prints a startup banner with key configuration details.
 *
 * Displayed immediately before the server starts listening so the operator
 * knows where to reach the API and UI.
 *
 * @param options - Resolved CLI options for display.
 */
function printBanner(options: CliOptions): void {
  console.log();
  console.log(`  🏭 Autonomous Software Factory v${VERSION}`);
  console.log();
  console.log(`  ➜  API:       http://localhost:${options.port}`);
  console.log(`  ➜  Swagger:   http://localhost:${options.port}/api/docs`);
  if (options.ui) {
    console.log(`  ➜  Web UI:    http://localhost:${options.port}`);
  }
  console.log(`  ➜  Database:  ${options.dbPath}`);
  console.log();
}

/**
 * Main startup sequence that orchestrates the full server lifecycle.
 *
 * This is the core function that ties together migrations, app creation,
 * static serving, HTTP listening, and browser opening. It is separated
 * from the CLI entry point to allow testing with injected dependencies.
 *
 * @param options - Fully resolved CLI options.
 * @param deps - Injectable dependencies for testing.
 * @returns A cleanup function that gracefully shuts down all resources.
 * @throws {Error} If migrations fail, the port is in use, or the web-UI
 *   dist directory is missing when `--ui` is enabled.
 */
export async function startServer(
  options: CliOptions,
  deps: {
    /** Override the open-browser function (for testing). */
    openBrowser?: (url: string) => Promise<void>;
    /** Override the web-UI dist path (for testing). */
    webUiDistPath?: string;
    /** Override the migrations directory path (for testing). */
    migrationsPath?: string;
  } = {},
): Promise<{ shutdown: () => Promise<void> }> {
  // Step 1: Ensure ~/.factory/ directory structure exists
  ensureFactoryHome();

  // Step 2: Run database migrations
  const migrationsPath = deps.migrationsPath ?? getMigrationsPath();
  console.log("  ⏳ Running database migrations...");
  const migrationResult = await runMigrations(options.dbPath, migrationsPath);
  if (migrationResult.applied > 0) {
    console.log(`  ✅ Applied ${migrationResult.applied} migration(s)`);
  } else {
    console.log("  ✅ Database is up to date");
  }

  // Step 3: Set DATABASE_PATH env var for the control-plane NestJS modules
  process.env["DATABASE_PATH"] = options.dbPath;

  // Step 4: Initialize tracing (console-only for CLI, no OTLP exporter)
  const tracingHandle: TracingHandle = initTracing({
    serviceName: "factory-cli",
    serviceVersion: VERSION,
    enableOtlpExporter: false,
    enableConsoleExporter: process.env["NODE_ENV"] === "development",
  });

  // Step 5: Create NestJS application
  const app = await createApp();

  // Step 6: Configure static web-UI serving if enabled
  if (options.ui) {
    const distPath = deps.webUiDistPath ?? getWebUiDistPath();
    if (existsSync(distPath)) {
      await configureStaticServing(app, distPath);
    } else {
      console.log(
        "  ⚠️  Web UI not found — run `pnpm --filter @factory/web-ui build` first. Starting in API-only mode.",
      );
    }
  }

  // Step 7: Start listening
  try {
    await app.listen(options.port, "0.0.0.0");
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "EADDRINUSE") {
      console.error(`\n  ❌ Port ${options.port} is already in use. Try --port <other-port>.\n`);
      await tracingHandle.shutdown();
      process.exit(1);
    }
    throw err;
  }

  // Step 8: Print banner and open browser
  printBanner(options);

  if (options.open) {
    const url = `http://localhost:${options.port}`;
    try {
      const openFn = deps.openBrowser ?? (await import("open")).default;
      await openFn(url);
    } catch {
      // Non-fatal — headless environments (CI, SSH) may not have a browser
      console.log("  ℹ️  Could not open browser automatically. Visit the URL above.");
    }
  }

  // Step 9: Return shutdown handle
  const shutdown = async (): Promise<void> => {
    console.log("\n  🛑 Shutting down...");
    await app.close();
    await tracingHandle.shutdown();
  };

  return { shutdown };
}
