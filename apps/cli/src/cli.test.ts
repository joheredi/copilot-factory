/**
 * Tests for the CLI entry point module.
 *
 * These tests validate the argument parsing, option resolution, and path
 * resolution logic of the CLI without actually starting a server. The
 * `startServer()` function is tested indirectly through its dependency
 * injection points — real server startup is covered by integration tests.
 *
 * Why these tests matter:
 * - Argument parsing errors surface as confusing runtime failures if not
 *   caught early. Testing Commander configuration ensures --port, --db-path,
 *   --no-open, and --no-ui behave as documented.
 * - `resolveOptions()` applies defaults and validates constraints (port range).
 *   Incorrect defaults would cause the server to bind to wrong ports or
 *   use wrong database paths in production.
 * - Path resolution for web-UI dist and migrations directories is critical
 *   for the monorepo layout. If these paths drift, the CLI silently falls
 *   back to API-only mode or fails migrations.
 */

import { describe, expect, it } from "vitest";
import { join } from "node:path";

import { buildProgram, resolveOptions, getWebUiDistPath, getMigrationsPath } from "./startup.js";

describe("buildProgram", () => {
  /**
   * Validates that Commander is configured with the correct command name,
   * description, and version. These values appear in --help and --version
   * output and are the first thing users see.
   */
  it("creates a program with correct metadata", () => {
    const program = buildProgram();
    expect(program.name()).toBe("factory");
    expect(program.version()).toBe("0.1.0");
  });
});

describe("resolveOptions", () => {
  /**
   * Validates that when no arguments are provided, the CLI uses sensible
   * defaults: port 4100, database path from `getDbPath()`, browser opens,
   * and UI is served. These defaults define the zero-config experience
   * for `npx @copilot/factory`.
   */
  it("applies default values when no arguments are provided", () => {
    const program = buildProgram();
    program.parse([], { from: "user" });
    const options = resolveOptions(program);

    expect(options.port).toBe(4100);
    expect(options.dbPath).toBeTruthy();
    expect(options.open).toBe(true);
    expect(options.ui).toBe(true);
  });

  /**
   * Validates that --port correctly overrides the default port. Users
   * need this when port 4100 is occupied or when running multiple
   * factory instances.
   */
  it("parses --port option", () => {
    const program = buildProgram();
    program.parse(["--port", "8080"], { from: "user" });
    const options = resolveOptions(program);

    expect(options.port).toBe(8080);
  });

  /**
   * Validates that -p shorthand works identically to --port. Commander
   * aliases must be explicitly configured and this test catches
   * configuration drift.
   */
  it("parses -p shorthand for --port", () => {
    const program = buildProgram();
    program.parse(["-p", "9000"], { from: "user" });
    const options = resolveOptions(program);

    expect(options.port).toBe(9000);
  });

  /**
   * Validates that --db-path overrides the default database location.
   * Essential for running the factory against a custom database file
   * (e.g., in CI or when multiple instances share a machine).
   */
  it("parses --db-path option", () => {
    const program = buildProgram();
    program.parse(["--db-path", "/tmp/test.db"], { from: "user" });
    const options = resolveOptions(program);

    expect(options.dbPath).toBe("/tmp/test.db");
  });

  /**
   * Validates that --no-open disables automatic browser opening. Critical
   * for headless environments (CI, SSH, Docker) where no display server
   * is available.
   */
  it("parses --no-open flag", () => {
    const program = buildProgram();
    program.parse(["--no-open"], { from: "user" });
    const options = resolveOptions(program);

    expect(options.open).toBe(false);
  });

  /**
   * Validates that --no-ui disables static file serving, producing an
   * API-only server. Useful for deployments where the UI is served
   * separately or not needed.
   */
  it("parses --no-ui flag", () => {
    const program = buildProgram();
    program.parse(["--no-ui"], { from: "user" });
    const options = resolveOptions(program);

    expect(options.ui).toBe(false);
  });

  /**
   * Validates that all options can be combined without conflicts.
   * Commander can have surprising interactions when multiple options
   * are used together — this test catches those edge cases.
   */
  it("handles all options combined", () => {
    const program = buildProgram();
    program.parse(["--port", "3000", "--db-path", "/data/my.db", "--no-open", "--no-ui"], {
      from: "user",
    });
    const options = resolveOptions(program);

    expect(options.port).toBe(3000);
    expect(options.dbPath).toBe("/data/my.db");
    expect(options.open).toBe(false);
    expect(options.ui).toBe(false);
  });

  /**
   * Validates that non-numeric port values are rejected with a clear
   * error message. Without this validation, NaN would propagate to
   * `app.listen()` and produce a confusing Node.js error.
   */
  it("throws on invalid port (non-numeric)", () => {
    const program = buildProgram();
    program.parse(["--port", "abc"], { from: "user" });

    expect(() => resolveOptions(program)).toThrow("Invalid port number");
  });

  /**
   * Validates that port 0 is rejected. While OS allows port 0 for
   * ephemeral assignment, it's not useful for a user-facing server
   * and likely indicates a misconfiguration.
   */
  it("throws on port 0", () => {
    const program = buildProgram();
    program.parse(["--port", "0"], { from: "user" });

    expect(() => resolveOptions(program)).toThrow("Invalid port number");
  });

  /**
   * Validates that ports above 65535 are rejected. TCP ports are 16-bit
   * unsigned integers; values above 65535 would cause silent failures
   * or undefined behavior in the network stack.
   */
  it("throws on port above 65535", () => {
    const program = buildProgram();
    program.parse(["--port", "70000"], { from: "user" });

    expect(() => resolveOptions(program)).toThrow("Invalid port number");
  });
});

describe("getWebUiDistPath", () => {
  /**
   * Validates that the web-UI dist path resolves relative to the CLI
   * source directory using the monorepo layout convention. If the
   * monorepo structure changes, this test will catch the drift.
   */
  it("resolves to the web-ui dist directory relative to CLI source", () => {
    const distPath = getWebUiDistPath();
    // Should resolve to apps/web-ui/dist from apps/cli/src/
    expect(distPath).toContain(join("web-ui", "dist"));
  });

  /**
   * Validates that the returned path is absolute, not relative. Relative
   * paths would break when the working directory changes during server
   * operation (e.g., when spawning child processes).
   */
  it("returns an absolute path", () => {
    const distPath = getWebUiDistPath();
    expect(distPath).toMatch(/^\//);
  });
});

describe("getMigrationsPath", () => {
  /**
   * Validates that the migrations path resolves to the control-plane
   * drizzle directory in the monorepo. Incorrect migration paths
   * would cause silent database schema drift or startup failures.
   */
  it("resolves to the control-plane drizzle directory", () => {
    const migrationsPath = getMigrationsPath();
    expect(migrationsPath).toContain(join("control-plane", "drizzle"));
  });

  /**
   * Validates that the returned path is absolute for the same reasons
   * as the web-UI dist path test.
   */
  it("returns an absolute path", () => {
    const migrationsPath = getMigrationsPath();
    expect(migrationsPath).toMatch(/^\//);
  });
});
