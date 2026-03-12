# T120: Serve web-ui static files from control-plane

| Field                     | Value                                                                      |
| ------------------------- | -------------------------------------------------------------------------- |
| **ID**                    | T120                                                                       |
| **Epic**                  | [E024: CLI Package & Single-Command Startup](../epics/E024-cli-package.md) |
| **Type**                  | feature                                                                    |
| **Status**                | pending                                                                    |
| **Priority**              | P0                                                                         |
| **Owner**                 | backend-engineer                                                           |
| **AI Executable**         | Yes                                                                        |
| **Human Review Required** | Yes                                                                        |
| **Dependencies**          | [T119](./T119-scaffold-cli-workspace.md)                                   |
| **Blocks**                | [T121](./T121-cli-entry-point.md)                                          |

---

## Description

Configure the NestJS control-plane to optionally serve the pre-built web-ui React SPA as static files. When enabled (via environment variable or programmatic flag), Fastify serves the `apps/web-ui/dist/` directory at the root path, with a catch-all fallback to `index.html` for client-side routing. This eliminates the need for a separate Vite dev server in production/CLI mode.

## Goal

Enable single-origin deployment where the API and UI are served from the same Fastify server, required for the `npx @copilot/factory` experience.

## Scope

### In Scope

- Install `@fastify/static` in the control-plane
- Create a NestJS module (`StaticServeModule`) that registers the static file plugin conditionally
- Enable via `SERVE_STATIC=true` environment variable or a programmatic `serveStatic` option in the bootstrap function
- Serve files from a configurable path (default: resolved relative to the CLI package)
- SPA fallback: non-API routes that don't match a static file return `index.html`
- Ensure API routes (`/tasks`, `/pools`, `/health`, etc.) take precedence over static files
- No-op when disabled (default for `pnpm dev` workflow)

### Out of Scope

- Building the web-ui (handled by `pnpm build` in the web-ui workspace)
- Vite proxy configuration (only needed during development)
- CDN or external static hosting

## Context Files

The implementing agent should read these files before starting:

- `apps/control-plane/src/main.ts` (bootstrap function)
- `apps/control-plane/src/app.module.ts` (module registration)
- `apps/web-ui/vite.config.ts` (current proxy setup for reference)

## Implementation Guidance

1. `cd apps/control-plane && pnpm add @fastify/static`
2. Create `apps/control-plane/src/static-serve/static-serve.module.ts`
3. Use a NestJS `OnModuleInit` hook to register `@fastify/static` on the Fastify instance
4. Get the Fastify instance via `app.getHttpAdapter().getInstance()` in bootstrap or via `ModuleRef`
5. Configure: `root` = path to web-ui dist, `prefix: "/"`, `decorateReply: false`
6. Add SPA fallback: register a catch-all route (`/*`) with lowest priority that serves `index.html`
7. Ensure API routes registered by controllers take precedence (Fastify matches routes in registration order)
8. Guard with `process.env.SERVE_STATIC === "true"` or a passed config flag
9. Export a `configureStaticServing(app, distPath)` function the CLI can call
10. Add `@Inject()` to any constructor parameters (tsx compatibility)
11. Write integration test verifying static files are served when enabled and API routes still work

## Acceptance Criteria

- [ ] When `SERVE_STATIC=true`, the control-plane serves files from the web-ui dist directory
- [ ] `GET /` returns `index.html` (the SPA entry point)
- [ ] `GET /assets/index-xxx.js` returns the bundled JS
- [ ] `GET /tasks` (API route) still returns JSON, not index.html
- [ ] Client-side routes like `/dashboard` return `index.html` (SPA fallback)
- [ ] When `SERVE_STATIC` is not set, no static files are served (default dev behavior)
- [ ] Health check still works: `GET /health` returns JSON

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Build the web-ui, start control-plane with SERVE_STATIC=true, verify in browser.

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm build
```

```bash
cd apps/control-plane && SERVE_STATIC=true WEB_UI_DIST=../web-ui/dist pnpm dev
```

## Risks / Notes

- Route precedence is critical: API routes must match before the SPA fallback. Fastify handles this by registration order.
- The dist path must be resolved correctly whether running from source (tsx) or from compiled output (dist/).

## Follow-on Tasks

T121
