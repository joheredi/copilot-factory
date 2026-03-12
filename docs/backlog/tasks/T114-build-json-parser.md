# T114: Build JSON/backlog.json task parser

| Field                     | Value                                                                             |
| ------------------------- | --------------------------------------------------------------------------------- |
| **ID**                    | T114                                                                              |
| **Epic**                  | [E023: Task Import Pipeline](../epics/E023-task-import.md)                        |
| **Type**                  | feature                                                                           |
| **Status**                | pending                                                                           |
| **Priority**              | P1                                                                                |
| **Owner**                 | backend-engineer                                                                  |
| **AI Executable**         | Yes                                                                               |
| **Human Review Required** | Yes                                                                               |
| **Dependencies**          | [T112](./T112-define-import-schema.md)                                            |
| **Blocks**                | [T115](./T115-import-discovery-endpoint.md), [T123](./T123-import-format-docs.md) |

---

## Description

Build a deterministic parser that reads JSON-formatted task files and produces an `ImportManifest`. Supports two formats: the structured `backlog.json` format (with epics and tasks arrays) used in this repository, and a simpler flat `tasks.json` array format for external tools.

## Goal

Provide a fast, reliable import path for machine-generated task lists without requiring markdown authoring.

## Scope

### In Scope

- Parse `backlog.json` format: extract tasks from `tasks` array, map fields (id→externalRef, desc→description, type→taskType, deps→dependencies, criteria→acceptanceCriteria)
- Parse flat `tasks.json` format: array of task objects matching ImportedTask shape
- Auto-detect format by checking for `epics` key (backlog.json) vs plain array
- Validate each task against `ImportedTaskSchema`, collect warnings for invalid entries
- Handle `backlog.json` epic metadata: extract project name from epic summaries if available
- Unit tests with fixture JSON files

### Out of Scope

- Markdown parsing (T113)
- API endpoints (T115)

## Context Files

The implementing agent should read these files before starting:

- `packages/schemas/src/import/task-import.ts` (after T112)
- `docs/backlog/backlog.json` (example input — first 100 lines for structure)

## Implementation Guidance

1. Create `packages/infrastructure/src/import/json-task-parser.ts`
2. Implement `parseJsonTasks(filePath: string): ImportManifest`
3. Read and parse the JSON file
4. Detect format: if root has `epics` and `tasks` keys → backlog.json format; if root is array → flat format
5. For backlog.json: map `id`→externalRef, `desc`→description, `type`→taskType, `deps`→dependencies, `blocks`→metadata.blocks, `criteria`→acceptanceCriteria, `priority` (map P0→critical etc.)
6. For flat format: validate each object against ImportedTaskSchema directly
7. Collect parse warnings for missing fields or validation failures
8. Export from `packages/infrastructure/src/import/index.ts`
9. Write tests with both fixture formats

## Acceptance Criteria

- [ ] Parses this repo's `docs/backlog/backlog.json` successfully
- [ ] Parses a flat `tasks.json` array format
- [ ] Auto-detects format without user input
- [ ] Maps all backlog.json fields to ImportedTask schema
- [ ] Generates warnings for malformed or invalid entries
- [ ] Returns a valid `ImportManifest`

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Parse this repo's backlog.json as a smoke test.

### Suggested Validation Commands

```bash
pnpm test --filter @factory/infrastructure -- --grep json-task-parser
```

## Risks / Notes

The backlog.json in this repo is 185KB. Parsing should be fast (< 100ms) since it's a single JSON.parse call followed by field mapping.

## Follow-on Tasks

T115, T123
