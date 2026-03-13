# T116: Create POST /import/execute endpoint

| Field                     | Value                                                      |
| ------------------------- | ---------------------------------------------------------- |
| **ID**                    | T116                                                       |
| **Epic**                  | [E023: Task Import Pipeline](../epics/E023-task-import.md) |
| **Type**                  | feature                                                    |
| **Status**                | done                                                       |
| **Priority**              | P0                                                         |
| **Owner**                 | backend-engineer                                           |
| **AI Executable**         | Yes                                                        |
| **Human Review Required** | Yes                                                        |
| **Dependencies**          | [T115](./T115-import-discovery-endpoint.md)                |
| **Blocks**                | [T117](./T117-import-api-hooks.md)                         |

---

## Description

Create the execution endpoint that takes the previewed import data and writes it to the database. Auto-creates a project and repository if none exist, maps `ImportedTask[]` to `CreateTaskDto[]`, creates all tasks in a single transaction, and establishes `TaskDependency` records for declared dependencies.

## Goal

Complete the import pipeline by persisting discovered tasks to the database with proper project/repository scaffolding and dependency wiring.

## Scope

### In Scope

- `POST /import/execute` accepting `{ path: string, tasks: ImportedTask[], projectName: string, repositoryName?: string, repositoryUrl?: string }`
- Auto-create project if no project exists with the given name (use path basename as default)
- Auto-create repository within the project (use path basename, local-path as remoteUrl, worktree strategy)
- Map each `ImportedTask` to a `CreateTaskDto` with the new repositoryId
- Set `externalRef` on each task for dedup — skip tasks where externalRef already exists in the repository
- Create `TaskDependency` records: resolve dependency externalRefs to task IDs post-insert
- Single transaction for all writes (atomic — all or nothing)
- Return `{ projectId, repositoryId, created: number, skipped: number, errors: string[] }`

### Out of Scope

- Discovery/parsing (T115)
- Web UI (T117, T118)
- Incremental sync or update of existing tasks

## Context Files

The implementing agent should read these files before starting:

- `apps/control-plane/src/tasks/tasks.service.ts` (batch creation pattern)
- `apps/control-plane/src/projects/projects.service.ts` (project creation)
- `apps/control-plane/src/projects/repositories.service.ts` (repository creation)
- `packages/schemas/src/import/task-import.ts` (ImportedTask schema)

## Implementation Guidance

1. Add `execute` method to `ImportService`
2. Create `apps/control-plane/src/import/dtos/execute-request.dto.ts` with Zod schema
3. In a writeTransaction:
   a. Find or create project by name
   b. Find or create repository by name within the project
   c. Query existing tasks by externalRef in the repository → build a skip set
   d. For each non-skipped ImportedTask, map to CreateTaskDto fields and insert
   e. After all tasks inserted, resolve dependency externalRefs: for each task's `dependencies` array, look up the target task's ID by externalRef, create TaskDependency record
4. Return summary with created/skipped counts and any errors
5. Add `@Inject()` to any new constructor parameters
6. Write tests covering: first import (creates project+repo), re-import (skips duplicates), dependency resolution

## Acceptance Criteria

- [ ] First import creates project, repository, and all tasks
- [ ] Re-import with same externalRefs skips already-imported tasks
- [ ] Dependencies between tasks are created as TaskDependency records
- [ ] All writes happen in a single transaction (rollback on failure)
- [ ] Returns accurate created/skipped/error counts
- [ ] Tasks are created in BACKLOG status

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Import this repo's backlog, verify task count, then re-import and verify zero new tasks created.

### Suggested Validation Commands

```bash
pnpm test --filter @factory/control-plane -- --grep import
```

## Risks / Notes

- Dependency resolution is best-effort: if a dependency's externalRef doesn't match any imported task, emit a warning but don't fail the import.
- The single-transaction approach may be slow for very large imports (1000+ tasks) but is safe for V1.

## Follow-on Tasks

T117
