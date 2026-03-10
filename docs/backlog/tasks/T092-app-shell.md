# T092: Build app shell with navigation layout

| Field | Value |
|---|---|
| **ID** | T092 |
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

Build the application shell with sidebar navigation, breadcrumbs, and content area layout.

## Goal

Provide consistent navigation and layout for all feature views.

## Scope

### In Scope

- Sidebar with navigation links to all primary views
- Views: Dashboard, Tasks, Pools, Reviews, Merge Queue, Config, Audit
- Breadcrumb trail
- Content area with responsive layout
- WebSocket connection indicator

### Out of Scope

- Individual view implementations (E020)
- Authentication

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/001-architecture.md`

## Implementation Guidance

1. Create apps/web-ui/src/components/layout/ with AppShell, Sidebar, Breadcrumbs
2. Sidebar items: Dashboard, Task Board, Worker Pools, Review Center, Merge Queue, Configuration, Audit Explorer
3. Use React Router Outlet for content area
4. Responsive: sidebar collapses on small screens
5. Active route highlighted in sidebar

## Acceptance Criteria

- [ ] Navigation between all views works
- [ ] Active route highlighted
- [ ] Responsive layout functions on various screen sizes
- [ ] Breadcrumbs update on navigation

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Navigate to all routes and verify layout

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm dev
```

## Risks / Notes

Layout decisions affect all views. Get review before implementing features.

## Follow-on Tasks

T093, T094, T095, T096, T097, T098, T099, T100
