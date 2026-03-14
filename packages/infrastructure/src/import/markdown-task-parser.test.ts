/**
 * Tests for the deterministic markdown task parser.
 *
 * Validates every public function exported by the parser module, covering:
 * - Metadata table extraction from various formats
 * - Section extraction for Description, Goal, Acceptance Criteria
 * - Checkbox item parsing with checked/unchecked states
 * - Dependency reference extraction from markdown links and plain text
 * - External reference extraction from filenames
 * - File reference extraction from Context Files sections
 * - Title extraction with ID prefix stripping
 * - Priority and task type mapping to domain enums
 * - Index file parsing for ordering hints
 * - Full task file parsing with Zod validation
 * - Directory-level discovery with filesystem abstraction
 * - Ordering application based on index.md hints
 *
 * These tests ensure the parser produces valid {@link ImportManifest} objects
 * that downstream consumers (API endpoints, UI preview) can rely on.
 *
 * @module import/markdown-task-parser.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  parseMetadataTable,
  parseBoldMetadata,
  extractSection,
  extractCheckboxItems,
  extractDependencyRefs,
  extractExternalRef,
  extractFileReferences,
  extractTitle,
  mapTaskType,
  mapPriority,
  parseIndexFile,
  parseTaskFile,
  applyOrdering,
  findMarkdownFiles,
  discoverMarkdownTasks,
} from "./markdown-task-parser.js";
import type { FileSystem } from "../workspace/types.js";
import type { ImportedTask } from "@factory/schemas";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Minimal valid task markdown matching the backlog format. */
const MINIMAL_TASK_MD = `# T001: Init monorepo

| Field        | Value      |
| ------------ | ---------- |
| **ID**       | T001       |
| **Type**     | foundation |
| **Priority** | P0         |

## Description

Set up the pnpm monorepo structure.
`;

/** Fully populated task markdown with all sections. */
const FULL_TASK_MD = `# T045: Implement Copilot CLI adapter

| Field                     | Value                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| **ID**                    | T045                                                                |
| **Epic**                  | [E009: Worker Runtime](../epics/E009-worker-runtime.md)             |
| **Type**                  | feature                                                             |
| **Status**                | done                                                                |
| **Priority**              | P1                                                                  |
| **Owner**                 | backend-engineer                                                    |
| **AI Executable**         | Yes                                                                 |
| **Human Review Required** | Yes                                                                 |
| **Dependencies**          | [T002](./T002-workspace.md), [T003](./T003-runtime.md)             |
| **Blocks**                | [T107](./T107-lifecycle.md), [T108](./T108-integration.md)         |

---

## Description

Build the Copilot CLI adapter that wraps the \`gh copilot\` command.

## Goal

Enable deterministic worker execution via the Copilot CLI.

## Scope

### In Scope

- Process spawning
- Output parsing

### Out of Scope

- Authentication
- Rate limiting

## Context Files

The implementing agent should read these files before starting:

- \`packages/infrastructure/src/worker-runtime/copilot-cli-adapter.ts\`
- \`packages/domain/src/enums.ts\`

## Acceptance Criteria

- [x] Copilot CLI process spawned with correct arguments
- [ ] Output parsed into result packet
- [ ] Timeout handling works correctly

## Definition of Done

- All acceptance criteria are met
- Tests pass
- Code reviewed

## Validation

### Suggested Validation Commands

\`\`\`bash
pnpm test --filter @factory/infrastructure
\`\`\`
`;

/** Task markdown with no metadata table — edge case. */
const NO_TABLE_TASK_MD = `# Build the thing

## Description

Just a description, no metadata table.
`;

/** Task markdown with unrecognized type and priority. */
const UNKNOWN_FIELDS_MD = `# T099: Unknown fields task

| Field        | Value      |
| ------------ | ---------- |
| **Type**     | mystery    |
| **Priority** | P99        |

## Description

A task with unrecognized field values.
`;

// ---------------------------------------------------------------------------
// Fake FileSystem for discovery tests
// ---------------------------------------------------------------------------

function createFakeFs(
  files: Record<string, string>,
  dirs: Record<string, Array<{ name: string; isDirectory: boolean }>>,
): FileSystem {
  return {
    async readFile(filePath: string): Promise<string> {
      const content = files[filePath];
      if (content === undefined) {
        throw new Error(`File not found: ${filePath}`);
      }
      return content;
    },
    async exists(filePath: string): Promise<boolean> {
      return filePath in dirs || filePath in files;
    },
    async readdir(dirPath: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
      return dirs[dirPath] ?? [];
    },
    async mkdir(): Promise<void> {},
    async writeFile(): Promise<void> {},
    async unlink(): Promise<void> {},
    async rename(): Promise<void> {},
    async rm(): Promise<void> {},
  };
}

