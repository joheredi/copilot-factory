/**
 * Tests for the JSON task parser module.
 *
 * Validates both backlog.json and flat JSON array formats, field mapping,
 * format auto-detection, warning generation, and error handling.
 *
 * @see {@link file://docs/backlog/tasks/T114-build-json-parser.md} — task spec
 */

import { describe, it, expect } from "vitest";

import type { FileSystem } from "../workspace/types.js";
import {
  detectJsonFormat,
  mapBacklogTask,
  mapFlatTask,
  parseBacklogJsonData,
  parseFlatJsonData,
  parseJsonTasks,
} from "./json-task-parser.js";

// ─── Test fixtures ───────────────────────────────────────────────────────────

/** Minimal backlog.json task with only required fields. */
const MINIMAL_BACKLOG_TASK = {
  id: "T001",
  title: "Initialize project",
  type: "foundation",
};

/** Fully populated backlog.json task with all known fields. */
const FULL_BACKLOG_TASK = {
  id: "T042",
  title: "Implement workspace manager",
  epic: "E005",
  type: "feature",
  priority: "P0",
  owner: "backend-engineer",
  ai_exec: "Yes",
  human_review: "Yes",
  deps: ["T001", "T002"],
  blocks: ["T043", "T044"],
  desc: "Build the workspace manager for git worktrees.",
  goal: "Enable isolated workspaces per task.",
  in_scope: ["Git worktree creation", "Cleanup on completion"],
  out_scope: ["Docker isolation"],
  context: ["packages/infrastructure/src/workspace/workspace-manager.ts"],
  criteria: ["Worktree created successfully", "Branch naming follows convention"],
  validation: "Run workspace creation test",
  risks: "Git worktree support varies across versions",
};

/** A minimal flat-format task that already uses ImportedTask field names. */
const MINIMAL_FLAT_TASK = {
  title: "Add logging middleware",
  taskType: "feature",
};

/** A fully populated flat-format task. */
const FULL_FLAT_TASK = {
  title: "Implement auth flow",
  description: "Build JWT-based authentication.",
  taskType: "feature",
  priority: "high",
  riskLevel: "medium",
  estimatedSize: "m",
  acceptanceCriteria: ["Login returns token", "Token refresh works"],
  definitionOfDone: "All auth tests pass",
  dependencies: ["T001"],
  suggestedFileScope: ["src/auth/"],
  externalRef: "AUTH-001",
  source: "tasks.json",
  metadata: { sprint: 3 },
};

/** Backlog.json root structure fixture. */
const BACKLOG_JSON_ROOT = {
  generated: "2026-03-10",
  epics: [{ id: "E001", title: "Foundation", summary: "Project scaffolding" }],
  tasks: [FULL_BACKLOG_TASK, MINIMAL_BACKLOG_TASK],
  phases: [],
};

/**
 * Create a fake FileSystem for testing, pre-loaded with file contents.
 * Only readFile is needed for the JSON parser.
 */
