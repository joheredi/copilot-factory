# T146: Serve web-ui static files from same server

| Field                     | Value                                                                    |
| ------------------------- | ------------------------------------------------------------------------ |
| **ID**                    | T146                                                                     |
| **Epic**                  | [E027: Factory Lifecycle & Recovery](../epics/E027-factory-lifecycle.md) |
| **Type**                  | feature                                                                  |
| **Status**                | pending                                                                  |
| **Priority**              | P0                                                                       |
| **Owner**                 | backend-engineer                                                         |
| **AI Executable**         | Yes                                                                      |
| **Human Review Required** | Yes                                                                      |
| **Dependencies**          | [T140](./T140-global-data-dir.md)                                        |
| **Blocks**                | [T145](./T145-start-command.md)                                          |

---

## Description

Configure the NestJS control-plane to optionally serve the pre-built web-ui React SPA as static files via `@fastify/static`. When enabled (`SERVE_STATIC=true`), Fastify serves `apps/web-ui/dist/` at the root path with an SPA fallback (non-API routes return `index.html`). API routes take precedence. This is the same task as T120 in E024 — consolidated here as the canonical task.

**Note:** This task replaces [T120](./T120-bundle-web-ui.md) which had the same scope. T120 should be marked as superseded.

## Goal

Enable single-origin deployment where API and UI are served from the same Fastify server, required for `npx @copilot/factory start`.

## Scope

### In Scope

- Install `@fastify/static` in `apps/control-plane`
- Create `StaticServeModule` in `apps/control-plane/src/static-serve/`
- Register the Fastify static file plugin conditionally (`SERVE_STATIC=true`)
- Serve files from a configurable path (`WEB_UI_DIST` env var)
- SPA fallback: non-API routes serve `index.html` for client-side routing
- API routes (`/tasks`, `/pools`, `/health`, etc.) take precedence over static files
- No-op when `SERVE_STATIC` is not set (default dev workflow unchanged)
- Integration test: verify static + API coexist

### Out of Scope

- Building the web-ui (handled by `pnpm build` in web-ui workspace)
- Vite proxy config (dev-only, unchanged)

## Context Files

The implementing agent should read these files before starting:

- `apps/control-plane/src/main.ts` — bootstrap function, Fastify adapter setup
- `apps/control-plane/src/app.module.ts` — module registration
- `apps/web-ui/vite.config.ts` — current proxy setup (for reference)

## Implementation Guidance

1. `cd apps/control-plane && pnpm add @fastify/static`
2. Create `apps/control-plane/src/static-serve/static-serve.module.ts`:
   ```typescript
   @Module({})
   export class StaticServeModule implements OnModuleInit {
     constructor(@Inject('FASTIFY_INSTANCE') private readonly fastify: any) {}

     async onModuleInit() {
       if (process.env.SERVE_STATIC !== 'true') return;
       const distPath = process.env.WEB_UI_DIST;
       if (!distPath || !existsSync(distPath)) return;

       await this.fastify.register(fastifyStatic, {
         root: path.resolve(distPath),
         prefix: '/',
         decorateReply: false,
       });

       // SPA fallback — must be registered after all API routes
       this.fastify.setNotFoundHandler((req, reply) => {
         if (req.url.startsWith('/api/') || req.url === '/health' || ...) {
           reply.code(404).send({ error: 'Not Found' });
         } else {
           reply.sendFile('index.html');
         }
       });
     }
   }
   ```
3. Alternative approach: configure in `main.ts` after `app.init()` but before `app.listen()`:
   ```typescript
   if (process.env.SERVE_STATIC === "true") {
     const fastify = app.getHttpAdapter().getInstance();
     await fastify.register(require("@fastify/static"), { root: distPath, prefix: "/" });
   }
   ```
4. Ensure API routes take precedence (Fastify matches routes in registration order — register static after API routes)
5. Add `@Inject()` to any constructor parameters (tsx compatibility)
6. Write tests: static serving enabled → serves index.html; disabled → no static; API routes still work

## Acceptance Criteria

- [ ] `SERVE_STATIC=true` + `WEB_UI_DIST=/path/to/dist` → serves web UI files
- [ ] `GET /` returns `index.html`
- [ ] `GET /dashboard` returns `index.html` (SPA fallback)
- [ ] `GET /tasks` returns JSON (API route, not index.html)
- [ ] `GET /health` returns JSON health check
- [ ] Without `SERVE_STATIC`, no static files served (default behavior)
- [ ] Missing or invalid `WEB_UI_DIST` logs warning but doesn't crash

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm build
cd apps/control-plane && SERVE_STATIC=true WEB_UI_DIST=../web-ui/dist pnpm dev
curl http://localhost:3000/          # Should return HTML
curl http://localhost:3000/health    # Should return JSON
```

## Risks / Notes

- Route precedence is critical. Fastify matches in registration order — register API controllers first, then static plugin.
- The SPA fallback must not intercept API 404s. Check if the URL matches a known API prefix before falling through to `index.html`.

## Follow-on Tasks

T145
