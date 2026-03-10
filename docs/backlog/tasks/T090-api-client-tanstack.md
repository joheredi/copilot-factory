# T090: Implement API client layer with TanStack Query

| Field | Value |
|---|---|
| **ID** | T090 |
| **Epic** | [E019: Web UI Foundation](../epics/E019-web-ui-foundation.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P1 |
| **Owner** | frontend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T089](./T089-react-spa-init.md) |
| **Blocks** | [T093](./T093-ui-dashboard.md), [T094](./T094-ui-task-board.md), [T095](./T095-ui-task-detail.md), [T096](./T096-ui-worker-pools.md), [T097](./T097-ui-review-center.md), [T098](./T098-ui-merge-queue.md), [T099](./T099-ui-config-editor.md), [T100](./T100-ui-audit-explorer.md) |

---

## Description

Create the API client layer using TanStack Query for data fetching, caching, and mutation with typed API functions.

## Goal

Provide a robust data fetching layer for all UI views.

## Scope

### In Scope

- TanStack Query provider setup
- Typed API client functions (fetch wrapper)
- Query hooks for all major entities (tasks, projects, pools, etc.)
- Mutation hooks for CRUD operations
- Error handling and retry logic
- Loading and error states

### Out of Scope

- WebSocket integration (T091)
- Specific view implementations

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Install @tanstack/react-query
2. Create apps/web-ui/src/api/client.ts with typed fetch wrapper
3. Base URL from environment variable (default http://localhost:3000/api)
4. Create hooks: useProjects, useTasks, useTask, usePools, useAuditTimeline, etc.
5. Mutation hooks: useCreateTask, useUpdateTask, etc.
6. Configure sensible defaults: staleTime, retry, refetchOnWindowFocus

## Acceptance Criteria

- [ ] TanStack Query provider wraps the app
- [ ] All major entity queries have hooks
- [ ] Type safety for API responses
- [ ] Loading/error states handled

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Verify queries fetch data from running backend

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm dev
```

## Risks / Notes

API types must match backend DTOs. Consider generating types from OpenAPI.

## Follow-on Tasks

T093, T094, T095, T096, T097, T098, T099, T100
