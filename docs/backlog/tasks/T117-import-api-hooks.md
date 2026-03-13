# T117: Create TanStack Query import hooks

| Field                     | Value                                                      |
| ------------------------- | ---------------------------------------------------------- |
| **ID**                    | T117                                                       |
| **Epic**                  | [E023: Task Import Pipeline](../epics/E023-task-import.md) |
| **Type**                  | feature                                                    |
| **Status**                | done                                                       |
| **Priority**              | P1                                                         |
| **Owner**                 | frontend-engineer                                          |
| **AI Executable**         | Yes                                                        |
| **Human Review Required** | Yes                                                        |
| **Dependencies**          | [T116](./T116-import-execute-endpoint.md)                  |
| **Blocks**                | [T118](./T118-import-dialog-component.md)                  |

---

## Description

Create TanStack Query mutation hooks for the import API endpoints: `useDiscoverTasks` for previewing tasks from a path, and `useExecuteImport` for committing the import. Follow the existing hook patterns in `use-tasks.ts`.

## Goal

Provide typed, cache-aware React hooks that the import dialog component can use for the discovery and execution steps.

## Scope

### In Scope

- `useDiscoverTasks()` — mutation calling `POST /import/discover`
- `useExecuteImport()` — mutation calling `POST /import/execute` with cache invalidation
- TypeScript types for request/response shapes matching the API DTOs
- Query key registration in `query-keys.ts`
- Tests following existing hook test patterns

### Out of Scope

- UI components (T118)
- API implementation (T115, T116)

## Context Files

The implementing agent should read these files before starting:

- `apps/web-ui/src/api/hooks/use-tasks.ts` (existing hook patterns)
- `apps/web-ui/src/api/client.ts` (apiPost, apiGet)
- `apps/web-ui/src/api/query-keys.ts` (key registry)
- `apps/web-ui/src/api/types.ts` (shared types)

## Implementation Guidance

1. Add import types to `apps/web-ui/src/api/types.ts`: `DiscoverRequest`, `DiscoverResponse`, `ExecuteImportRequest`, `ExecuteImportResponse`, `ImportedTask`, `ParseWarning`
2. Add import query keys to `apps/web-ui/src/api/query-keys.ts`
3. Create `apps/web-ui/src/api/hooks/use-import.ts`
4. `useDiscoverTasks`: useMutation calling `apiPost<DiscoverResponse>("/import/discover", { path, pattern })`
5. `useExecuteImport`: useMutation calling `apiPost<ExecuteImportResponse>("/import/execute", data)` with `onSuccess` invalidating `queryKeys.tasks.all` and `queryKeys.projects.all`
6. Export from `apps/web-ui/src/api/index.ts`
7. Write tests with mocked fetch following `use-tasks.test.tsx` patterns

## Acceptance Criteria

- [ ] `useDiscoverTasks` mutation sends correct POST request and returns typed response
- [ ] `useExecuteImport` mutation sends correct POST request and invalidates task/project caches
- [ ] Both hooks expose `isPending`, `error`, `data` states
- [ ] Types match the API response shapes
- [ ] Tests cover success and error scenarios

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run web-ui tests.

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm test -- --grep use-import
```

## Risks / Notes

None significant. This follows well-established patterns in the codebase.

## Follow-on Tasks

T118
