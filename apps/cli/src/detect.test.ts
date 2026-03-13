/**
 * Tests for the project metadata auto-detection module ({@link detect}).
 *
 * These tests validate that each detection function correctly probes
 * the filesystem and git state, and degrades gracefully when the
 * expected data is absent. Real temporary directories and git repos
 * are used (no mocks) to ensure the detection logic works against
 * actual OS and git behavior.
 *
 * @see {@link file://docs/backlog/tasks/T142-init-project-detection.md}
 */

import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  detectAll,
  detectDefaultBranch,
  detectGitRemoteUrl,
  detectOwner,
  detectProjectName,
} from "./detect.js";

/** Create a temp directory for each test and clean up afterwards. */
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "detect-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Helper: initialize a bare git repo in the temp directory.
 * Sets user.name so that detectOwner tests are predictable.
 */
function initGitRepo(dir: string, userName = "Test User"): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync(`git config user.name "${userName}"`, { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@example.com"', {
    cwd: dir,
    stdio: "pipe",
  });
}

/**
 * Helper: add a remote named "origin" pointing to a local bare repo,
 * fetch it, and set refs/remotes/origin/HEAD to simulate a real clone.
 */
function addOriginRemote(dir: string, remoteUrl: string, defaultBranch = "main"): void {
  execSync(`git remote add origin ${remoteUrl}`, { cwd: dir, stdio: "pipe" });
  // Manually create the symbolic ref that `git clone` normally sets.
  execSync(`git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/${defaultBranch}`, {
    cwd: dir,
    stdio: "pipe",
  });
}

// ---------------------------------------------------------------------------
// detectProjectName
// ---------------------------------------------------------------------------

describe("detectProjectName", () => {
  /**
   * Validates that the name field from package.json is preferred over
   * the directory basename. This is the primary detection path for
   * Node.js projects.
   */
  it("returns name from package.json when present", () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "my-cool-app" }));
    expect(detectProjectName(tempDir)).toBe("my-cool-app");
  });

  /**
   * Validates fallback behavior: when no package.json exists, the
   * directory name itself is a reasonable project identifier.
   */
  it("falls back to directory basename when no package.json", () => {
    const result = detectProjectName(tempDir);
    // tempDir is something like /tmp/detect-test-XXXXXX
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  /**
   * Validates that a malformed package.json does not crash detection
   * and triggers the basename fallback instead.
   */
  it("falls back to directory basename when package.json is invalid JSON", () => {
    writeFileSync(join(tempDir, "package.json"), "not-json{{");
    const result = detectProjectName(tempDir);
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  /**
   * Validates that a package.json without a name field triggers the
   * basename fallback — this can happen with minimal package.json files.
   */
  it("falls back to directory basename when package.json has no name field", () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ version: "1.0.0" }));
    const result = detectProjectName(tempDir);
    expect(result).toBeTruthy();
  });

  /**
   * Validates that an empty name string in package.json is treated as
   * absent, triggering the basename fallback.
   */
  it("falls back to directory basename when package.json name is empty string", () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "" }));
    const result = detectProjectName(tempDir);
    expect(result).toBeTruthy();
  });

  /**
   * Validates that scoped npm package names (e.g. @org/pkg) are
   * returned as-is, preserving the full scope.
   */
  it("preserves scoped package names", () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "@myorg/my-lib" }));
    expect(detectProjectName(tempDir)).toBe("@myorg/my-lib");
  });
});

// ---------------------------------------------------------------------------
// detectGitRemoteUrl
// ---------------------------------------------------------------------------

describe("detectGitRemoteUrl", () => {
  /**
   * Validates that the origin remote URL is correctly detected from
   * a git repository. This is the primary path for projects cloned
   * from a remote.
   */
  it("returns origin remote URL when git repo has origin", () => {
    initGitRepo(tempDir);
    execSync("git remote add origin https://github.com/test/repo.git", {
      cwd: tempDir,
      stdio: "pipe",
    });
    expect(detectGitRemoteUrl(tempDir)).toBe("https://github.com/test/repo.git");
  });

  /**
   * Validates that detection returns null for non-git directories.
   * This is the expected behavior for projects that haven't been
   * initialized with git yet.
   */
  it("returns null when directory is not a git repo", () => {
    expect(detectGitRemoteUrl(tempDir)).toBeNull();
  });

  /**
   * Validates that a git repo without an origin remote returns null,
   * since there's no remote URL to detect.
   */
  it("returns null when git repo has no origin remote", () => {
    initGitRepo(tempDir);
    expect(detectGitRemoteUrl(tempDir)).toBeNull();
  });

  /**
   * Validates detection of SSH-style remote URLs, which are common
   * in developer workflows.
   */
  it("detects SSH remote URLs", () => {
    initGitRepo(tempDir);
    execSync("git remote add origin git@github.com:test/repo.git", {
      cwd: tempDir,
      stdio: "pipe",
    });
    expect(detectGitRemoteUrl(tempDir)).toBe("git@github.com:test/repo.git");
  });
});

