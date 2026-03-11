# T089: Initialize React SPA with Vite, Tailwind, shadcn/ui

| Field                     | Value                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| **ID**                    | T089                                                                                                   |
| **Epic**                  | [E019: Web UI Foundation](../epics/E019-web-ui-foundation.md)                                          |
| **Type**                  | foundation                                                                                             |
| **Status**                | pending                                                                                                |
| **Priority**              | P1                                                                                                     |
| **Owner**                 | frontend-engineer                                                                                      |
| **AI Executable**         | Yes                                                                                                    |
| **Human Review Required** | Yes                                                                                                    |
| **Dependencies**          | [T001](./T001-init-monorepo.md), [T081](./T081-api-project-repo.md)                                    |
| **Blocks**                | [T090](./T090-api-client-tanstack.md), [T091](./T091-websocket-client.md), [T092](./T092-app-shell.md) |

---

## Description

Bootstrap the React SPA in apps/web-ui with Vite, TypeScript, Tailwind CSS, and shadcn/ui component library.

## Goal

Establish the frontend application foundation.

## Scope

### In Scope

- Vite + React + TypeScript setup
- Tailwind CSS configuration
- shadcn/ui installation and theme
- Basic component primitives (Button, Card, Table, etc.)
- React Router for navigation
- Environment variable handling

### Out of Scope

- API integration (T090)
- WebSocket client (T091)
- Feature views (E020)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Use Vite's React-TS template for apps/web-ui
2. Install and configure Tailwind CSS v3+
3. Set up shadcn/ui with default theme
4. Add commonly used shadcn/ui components: Button, Card, Table, Dialog, Badge, Tabs, etc.
5. Configure React Router v6 with lazy loading
6. Add proxy config for API requests to backend (vite.config.ts)

## Acceptance Criteria

- [ ] App builds and runs via pnpm dev
- [ ] Tailwind classes apply correctly
- [ ] shadcn/ui components render correctly
- [ ] Router navigation works

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

pnpm dev in web-ui and verify app loads in browser

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm dev
```

## Risks / Notes

shadcn/ui requires specific Tailwind config. Follow their setup guide exactly.

## Follow-on Tasks

T090, T091, T092
