# T150: Add multi-project filter to dashboard

| Field                     | Value                                                                    |
| ------------------------- | ------------------------------------------------------------------------ |
| **ID**                    | T150                                                                     |
| **Epic**                  | [E027: Factory Lifecycle & Recovery](../epics/E027-factory-lifecycle.md) |
| **Type**                  | feature                                                                  |
| **Status**                | done                                                                     |
| **Priority**              | P1                                                                       |
| **Owner**                 | frontend-engineer                                                        |
| **AI Executable**         | Yes                                                                      |
| **Human Review Required** | Yes                                                                      |
| **Dependencies**          | None                                                                     |
| **Blocks**                | None                                                                     |

---

## Description

Add a project selector/filter to the web UI dashboard so operators can view all registered projects or drill into a single project. Task counts, pool status, and the activity feed should respect the selected project filter. Add project name badges to task list items.

## Goal

Support the multi-project operator experience: one dashboard for all projects, with the ability to focus on one.

## Scope

### In Scope

- Project selector dropdown in the dashboard header (default: "All Projects")
- Fetch project list via existing `useProjects()` hook
- When a project is selected, pass `repositoryId` filter to task queries
- Task count cards on dashboard respect the project filter
- Activity feed respects the project filter (filter audit events by entity)
- Task list page: add project/repository name badge to each task row
- URL state: sync selected project to URL query param for bookmarkability

### Out of Scope

- Per-project pages or routing
- Project CRUD from the dashboard (covered by E025)
- RBAC or access control

## Context Files

The implementing agent should read these files before starting:

- `apps/web-ui/src/features/dashboard/page.tsx` — dashboard layout
- `apps/web-ui/src/features/dashboard/hooks/use-dashboard-data.ts` — data fetching
- `apps/web-ui/src/features/tasks/page.tsx` — task list
- `apps/web-ui/src/api/hooks/use-projects.ts` — `useProjects()` hook
- `apps/web-ui/src/api/hooks/use-tasks.ts` — task query params

## Implementation Guidance

1. Add a project selector component (shadcn Select) to the dashboard header
2. Store selected projectId in URL search params via React Router
3. When project selected, look up its repositories, pass repositoryId to task queries
4. Modify `useDashboardData` to accept an optional repositoryId filter
5. Add `repositoryId` param to task count queries
6. In the task list, add a Badge showing the repository/project name
7. Use `afterEach(cleanup)` in tests

## Acceptance Criteria

- [ ] Dashboard shows a project selector dropdown
- [ ] "All Projects" shows aggregate data (default)
- [ ] Selecting a project filters task counts and activity
- [ ] Task list shows project name badges
- [ ] Filter state is in the URL (bookmarkable)

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm test -- --grep project-selector
```

## Risks / Notes

The task API may need a `repositoryId` filter param if it doesn't already support one. Check the controller's query DTO.

## Follow-on Tasks

None
