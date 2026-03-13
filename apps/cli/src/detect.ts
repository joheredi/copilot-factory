/**
 * Project metadata auto-detection for `factory init`.
 *
 * Each detection function probes the project directory for a specific piece
 * of metadata (name, git remote, default branch, owner). Every function is
 * independently callable, returns `null` on failure, and never throws —
 * callers can fall back to interactive prompts for any missing value.
 *
 * Git commands use synchronous execution because detection runs once during
 * init, so the simplicity of `execSync` outweighs async overhead.
 *
 * @see {@link file://docs/backlog/tasks/T142-init-project-detection.md}
 * @module @copilot/factory
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { userInfo } from "node:os";

/**
 * Aggregated project metadata produced by {@link detectAll}.
 *
 * Each field is nullable — `null` means the value could not be inferred
 * and should be prompted for interactively by the init flow (T143).
 */
export interface ProjectMetadata {
  /** Project name from package.json `name` field, or the directory basename. */
  projectName: string | null;
  /** Git remote URL from `git remote get-url origin`. */
  gitRemoteUrl: string | null;
  /** Default branch name parsed from the remote HEAD symbolic ref. */
  defaultBranch: string | null;
  /** Owner name from `git config user.name`, or the OS login username. */
  owner: string | null;
}

/**
 * Detect the project name from the working directory.
 *
 * Resolution order:
 * 1. `name` field in `package.json` (if present and non-empty)
 * 2. Directory basename (always available)
 *
 * @param cwd - Absolute path to the project root directory.
 * @returns The detected project name, or `null` if both strategies fail
 *          (which in practice only happens if `cwd` is the filesystem root).
 */
export function detectProjectName(cwd: string): string | null {
  try {
    const raw = readFileSync(join(cwd, "package.json"), "utf-8");
    const pkg: unknown = JSON.parse(raw);
    if (
      typeof pkg === "object" &&
      pkg !== null &&
      "name" in pkg &&
      typeof (pkg as Record<string, unknown>)["name"] === "string"
    ) {
      const name = (pkg as Record<string, unknown>)["name"] as string;
      if (name.length > 0) {
        return name;
      }
    }
  } catch {
    // package.json missing, unreadable, or malformed — fall through.
  }

  const dir = basename(cwd);
  return dir.length > 0 ? dir : null;
}

/**
 * Detect the git remote URL for `origin`.
 *
 * Runs `git remote get-url origin` in the given directory. Returns `null`
 * when the directory is not a git repository or has no `origin` remote.
 *
 * @param cwd - Absolute path to the project root directory.
 * @returns The remote URL string, or `null` on failure.
 */
export function detectGitRemoteUrl(cwd: string): string | null {
  try {
    const url = execSync("git remote get-url origin", {
      cwd,
      stdio: "pipe",
    })
      .toString()
      .trim();
    return url.length > 0 ? url : null;
  } catch {
    return null;
  }
}

/**
 * Detect the default branch name for the remote.
 *
 * Parses the output of `git symbolic-ref refs/remotes/origin/HEAD` to
 * extract the branch name (e.g. `refs/remotes/origin/main` → `"main"`).
 * Falls back to `"main"` when detection fails, since it is the most
 * common default branch name.
 *
 * @param cwd - Absolute path to the project root directory.
 * @returns The branch name, defaulting to `"main"` on failure.
 */
export function detectDefaultBranch(cwd: string): string | null {
  try {
    const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      cwd,
      stdio: "pipe",
    })
      .toString()
      .trim();
    // ref is typically "refs/remotes/origin/main" — extract the last segment.
    const parts = ref.split("/");
    const branch = parts[parts.length - 1];
    if (branch && branch.length > 0) {
      return branch;
    }
  } catch {
    // Not a git repo, or origin HEAD not set — use safe default.
  }

  return "main";
}

/**
 * Detect the project owner (human name or username).
 *
 * Resolution order:
 * 1. `git config user.name` (project or global git config)
 * 2. OS login username via `os.userInfo()`
 *
 * @param cwd - Absolute path to the project root directory.
 * @returns The detected owner name, or `null` if all strategies fail.
 */
export function detectOwner(cwd: string): string | null {
  try {
    const name = execSync("git config user.name", {
      cwd,
      stdio: "pipe",
    })
      .toString()
      .trim();
    if (name.length > 0) {
      return name;
    }
  } catch {
    // git not available or user.name not set — fall through.
  }

  try {
    const info = userInfo();
    if (info.username.length > 0) {
      return info.username;
    }
  } catch {
    // userInfo() can throw on some platforms.
  }

  return null;
}

/**
 * Run all project metadata detections and return the aggregated result.
 *
 * Each detection is independent — a failure in one does not affect the
 * others. The returned object always has all four fields, with `null`
 * for any value that could not be inferred.
 *
 * @param cwd - Absolute path to the project root directory.
 * @returns Aggregated {@link ProjectMetadata} with all detected values.
 */
export function detectAll(cwd: string): ProjectMetadata {
  return {
    projectName: detectProjectName(cwd),
    gitRemoteUrl: detectGitRemoteUrl(cwd),
    defaultBranch: detectDefaultBranch(cwd),
    owner: detectOwner(cwd),
  };
}
