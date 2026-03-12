/**
 * Tests for task import Zod schemas ({@link ImportedTaskSchema},
 * {@link ImportManifestSchema}, {@link ParseWarningSchema}).
 *
 * These schemas are the contract boundary for the entire import pipeline:
 * parsers produce them, the API validates them, and the UI renders them.
 * Getting the validation right is critical because:
 * - Too strict → valid task files are rejected during import
 * - Too loose → invalid data reaches the database and corrupts task state
 *
 * @see T112 — Define task import Zod schemas
 */

import { describe, it, expect } from "vitest";

import {
  ParseWarningSeveritySchema,
  ParseWarningSchema,
  ImportedTaskSchema,
  ImportManifestSchema,
} from "./task-import.js";
import type { ParseWarning, ImportedTask, ImportManifest } from "./task-import.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Minimal valid task — only required fields. */
const minimalTask = {
  title: "Implement user login",
  taskType: "feature",
} as const;

/** Fully populated task with every optional field set. */
const fullTask: ImportedTask = {
  title: "Implement user authentication",
  description: "Add JWT-based login and token refresh endpoints.",
  taskType: "feature",
  priority: "high",
  riskLevel: "medium",
  estimatedSize: "m",
  acceptanceCriteria: [
    "Login endpoint returns JWT on valid credentials",
    "Token refresh extends session by 1 hour",
  ],
  definitionOfDone: "All acceptance criteria met with >80% coverage.",
  dependencies: ["T041", "T043"],
  suggestedFileScope: ["src/auth/**/*.ts"],
  externalRef: "T042",
  source: "T042-implement-auth.md",
  metadata: { epic: "E009", owner: "backend-engineer" },
};

/** Valid parse warning with all fields. */
const fullWarning: ParseWarning = {
  file: "T042-implement-auth.md",
  field: "priority",
  message: "Priority value 'P0' mapped to 'critical'",
  severity: "info",
};

/** Valid import manifest with tasks and warnings. */
const fullManifest: ImportManifest = {
  sourcePath: "/home/user/project/docs/backlog/tasks",
  formatVersion: "1.0",
  tasks: [fullTask],
  warnings: [fullWarning],
  discoveredProjectName: "copilot-factory",
  discoveredRepositoryName: "copilot-factory",
};

// ─── ParseWarningSeverity ────────────────────────────────────────────────────

describe("ParseWarningSeveritySchema", () => {
  /**
   * All three severity levels must be accepted.
   * Important because the UI uses severity to color-code warnings
   * and filter them in the preview.
   */
  it.each(["info", "warning", "error"])("should accept '%s'", (severity) => {
    expect(ParseWarningSeveritySchema.safeParse(severity).success).toBe(true);
  });

  /**
   * Invalid severity values must be rejected to prevent unknown
   * severity levels from reaching the UI.
   */
  it("should reject invalid severity", () => {
    expect(ParseWarningSeveritySchema.safeParse("critical").success).toBe(false);
    expect(ParseWarningSeveritySchema.safeParse("").success).toBe(false);
  });
});

// ─── ParseWarning ────────────────────────────────────────────────────────────

describe("ParseWarningSchema", () => {
  /**
   * A fully populated warning must validate. Ensures all fields work
   * together and the schema accepts the expected shape.
   */
  it("should accept a fully populated warning", () => {
    const result = ParseWarningSchema.safeParse(fullWarning);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(fullWarning);
    }
  });

  /**
   * The `field` property is optional — warnings like "file not found"
   * don't relate to a specific field.
   */
  it("should accept a warning without the optional field property", () => {
    const warning = {
      file: "README.md",
      message: "File does not appear to contain task metadata",
      severity: "warning",
    };
    const result = ParseWarningSchema.safeParse(warning);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.field).toBeUndefined();
    }
  });

  /**
   * Empty file name must be rejected — every warning must trace back
   * to a source file for the UI to display it meaningfully.
   */
  it("should reject an empty file name", () => {
    const warning = { ...fullWarning, file: "" };
    expect(ParseWarningSchema.safeParse(warning).success).toBe(false);
  });

  /**
   * Missing file must be rejected — it's a required field.
   */
  it("should reject a missing file", () => {
    const { file: _, ...warning } = fullWarning;
    expect(ParseWarningSchema.safeParse(warning).success).toBe(false);
  });

  /**
   * Empty message must be rejected — a warning without a message
   * provides no value to the user.
   */
  it("should reject an empty message", () => {
    const warning = { ...fullWarning, message: "" };
    expect(ParseWarningSchema.safeParse(warning).success).toBe(false);
  });

  /**
   * Missing severity must be rejected — the UI needs severity to
   * decide how to display the warning.
   */
  it("should reject a missing severity", () => {
    const { severity: _, ...warning } = fullWarning;
    expect(ParseWarningSchema.safeParse(warning).success).toBe(false);
  });

  /**
   * Empty string field must be rejected — if `field` is provided
   * it must be meaningful.
   */
  it("should reject an empty field string", () => {
    const warning = { ...fullWarning, field: "" };
    expect(ParseWarningSchema.safeParse(warning).success).toBe(false);
  });
});

