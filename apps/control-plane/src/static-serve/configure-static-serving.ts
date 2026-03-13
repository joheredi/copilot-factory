/**
 * Static file serving configuration for the control-plane Fastify server.
 *
 * Enables single-origin deployment where the API and web-ui SPA are served
 * from the same Fastify instance. This eliminates the need for a separate
 * Vite dev server and is required for the single-command CLI experience
 * (`npx @copilot/factory`).
 *
 * API routes registered by NestJS controllers always take precedence over
 * static file serving because Fastify matches specific routes before
 * wildcard routes in its routing tree.
 *
 * @see docs/backlog/tasks/T120-bundle-web-ui.md
 * @module @factory/control-plane
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Validates that the dist directory exists and contains an index.html file.
 *
 * @param distPath - Path to the web-ui dist directory
 * @returns The resolved absolute path to the dist directory
 * @throws Error if the directory or index.html does not exist
 */
function validateDistPath(distPath: string): string {
  const resolvedPath = resolve(distPath);

  if (!existsSync(resolvedPath)) {
    throw new Error(
      `Web UI dist directory not found: ${resolvedPath}. ` +
        `Run 'pnpm build' in apps/web-ui first.`,
    );
  }

  const indexPath = join(resolvedPath, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(
      `index.html not found in ${resolvedPath}. ` + `Run 'pnpm build' in apps/web-ui first.`,
    );
  }

  return resolvedPath;
}

/**
 * Registers the `@fastify/static` plugin and a SPA fallback wildcard route
 * on a Fastify instance.
 *
 * The static plugin is registered with `wildcard: false` so it does not
 * create its own catch-all route. Instead, a custom `GET /*` route handles
 * both static file serving and SPA fallback:
 *
 * 1. If the requested URL maps to an existing file on disk, the file is
 *    served via `reply.sendFile()` (efficient streaming with correct
 *    content-type headers).
 * 2. Otherwise, `index.html` is returned for client-side routing (SPA
 *    behavior — React Router handles the path in the browser).
 *
 * Fastify's routing tree guarantees that specific routes registered by
 * NestJS controllers (e.g., `GET /health`, `GET /tasks/:id`) always
 * match before this wildcard route.
 *
 * @param fastifyInstance - The Fastify server instance
 * @param resolvedDistPath - Absolute path to the web-ui dist directory
 */
export async function registerStaticFileServing(
  fastifyInstance: FastifyInstance,
  resolvedDistPath: string,
): Promise<void> {
  // Register @fastify/static with wildcard disabled. The plugin provides
  // reply.sendFile() for efficient file streaming with correct MIME types.
  // We handle routing ourselves via the wildcard route below.
  await fastifyInstance.register(fastifyStatic, {
    root: resolvedDistPath,
    prefix: "/",
    wildcard: false,
  });

  // Pre-read index.html content for SPA fallback responses.
  // Cached in memory to avoid filesystem reads on every navigation request.
  const indexHtml = readFileSync(join(resolvedDistPath, "index.html"), "utf-8");

  // Wildcard GET route handles both static file serving and SPA fallback.
  // In Fastify's routing tree, specific routes (from NestJS controllers like
  // GET /health, GET /tasks, GET /tasks/:id) always match before wildcards,
  // so API endpoints are completely unaffected by this catch-all.
  fastifyInstance.get("/*", (request: FastifyRequest, reply: FastifyReply) => {
    // Strip query parameters and decode URI for filesystem lookup
    const rawPath = request.url.split("?")[0] ?? "/";
    const urlPath = decodeURIComponent(rawPath).replace(/^\//, "");

    if (urlPath) {
      const filePath = join(resolvedDistPath, urlPath);

      // Serve the actual file if it exists (JS bundles, CSS, images, fonts)
      if (existsSync(filePath) && statSync(filePath).isFile()) {
        return reply.sendFile(urlPath);
      }
    }

    // SPA fallback: return index.html for client-side routes (/dashboard, etc.)
    return reply.type("text/html").send(indexHtml);
  });
}

/**
 * Configures the NestJS Fastify application to serve pre-built web-ui
 * static files and provides SPA fallback routing for client-side navigation.
 *
 * This function is the primary public API for enabling static serving.
 * It is designed to be called from the application bootstrap function
 * or directly by the CLI entry point (T121).
 *
 * Call this **after** `NestFactory.create()` but **before** `app.listen()`
 * so that the Fastify plugin is registered before the routing tree is built.
 *
 * @param app - The NestJS Fastify application instance
 * @param distPath - Path to the web-ui dist directory containing built assets
 * @throws Error if distPath does not exist or does not contain index.html
 *
 * @example
 * ```typescript
 * const app = await NestFactory.create<NestFastifyApplication>(
 *   AppModule,
 *   new FastifyAdapter(),
 * );
 * await configureStaticServing(app, './apps/web-ui/dist');
 * await app.listen(3000);
 * ```
 */
export async function configureStaticServing(
  app: NestFastifyApplication,
  distPath: string,
): Promise<void> {
  const resolvedPath = validateDistPath(distPath);
  // Cast through unknown because NestJS may bundle a slightly different
  // Fastify type version than the project's direct dependency.
  const fastifyInstance = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;
  await registerStaticFileServing(fastifyInstance, resolvedPath);
}
