# T115: Create POST /import/discover endpoint

| Field                     | Value                                                                        |
| ------------------------- | ---------------------------------------------------------------------------- |
| **ID**                    | T115                                                                         |
| **Epic**                  | [E023: Task Import Pipeline](../epics/E023-task-import.md)                   |
| **Type**                  | feature                                                                      |
| **Status**                | pending                                                                      |
| **Priority**              | P0                                                                           |
| **Owner**                 | backend-engineer                                                             |
| **AI Executable**         | Yes                                                                          |
| **Human Review Required** | Yes                                                                          |
| **Dependencies**          | [T113](./T113-build-markdown-parser.md), [T114](./T114-build-json-parser.md) |
| **Blocks**                | [T116](./T116-import-execute-endpoint.md)                                    |

---

## Description

Create a new NestJS ImportModule with a discovery endpoint that accepts a local directory path, runs the deterministic parsers, and returns a preview of discovered tasks without writing anything to the database. This lets the UI show users what will be imported before they commit.

## Goal

Provide a safe, read-only preview step so users can review and selectively import tasks.

## Scope

### In Scope

- `POST /import/discover` accepting `{ path: string, pattern?: string }`
- ImportModule with ImportController and ImportService
- Service reads the filesystem at the given path
- Auto-detects format: checks for `backlog.json` first, then falls back to markdown glob
- Runs the appropriate parser (T113 or T114)
- Returns `{ tasks: ImportedTask[], warnings: ParseWarning[], suggestedProjectName: string, suggestedRepositoryName: string, format: string }`
- Suggested names derived from directory basename or parsed metadata
- Validation that the path exists and is readable
- Swagger/OpenAPI documentation

### Out of Scope

- Writing to the database (T116)
- Web UI (T117, T118)
- File upload (reads local filesystem only)

## Context Files

The implementing agent should read these files before starting:

- `apps/control-plane/src/app.module.ts`
- `apps/control-plane/src/projects/projects.controller.ts` (controller pattern)
- `packages/infrastructure/src/import/index.ts` (parsers from T113/T114)

## Implementation Guidance

1. Create `apps/control-plane/src/import/import.module.ts` with ImportController and ImportService as providers
2. Create `apps/control-plane/src/import/import.controller.ts` with `@Controller("import")` and `POST /import/discover`
3. Create `apps/control-plane/src/import/import.service.ts` with `discover(path: string, pattern?: string)` method
4. Create `apps/control-plane/src/import/dtos/discover-request.dto.ts` with Zod validation: path (required, non-empty string), pattern (optional string)
5. Service logic: validate path exists (`fs.existsSync`), check for `backlog.json` → use JSON parser, else use markdown parser
6. Derive `suggestedProjectName` from `path.basename(path)` or parsed metadata
7. Register ImportModule in AppModule imports
8. Add `@Inject()` to all constructor parameters (tsx compatibility)
9. Write controller + service tests

## Acceptance Criteria

- [ ] `POST /import/discover` with a valid path returns parsed tasks
- [ ] Auto-detects JSON vs markdown format
- [ ] Returns warnings for parse issues
- [ ] Returns suggested project/repository names
- [ ] Returns 400 for non-existent or unreadable paths
- [ ] Does not write to the database
- [ ] Endpoint appears in Swagger docs

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Point the endpoint at this repo's `docs/backlog/` directory and verify 111 tasks are discovered.

### Suggested Validation Commands

```bash
pnpm test --filter @factory/control-plane -- --grep import
```

## Risks / Notes

- Filesystem access from the API is acceptable because the factory is local-first. This would need to change for remote deployments.
- Large directories (thousands of files) could be slow to scan; consider adding a file count limit or timeout.

## Follow-on Tasks

T116
