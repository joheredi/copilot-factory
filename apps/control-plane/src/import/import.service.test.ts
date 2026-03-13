/**
 * Unit tests for the ImportService.
 *
 * Tests verify the core discovery logic:
 * 1. Auto-detection of JSON vs markdown format
 * 2. Correct parser delegation based on format
 * 3. Suggested name derivation from directory basename
 * 4. Error handling for non-existent paths
 * 5. Warning passthrough from parsers
 *
 * Uses a fake filesystem ({@link FakeFileSystem}) to isolate tests from
 * the real filesystem. The fake supports `exists()`, `readFile()`, and
 * `readDirectory()` which are the operations used by the parsers.
 *
 * @module @factory/control-plane
 * @see T115 — Create POST /import/discover endpoint
 */
import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";
import type { FileSystem } from "@factory/infrastructure";

import { ImportService } from "./import.service.js";

// ─── Fake FileSystem ─────────────────────────────────────────────────────────

/**
 * In-memory filesystem for testing.
 *
 * Stores files as a map of absolute paths to content strings. Supports the
 * subset of FileSystem methods used by the import parsers: exists, readFile,
 * readDirectory, and isDirectory.
 */
class FakeFileSystem implements FileSystem {
  private files = new Map<string, string>();
  private directories = new Set<string>();

  /** Register a file with its content. */
  addFile(filePath: string, content: string): void {
    this.files.set(filePath, content);
    // Auto-register parent directories
    const parts = filePath.split("/");
    for (let i = 1; i < parts.length; i++) {
      this.directories.add(parts.slice(0, i).join("/"));
    }
  }

  /** Register a directory (for exists/isDirectory checks). */
  addDirectory(dirPath: string): void {
    this.directories.add(dirPath);
  }

  async exists(p: string): Promise<boolean> {
    return this.files.has(p) || this.directories.has(p);
  }