// ---------------------------------------------------------------------------
// detectDefaultBranch
// ---------------------------------------------------------------------------

describe("detectDefaultBranch", () => {
  /**
   * Validates that the default branch is correctly parsed from the
   * symbolic ref. This simulates the state after `git clone`, where
   * refs/remotes/origin/HEAD points to the default branch.
   */
  it("detects default branch from symbolic ref", () => {
    initGitRepo(tempDir);
    addOriginRemote(tempDir, "https://github.com/test/repo.git", "develop");
    expect(detectDefaultBranch(tempDir)).toBe("develop");
  });

  /**
   * Validates that when branch detection fails (not a git repo),
   * the function returns "main" as a safe default — the most common
   * default branch name in modern git workflows.
   */
  it('falls back to "main" when not a git repo', () => {
    expect(detectDefaultBranch(tempDir)).toBe("main");
  });

  /**
   * Validates fallback when origin/HEAD is not set. This happens
   * when a repo is initialized locally without cloning.
   */
  it('falls back to "main" when origin/HEAD is not set', () => {
    initGitRepo(tempDir);
    expect(detectDefaultBranch(tempDir)).toBe("main");
  });

  /**
   * Validates detection of non-standard default branch names like
   * "master", which are still common in older repositories.
   */
  it("detects non-standard default branch names", () => {
    initGitRepo(tempDir);
    addOriginRemote(tempDir, "https://github.com/test/repo.git", "master");
    expect(detectDefaultBranch(tempDir)).toBe("master");
  });
});

// ---------------------------------------------------------------------------
// detectOwner
// ---------------------------------------------------------------------------

describe("detectOwner", () => {
  /**
   * Validates that the owner is detected from git config user.name.
   * This is the preferred detection path since it reflects the
   * developer's identity as configured for the project.
   */
  it("returns git config user.name when available", () => {
    initGitRepo(tempDir, "Alice Developer");
    expect(detectOwner(tempDir)).toBe("Alice Developer");
  });

  /**
   * Validates the OS username fallback when git user.name is not
   * configured. The OS username is always available and provides
   * a reasonable default.
   */
  it("falls back to OS username when not a git repo", () => {
    const result = detectOwner(tempDir);
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  /**
   * Validates the OS username fallback when git user.name is not
   * set (empty). A git repo can exist without user.name configured.
   */
  it("falls back to OS username when git user.name is not set", () => {
    initGitRepo(tempDir);
    execSync("git config --unset user.name", { cwd: tempDir, stdio: "pipe" });
    const result = detectOwner(tempDir);
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// detectAll
// ---------------------------------------------------------------------------

describe("detectAll", () => {
  /**
   * Validates that detectAll aggregates all four detection results
   * into a single ProjectMetadata object, with non-null values for
   * all fields when full context is available.
   */
  it("returns complete metadata for a fully configured project", () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "full-project" }));
    initGitRepo(tempDir, "Full Owner");
    addOriginRemote(tempDir, "https://github.com/full/project.git", "main");

    const meta = detectAll(tempDir);
    expect(meta.projectName).toBe("full-project");
    expect(meta.gitRemoteUrl).toBe("https://github.com/full/project.git");
    expect(meta.defaultBranch).toBe("main");
    expect(meta.owner).toBe("Full Owner");
  });

  /**
   * Validates that detectAll works in a bare directory with no git
   * or package.json. Each detection degrades independently, so we
   * still get partial results (basename, OS username, "main" default).
   */
  it("returns partial metadata for a bare directory", () => {
    const meta = detectAll(tempDir);
    expect(meta.projectName).toBeTruthy(); // directory basename
    expect(meta.gitRemoteUrl).toBeNull(); // no git
    expect(meta.defaultBranch).toBe("main"); // safe default
    expect(meta.owner).toBeTruthy(); // OS username
  });

  /**
   * Validates that the returned object has the correct shape with
   * all four expected fields, regardless of detection outcomes.
   */
  it("always returns all four fields", () => {
    const meta = detectAll(tempDir);
    expect(meta).toHaveProperty("projectName");
    expect(meta).toHaveProperty("gitRemoteUrl");
    expect(meta).toHaveProperty("defaultBranch");
    expect(meta).toHaveProperty("owner");
  });

  /**
   * Validates that nested subdirectories are handled correctly —
   * detecting from a subdirectory should still find the git repo
   * in a parent directory (git's normal directory traversal).
   */
  it("detects git metadata from a subdirectory of a repo", () => {
    initGitRepo(tempDir, "Sub User");
    execSync("git remote add origin https://github.com/sub/repo.git", {
      cwd: tempDir,
      stdio: "pipe",
    });

    const subDir = join(tempDir, "packages", "core");
    mkdirSync(subDir, { recursive: true });

    const meta = detectAll(subDir);
    expect(meta.gitRemoteUrl).toBe("https://github.com/sub/repo.git");
    expect(meta.owner).toBe("Sub User");
  });
});
