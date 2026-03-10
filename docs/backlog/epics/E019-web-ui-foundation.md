# E019: Web UI Foundation

## Summary

Bootstrap the React SPA with Vite, Tailwind, shadcn/ui, TanStack Query, WebSocket client, and app shell.

## Why This Epic Exists

The UI is the primary operator interface. The foundation must be solid before building feature views.

## Goals

- React + Vite + Tailwind + shadcn/ui setup
- API client with TanStack Query
- WebSocket client for live updates
- App shell with navigation

## Scope

### In Scope

- Frontend structure from docs/prd/007-technical-architecture.md §7.16
- API client layer
- Live update infrastructure
- Navigation layout

### Out of Scope

- Feature-specific views (E020)
- Operator action controls (E021)

## Dependencies

**Depends on:** E017, E018

**Enables:** E020, E021

## Risks / Notes

UI framework choices are hard to change later. Component library selection matters.

## Tasks

| ID | Title | Priority | Status |
|---|---|---|---|
| [T089](../tasks/T089-react-spa-init.md) | Initialize React SPA with Vite, Tailwind, shadcn/ui | P1 | pending |
| [T090](../tasks/T090-api-client-tanstack.md) | Implement API client layer with TanStack Query | P1 | pending |
| [T091](../tasks/T091-websocket-client.md) | Implement WebSocket client for live updates | P1 | pending |
| [T092](../tasks/T092-app-shell.md) | Build app shell with navigation layout | P1 | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

SPA loads with navigation shell. API calls work. WebSocket connects and receives events.
