# Task Format Reference

This document describes the canonical task file formats supported by the factory import system. Use it to prepare your task files for import, whether you author them by hand or convert existing tasks from another tool.

## Table of Contents

- [Overview](#overview)
- [Markdown Format](#markdown-format)
- [JSON Format](#json-format)
- [Field Mapping Table](#field-mapping-table)
- [Complete Examples](#complete-examples)
- [AI Prompt Template](#ai-prompt-template)
- [Troubleshooting](#troubleshooting)

---

## Overview

The factory import pipeline supports two input formats:

| Format       | File Extension | Best For                                                                                                                               |
| ------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Markdown** | `.md`          | Human-authored tasks in a `docs/backlog/tasks/` directory. Each file is one task. Easy to read and edit.                               |
| **JSON**     | `.json`        | Machine-generated or bulk-exported task lists. Two sub-formats: _backlog.json_ (structured with epics) and _flat array_ (simple list). |

Both formats are parsed into the same internal schema (`ImportedTask`) and validated through the same Zod schemas before import. You can mix formats in the same project — the import dialog auto-detects the format from the file contents.

### Import Flow

```
Source files (Markdown or JSON)
        ↓
  Parser (auto-detected)
        ↓
  ImportManifest (tasks + warnings)
        ↓
  UI Preview (review, edit, confirm)
        ↓
  Task Creation in Database
```

---

## Markdown Format

Each markdown file represents one task. The parser extracts data from three sources within the file:

1. **Metadata table** — a two-column markdown table with `| Field | Value |` rows
2. **Headed sections** — content under `## Heading` blocks
3. **Filename** — the external reference ID is extracted from the filename (e.g., `T042` from `T042-implement-supervisor.md`)

### Metadata Table

The metadata table must be a standard markdown table with two columns: **Field** and **Value**. Field names are matched case-insensitively after stripping bold markers (`**`).

| Field                     | Required | Maps To                 | Description                                                                                                      |
| ------------------------- | -------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **ID**                    | No       | `externalRef`           | Unique identifier (e.g., `T042`). Also extracted from the filename if not present in the table.                  |
| **Title**                 | No       | —                       | Not used directly; the parser takes the title from the first `# Heading` in the file.                            |
| **Epic**                  | No       | `metadata.epic`         | Parent epic reference (e.g., `E005`). Stored in metadata.                                                        |
| **Type**                  | Yes      | `taskType`              | Task classification. Mapped via the [type mapping table](#type-mapping).                                         |
| **Status**                | No       | `metadata.status`       | Current status (e.g., `pending`, `done`). Stored in metadata.                                                    |
| **Priority**              | No       | `priority`              | Scheduling priority. Mapped via the [priority mapping table](#priority-mapping). Defaults to `medium` if absent. |
| **Owner**                 | No       | `metadata.owner`        | Role or person responsible. Stored in metadata.                                                                  |
| **AI Executable**         | No       | `metadata.aiExecutable` | Whether an AI agent can execute this task (`Yes`/`No`). Stored in metadata.                                      |
| **Human Review Required** | No       | `metadata.humanReview`  | Whether human review is needed (`Yes`/`No`). Stored in metadata.                                                 |
| **Dependencies**          | No       | `dependencies`          | Tasks this depends on. Accepts markdown links (`[T001](./T001-file.md)`) or plain IDs (`T001, T002`).            |
| **Blocks**                | No       | `metadata.blocks`       | Tasks blocked by this one. Same link/ID syntax as Dependencies. Stored in metadata.                              |

#### Example Metadata Table

```markdown
| Field                     | Value                                                        |
| ------------------------- | ------------------------------------------------------------ |
| **ID**                    | T042                                                         |
| **Epic**                  | [E005: Worker Lifecycle](../epics/E005-lifecycle.md)         |
| **Type**                  | feature                                                      |
| **Status**                | pending                                                      |
| **Priority**              | P1                                                           |
| **Owner**                 | backend-engineer                                             |
| **AI Executable**         | Yes                                                          |
| **Human Review Required** | Yes                                                          |
| **Dependencies**          | [T030](./T030-lease-service.md), [T031](./T031-heartbeat.md) |
| **Blocks**                | [T050](./T050-integration-test.md)                           |
```

### Headed Sections

The parser recognizes these `## Heading` sections (case-insensitive):

| Section Heading          | Maps To               | Description                                                                           |
| ------------------------ | --------------------- | ------------------------------------------------------------------------------------- |
| `## Description`         | `description`         | Combined with the Goal section (separated by a newline) to form the task description. |
| `## Goal`                | `description`         | Appended to the Description section.                                                  |
| `## Scope`               | —                     | Container for In Scope / Out of Scope subsections.                                    |
| `### In Scope`           | `metadata.inScope`    | Bullet list of what's included.                                                       |
| `### Out of Scope`       | `metadata.outScope`   | Bullet list of what's excluded.                                                       |
| `## Context Files`       | `suggestedFileScope`  | Backtick-quoted file paths are extracted (e.g., `` `src/auth/login.ts` ``).           |
| `## Acceptance Criteria` | `acceptanceCriteria`  | Checkbox items (`- [ ] criterion`) are extracted as individual strings.               |
| `## Definition of Done`  | `definitionOfDone`    | Free-text summary of what "done" means.                                               |
| `## Validation`          | `metadata.validation` | Validation instructions. Stored in metadata.                                          |
| `## Risks / Notes`       | `metadata.risks`      | Risk assessment or notes. Stored in metadata.                                         |

#### Checkbox Syntax for Acceptance Criteria

Acceptance criteria are extracted from GitHub-flavored checkbox lists:

```markdown
## Acceptance Criteria

- [ ] Worker processes exactly one task per lease
- [ ] Heartbeat interval is configurable via environment variable
- [ ] Graceful shutdown completes in-progress work before exiting
- [ ] Unit tests cover all three scenarios
```

Each `- [ ]` or `- [x]` item becomes one entry in the `acceptanceCriteria` array.

### Task Title

The task title is taken from the **first `# Heading`** in the file:

```markdown
# T042: Implement worker supervisor
```

The parser uses everything after the first `#` as the title.

### External Reference from Filename

If the filename matches the pattern `T###-description.md` (e.g., `T042-implement-supervisor.md`), the parser extracts `T042` as the `externalRef`. This is used for deduplication on re-import.

---

## JSON Format

The JSON parser supports two sub-formats, auto-detected from the file structure.

### Format 1: backlog.json (Structured)

A root object with `epics` and `tasks` arrays. This is the format used by the project's own `docs/backlog/backlog.json`.

```json
{
  "generated": "2026-03-10",
  "epics": [
    {
      "id": "E001",
      "title": "Repository & Platform Foundation",
      "summary": "Bootstrap the monorepo and toolchain.",
      "tasks": ["T001", "T002", "T003"]
    }
  ],
  "tasks": [
    {
      "id": "T001",
      "title": "Initialize pnpm monorepo workspace",
      "epic": "E001",
      "type": "foundation",
      "priority": "P0",
      "deps": [],
      "blocks": ["T002", "T003"],
      "desc": "Create the root pnpm monorepo...",
      "goal": "Establish the foundational monorepo structure.",
      "in_scope": ["Root package.json", "Directory scaffolding"],
      "out_scope": ["TypeScript configuration (T002)"],
      "context": ["docs/prd/007-technical-architecture.md"],
      "criteria": ["pnpm install succeeds", "All packages listed"],
      "validation": "Run pnpm install and verify workspace linking",
      "risks": "None significant.",
      "owner": "platform-engineer",
      "ai_exec": "Yes",
      "human_review": "Yes"
    }
  ]
}
```

#### backlog.json Task Fields

| Field          | Required | Maps To                 | Description                                                                                       |
| -------------- | -------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `id`           | No       | `externalRef`           | Unique task identifier (e.g., `T001`). Used for deduplication.                                    |
| `title`        | **Yes**  | `title`                 | Human-readable task title.                                                                        |
| `type`         | **Yes**  | `taskType`              | Task classification. Mapped via the [type mapping table](#type-mapping).                          |
| `desc`         | No       | `description`           | Task description.                                                                                 |
| `priority`     | No       | `priority`              | Priority level. Mapped via the [priority mapping table](#priority-mapping). Defaults to `medium`. |
| `deps`         | No       | `dependencies`          | Array of task IDs this depends on.                                                                |
| `criteria`     | No       | `acceptanceCriteria`    | Array of success criteria strings.                                                                |
| `context`      | No       | `suggestedFileScope`    | Array of file paths or globs relevant to the task.                                                |
| `goal`         | No       | `metadata.goal`         | Goal statement. Stored in metadata.                                                               |
| `epic`         | No       | `metadata.epic`         | Parent epic ID. Stored in metadata.                                                               |
| `blocks`       | No       | `metadata.blocks`       | Array of task IDs blocked by this task. Stored in metadata.                                       |
| `in_scope`     | No       | `metadata.inScope`      | Array of in-scope items. Stored in metadata.                                                      |
| `out_scope`    | No       | `metadata.outScope`     | Array of out-of-scope items. Stored in metadata.                                                  |
| `validation`   | No       | `metadata.validation`   | Validation instructions. Stored in metadata.                                                      |
| `risks`        | No       | `metadata.risks`        | Risk assessment. Stored in metadata.                                                              |
| `owner`        | No       | `metadata.owner`        | Role or person responsible. Stored in metadata.                                                   |
| `ai_exec`      | No       | `metadata.aiExecutable` | Whether AI can execute (`Yes`/`No`). Stored in metadata.                                          |
| `human_review` | No       | `metadata.humanReview`  | Whether human review is needed (`Yes`/`No`). Stored in metadata.                                  |
| `status`       | No       | `metadata.status`       | Current status. Stored in metadata.                                                               |

#### Format Detection

The parser identifies backlog.json format when the root object contains both an `epics` array and a `tasks` array. Tasks are read from the top-level `tasks` array (the `tasks` arrays inside each epic contain only task ID references, not full task objects).

### Format 2: Flat tasks.json (Simple Array)

A plain JSON array of task objects using the canonical `ImportedTask` field names directly. This is the simplest format for programmatic generation.

```json
[
  {
    "title": "Add user authentication",
    "taskType": "feature",
    "priority": "high",
    "description": "Implement JWT-based authentication with login and logout.",
    "acceptanceCriteria": [
      "Login endpoint returns a JWT token",
      "Logout endpoint invalidates the token",
      "Protected routes reject unauthenticated requests"
    ],
    "dependencies": ["T001"],
    "externalRef": "AUTH-001"
  },
  {
    "title": "Fix pagination offset bug",
    "taskType": "bug_fix",
    "priority": "critical",
    "description": "The task list API returns duplicate items when paginating.",
    "externalRef": "BUG-042"
  }
]
```

#### Flat JSON Task Fields

Flat format tasks use the canonical `ImportedTask` schema field names directly — no mapping is needed. Only `title` and `taskType` are required.

| Field                | Required | Type       | Description                                                                          |
| -------------------- | -------- | ---------- | ------------------------------------------------------------------------------------ |
| `title`              | **Yes**  | `string`   | Task title (1–500 characters).                                                       |
| `taskType`           | **Yes**  | `string`   | One of: `feature`, `bug_fix`, `refactor`, `chore`, `documentation`, `test`, `spike`. |
| `description`        | No       | `string`   | Longer task description.                                                             |
| `priority`           | No       | `string`   | One of: `critical`, `high`, `medium`, `low`. Defaults to `medium`.                   |
| `riskLevel`          | No       | `string`   | One of: `high`, `medium`, `low`.                                                     |
| `estimatedSize`      | No       | `string`   | One of: `xs`, `s`, `m`, `l`, `xl`.                                                   |
| `acceptanceCriteria` | No       | `string[]` | List of success criteria.                                                            |
| `definitionOfDone`   | No       | `string`   | Summary of what "done" means.                                                        |
| `dependencies`       | No       | `string[]` | External references to tasks this depends on.                                        |
| `suggestedFileScope` | No       | `string[]` | Glob patterns for relevant files.                                                    |
| `externalRef`        | No       | `string`   | Unique external identifier for deduplication.                                        |
| `metadata`           | No       | `object`   | Arbitrary extra fields from the source.                                              |

#### Format Detection

The parser identifies flat format when the root value is a JSON array.

---

## Field Mapping Table

This table shows how fields map across all three representations:

| Markdown (Metadata Table)                | backlog.json          | Flat JSON / ImportedTask | System Field (CreateTaskDto) |
| ---------------------------------------- | --------------------- | ------------------------ | ---------------------------- |
| First `# Heading`                        | `title`               | `title`                  | `title`                      |
| `Type`                                   | `type`                | `taskType`               | `taskType`                   |
| `## Description` + `## Goal`             | `desc`                | `description`            | `description`                |
| `Priority`                               | `priority`            | `priority`               | `priority`                   |
| —                                        | —                     | `riskLevel`              | `riskLevel`                  |
| —                                        | —                     | `estimatedSize`          | `estimatedSize`              |
| `## Acceptance Criteria` (`- [ ]` items) | `criteria`            | `acceptanceCriteria`     | `acceptanceCriteria`         |
| `## Definition of Done`                  | —                     | `definitionOfDone`       | `definitionOfDone`           |
| `Dependencies` (links or IDs)            | `deps`                | `dependencies`           | _(resolved to foreign keys)_ |
| `## Context Files` (backtick paths)      | `context`             | `suggestedFileScope`     | `suggestedFileScope`         |
| `ID` or filename `T###-*.md`             | `id`                  | `externalRef`            | `externalRef`                |
| _(filename)_                             | _(filename)_          | `source`                 | _(internal)_                 |
| `Epic`, `Status`, `Owner`, etc.          | `epic`, `owner`, etc. | `metadata`               | _(not persisted directly)_   |

### Type Mapping

The parser normalizes external type names to the canonical system types:

| Input Value (case-insensitive)                            | System Type     |
| --------------------------------------------------------- | --------------- |
| `feature`                                                 | `feature`       |
| `bug_fix`, `bugfix`, `bug fix`, `bug`                     | `bug_fix`       |
| `refactor`, `refactoring`                                 | `refactor`      |
| `chore`                                                   | `chore`         |
| `documentation`, `docs`                                   | `documentation` |
| `test`, `testing`                                         | `test`          |
| `spike`, `research`                                       | `spike`         |
| `foundation`, `infrastructure`, `config`, `observability` | `chore`         |
| `integration`                                             | `feature`       |
| `validation`                                              | `test`          |

If the input value is not in this table, the parser emits a warning and the task is skipped.

### Priority Mapping

The parser normalizes priority shortcodes and full names:

| Input Value (case-insensitive) | System Priority |
| ------------------------------ | --------------- |
| `P0`, `critical`               | `critical`      |
| `P1`, `high`                   | `high`          |
| `P2`, `medium`                 | `medium`        |
| `P3`, `low`                    | `low`           |

If the priority cannot be mapped, a warning is emitted and the default (`medium`) is used.

---

## Complete Examples

### Markdown Task File

Save this as `docs/backlog/tasks/T042-implement-supervisor.md`:

````markdown
# T042: Implement worker supervisor

| Field                     | Value                                                        |
| ------------------------- | ------------------------------------------------------------ |
| **ID**                    | T042                                                         |
| **Epic**                  | [E005: Worker Lifecycle](../epics/E005-lifecycle.md)         |
| **Type**                  | feature                                                      |
| **Status**                | pending                                                      |
| **Priority**              | P1                                                           |
| **Owner**                 | backend-engineer                                             |
| **AI Executable**         | Yes                                                          |
| **Human Review Required** | Yes                                                          |
| **Dependencies**          | [T030](./T030-lease-service.md), [T031](./T031-heartbeat.md) |
| **Blocks**                | [T050](./T050-integration-test.md)                           |

---

## Description

Implement the worker supervisor service that manages the lifecycle of ephemeral
worker processes. The supervisor is responsible for spawning workers when tasks
are assigned, monitoring their health via heartbeats, and terminating workers
that exceed their lease duration or fail health checks.

## Goal

Provide a reliable process management layer between the scheduler and the
individual worker agents.

## Scope

### In Scope

- Worker process spawning with isolated workspaces
- Heartbeat monitoring with configurable interval
- Graceful shutdown on lease expiration
- Process cleanup on unexpected termination

### Out of Scope

- Worker pool sizing strategy (T055)
- Multi-host worker distribution (future)

## Context Files

The implementing agent should read these files before starting:

- `packages/domain/src/worker/supervisor.ts`
- `packages/application/src/services/worker-service.ts`
- `docs/prd/007-technical-architecture.md`

## Acceptance Criteria

- [ ] Supervisor spawns a worker process for each assigned task
- [ ] Heartbeat interval is configurable (default: 30 seconds)
- [ ] Workers exceeding lease duration are terminated with SIGTERM
- [ ] Unexpected worker exits trigger task state transition to `failed`
- [ ] Unit tests cover spawn, heartbeat, timeout, and crash scenarios

## Definition of Done

All acceptance criteria met, tests pass, code reviewed, no regressions.

## Validation

### Suggested Validation Commands

```bash
pnpm test --project @factory/infrastructure
```
````

## Risks / Notes

Process management is platform-dependent. Ensure signals work correctly on
both Linux and macOS. Windows support is out of scope for V1.

## Follow-on Tasks

T050 (integration test), T055 (pool sizing)

````

### backlog.json Entry

```json
{
  "id": "T042",
  "title": "Implement worker supervisor",
  "epic": "E005",
  "type": "feature",
  "priority": "P1",
  "owner": "backend-engineer",
  "ai_exec": "Yes",
  "human_review": "Yes",
  "deps": ["T030", "T031"],
  "blocks": ["T050"],
  "desc": "Implement the worker supervisor service that manages the lifecycle of ephemeral worker processes. The supervisor is responsible for spawning workers when tasks are assigned, monitoring their health via heartbeats, and terminating workers that exceed their lease duration or fail health checks.",
  "goal": "Provide a reliable process management layer between the scheduler and the individual worker agents.",
  "in_scope": [
    "Worker process spawning with isolated workspaces",
    "Heartbeat monitoring with configurable interval",
    "Graceful shutdown on lease expiration",
    "Process cleanup on unexpected termination"
  ],
  "out_scope": [
    "Worker pool sizing strategy (T055)",
    "Multi-host worker distribution (future)"
  ],
  "context": [
    "packages/domain/src/worker/supervisor.ts",
    "packages/application/src/services/worker-service.ts",
    "docs/prd/007-technical-architecture.md"
  ],
  "criteria": [
    "Supervisor spawns a worker process for each assigned task",
    "Heartbeat interval is configurable (default: 30 seconds)",
    "Workers exceeding lease duration are terminated with SIGTERM",
    "Unexpected worker exits trigger task state transition to failed",
    "Unit tests cover spawn, heartbeat, timeout, and crash scenarios"
  ],
  "validation": "pnpm test --project @factory/infrastructure",
  "risks": "Process management is platform-dependent. Ensure signals work correctly on both Linux and macOS."
}
````

### Flat tasks.json Entry

```json
[
  {
    "title": "Implement worker supervisor",
    "taskType": "feature",
    "priority": "high",
    "description": "Implement the worker supervisor service that manages the lifecycle of ephemeral worker processes.",
    "acceptanceCriteria": [
      "Supervisor spawns a worker process for each assigned task",
      "Heartbeat interval is configurable (default: 30 seconds)",
      "Workers exceeding lease duration are terminated with SIGTERM",
      "Unexpected worker exits trigger task state transition to failed"
    ],
    "dependencies": ["T030", "T031"],
    "suggestedFileScope": [
      "packages/domain/src/worker/supervisor.ts",
      "packages/application/src/services/worker-service.ts"
    ],
    "externalRef": "T042",
    "riskLevel": "medium",
    "estimatedSize": "l"
  }
]
```

---

## AI Prompt Template

Use this prompt with any AI assistant (GitHub Copilot, ChatGPT, Claude, etc.) to convert your existing tasks into the factory markdown format. Copy the entire block, replace the placeholder at the end with your tasks, and submit.

```
Convert the following tasks into factory-compatible markdown files. Produce one
markdown file per task.

Each file must follow this exact structure:

1. A level-1 heading with the task title:
   # <ID>: <Title>

2. A metadata table with these fields (include all that apply):
   | Field                     | Value     |
   | ------------------------- | --------- |
   | **ID**                    | <unique ID, e.g., T001> |
   | **Epic**                  | <epic name or "None"> |
   | **Type**                  | <one of: feature, bug_fix, refactor, chore, documentation, test, spike> |
   | **Status**                | pending |
   | **Priority**              | <one of: P0, P1, P2, P3> |
   | **Owner**                 | <role or person> |
   | **AI Executable**         | <Yes or No> |
   | **Human Review Required** | <Yes or No> |
   | **Dependencies**          | <comma-separated task IDs, or "None"> |
   | **Blocks**                | <comma-separated task IDs, or "None"> |

3. A horizontal rule: ---

4. These sections (include all that have content):
   ## Description
   <paragraph describing what needs to be done>

   ## Goal
   <one-sentence goal>

   ## Scope
   ### In Scope
   - <bullet list>

   ### Out of Scope
   - <bullet list>

   ## Context Files
   - `<file path relevant to this task>`

   ## Acceptance Criteria
   - [ ] <criterion 1>
   - [ ] <criterion 2>

   ## Definition of Done
   <summary>

   ## Risks / Notes
   <any risks or notes>

IMPORTANT RULES:
- The Type field MUST be one of: feature, bug_fix, refactor, chore, documentation, test, spike
- The Priority field MUST be one of: P0 (critical), P1 (high), P2 (medium), P3 (low)
- Acceptance criteria MUST use checkbox syntax: - [ ] criterion
- Dependencies should reference task IDs (e.g., T001, T002)
- Each file should be named: <ID>-<kebab-case-title>.md (e.g., T001-init-monorepo.md)

Here are my tasks to convert:

<PASTE YOUR TASKS HERE>
```

---

## Troubleshooting

### Common Parse Warnings and How to Fix Them

#### 1. Missing required field "title"

```
⚠ error — Task unknown: missing required field "title"
```

**Cause:** The markdown file has no `# Heading` at the top, or the JSON entry has no `title` field.

**Fix:** Add a level-1 heading to your markdown file (`# T001: My task title`) or add a `"title"` field to your JSON entry.

#### 2. Could not map type to a known task type

```
⚠ error — Task T042: could not map type "story" to a known task type
```

**Cause:** The `Type` field contains a value not in the [type mapping table](#type-mapping).

**Fix:** Change the Type to one of the recognized values: `feature`, `bug_fix`, `refactor`, `chore`, `documentation`, `test`, `spike`, `foundation`, `infrastructure`, `config`, `observability`, `integration`, `validation`, `research`, `docs`, `testing`, `bugfix`, `bug`, `bug fix`, or `refactoring`.

#### 3. Could not map priority, using default

```
⚠ warning — Task T042: could not map priority "urgent", using default
```

**Cause:** The `Priority` field contains a value not in the [priority mapping table](#priority-mapping).

**Fix:** Change the Priority to one of: `P0`, `P1`, `P2`, `P3`, `critical`, `high`, `medium`, or `low`. If omitted, the default is `medium`.

#### 4. Circular dependencies detected

```
⚠ warning — Circular dependency: T001 → T002 → T003 → T001
```

**Cause:** Tasks reference each other in a dependency cycle, making it impossible to determine execution order.

**Fix:** Break the cycle by removing one of the dependency edges. Decide which task can start independently and remove its dependency on the others.

#### 5. Duplicate external reference

```
⚠ warning — Task "T042" has the same externalRef as an existing task; skipping
```

**Cause:** A task with the same `externalRef` (e.g., `T042`) already exists in the system. The import pipeline uses `externalRef` for deduplication.

**Fix:** This is expected on re-import. The duplicate is skipped automatically. If you want to update the existing task, delete it first or use a different `externalRef`.

#### 6. Unknown fields in flat JSON

```
⚠ info — Task "AUTH-001": unknown field "assignee" moved to metadata
```

**Cause:** The flat JSON entry contains fields not in the `ImportedTask` schema.

**Fix:** No action needed — unknown fields are preserved in the `metadata` object and shown in the import preview. To suppress the warning, remove the field or move it inside a `"metadata"` object explicitly.

#### 7. Empty acceptance criteria item

```
⚠ warning — Task T042: empty acceptance criteria item at index 2
```

**Cause:** A checkbox item in the Acceptance Criteria section is empty (`- [ ]` with no text after it).

**Fix:** Either add text after the checkbox or remove the empty line.