// ─── ImportedTask ────────────────────────────────────────────────────────────

describe("ImportedTaskSchema", () => {
  /**
   * A minimal task with only required fields must validate.
   * This is the most common case when parsing markdown files
   * that only contain a title and type.
   */
  it("should accept a minimal task (title + taskType only)", () => {
    const result = ImportedTaskSchema.safeParse(minimalTask);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Implement user login");
      expect(result.data.taskType).toBe("feature");
      expect(result.data.priority).toBe("medium"); // default
    }
  });

  /**
   * A fully populated task with every optional field must validate.
   * Ensures all optional fields work together without conflicts.
   */
  it("should accept a fully populated task", () => {
    const result = ImportedTaskSchema.safeParse(fullTask);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(fullTask);
    }
  });

  /**
   * Priority must default to "medium" when not specified.
   * This ensures tasks from files that omit priority get a
   * sensible default instead of failing validation.
   */
  it("should default priority to 'medium' when omitted", () => {
    const result = ImportedTaskSchema.safeParse(minimalTask);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe("medium");
    }
  });

  /**
   * All valid taskType values must be accepted.
   * Covers the domain enum exhaustively.
   */
  it.each(["feature", "bug_fix", "refactor", "chore", "documentation", "test", "spike"])(
    "should accept taskType '%s'",
    (taskType) => {
      const result = ImportedTaskSchema.safeParse({ ...minimalTask, taskType });
      expect(result.success).toBe(true);
    },
  );

  /**
   * All valid priority values must be accepted.
   */
  it.each(["critical", "high", "medium", "low"])("should accept priority '%s'", (priority) => {
    const result = ImportedTaskSchema.safeParse({ ...minimalTask, priority });
    expect(result.success).toBe(true);
  });

  /**
   * All valid riskLevel values must be accepted.
   */
  it.each(["high", "medium", "low"])("should accept riskLevel '%s'", (riskLevel) => {
    const result = ImportedTaskSchema.safeParse({ ...minimalTask, riskLevel });
    expect(result.success).toBe(true);
  });

  /**
   * All valid estimatedSize values must be accepted.
   */
  it.each(["xs", "s", "m", "l", "xl"])("should accept estimatedSize '%s'", (estimatedSize) => {
    const result = ImportedTaskSchema.safeParse({ ...minimalTask, estimatedSize });
    expect(result.success).toBe(true);
  });

  /**
   * Metadata can hold arbitrary key-value pairs.
   * Important because parsers extract fields that don't map to known
   * schema fields and store them in metadata for UI display.
   */
  it("should accept metadata with arbitrary values", () => {
    const task = {
      ...minimalTask,
      metadata: {
        epic: "E009",
        customFlag: true,
        nestedObj: { key: "value" },
        count: 42,
      },
    };
    const result = ImportedTaskSchema.safeParse(task);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata).toEqual(task.metadata);
    }
  });

  /**
   * The inferred TypeScript type must be assignable.
   * Ensures compile-time and runtime validation agree.
   */
  it("should produce a correct inferred type", () => {
    const data: ImportedTask = { ...fullTask };
    const result = ImportedTaskSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  // ─── Rejection cases ────────────────────────────────────────────────────

  /**
   * Missing title must be rejected — every task needs a title.
   */
  it("should reject a task without a title", () => {
    const { title: _, ...task } = minimalTask;
    expect(ImportedTaskSchema.safeParse(task).success).toBe(false);
  });

  /**
   * Empty title must be rejected — an empty string is not a valid title.
   */
  it("should reject an empty title", () => {
    expect(ImportedTaskSchema.safeParse({ ...minimalTask, title: "" }).success).toBe(false);
  });

  /**
   * Title exceeding 500 chars must be rejected to prevent
   * excessively long titles that break UI layouts.
   */
  it("should reject a title exceeding 500 characters", () => {
    const longTitle = "x".repeat(501);
    expect(ImportedTaskSchema.safeParse({ ...minimalTask, title: longTitle }).success).toBe(false);
  });

  /**
   * Missing taskType must be rejected — it's required for routing
   * tasks to the correct worker profiles.
   */
  it("should reject a task without a taskType", () => {
    const { taskType: _, ...task } = minimalTask;
    expect(ImportedTaskSchema.safeParse(task).success).toBe(false);
  });

  /**
   * Invalid taskType must be rejected to prevent unknown task types
   * from entering the system.
   */
  it("should reject an invalid taskType", () => {
    expect(ImportedTaskSchema.safeParse({ ...minimalTask, taskType: "epic" }).success).toBe(false);
  });

  /**
   * Invalid priority must be rejected.
   */
  it("should reject an invalid priority", () => {
    expect(ImportedTaskSchema.safeParse({ ...minimalTask, priority: "urgent" }).success).toBe(
      false,
    );
  });

  /**
   * Invalid riskLevel must be rejected.
   */
  it("should reject an invalid riskLevel", () => {
    expect(ImportedTaskSchema.safeParse({ ...minimalTask, riskLevel: "extreme" }).success).toBe(
      false,
    );
  });

  /**
   * Invalid estimatedSize must be rejected.
   */
  it("should reject an invalid estimatedSize", () => {
    expect(ImportedTaskSchema.safeParse({ ...minimalTask, estimatedSize: "xxl" }).success).toBe(
      false,
    );
  });

  /**
   * Acceptance criteria with empty strings must be rejected.
   * Each criterion must be meaningful.
   */
  it("should reject acceptanceCriteria with empty strings", () => {
    const task = { ...minimalTask, acceptanceCriteria: ["valid", ""] };
    expect(ImportedTaskSchema.safeParse(task).success).toBe(false);
  });

  /**
   * Dependencies with empty strings must be rejected.
   * Each dependency ref must be a non-empty identifier.
   */
  it("should reject dependencies with empty strings", () => {
    const task = { ...minimalTask, dependencies: ["T041", ""] };
    expect(ImportedTaskSchema.safeParse(task).success).toBe(false);
  });

  /**
   * Empty externalRef must be rejected — if provided it must be meaningful.
   */
  it("should reject an empty externalRef", () => {
    const task = { ...minimalTask, externalRef: "" };
    expect(ImportedTaskSchema.safeParse(task).success).toBe(false);
  });

  /**
   * Empty source must be rejected — if provided it must trace to a file.
   */
  it("should reject an empty source", () => {
    const task = { ...minimalTask, source: "" };
    expect(ImportedTaskSchema.safeParse(task).success).toBe(false);
  });

  /**
   * Empty strings in suggestedFileScope must be rejected.
   */
  it("should reject suggestedFileScope with empty strings", () => {
    const task = { ...minimalTask, suggestedFileScope: ["src/**", ""] };
    expect(ImportedTaskSchema.safeParse(task).success).toBe(false);
  });

  /**
   * A title of exactly 500 characters should be accepted (boundary).
   */
  it("should accept a title of exactly 500 characters", () => {
    const task = { ...minimalTask, title: "x".repeat(500) };
    expect(ImportedTaskSchema.safeParse(task).success).toBe(true);
  });

  /**
   * Empty arrays for optional array fields should be accepted.
   * Parsers may produce empty arrays when no items are found.
   */
  it("should accept empty arrays for optional array fields", () => {
    const task = {
      ...minimalTask,
      acceptanceCriteria: [],
      dependencies: [],
      suggestedFileScope: [],
    };
    const result = ImportedTaskSchema.safeParse(task);
    expect(result.success).toBe(true);
  });
});

