# T112: Define task import Zod schemas

| Field                     | Value                                                                        |
| ------------------------- | ---------------------------------------------------------------------------- |
| **ID**                    | T112                                                                         |
| **Epic**                  | [E023: Task Import Pipeline](../epics/E023-task-import.md)                   |
| **Type**                  | foundation                                                                   |
| **Status**                | pending                                                                      |
| **Priority**              | P0                                                                           |
| **Owner**                 | backend-engineer                                                             |
| **AI Executable**         | Yes                                                                          |
| **Human Review Required** | Yes                                                                          |
| **Dependencies**          | None                                                                         |
| **Blocks**                | [T113](./T113-build-markdown-parser.md), [T114](./T114-build-json-parser.md) |

---

## Description

Define the canonical Zod schemas for task import: `ImportedTask` (a single parsed task with all optional/required fields mapped from external formats) and `ImportManifest` (the full result of a discovery pass including tasks, warnings, and source metadata). These schemas are the contract between parsers, the API, and the UI preview.

## Goal

Establish a single validated shape that all import parsers produce and all consumers (API, UI) expect, ensuring consistency and type safety throughout the import pipeline.

## Scope

### In Scope

- `ImportedTaskSchema`: title, description, taskType, priority, riskLevel, estimatedSize, acceptanceCriteria (array), definitionOfDone, dependencies (array of externalRef strings), suggestedFileScope (array), externalRef, source (filename), metadata (record for extra fields)
- `ImportManifestSchema`: sourcePath, formatVersion, tasks (array of ImportedTask), warnings (array of parse warning objects with file, field, message), discoveredProjectName, discoveredRepositoryName
- `ParseWarning` type: file, field (optional), message, severity (info | warning | error)
- Export from `packages/schemas/src/import/index.ts`
- Add to package exports in `packages/schemas/package.json`

### Out of Scope

- Parser implementation (T113, T114)
- API endpoints (T115, T116)

## Context Files

The implementing agent should read these files before starting:

- `packages/schemas/src/index.ts`
- `apps/control-plane/src/tasks/dtos/create-task.dto.ts`
- `docs/backlog/tasks/T001-init-monorepo.md` (example task format)

## Implementation Guidance

1. Create `packages/schemas/src/import/task-import.ts`
2. Define `ParseWarningSchema` with file, field (optional), message, severity enum
3. Define `ImportedTaskSchema` with all fields — title and taskType required, rest optional with sensible defaults
4. Map field names to match `CreateTaskDto` where possible (taskType, priority, riskLevel, estimatedSize)
5. Include `externalRef` for dedup on re-import and `source` for tracing back to the original file
6. Define `ImportManifestSchema` wrapping the tasks array with discovery metadata
7. Create `packages/schemas/src/import/index.ts` re-exporting all types and schemas
8. Update `packages/schemas/src/index.ts` to export the import module
9. Write unit tests validating schema acceptance/rejection of edge cases

## Acceptance Criteria

- [ ] `ImportedTaskSchema` validates a minimal task (title + taskType only)
- [ ] `ImportedTaskSchema` validates a fully populated task with all optional fields
- [ ] `ImportManifestSchema` validates a complete discovery result
- [ ] `ParseWarningSchema` validates warning objects with all severity levels
- [ ] Invalid inputs are rejected with clear Zod error messages
- [ ] Types are exported and importable from `@factory/schemas`

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run schema validation tests.

### Suggested Validation Commands

```bash
pnpm test --filter @factory/schemas -- --grep import
```

## Risks / Notes

The schema should be permissive enough to handle markdown files with missing fields (defaults applied) while strict enough to catch truly invalid data. Use `.optional().default()` liberally.

## Follow-on Tasks

T113, T114
