# T094: Build task board with status filtering and pagination

| Field                     | Value                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| **ID**                    | T094                                                               |
| **Epic**                  | [E020: Web UI Feature Views](../epics/E020-web-ui-features.md)     |
| **Type**                  | feature                                                            |
| **Status**                | done                                                               |
| **Priority**              | P1                                                                 |
| **Owner**                 | frontend-engineer                                                  |
| **AI Executable**         | Yes                                                                |
| **Human Review Required** | Yes                                                                |
| **Dependencies**          | [T090](./T090-api-client-tanstack.md), [T092](./T092-app-shell.md) |
| **Blocks**                | [T104](./T104-ui-operator-task.md)                                 |

---

## Description

Build the task board view with table display, status filtering, priority sorting, and pagination.

## Goal

Enable operators to browse and manage all tasks.

## Scope

### In Scope

- Task table with columns: ID, title, status, priority, repository, updated_at
- Status filter (multi-select)
- Priority filter
- Repository filter
- Sorting by priority, updated_at
- Pagination controls
- Click-through to task detail
- Status badges with color coding

### Out of Scope

- Task creation form (can use API directly)
- Kanban view (future)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/001-architecture.md`

## Implementation Guidance

1. Create apps/web-ui/src/features/tasks/TaskBoardPage.tsx
2. Use shadcn/ui Table, Badge, Select components
3. Filter state in URL params for shareable links
4. Status badges: color-coded by state category (active=blue, review=purple, done=green, failed=red)
5. Pagination: page-based with configurable page size

## Acceptance Criteria

- [ ] Task table displays correctly
- [ ] Filtering works for all supported fields
- [ ] Sorting works
- [ ] Pagination works
- [ ] Status badges are visually clear

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

View task board with various filter combinations

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm dev
```

## Risks / Notes

Large task lists need pagination. Ensure backend supports it.

## Follow-on Tasks

T104