  async readFile(p: string): Promise<string> {
    const content = this.files.get(p);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file: ${p}`);
    }
    return content;
  }

  async readdir(p: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
    const entries = new Map<string, boolean>();
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(p + "/")) {
        const relative = filePath.slice(p.length + 1);
        const firstSegment = relative.split("/")[0];
        // If relative has more segments, this is a directory child; otherwise a file
        entries.set(firstSegment, relative.includes("/") ? true : false);
      }
    }
    for (const dirPath of this.directories) {
      if (dirPath.startsWith(p + "/")) {
        const relative = dirPath.slice(p.length + 1);
        if (!relative.includes("/")) {
          entries.set(relative, true);
        }
      }
    }
    return [...entries.entries()].map(([name, isDir]) => ({
      name,
      isDirectory: isDir,
    }));
  }

  async mkdir(_p: string, _opts?: { recursive?: boolean }): Promise<void> {
    // no-op for tests
  }

  async writeFile(_p: string, _content: string): Promise<void> {
    throw new Error("writeFile not supported in FakeFileSystem");
  }

  async unlink(_p: string): Promise<void> {
    throw new Error("unlink not supported in FakeFileSystem");
  }

  async rename(_old: string, _new: string): Promise<void> {
    throw new Error("rename not supported in FakeFileSystem");
  }

  async rm(_p: string, _opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
    throw new Error("rm not supported in FakeFileSystem");
  }
}

// ─── Markdown task file template ─────────────────────────────────────────────

/**
 * Generates a minimal valid markdown task file for testing.
 * The format matches what the markdown parser expects: a metadata table
 * followed by description and acceptance criteria sections.
 */
function markdownTaskFile(id: string, title: string): string {
  return `# ${id}: ${title}

| Field | Value |
|---|---|
| **ID** | ${id} |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P1 |

## Description

${title} description.

## Acceptance Criteria

- [ ] Criterion one
`;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ImportService", () => {
  let fs: FakeFileSystem;
  let service: ImportService;

  beforeEach(() => {
    fs = new FakeFileSystem();
    service = new ImportService(fs);
  });

  /**
   * Validates that the service throws a descriptive error when the given
   * path does not exist on the filesystem. This prevents confusing error
   * messages from downstream parsers and provides a clear 400 response.
   */
  it("should throw BadRequestException for non-existent path", async () => {
    await expect(service.discover("/nonexistent/path")).rejects.toThrow(BadRequestException);
    await expect(service.discover("/nonexistent/path")).rejects.toThrow(/does not exist/);
  });

  /**
   * Validates the JSON format auto-detection: when a directory contains
   * a `backlog.json` file, the service should use the JSON parser and
   * report `format: "json"` in the response.
   */
  it("should discover tasks from backlog.json when present", async () => {
    const sourcePath = "/test/project";
    fs.addDirectory(sourcePath);
    fs.addFile(
      `${sourcePath}/backlog.json`,
      JSON.stringify({
        generated: "2025-01-01",
        epics: [{ id: "E001", title: "Test Epic", tasks: ["T001"] }],
        tasks: [
          {
            id: "T001",
            title: "Test Task",
            type: "feature",
            desc: "A test task",
            deps: [],
            criteria: ["Must work"],
          },
        ],
      }),
    );

    const result = await service.discover(sourcePath);

    expect(result.format).toBe("json");
    expect(result.tasks.length).toBeGreaterThanOrEqual(1);
    expect(result.tasks[0].title).toBe("Test Task");
    expect(result.suggestedProjectName).toBe("project");
    expect(result.suggestedRepositoryName).toBe("project");
  });

  /**
   * Validates the markdown format fallback: when no backlog.json exists,
   * the service should scan for .md files using the markdown parser and
   * report `format: "markdown"` in the response.
   */
  it("should discover tasks from markdown files when no backlog.json", async () => {
    const sourcePath = "/test/my-backlog";
    fs.addDirectory(sourcePath);
    fs.addDirectory(`${sourcePath}/tasks`);
    fs.addFile(`${sourcePath}/tasks/T001-first-task.md`, markdownTaskFile("T001", "First Task"));
    fs.addFile(`${sourcePath}/tasks/T002-second-task.md`, markdownTaskFile("T002", "Second Task"));

    const result = await service.discover(sourcePath);

    expect(result.format).toBe("markdown");
    expect(result.tasks.length).toBe(2);
    expect(result.suggestedProjectName).toBe("my-backlog");
    expect(result.suggestedRepositoryName).toBe("my-backlog");
  });

  /**
   * Validates that the suggested project name uses the directory basename
   * when neither parser provides a discovered name from metadata.
   * This ensures sensible defaults even with minimal source content.
   */
  it("should derive suggested names from directory basename", async () => {
    const sourcePath = "/home/user/awesome-project";
    fs.addDirectory(sourcePath);
    fs.addDirectory(`${sourcePath}/tasks`);
    fs.addFile(`${sourcePath}/tasks/T001-task.md`, markdownTaskFile("T001", "A Task"));

    const result = await service.discover(sourcePath);

    expect(result.suggestedProjectName).toBe("awesome-project");
    expect(result.suggestedRepositoryName).toBe("awesome-project");
  });

  /**
   * Validates that parser warnings are passed through to the response.
   * Warnings are critical for the UI preview step — they tell the user
   * about issues with specific tasks before they commit to the import.
   */
  it("should pass through parser warnings", async () => {
    const sourcePath = "/test/warned";
    fs.addDirectory(sourcePath);
    fs.addFile(
      `${sourcePath}/backlog.json`,
      JSON.stringify({
        epics: [],
        tasks: [
          {
            id: "T001",
            title: "Good Task",
            type: "feature",
          },
          {
            id: "T002",
            // Missing title — should generate a warning
            type: "feature",
          },
        ],
      }),
    );

    const result = await service.discover(sourcePath);

    // One task should parse successfully, one should generate warnings
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  /**
   * Validates that an empty directory produces zero tasks and no crash.
   * The service should gracefully handle directories with no recognizable
   * task files rather than throwing an error.
   */
  it("should handle empty directory gracefully", async () => {
    const sourcePath = "/test/empty";
    fs.addDirectory(sourcePath);

    const result = await service.discover(sourcePath);

    expect(result.tasks).toHaveLength(0);
    expect(result.format).toBe("markdown");
    expect(result.suggestedProjectName).toBe("empty");
  });

  /**
   * Validates JSON format priority: when both backlog.json and markdown
   * files exist, the service should prefer backlog.json. This matches the
   * task spec requirement for auto-detection order.
   */
  it("should prefer backlog.json over markdown when both exist", async () => {
    const sourcePath = "/test/mixed";
    fs.addDirectory(sourcePath);
    fs.addDirectory(`${sourcePath}/tasks`);
    fs.addFile(
      `${sourcePath}/backlog.json`,
      JSON.stringify({
        epics: [],
        tasks: [{ id: "J001", title: "JSON Task", type: "feature" }],
      }),
    );
    fs.addFile(`${sourcePath}/tasks/T001-md-task.md`, markdownTaskFile("T001", "MD Task"));

    const result = await service.discover(sourcePath);

    expect(result.format).toBe("json");
  });
});
