# T113: Build deterministic markdown task parser

| Field                     | Value                                                                             |
| ------------------------- | --------------------------------------------------------------------------------- |
| **ID**                    | T113                                                                              |
| **Epic**                  | [E023: Task Import Pipeline](../epics/E023-task-import.md)                        |
| **Type**                  | feature                                                                           |
| **Status**                | done                                                                              |
| **Priority**              | P0                                                                                |
| **Owner**                 | backend-engineer                                                                  |
| **AI Executable**         | Yes                                                                               |
| **Human Review Required** | Yes                                                                               |
| **Dependencies**          | [T112](./T112-define-import-schema.md)                                            |
| **Blocks**                | [T115](./T115-import-discovery-endpoint.md), [T123](./T123-import-format-docs.md) |

---

## Description

Build a deterministic parser that reads a directory of markdown task files and produces an `ImportManifest`. The parser handles the metadata table format used in this repository's backlog (`| Field | Value |` tables), headings for scope/criteria sections, and checkbox lists for acceptance criteria. It also reads `index.md` for ordering hints and discovers task files via glob patterns.

## Goal

Enable reliable, fast parsing of well-structured markdown backlogs without requiring AI, supporting the primary import path for the factory.

## Scope

### In Scope

- Glob discovery: find `tasks/**/*.md` (or user-specified pattern) relative to a base path
- Parse `index.md` if present: extract task ordering, epic groupings, and metadata
- Parse individual `.md` files: extract metadata table fields, description, goal, scope, acceptance criteria, dependencies, blocks
- Map parsed fields to `ImportedTask` schema (from T112)
- Generate `ParseWarning` entries for missing fields, unrecognized fields, or parse failures
- Handle gracefully: files without metadata tables, empty files, non-task markdown
- Extract `externalRef` from filename (e.g., `T045` from `T045-copilot-cli-adapter.md`)
- Unit tests with fixture markdown files covering all edge cases

### Out of Scope

- JSON parsing (T114)
- AI-powered parsing of unstructured formats
- API endpoints (T115)

## Context Files

The implementing agent should read these files before starting:

- `packages/schemas/src/import/task-import.ts` (after T112)
- `docs/backlog/tasks/T001-init-monorepo.md` (example input)
- `docs/backlog/tasks/T025-job-queue-core.md` (example input)
- `docs/backlog/index.md` (index format)

## Implementation Guidance

1. Create `packages/infrastructure/src/import/markdown-task-parser.ts`
2. Implement `discoverMarkdownTasks(basePath: string, pattern?: string): ImportManifest`
3. Use `node:fs` and a glob library (or `node:fs` recursive readdir with filter) to find `.md` files
4. For each file, parse the metadata table: split lines by `|`, trim, map field names to ImportedTask fields
5. Field mapping: `ID` → externalRef, `Type` → taskType, `Priority` → priority (strip "P" prefix and map: P0→critical, P1→high, P2→medium, P3→low), `Dependencies` → dependencies (extract task IDs from link syntax), `Blocks` → stored in metadata
6. Parse `## Acceptance Criteria` section: extract checkbox items as string array
7. Parse `## Description`, `## Goal` sections as plain text
8. Parse `## Scope` → `### In Scope` / `### Out of Scope` as arrays
9. If `index.md` exists, parse it for task ordering (use it to sort the result)
10. Collect warnings for each file: missing required fields, unparseable sections
11. Create `packages/infrastructure/src/import/index.ts` exporting the parser
12. Write comprehensive tests with fixture `.md` files in the test directory

## Acceptance Criteria

- [ ] Parses this repo's `docs/backlog/tasks/*.md` files successfully (111 tasks)
- [ ] Extracts title, description, taskType, priority, dependencies from metadata tables
- [ ] Extracts acceptance criteria from checkbox lists
- [ ] Generates warnings for files with missing or malformed metadata
- [ ] Handles non-task markdown files gracefully (skip with warning)
- [ ] Returns a valid `ImportManifest` matching the schema from T112
- [ ] ExternalRef extracted from filenames (e.g., `T045`)

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Parse this repo's own backlog as a smoke test.

### Suggested Validation Commands

```bash
pnpm test --filter @factory/infrastructure -- --grep markdown-task-parser
```

## Risks / Notes

- Markdown parsing is inherently fragile. The parser should be lenient, producing warnings rather than errors for unexpected structures.
- The metadata table format is specific to this project but common enough (GitHub-flavored markdown tables) to be reusable.

## Follow-on Tasks

T115, T123