// ---------------------------------------------------------------------------
// parseMetadataTable
// ---------------------------------------------------------------------------

describe("parseMetadataTable", () => {
  /**
   * Validates that the parser correctly extracts field-value pairs from a
   * standard markdown table with bold field names. This is the most common
   * format in the backlog task files and must work reliably.
   */
  it("extracts fields from a standard metadata table", () => {
    const result = parseMetadataTable(MINIMAL_TASK_MD);

    expect(result.get("id")).toBe("T001");
    expect(result.get("type")).toBe("foundation");
    expect(result.get("priority")).toBe("P0");
  });

  /**
   * Validates parsing of fields containing markdown links, which is how
   * dependencies, epics, and blocks are formatted in task files.
   */
  it("extracts markdown link values from the table", () => {
    const result = parseMetadataTable(FULL_TASK_MD);

    expect(result.get("epic")).toContain("E009");
    expect(result.get("dependencies")).toContain("T002");
    expect(result.get("blocks")).toContain("T107");
    expect(result.get("status")).toBe("done");
    expect(result.get("owner")).toBe("backend-engineer");
  });

  /**
   * Validates that the parser returns an empty map when no table is present,
   * rather than throwing an error. The parser should be lenient.
   */
  it("returns empty map when no table is present", () => {
    const result = parseMetadataTable("# Just a heading\n\nSome text.");
    expect(result.size).toBe(0);
  });

  /**
   * Validates case-insensitive field name lookup since bold markers and
   * varying casing are common in markdown tables.
   */
  it("normalizes field names to lowercase", () => {
    const md = `| Field | Value |\n| --- | --- |\n| **AI Executable** | Yes |`;
    const result = parseMetadataTable(md);
    expect(result.get("ai executable")).toBe("Yes");
  });
});

// ---------------------------------------------------------------------------
// parseBoldMetadata
// ---------------------------------------------------------------------------

describe("parseBoldMetadata", () => {
  it("extracts **Key:** value pairs", () => {
    const content = `# M12-005: LLM Provider

**Status:** done
**Priority:** high
**Tag:** 🤖 agent

## Description

Some description.
`;
    const result = parseBoldMetadata(content);
    expect(result.get("status")).toBe("done");
    expect(result.get("priority")).toBe("high");
    expect(result.get("tag")).toBe("🤖 agent");
  });

  it("handles backtick-wrapped values", () => {
    const content = `# Task

**Status:** \`done\`
**Milestone:** \`M12 — Production Readiness\`

## Why
`;
    const result = parseBoldMetadata(content);
    expect(result.get("status")).toBe("done");
    expect(result.get("milestone")).toBe("M12 — Production Readiness");
  });

  it("stops at first H2 heading", () => {
    const content = `# Task

**Status:** done

## Description

**Priority:** high
`;
    const result = parseBoldMetadata(content);
    expect(result.get("status")).toBe("done");
    // Priority is below ## so should NOT be captured
    expect(result.has("priority")).toBe(false);
  });

  it("skips table rows", () => {
    const content = `# Task

| Field | Value |
| ----- | ----- |
| **Status** | done |

**Priority:** high

## Description
`;
    const result = parseBoldMetadata(content);
    // Table rows are skipped — only bold key-value outside tables
    expect(result.get("priority")).toBe("high");
    expect(result.has("status")).toBe(false);
  });

  it("returns empty map when no bold metadata exists", () => {
    const content = `# Task

## Description

Just a description.
`;
    const result = parseBoldMetadata(content);
    expect(result.size).toBe(0);
  });

  it("handles dependencies with complex values", () => {
    const content = `# Task

**Dependencies:** M12-006 (Azure OpenAI provisioning — 👤 human), M8 (migration platform)

## Description
`;
    const result = parseBoldMetadata(content);
    expect(result.get("dependencies")).toBe(
      "M12-006 (Azure OpenAI provisioning — 👤 human), M8 (migration platform)",
    );
  });

  it("normalizes keys to lowercase", () => {
    const content = `# Task

**Status:** done
**PRIORITY:** high
**Milestone:** M12

## Why
`;
    const result = parseBoldMetadata(content);
    expect(result.get("status")).toBe("done");
    expect(result.get("priority")).toBe("high");
    expect(result.get("milestone")).toBe("M12");
  });
});

// ---------------------------------------------------------------------------
// parseTaskFile with bold metadata
// ---------------------------------------------------------------------------