// ─── ImportManifest ──────────────────────────────────────────────────────────

describe("ImportManifestSchema", () => {
  /**
   * A fully populated manifest must validate.
   * This is the golden path for a successful discovery pass.
   */
  it("should accept a fully populated manifest", () => {
    const result = ImportManifestSchema.safeParse(fullManifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(fullManifest);
    }
  });

  /**
   * A minimal manifest with no tasks and no warnings must validate.
   * This represents scanning a directory with no task files.
   */
  it("should accept a minimal manifest with empty tasks and warnings", () => {
    const manifest = {
      sourcePath: "/some/path",
      tasks: [],
      warnings: [],
    };
    const result = ImportManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  /**
   * A manifest with multiple tasks and warnings must validate.
   * Real imports typically produce many tasks with scattered warnings.
   */
  it("should accept a manifest with multiple tasks and warnings", () => {
    const manifest = {
      sourcePath: "/project/tasks",
      tasks: [
        { title: "Task A", taskType: "feature" },
        { title: "Task B", taskType: "bug_fix" },
        { title: "Task C", taskType: "chore" },
      ],
      warnings: [
        { file: "taskA.md", message: "Missing priority", severity: "warning" },
        { file: "taskB.md", field: "riskLevel", message: "Unknown value 'P1'", severity: "error" },
      ],
    };
    const result = ImportManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tasks).toHaveLength(3);
      expect(result.data.warnings).toHaveLength(2);
    }
  });

  /**
   * Optional discovery metadata should be preserved when present.
   * This metadata helps pre-fill the project/repo fields during import.
   */
  it("should preserve optional discovery metadata", () => {
    const result = ImportManifestSchema.safeParse(fullManifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discoveredProjectName).toBe("copilot-factory");
      expect(result.data.discoveredRepositoryName).toBe("copilot-factory");
      expect(result.data.formatVersion).toBe("1.0");
    }
  });

  /**
   * The inferred TypeScript type must be assignable.
   */
  it("should produce a correct inferred type", () => {
    const data: ImportManifest = { ...fullManifest };
    const result = ImportManifestSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  // ─── Rejection cases ────────────────────────────────────────────────────

  /**
   * Missing sourcePath must be rejected — it's required to know where
   * the discovery pass scanned.
   */
  it("should reject a manifest without sourcePath", () => {
    const { sourcePath: _, ...manifest } = fullManifest;
    expect(ImportManifestSchema.safeParse(manifest).success).toBe(false);
  });

  /**
   * Empty sourcePath must be rejected.
   */
  it("should reject an empty sourcePath", () => {
    const manifest = { ...fullManifest, sourcePath: "" };
    expect(ImportManifestSchema.safeParse(manifest).success).toBe(false);
  });

  /**
   * Missing tasks array must be rejected — even an empty scan
   * should explicitly return an empty array.
   */
  it("should reject a manifest without tasks", () => {
    const { tasks: _, ...manifest } = fullManifest;
    expect(ImportManifestSchema.safeParse(manifest).success).toBe(false);
  });

  /**
   * Missing warnings array must be rejected — same reasoning as tasks.
   */
  it("should reject a manifest without warnings", () => {
    const { warnings: _, ...manifest } = fullManifest;
    expect(ImportManifestSchema.safeParse(manifest).success).toBe(false);
  });

  /**
   * Invalid task within the tasks array must be rejected.
   * Ensures nested ImportedTaskSchema validation is applied.
   */
  it("should reject a manifest with an invalid task", () => {
    const manifest = {
      ...fullManifest,
      tasks: [{ title: "" }], // missing taskType and empty title
    };
    expect(ImportManifestSchema.safeParse(manifest).success).toBe(false);
  });

  /**
   * Invalid warning within the warnings array must be rejected.
   * Ensures nested ParseWarningSchema validation is applied.
   */
  it("should reject a manifest with an invalid warning", () => {
    const manifest = {
      ...fullManifest,
      warnings: [{ file: "", message: "bad", severity: "info" }],
    };
    expect(ImportManifestSchema.safeParse(manifest).success).toBe(false);
  });

  /**
   * Empty discoveredProjectName must be rejected — if provided,
   * it must be a non-empty string.
   */
  it("should reject an empty discoveredProjectName", () => {
    const manifest = { ...fullManifest, discoveredProjectName: "" };
    expect(ImportManifestSchema.safeParse(manifest).success).toBe(false);
  });

  /**
   * Empty discoveredRepositoryName must be rejected.
   */
  it("should reject an empty discoveredRepositoryName", () => {
    const manifest = { ...fullManifest, discoveredRepositoryName: "" };
    expect(ImportManifestSchema.safeParse(manifest).success).toBe(false);
  });

  /**
   * Empty formatVersion must be rejected — if provided it must be meaningful.
   */
  it("should reject an empty formatVersion", () => {
    const manifest = { ...fullManifest, formatVersion: "" };
    expect(ImportManifestSchema.safeParse(manifest).success).toBe(false);
  });
});
