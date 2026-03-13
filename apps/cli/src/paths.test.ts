import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ensureFactoryHome,
  getArtifactsRoot,
  getDbPath,
  getFactoryHome,
  getMigrationsDir,
  getWorkspacesRoot,
} from "./paths.js";

/**
 * Tests for the global data directory path resolution module.
 *
 * These tests are critical because every service in the factory (database,
 * workspace manager, artifact store, migration runner) depends on consistent
 * path resolution. A bug here would cause data to be written to the wrong
 * location, potentially corrupting the user's home directory or causing
 * silent data loss.
 *
 * All tests that create directories use a temporary directory and the
 * FACTORY_HOME env var override to avoid touching the real ~/.copilot-factory/.
 */
describe("paths", () => {
  const originalFactoryHome = process.env["FACTORY_HOME"];

  afterEach(() => {
    // Restore original env after each test to prevent leakage
    if (originalFactoryHome === undefined) {
      delete process.env["FACTORY_HOME"];
    } else {
      process.env["FACTORY_HOME"] = originalFactoryHome;
    }
  });

  describe("getFactoryHome", () => {
    /**
     * Validates that the default factory home resolves to ~/.copilot-factory/
     * using os.homedir() for cross-platform compatibility. This is the
     * standard location users will expect their factory data to live.
     */
    it("returns ~/.copilot-factory/ by default when FACTORY_HOME is not set", () => {
      delete process.env["FACTORY_HOME"];

      const result = getFactoryHome();

      expect(result).toBe(join(homedir(), ".copilot-factory"));
    });

    /**
     * Validates that the FACTORY_HOME env var overrides the default path.
     * This override is essential for testing (to avoid writing to the real
     * home directory) and for non-standard deployments.
     */
    it("returns FACTORY_HOME when the env var is set", () => {
      process.env["FACTORY_HOME"] = "/custom/factory/path";

      const result = getFactoryHome();

      expect(result).toBe("/custom/factory/path");
    });

    /**
     * Ensures that an empty FACTORY_HOME string falls back to the default.
     * An empty string is treated as "not set" to prevent accidentally
     * creating directories at the filesystem root.
     */
    it("falls back to default when FACTORY_HOME is empty string", () => {
      process.env["FACTORY_HOME"] = "";

      const result = getFactoryHome();

      expect(result).toBe(join(homedir(), ".copilot-factory"));
    });
  });

  describe("getDbPath", () => {
    /**
     * Validates that the database path is always relative to the factory
     * home. This ensures the SQLite database lives inside the managed
     * data directory regardless of which home is configured.
     */
    it("returns {home}/factory.db", () => {
      process.env["FACTORY_HOME"] = "/test/home";

      const result = getDbPath();

      expect(result).toBe("/test/home/factory.db");
    });
  });

  describe("getWorkspacesRoot", () => {
    /**
     * Validates workspace root resolution. Git worktrees for all tasks
     * are created under this directory.
     */
    it("returns {home}/workspaces/", () => {
      process.env["FACTORY_HOME"] = "/test/home";

      const result = getWorkspacesRoot();

      expect(result).toBe(join("/test/home", "workspaces"));
    });
  });

  describe("getArtifactsRoot", () => {
    /**
     * Validates artifact root resolution. All task packets, run logs,
     * review artifacts, and merge outputs are stored under this path.
     */
    it("returns {home}/artifacts/", () => {
      process.env["FACTORY_HOME"] = "/test/home";

      const result = getArtifactsRoot();

      expect(result).toBe(join("/test/home", "artifacts"));
    });
  });

  describe("getMigrationsDir", () => {
    /**
     * Validates migration directory resolution. The Drizzle migration
     * runner needs to locate SQL migration files to apply schema changes
     * to the factory database.
     */
    it("returns {home}/drizzle/", () => {
      process.env["FACTORY_HOME"] = "/test/home";

      const result = getMigrationsDir();

      expect(result).toBe(join("/test/home", "drizzle"));
    });
  });

  describe("ensureFactoryHome", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "factory-test-"));
      process.env["FACTORY_HOME"] = tempDir;
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    /**
     * Validates that ensureFactoryHome creates the workspaces and artifacts
     * subdirectories. These are the two directories that must exist before
     * the workspace manager and artifact store can operate.
     */
    it("creates workspaces and artifacts subdirectories", () => {
      ensureFactoryHome();

      expect(existsSync(join(tempDir, "workspaces"))).toBe(true);
      expect(existsSync(join(tempDir, "artifacts"))).toBe(true);
    });

    /**
     * Validates idempotency — calling ensureFactoryHome multiple times
     * must not fail or modify existing directories. This is important
     * because the function is called at startup and may run concurrently
     * across CLI invocations.
     */
    it("is idempotent — calling multiple times does not throw", () => {
      ensureFactoryHome();
      ensureFactoryHome();
      ensureFactoryHome();

      expect(existsSync(join(tempDir, "workspaces"))).toBe(true);
      expect(existsSync(join(tempDir, "artifacts"))).toBe(true);
    });

    /**
     * Validates that ensureFactoryHome works when the factory home
     * directory itself doesn't exist yet (first-run scenario). Uses
     * a nested path to ensure recursive creation works.
     */
    it("creates the home directory itself if it does not exist", () => {
      const nestedDir = join(tempDir, "nested", "deep", "factory");
      process.env["FACTORY_HOME"] = nestedDir;

      ensureFactoryHome();

      expect(existsSync(nestedDir)).toBe(true);
      expect(existsSync(join(nestedDir, "workspaces"))).toBe(true);
      expect(existsSync(join(nestedDir, "artifacts"))).toBe(true);
    });
  });
});