describe("parseTaskFile — bold metadata format", () => {
  it("extracts status and priority from bold key-value format", () => {
    const content = `# M12-005: LLM Provider — Azure OpenAI Integration

**Status:** \`done\`
**Milestone:** M12 — Production Readiness
**Dependencies:** M12-006, M8
**Priority:** high
**Tag:** 🤖 agent

## Why

The AI-assisted migration pipeline needs a real provider.

## Description

Implement a concrete AzureOpenAiMigrationProvider.
`;
    const result = parseTaskFile(content, "M12-005-llm-provider.md");
    expect(result.task).not.toBeNull();
    expect(result.task!.title).toContain("LLM Provider");
    expect(result.task!.priority).toBe("high");
    // Status should be in metadata for the classifier to pick up
    expect(result.task!.metadata?.["status"]).toBe("done");
  });

  it("table metadata takes precedence over bold metadata", () => {
    const content = `# T001: Test Task

**Status:** done
**Priority:** low

| Field        | Value     |
| ------------ | --------- |
| **Priority** | P0        |

## Description

Test.
`;
    const result = parseTaskFile(content, "T001-test.md");
    expect(result.task).not.toBeNull();
    // Table says P0 → critical, bold says low — table should win
    expect(result.task!.priority).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// extractSection
// ---------------------------------------------------------------------------

describe("extractSection", () => {
  /**
   * Validates that Description section content is captured between
   * the heading and the next heading boundary.
   */
  it("extracts Description section content", () => {
    const result = extractSection(FULL_TASK_MD, "Description");
    expect(result).toContain("Copilot CLI adapter");
    expect(result).toContain("`gh copilot`");
  });

  /**
   * Validates Goal section extraction — a distinct section with its own
   * content that should not bleed into Description.
   */
  it("extracts Goal section content", () => {
    const result = extractSection(FULL_TASK_MD, "Goal");
    expect(result).toContain("deterministic worker execution");
  });

  /**
   * Validates that the Scope section includes both In Scope and Out of
   * Scope subsections (H3 headings within the H2 section).
   */
  it("extracts Scope section with subsections", () => {
    const result = extractSection(FULL_TASK_MD, "Scope");
    expect(result).toContain("In Scope");
    expect(result).toContain("Process spawning");
    expect(result).toContain("Out of Scope");
    expect(result).toContain("Authentication");
  });

  /**
   * Validates case-insensitive heading matching since markdown headings
   * could theoretically vary in casing.
   */
  it("matches headings case-insensitively", () => {
    const result = extractSection(FULL_TASK_MD, "description");
    expect(result).toContain("Copilot CLI adapter");
  });

  /**
   * Validates that undefined is returned for missing sections rather than
   * an empty string, allowing callers to distinguish "not found" from "empty".
   */
  it("returns undefined for missing sections", () => {
    const result = extractSection(MINIMAL_TASK_MD, "Nonexistent");
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractCheckboxItems
// ---------------------------------------------------------------------------

describe("extractCheckboxItems", () => {
  /**
   * Validates extraction of checkbox items from acceptance criteria sections.
   * Both checked [x] and unchecked [ ] items should be captured.
   */
  it("extracts checked and unchecked checkbox items", () => {
    const section = extractSection(FULL_TASK_MD, "Acceptance Criteria")!;
    const items = extractCheckboxItems(section);

    expect(items).toHaveLength(3);
    expect(items[0]).toBe("Copilot CLI process spawned with correct arguments");
    expect(items[1]).toBe("Output parsed into result packet");
    expect(items[2]).toBe("Timeout handling works correctly");
  });

  /**
   * Validates that non-checkbox list items are ignored, preventing
   * false positives from regular bullet lists.
   */
  it("ignores non-checkbox items", () => {
    const content = "- Regular item\n- [ ] Checkbox item\n* [ ] Star checkbox\n- Not a checkbox";
    const items = extractCheckboxItems(content);
    expect(items).toHaveLength(2);
    expect(items[0]).toBe("Checkbox item");
    expect(items[1]).toBe("Star checkbox");
  });

  /**
   * Validates empty return when no checkboxes are present.
   */
  it("returns empty array when no checkboxes found", () => {
    const items = extractCheckboxItems("No checkboxes here.\n\nJust text.");
    expect(items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractDependencyRefs
// ---------------------------------------------------------------------------

describe("extractDependencyRefs", () => {
  /**
   * Validates extraction of task refs from markdown link syntax, which is
   * the standard format in backlog task files.
   */
  it("extracts refs from markdown links", () => {
    const refs = extractDependencyRefs("[T002](./T002-workspace.md), [T003](./T003-runtime.md)");
    expect(refs).toEqual(["T002", "T003"]);
  });

  /**
   * Validates extraction from plain text references when no markdown
   * links are used (fallback format).
   */
  it("extracts refs from plain text", () => {
    const refs = extractDependencyRefs("T042, T043");
    expect(refs).toEqual(["T042", "T043"]);
  });

  /**
   * Validates that a single dependency is correctly extracted.
   */
  it("handles single dependency", () => {
    const refs = extractDependencyRefs("[T134](./T134-dispatch.md)");
    expect(refs).toEqual(["T134"]);
  });

  /**
   * Validates that "None" returns an empty array — this is used in
   * the backlog when a task has no dependencies.
   */
  it("returns empty for None", () => {
    // The caller handles "None" check, but test the extraction still works
    const refs = extractDependencyRefs("None");
    expect(refs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractExternalRef
// ---------------------------------------------------------------------------

describe("extractExternalRef", () => {
  /**
   * Validates the standard filename pattern used in the backlog.
   */
  it("extracts task ID from standard filename", () => {
    expect(extractExternalRef("T045-copilot-cli-adapter.md")).toBe("T045");
  });

  /**
   * Validates extraction of multi-digit task IDs.
   */
  it("handles multi-digit IDs", () => {
    expect(extractExternalRef("T1234-long-name.md")).toBe("T1234");
  });

  /**
   * Validates that non-matching filenames return undefined.
   */
  it("returns undefined for non-matching filenames", () => {
    expect(extractExternalRef("index.md")).toBeUndefined();
    expect(extractExternalRef("readme.md")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractFileReferences
// ---------------------------------------------------------------------------

describe("extractFileReferences", () => {
  /**
   * Validates extraction of backtick-quoted file paths from a
   * Context Files section. This is how file references appear in tasks.
   */
  it("extracts backtick-quoted file paths", () => {
    const content = [
      "- `packages/infrastructure/src/worker-runtime/copilot-cli-adapter.ts`",
      "- `packages/domain/src/enums.ts`",
    ].join("\n");

    const paths = extractFileReferences(content);
    expect(paths).toContain("packages/infrastructure/src/worker-runtime/copilot-cli-adapter.ts");
    expect(paths).toContain("packages/domain/src/enums.ts");
  });

  /**
   * Validates deduplication of file references — the same file
   * might be mentioned multiple times in context.
   */
  it("deduplicates file paths", () => {
    const content = "- `src/foo.ts`\n- `src/foo.ts`\n- `src/bar.ts`";
    const paths = extractFileReferences(content);
    expect(paths).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// extractTitle
// ---------------------------------------------------------------------------

describe("extractTitle", () => {
  /**
   * Validates title extraction from H1 heading with task ID prefix stripped.
   * The parser should remove "T045: " prefix patterns to get a clean title.
   */
  it("extracts title from H1 and strips task ID prefix", () => {
    const title = extractTitle(FULL_TASK_MD, new Map());
    expect(title).toBe("Implement Copilot CLI adapter");
  });

  /**
   * Validates title extraction when no colon separator is used.
   */
  it("strips ID prefix with dash separator", () => {
    const md = "# T099 - Build the feature\n\nContent.";
    const title = extractTitle(md, new Map());
    expect(title).toBe("Build the feature");
  });

  /**
   * Validates that H1 headings without task ID prefixes are returned as-is.
   */
  it("returns full title when no ID prefix present", () => {
    const md = "# Build something awesome\n";
    const title = extractTitle(md, new Map());
    expect(title).toBe("Build something awesome");
  });

  /**
   * Validates fallback to metadata table ID when no H1 is present.
   */
  it("falls back to metadata ID", () => {
    const metadata = new Map([["id", "T099"]]);
    const title = extractTitle("## Only H2 headings here\n", metadata);
    expect(title).toBe("Task T099");
  });
});

// ---------------------------------------------------------------------------
// mapTaskType
// ---------------------------------------------------------------------------

describe("mapTaskType", () => {
  /**
   * Validates all known task type mappings including backlog-specific
   * types like "foundation" and "infrastructure" that map to "chore".
   */
  it.each([
    ["feature", "feature"],
    ["bug_fix", "bug_fix"],
    ["bugfix", "bug_fix"],
    ["refactor", "refactor"],
    ["chore", "chore"],
    ["documentation", "documentation"],
    ["docs", "documentation"],
    ["test", "test"],
    ["testing", "test"],
    ["spike", "spike"],
    ["foundation", "chore"],
    ["infrastructure", "chore"],
    ["integration", "feature"],
    ["validation", "test"],
  ])('maps "%s" to "%s"', (input, expected) => {
    expect(mapTaskType(input)).toBe(expected);
  });

  /**
   * Validates case-insensitive mapping.
   */
  it("is case-insensitive", () => {
    expect(mapTaskType("FEATURE")).toBe("feature");
    expect(mapTaskType("Foundation")).toBe("chore");
  });

  /**
   * Validates that unknown types return undefined so the caller
   * can generate a warning.
   */
  it("returns undefined for unknown types", () => {
    expect(mapTaskType("mystery")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mapPriority
// ---------------------------------------------------------------------------

describe("mapPriority", () => {
  /**
   * Validates all priority label mappings from backlog format (P0-P3)
   * and domain format (critical/high/medium/low).
   */
  it.each([
    ["P0", "critical"],
    ["P1", "high"],
    ["P2", "medium"],
    ["P3", "low"],
    ["critical", "critical"],
    ["high", "high"],
    ["medium", "medium"],
    ["low", "low"],
  ])('maps "%s" to "%s"', (input, expected) => {
    expect(mapPriority(input)).toBe(expected);
  });

  /**
   * Validates that unknown priorities return undefined.
   */
  it("returns undefined for unknown priorities", () => {
    expect(mapPriority("P99")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseIndexFile
// ---------------------------------------------------------------------------

describe("parseIndexFile", () => {
  const INDEX_MD = `# Autonomous Software Factory — Backlog

## Active Epics

| ID   | Title       | Done | Pending |
| ---- | ----------- | ---- | ------- |
| E001 | Foundation  | 6    | 0       |

## Tasks

| ID   | Title              | Priority | Status  |
| ---- | ------------------ | -------- | ------- |
| T001 | Init monorepo      | P0       | done    |
| T002 | TypeScript setup   | P0       | done    |
| T003 | Workspace manager  | P0       | pending |
`;

  /**
   * Validates that task IDs are extracted in table order from index.md,
   * which determines import ordering.
   */
  it("extracts task ordering from table rows", () => {
    const result = parseIndexFile(INDEX_MD);
    expect(result.taskOrder).toContain("T001");
    expect(result.taskOrder).toContain("T002");
    expect(result.taskOrder).toContain("T003");
    expect(result.taskOrder.indexOf("T001")).toBeLessThan(result.taskOrder.indexOf("T002"));
  });

  /**
   * Validates project name extraction from the H1 heading.
   */
  it("extracts project name from H1", () => {
    const result = parseIndexFile(INDEX_MD);
    expect(result.projectName).toBe("Autonomous Software Factory — Backlog");
  });

  /**
   * Validates deduplication of task refs that appear in multiple tables.
   */
  it("deduplicates task refs", () => {
    const md = `| T001 | First |\n| T001 | Duplicate |`;
    const result = parseIndexFile(md);
    const t001Count = result.taskOrder.filter((r) => r === "T001").length;
    expect(t001Count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// parseTaskFile (integration of all parsing functions)
// ---------------------------------------------------------------------------

describe("parseTaskFile", () => {
  /**
   * Validates end-to-end parsing of a minimal task file. The parser should
   * produce a valid ImportedTask with required fields populated and defaults
   * applied for optional fields.
   */
  it("parses a minimal task file into a valid ImportedTask", () => {
    const { task, warnings } = parseTaskFile(MINIMAL_TASK_MD, "T001-init-monorepo.md");

    expect(task).not.toBeNull();
    expect(task!.title).toBe("Init monorepo");
    expect(task!.taskType).toBe("chore"); // "foundation" maps to "chore"
    expect(task!.priority).toBe("critical"); // P0 maps to critical
    expect(task!.externalRef).toBe("T001");
    expect(task!.source).toBe("T001-init-monorepo.md");
    expect(task!.description).toContain("pnpm monorepo");

    // No error-level warnings expected for a valid file
    const errors = warnings.filter((w) => w.severity === "error");
    expect(errors).toHaveLength(0);
  });

  /**
   * Validates end-to-end parsing of a fully populated task file. All optional
   * fields should be extracted and mapped correctly.
   */
  it("parses a fully populated task file", () => {
    const { task, warnings } = parseTaskFile(FULL_TASK_MD, "T045-copilot-cli-adapter.md");

    expect(task).not.toBeNull();
    expect(task!.title).toBe("Implement Copilot CLI adapter");
    expect(task!.taskType).toBe("feature");
    expect(task!.priority).toBe("high"); // P1 maps to high
    expect(task!.externalRef).toBe("T045");

    // Description is now the full raw markdown content
    expect(task!.description).toContain("Copilot CLI adapter");
    expect(task!.description).toContain("## Goal");

    // Acceptance criteria extracted from checkboxes
    expect(task!.acceptanceCriteria).toHaveLength(3);
    expect(task!.acceptanceCriteria![0]).toContain("correct arguments");

    // Dependencies extracted from markdown links
    expect(task!.dependencies).toEqual(["T002", "T003"]);

    // Definition of Done
    expect(task!.definitionOfDone).toContain("acceptance criteria");

    // Context file paths
    expect(task!.suggestedFileScope).toContain(
      "packages/infrastructure/src/worker-runtime/copilot-cli-adapter.ts",
    );

    // Metadata extras
    expect(task!.metadata).toBeDefined();
    expect(task!.metadata!["status"]).toBe("done");
    expect(task!.metadata!["blocks"]).toEqual(["T107", "T108"]);

    const errors = warnings.filter((w) => w.severity === "error");
    expect(errors).toHaveLength(0);
  });

  /**
   * Validates that a file with no metadata table still produces a task
   * if it has an H1 heading — using defaults for missing fields.
   */
  it("handles files with no metadata table", () => {
    const { task, warnings } = parseTaskFile(NO_TABLE_TASK_MD, "build-thing.md");

    expect(task).not.toBeNull();
    expect(task!.title).toBe("Build the thing");
    expect(task!.taskType).toBe("chore"); // Default when no type specified

    // Should have warnings about missing type
    const typeWarnings = warnings.filter((w) => w.field === "taskType");
    expect(typeWarnings.length).toBeGreaterThan(0);
  });

  /**
   * Validates that unrecognized field values produce warnings while still
   * generating a task with defaults. The parser should be lenient.
   */
  it("generates warnings for unrecognized fields and uses defaults", () => {
    const { task, warnings } = parseTaskFile(UNKNOWN_FIELDS_MD, "T099-unknown.md");

    expect(task).not.toBeNull();
    expect(task!.taskType).toBe("chore"); // Default for unrecognized type
    expect(task!.priority).toBe("medium"); // Default priority

    // Should have warnings for both type and priority
    const typeWarning = warnings.find((w) => w.field === "taskType");
    expect(typeWarning).toBeDefined();
    expect(typeWarning!.message).toContain("mystery");

    const priorityWarning = warnings.find((w) => w.field === "priority");
    expect(priorityWarning).toBeDefined();
    expect(priorityWarning!.message).toContain("P99");
  });

  /**
   * Validates that a file with absolutely no title produces an error-level
   * warning and returns null — we cannot create a task without a title.
   */
  it("returns null with error warning when no title found", () => {
    const { task, warnings } = parseTaskFile(
      "Just some text\nwith no headings\nor tables.",
      "orphan.md",
    );

    expect(task).toBeNull();
    const errorWarnings = warnings.filter((w) => w.severity === "error");
    expect(errorWarnings.length).toBeGreaterThan(0);
    expect(errorWarnings[0].field).toBe("title");
  });

  /**
   * Validates that the full raw markdown content is stored as the description,
   * preserving all sections including non-standard ones like Objective,
   * Implementation Notes, etc.
   */
  it("preserves full raw markdown as description", () => {
    const richMd = `# M15-005: Sales Ownership API
**Status:** \`not-started\`
**Dependencies:** M15-003, M15-004
**Priority:** high
**Tag:** 🤖 agent

## Objective

Expose sales ownership assignment through REST endpoints.

## Implementation Notes

### Endpoints

\`\`\`
PATCH /v1/sales/customers/{id}/owner
\`\`\`

## Non-Goals

- Commission-related endpoints

## Acceptance Criteria

- [ ] Customer owner can be assigned
- [ ] Ownership history is queryable
`;

    const { task } = parseTaskFile(richMd, "M15-005-ownership-api.md");

    expect(task).not.toBeNull();
    // Full markdown is the description — all sections preserved
    expect(task!.description).toContain("## Objective");
    expect(task!.description).toContain("## Implementation Notes");
    expect(task!.description).toContain("## Non-Goals");
    expect(task!.description).toContain("PATCH /v1/sales/customers/{id}/owner");
    expect(task!.description).toContain("Commission-related endpoints");
    // Dependencies extracted from bold metadata
    expect(task!.dependencies).toEqual(["M15-003", "M15-004"]);
    // External ref from filename
    expect(task!.externalRef).toBe("M15-005");
  });
});

// ---------------------------------------------------------------------------
// applyOrdering
// ---------------------------------------------------------------------------

describe("applyOrdering", () => {
  const tasks: ImportedTask[] = [
    { title: "C", taskType: "chore", externalRef: "T003" } as ImportedTask,
    { title: "A", taskType: "chore", externalRef: "T001" } as ImportedTask,
    { title: "B", taskType: "chore", externalRef: "T002" } as ImportedTask,
  ];

  /**
   * Validates that tasks are reordered according to the index.md ordering
   * when external refs match.
   */
  it("reorders tasks according to ordering array", () => {
    const ordered = applyOrdering(tasks, ["T001", "T002", "T003"]);
    expect(ordered.map((t) => t.externalRef)).toEqual(["T001", "T002", "T003"]);
  });

  /**
   * Validates that tasks not in the ordering list are appended at the end.
   */
  it("appends unordered tasks at the end", () => {
    const ordered = applyOrdering(tasks, ["T002"]);
    expect(ordered[0].externalRef).toBe("T002");
    expect(ordered).toHaveLength(3);
  });

  /**
   * Validates that tasks without external refs are preserved at the end.
   */
  it("preserves tasks without external refs", () => {
    const mixed = [...tasks, { title: "No ref", taskType: "chore" } as ImportedTask];
    const ordered = applyOrdering(mixed, ["T001"]);
    expect(ordered[ordered.length - 1].title).toBe("No ref");
  });
});

// ---------------------------------------------------------------------------
// findMarkdownFiles
// ---------------------------------------------------------------------------

describe("findMarkdownFiles", () => {
  /**
   * Validates recursive discovery of .md files through the filesystem
   * abstraction. This ensures the parser can traverse nested directories.
   */
  it("discovers .md files recursively", async () => {
    const fs = createFakeFs(
      {
        "/root/file1.md": "",
        "/root/sub/file2.md": "",
        "/root/sub/file3.txt": "",
      },
      {
        "/root": [
          { name: "file1.md", isDirectory: false },
          { name: "sub", isDirectory: true },
        ],
        "/root/sub": [
          { name: "file2.md", isDirectory: false },
          { name: "file3.txt", isDirectory: false },
        ],
      },
    );

    const files = await findMarkdownFiles("/root", fs);
    expect(files).toEqual(["/root/file1.md", "/root/sub/file2.md"]);
  });

  /**
   * Validates that hidden directories (starting with .) are skipped.
   */
  it("skips hidden directories", async () => {
    const fs = createFakeFs(
      { "/root/.hidden/secret.md": "" },
      {
        "/root": [{ name: ".hidden", isDirectory: true }],
        "/root/.hidden": [{ name: "secret.md", isDirectory: false }],
      },
    );

    const files = await findMarkdownFiles("/root", fs);
    expect(files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// discoverMarkdownTasks (full pipeline integration)
// ---------------------------------------------------------------------------

describe("discoverMarkdownTasks", () => {
  let fakeFs: FileSystem;

  beforeEach(() => {
    fakeFs = createFakeFs(
      {
        "/backlog/index.md": `# My Project Backlog\n\n| ID | Title |\n| --- | --- |\n| T001 | First |\n| T002 | Second |`,
        "/backlog/tasks/T001-first.md": MINIMAL_TASK_MD,
        "/backlog/tasks/T002-second.md": `# T002: Second task\n\n| Field | Value |\n| --- | --- |\n| **Type** | feature |\n| **Priority** | P1 |\n\n## Description\n\nThe second task.`,
      },
      {
        "/backlog": [
          { name: "index.md", isDirectory: false },
          { name: "tasks", isDirectory: true },
        ],
        "/backlog/tasks": [
          { name: "T001-first.md", isDirectory: false },
          { name: "T002-second.md", isDirectory: false },
        ],
      },
    );
  });

  /**
   * Validates the full discovery pipeline: finds tasks/ directory, parses
   * all markdown files, reads index.md for ordering, and produces a valid
   * ImportManifest that passes Zod validation.
   */
  it("produces a valid ImportManifest from a directory", async () => {
    const manifest = await discoverMarkdownTasks("/backlog", fakeFs);

    expect(manifest.sourcePath).toBe("/backlog");
    expect(manifest.formatVersion).toBe("1.0");
    expect(manifest.tasks).toHaveLength(2);
    expect(manifest.discoveredProjectName).toBe("My Project Backlog");
  });

  /**
   * Validates that tasks are ordered according to index.md when available.
   */
  it("applies ordering from index.md", async () => {
    const manifest = await discoverMarkdownTasks("/backlog", fakeFs);

    // T001 should come before T002 based on index ordering
    const refs = manifest.tasks.map((t) => t.externalRef);
    expect(refs.indexOf("T001")).toBeLessThan(refs.indexOf("T002"));
  });

  /**
   * Validates that the parser works when no index.md is present — tasks
   * should still be parsed, just without ordering or project name.
   */
  it("works without index.md", async () => {
    const noIndexFs = createFakeFs(
      {
        "/backlog/tasks/T001-first.md": MINIMAL_TASK_MD,
      },
      {
        "/backlog": [{ name: "tasks", isDirectory: true }],
        "/backlog/tasks": [{ name: "T001-first.md", isDirectory: false }],
      },
    );

    const manifest = await discoverMarkdownTasks("/backlog", noIndexFs);

    expect(manifest.tasks).toHaveLength(1);
    expect(manifest.discoveredProjectName).toBeUndefined();
  });

  /**
   * Validates that warnings are collected and included in the manifest.
   */
  it("collects warnings from all parsed files", async () => {
    const warningFs = createFakeFs(
      {
        "/backlog/tasks/T099-bad.md": UNKNOWN_FIELDS_MD,
      },
      {
        "/backlog": [{ name: "tasks", isDirectory: true }],
        "/backlog/tasks": [{ name: "T099-bad.md", isDirectory: false }],
      },
    );

    const manifest = await discoverMarkdownTasks("/backlog", warningFs);

    expect(manifest.warnings.length).toBeGreaterThan(0);
    expect(manifest.warnings.some((w) => w.severity === "warning")).toBe(true);
  });

  /**
   * Validates that tasks with DONE or CANCELLED status are excluded from
   * the manifest, and an info-level warning is emitted for each.
   */
  it("excludes DONE and CANCELLED tasks from manifest", async () => {
    const doneMd = `# T010: Already finished\n\n| Field | Value |\n| --- | --- |\n| **Type** | feature |\n| **Status** | done |\n| **Priority** | P2 |\n\n## Description\n\nThis is already done.`;
    const cancelledMd = `# T011: Dropped task\n\n| Field | Value |\n| --- | --- |\n| **Type** | chore |\n| **Status** | cancelled |\n| **Priority** | P3 |\n\n## Description\n\nThis was cancelled.`;
    const activeMd = `# T012: Active task\n\n| Field | Value |\n| --- | --- |\n| **Type** | feature |\n| **Status** | backlog |\n| **Priority** | P1 |\n\n## Description\n\nThis is active work.`;

    const statusFs = createFakeFs(
      {
        "/backlog/tasks/T010-done.md": doneMd,
        "/backlog/tasks/T011-cancelled.md": cancelledMd,
        "/backlog/tasks/T012-active.md": activeMd,
      },
      {
        "/backlog": [{ name: "tasks", isDirectory: true }],
        "/backlog/tasks": [
          { name: "T010-done.md", isDirectory: false },
          { name: "T011-cancelled.md", isDirectory: false },
          { name: "T012-active.md", isDirectory: false },
        ],
      },
    );

    // Use a classify function that maps raw statuses to proper values
    const classify = async (inputs: { rawStatus?: string }[]) => ({
      results: inputs.map((input) => {
        const raw = (input.rawStatus ?? "").toLowerCase();
        const statusMap: Record<string, string> = {
          done: "DONE",
          cancelled: "CANCELLED",
          backlog: "BACKLOG",
        };
        return {
          taskType: "feature" as const,
          status: (statusMap[raw] ?? "BACKLOG") as "BACKLOG" | "DONE" | "CANCELLED",
        };
      }),
      warnings: [],
    });

    const manifest = await discoverMarkdownTasks("/backlog", statusFs, classify);

    // Only the active task should survive
    expect(manifest.tasks).toHaveLength(1);
    expect(manifest.tasks[0]!.externalRef).toBe("T012");

    // Info warnings emitted for skipped tasks
    const skipWarnings = manifest.warnings.filter(
      (w) => w.severity === "info" && w.message.includes("Skipped"),
    );
    expect(skipWarnings).toHaveLength(2);
    expect(skipWarnings.some((w) => w.message.includes("DONE"))).toBe(true);
    expect(skipWarnings.some((w) => w.message.includes("CANCELLED"))).toBe(true);
  });

  /**
   * Validates that when no tasks/ subdirectory exists, the parser falls
   * back to searching the sourcePath directly.
   */
  it("falls back to sourcePath when no tasks/ directory", async () => {
    const flatFs = createFakeFs(
      {
        "/flat/T001-first.md": MINIMAL_TASK_MD,
      },
      {
        "/flat": [{ name: "T001-first.md", isDirectory: false }],
      },
    );

    const manifest = await discoverMarkdownTasks("/flat", flatFs);
    expect(manifest.tasks).toHaveLength(1);
  });

  /**
   * Validates that description contains the full raw markdown content,
   * including non-standard sections like Objective and Implementation Notes.
   */
  it("stores full raw markdown as description for deterministic-parsed tasks", async () => {
    const richMd = `# M15-005: Sales Ownership API
**Status:** \`not-started\`
**Dependencies:** M15-003, M15-004
**Priority:** high
**Tag:** feature

## Objective

Expose sales ownership endpoints.

## Implementation Notes

PATCH /v1/sales/customers/{id}/owner

## Acceptance Criteria

- [ ] Customer owner can be assigned
`;

    const richFs = createFakeFs(
      {
        "/backlog/tasks/M15-005-ownership-api.md": richMd,
      },
      {
        "/backlog": [{ name: "tasks", isDirectory: true }],
        "/backlog/tasks": [{ name: "M15-005-ownership-api.md", isDirectory: false }],
      },
    );

    const manifest = await discoverMarkdownTasks("/backlog", richFs);

    expect(manifest.tasks).toHaveLength(1);
    const task = manifest.tasks[0]!;
    // Description is the full raw markdown — all sections preserved
    expect(task.description).toContain("## Objective");
    expect(task.description).toContain("## Implementation Notes");
    expect(task.description).toContain("PATCH /v1/sales/customers/{id}/owner");
    // Structured fields still extracted
    expect(task.dependencies).toEqual(["M15-003", "M15-004"]);
    expect(task.priority).toBe("high");
    expect(task.acceptanceCriteria).toContain("Customer owner can be assigned");
  });
});