function createFakeFs(files: Record<string, string>): FileSystem {
  return {
    readFile: async (path: string) => {
      const content = files[path];
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory: '${path}'`);
      }
      return content;
    },
    mkdir: async () => {},
    exists: async () => false,
    writeFile: async () => {},
    unlink: async () => {},
    rename: async () => {},
    readdir: async () => [],
    rm: async () => {},
  };
}

// ─── detectJsonFormat ────────────────────────────────────────────────────────

describe("detectJsonFormat", () => {
  /**
   * Validates that an object with an "epics" key is recognized as backlog format.
   * This is the primary heuristic for distinguishing the two supported formats.
   */
  it("returns 'backlog' for objects with epics key", () => {
    expect(detectJsonFormat({ epics: [], tasks: [] })).toBe("backlog");
  });

  /**
   * Validates that a plain array is recognized as flat format.
   * Flat format is the simpler import path for external tools.
   */
  it("returns 'flat' for arrays", () => {
    expect(detectJsonFormat([{ title: "test", taskType: "feature" }])).toBe("flat");
  });

  /**
   * Validates that empty arrays are still recognized as flat format.
   */
  it("returns 'flat' for empty arrays", () => {
    expect(detectJsonFormat([])).toBe("flat");
  });

  /**
   * Validates that objects without the epics key are classified as unknown,
   * preventing misinterpretation of arbitrary JSON.
   */
  it("returns 'unknown' for objects without epics key", () => {
    expect(detectJsonFormat({ tasks: [] })).toBe("unknown");
  });

  /**
   * Validates that primitive values are classified as unknown.
   */
  it("returns 'unknown' for non-object/non-array values", () => {
    expect(detectJsonFormat("hello")).toBe("unknown");
    expect(detectJsonFormat(42)).toBe("unknown");
    expect(detectJsonFormat(null)).toBe("unknown");
    expect(detectJsonFormat(undefined)).toBe("unknown");
  });
});

// ─── mapBacklogTask ──────────────────────────────────────────────────────────

describe("mapBacklogTask", () => {
  const SOURCE = "backlog.json";

  /**
   * Validates that a minimal task (title + valid type) is successfully mapped.
   * This is the base case for backlog.json parsing — most tasks will have
   * at least these two fields.
   */
  it("maps a minimal backlog task", () => {
    const { task, warnings } = mapBacklogTask(MINIMAL_BACKLOG_TASK, SOURCE);

    expect(task).not.toBeNull();
    expect(task!.title).toBe("Initialize project");
    expect(task!.taskType).toBe("chore"); // "foundation" maps to "chore"
    expect(task!.externalRef).toBe("T001");
    expect(task!.source).toBe(SOURCE);
    expect(warnings).toHaveLength(0);
  });

  /**
   * Validates complete field mapping from backlog.json abbreviated names to
   * ImportedTask canonical names. Every backlog.json field must land in the
   * correct ImportedTask field or in metadata.
   */
  it("maps all fields of a fully populated backlog task", () => {
    const { task, warnings } = mapBacklogTask(FULL_BACKLOG_TASK, SOURCE);

    expect(task).not.toBeNull();
    expect(warnings).toHaveLength(0);

    // Direct field mappings
    expect(task!.title).toBe("Implement workspace manager");
    expect(task!.taskType).toBe("feature");
    expect(task!.priority).toBe("critical"); // P0 → critical
    expect(task!.externalRef).toBe("T042");
    expect(task!.description).toBe("Build the workspace manager for git worktrees.");
    expect(task!.dependencies).toEqual(["T001", "T002"]);
    expect(task!.acceptanceCriteria).toEqual([
      "Worktree created successfully",
      "Branch naming follows convention",
    ]);
    expect(task!.suggestedFileScope).toEqual([
      "packages/infrastructure/src/workspace/workspace-manager.ts",
    ]);
    expect(task!.source).toBe(SOURCE);

    // Metadata bucket
    expect(task!.metadata).toBeDefined();
    expect(task!.metadata!.blocks).toEqual(["T043", "T044"]);
    expect(task!.metadata!.goal).toBe("Enable isolated workspaces per task.");
    expect(task!.metadata!.inScope).toEqual(["Git worktree creation", "Cleanup on completion"]);
    expect(task!.metadata!.outScope).toEqual(["Docker isolation"]);
    expect(task!.metadata!.validation).toBe("Run workspace creation test");
    expect(task!.metadata!.risks).toBe("Git worktree support varies across versions");
    expect(task!.metadata!.owner).toBe("backend-engineer");
    expect(task!.metadata!.aiExecutable).toBe("Yes");
    expect(task!.metadata!.humanReview).toBe("Yes");
    expect(task!.metadata!.epic).toBe("E005");
  });

  /**
   * Validates that missing required title field produces an error warning
   * and returns null task. The parser must not silently skip required fields.
   */
  it("returns error warning for missing title", () => {
    const { task, warnings } = mapBacklogTask({ id: "T099", type: "feature" }, SOURCE);

    expect(task).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("error");
    expect(warnings[0].field).toBe("title");
  });

  /**
   * Validates that an unmappable type field produces an error warning.
   * Unknown task types cannot be silently defaulted — they indicate
   * a problem in the source data.
   */
  it("returns error warning for unmappable type", () => {
    const { task, warnings } = mapBacklogTask(
      { id: "T099", title: "Test task", type: "alien_type" },
      SOURCE,
    );

    expect(task).toBeNull();
    expect(warnings.some((w) => w.field === "type")).toBe(true);
  });

  /**
   * Validates that an unmappable priority generates a warning but still
   * produces a valid task (priority defaults to "medium").
   */
  it("warns but continues for unmappable priority", () => {
    const { task, warnings } = mapBacklogTask(
      { id: "T050", title: "Some task", type: "feature", priority: "P99" },
      SOURCE,
    );

    expect(task).not.toBeNull();
    expect(task!.priority).toBe("medium"); // falls back to default
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("warning");
    expect(warnings[0].field).toBe("priority");
  });

  /**
   * Validates that empty arrays for deps, criteria, and context are not
   * included in the output (they are optional and should only appear when
   * they contain values).
   */
  it("omits empty arrays from output", () => {
    const { task } = mapBacklogTask(
      {
        id: "T051",
        title: "Empty arrays task",
        type: "chore",
        deps: [],
        criteria: [],
        context: [],
        blocks: [],
      },
      SOURCE,
    );

    expect(task).not.toBeNull();
    expect(task!.dependencies).toBeUndefined();
    expect(task!.acceptanceCriteria).toBeUndefined();
    expect(task!.suggestedFileScope).toBeUndefined();
    expect(task!.metadata).toBeUndefined();
  });
});

// ─── mapFlatTask ─────────────────────────────────────────────────────────────

describe("mapFlatTask", () => {
  const SOURCE = "tasks.json";

  /**
   * Validates that a minimal flat task with just title and taskType passes
   * schema validation. This is the simplest valid import.
   */
  it("validates a minimal flat task", () => {
    const { task, warnings } = mapFlatTask(MINIMAL_FLAT_TASK, 0, SOURCE);

    expect(task).not.toBeNull();
    expect(task!.title).toBe("Add logging middleware");
    expect(task!.taskType).toBe("feature");
    expect(task!.source).toBe(SOURCE);
    expect(warnings).toHaveLength(0);
  });

  /**
   * Validates that all ImportedTask fields are preserved when a fully
   * populated flat task is parsed.
   */
  it("validates a fully populated flat task", () => {
    const { task, warnings } = mapFlatTask(FULL_FLAT_TASK, 0, SOURCE);

    expect(task).not.toBeNull();
    expect(warnings).toHaveLength(0);
    expect(task!.title).toBe("Implement auth flow");
    expect(task!.description).toBe("Build JWT-based authentication.");
    expect(task!.priority).toBe("high");
    expect(task!.riskLevel).toBe("medium");
    expect(task!.estimatedSize).toBe("m");
    expect(task!.acceptanceCriteria).toEqual(["Login returns token", "Token refresh works"]);
    expect(task!.externalRef).toBe("AUTH-001");
    expect(task!.metadata).toEqual({ sprint: 3 });
  });

  /**
   * Validates that null entries in the array produce an error warning
   * rather than crashing the parser.
   */
  it("returns error for null entries", () => {
    const { task, warnings } = mapFlatTask(null, 3, SOURCE);

    expect(task).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("error");
    expect(warnings[0].message).toContain("index 3");
  });

  /**
   * Validates that non-object entries (strings, numbers) produce error
   * warnings with the correct index in the message.
   */
  it("returns error for non-object entries", () => {
    const { task, warnings } = mapFlatTask("not an object", 5, SOURCE);

    expect(task).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("index 5");
  });

  /**
   * Validates that objects missing required fields produce Zod validation
   * errors with meaningful messages.
   */
  it("returns validation errors for invalid objects", () => {
    const { task, warnings } = mapFlatTask(
      { description: "missing title and taskType" },
      0,
      SOURCE,
    );

    expect(task).toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((w) => w.severity === "error")).toBe(true);
  });

  /**
   * Validates that the source field from the flat task entry takes precedence
   * over the injected source when both are present.
   */
  it("preserves existing source field from the entry", () => {
    const { task } = mapFlatTask(
      { title: "Test", taskType: "chore", source: "original.json" },
      0,
      "injected.json",
    );

    expect(task).not.toBeNull();
    expect(task!.source).toBe("original.json");
  });
});

// ─── parseBacklogJsonData ────────────────────────────────────────────────────

describe("parseBacklogJsonData", () => {
  const SOURCE = "docs/backlog/backlog.json";

  /**
   * Validates end-to-end parsing of a backlog.json structure, ensuring
   * all valid tasks are included and the manifest metadata is correct.
   */
  it("parses a complete backlog.json structure", () => {
    const manifest = parseBacklogJsonData(BACKLOG_JSON_ROOT, SOURCE);

    expect(manifest.sourcePath).toBe(SOURCE);
    expect(manifest.tasks).toHaveLength(2);
    expect(manifest.tasks[0].title).toBe("Implement workspace manager");
    expect(manifest.tasks[1].title).toBe("Initialize project");
    expect(manifest.formatVersion).toBe("2026-03-10");
  });

  /**
   * Validates that tasks with mapping errors are skipped while valid tasks
   * are still included. The parser must be resilient to partial failures.
   */
  it("skips invalid tasks and collects warnings", () => {
    const data = {
      epics: [],
      tasks: [
        FULL_BACKLOG_TASK,
        { id: "TBAD", type: "feature" }, // missing title
        { id: "TBAD2", title: "No type" }, // missing type
      ],
    };

    const manifest = parseBacklogJsonData(data, SOURCE);

    expect(manifest.tasks).toHaveLength(1);
    expect(manifest.tasks[0].externalRef).toBe("T042");
    expect(manifest.warnings.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * Validates that a missing tasks array produces a warning rather than
   * crashing. This handles malformed backlog.json files gracefully.
   */
  it("warns when tasks array is missing", () => {
    const manifest = parseBacklogJsonData({ epics: [] }, SOURCE);

    expect(manifest.tasks).toHaveLength(0);
    expect(manifest.warnings).toHaveLength(1);
    expect(manifest.warnings[0].field).toBe("tasks");
  });

  /**
   * Validates that non-object entries in the tasks array are skipped
   * with a warning rather than crashing.
   */
  it("skips non-object entries in tasks array", () => {
    const data = {
      epics: [],
      tasks: [MINIMAL_BACKLOG_TASK, null, "string", 42],
    };

    const manifest = parseBacklogJsonData(data as unknown as Record<string, unknown>, SOURCE);

    expect(manifest.tasks).toHaveLength(1);
    expect(manifest.warnings.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── parseFlatJsonData ───────────────────────────────────────────────────────

describe("parseFlatJsonData", () => {
  const SOURCE = "tasks.json";

  /**
   * Validates end-to-end parsing of a flat JSON task array.
   */
  it("parses a flat array of tasks", () => {
    const manifest = parseFlatJsonData([MINIMAL_FLAT_TASK, FULL_FLAT_TASK], SOURCE);

    expect(manifest.sourcePath).toBe(SOURCE);
    expect(manifest.tasks).toHaveLength(2);
    expect(manifest.warnings).toHaveLength(0);
  });

  /**
   * Validates that an empty array produces an empty manifest with no warnings.
   */
  it("handles empty array", () => {
    const manifest = parseFlatJsonData([], SOURCE);

    expect(manifest.tasks).toHaveLength(0);
    expect(manifest.warnings).toHaveLength(0);
  });

  /**
   * Validates that mixed valid and invalid entries are handled correctly,
   * keeping valid tasks and generating warnings for invalid ones.
   */
  it("handles mixed valid and invalid entries", () => {
    const manifest = parseFlatJsonData([MINIMAL_FLAT_TASK, null, { title: "no type" }], SOURCE);

    expect(manifest.tasks).toHaveLength(1);
    expect(manifest.warnings.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── parseJsonTasks (integration) ────────────────────────────────────────────

describe("parseJsonTasks", () => {
  /**
   * Validates the full pipeline: read file → parse JSON → detect format →
   * map tasks → return manifest. This is the primary integration test
   * ensuring all components work together for backlog.json format.
   */
  it("parses a backlog.json file end-to-end", async () => {
    const fs = createFakeFs({
      "/data/backlog.json": JSON.stringify(BACKLOG_JSON_ROOT),
    });

    const manifest = await parseJsonTasks("/data/backlog.json", fs);

    expect(manifest.sourcePath).toBe("/data/backlog.json");
    expect(manifest.tasks).toHaveLength(2);
    expect(manifest.formatVersion).toBe("2026-03-10");
    expect(manifest.warnings).toHaveLength(0);
  });

  /**
   * Validates the full pipeline for flat format detection and parsing.
   */
  it("parses a flat tasks.json file end-to-end", async () => {
    const fs = createFakeFs({
      "/data/tasks.json": JSON.stringify([MINIMAL_FLAT_TASK, FULL_FLAT_TASK]),
    });

    const manifest = await parseJsonTasks("/data/tasks.json", fs);

    expect(manifest.sourcePath).toBe("/data/tasks.json");
    expect(manifest.tasks).toHaveLength(2);
    expect(manifest.warnings).toHaveLength(0);
  });

  /**
   * Validates graceful handling when the file does not exist.
   * The parser must return a manifest with an error warning rather than
   * throwing an exception.
   */
  it("returns error manifest when file does not exist", async () => {
    const fs = createFakeFs({});

    const manifest = await parseJsonTasks("/nonexistent.json", fs);

    expect(manifest.tasks).toHaveLength(0);
    expect(manifest.warnings).toHaveLength(1);
    expect(manifest.warnings[0].severity).toBe("error");
    expect(manifest.warnings[0].message).toContain("Failed to read file");
  });

  /**
   * Validates graceful handling of invalid JSON content.
   * Malformed files must produce a clear error rather than crash.
   */
  it("returns error manifest for invalid JSON", async () => {
    const fs = createFakeFs({
      "/data/bad.json": "{ not valid json !!!",
    });

    const manifest = await parseJsonTasks("/data/bad.json", fs);

    expect(manifest.tasks).toHaveLength(0);
    expect(manifest.warnings).toHaveLength(1);
    expect(manifest.warnings[0].severity).toBe("error");
    expect(manifest.warnings[0].message).toContain("Invalid JSON");
  });

  /**
   * Validates that unrecognized JSON structures (neither backlog.json
   * nor flat array) produce a clear format error.
   */
  it("returns error manifest for unrecognized format", async () => {
    const fs = createFakeFs({
      "/data/weird.json": JSON.stringify({ foo: "bar" }),
    });

    const manifest = await parseJsonTasks("/data/weird.json", fs);

    expect(manifest.tasks).toHaveLength(0);
    expect(manifest.warnings).toHaveLength(1);
    expect(manifest.warnings[0].message).toContain("Unrecognized JSON format");
  });

  /**
   * Validates that the parser handles a backlog.json with mixed valid
   * and invalid tasks, collecting all warnings while preserving valid results.
   * This simulates real-world backlog files that may have data quality issues.
   */
  it("collects warnings across multiple invalid tasks", async () => {
    const data = {
      epics: [],
      tasks: [
        FULL_BACKLOG_TASK,
        { id: "TBAD1", type: "feature" }, // missing title
        { id: "TBAD2", title: "No type" }, // missing type
        MINIMAL_BACKLOG_TASK,
      ],
    };
    const fs = createFakeFs({
      "/data/mixed.json": JSON.stringify(data),
    });

    const manifest = await parseJsonTasks("/data/mixed.json", fs);

    expect(manifest.tasks).toHaveLength(2);
    expect(manifest.warnings.length).toBeGreaterThanOrEqual(2);
  });
});
