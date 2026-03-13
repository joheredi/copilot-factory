/**
 * NestJS module for optional static file serving of the web-ui SPA.
 *
 * When the `SERVE_STATIC` environment variable is set to `"true"`, this
 * module configures the Fastify server to serve the pre-built web-ui from
 * the path specified by `WEB_UI_DIST`. When disabled (default), this module
 * is a no-op and has no effect on the application.
 *
 * This module uses `OnApplicationBootstrap` to register the Fastify plugin
 * after all NestJS controller routes are registered but before the server
 * starts listening, ensuring correct route precedence (API routes always
 * match before the static file wildcard).
 *
 * Environment variables:
 * - `SERVE_STATIC`: Set to `"true"` to enable static file serving
 * - `WEB_UI_DIST`: Path to the web-ui dist directory (required when enabled)
 *
 * For programmatic use (e.g., CLI entry point), use the exported
 * {@link configureStaticServing} function directly instead of relying
 * on this module's env-var-based activation.
 *
 * @see configure-static-serving.ts for the Fastify plugin registration
 * @see docs/backlog/tasks/T120-bundle-web-ui.md
 * @module @factory/control-plane
 */
import { Injectable, Logger, Module } from "@nestjs/common";
import type { OnApplicationBootstrap } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { join } from "node:path";

import { registerStaticFileServing } from "./configure-static-serving.js";

/**
 * Service that conditionally registers static file serving during the
 * NestJS application bootstrap lifecycle.
 *
 * Reads configuration from environment variables and delegates to
 * {@link registerStaticFileServing} for the actual Fastify plugin setup.
 * Logs warnings instead of throwing errors for missing configuration,
 * since static serving is optional and should not prevent the API from
 * starting.
 */
@Injectable()
class StaticServeInitializer implements OnApplicationBootstrap {
  private readonly logger = new Logger(StaticServeInitializer.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  /**
   * Registers static file serving if SERVE_STATIC is enabled.
   *
   * Called by NestJS after all modules are initialized and all controller
   * routes are registered, but before the server starts listening. This
   * timing ensures the wildcard route has lowest priority in Fastify's
   * routing tree.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (process.env["SERVE_STATIC"] !== "true") {
      return;
    }

    const distPath = process.env["WEB_UI_DIST"];
    if (!distPath) {
      this.logger.warn(
        "SERVE_STATIC is enabled but WEB_UI_DIST is not configured. " +
          "Set WEB_UI_DIST to the path of the web-ui dist directory.",
      );
      return;
    }

    const resolvedPath = resolve(distPath);
    if (!existsSync(resolvedPath)) {
      this.logger.warn(
        `Web UI dist directory not found: ${resolvedPath}. Skipping static serving.`,
      );
      return;
    }

    const indexPath = join(resolvedPath, "index.html");
    if (!existsSync(indexPath)) {
      this.logger.warn(`index.html not found in ${resolvedPath}. Skipping static serving.`);
      return;
    }

    const fastifyInstance = this.httpAdapterHost.httpAdapter.getInstance() as FastifyInstance;
    await registerStaticFileServing(fastifyInstance, resolvedPath);

    this.logger.log(`Serving web-ui static files from ${resolvedPath}`);
  }
}

/**
 * Module that optionally serves the web-ui static files from the control-plane.
 *
 * Always safe to import — when `SERVE_STATIC` is not `"true"`, this module
 * has zero effect on the application. The initializer service only runs
 * its setup logic when the environment variable is explicitly enabled.
 */
@Module({
  providers: [StaticServeInitializer],
})
export class StaticServeModule {}
