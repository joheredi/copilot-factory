/**
 * Static file serving module for the control-plane.
 *
 * Exports:
 * - {@link StaticServeModule} — NestJS module for env-var-based static serving
 * - {@link configureStaticServing} — Function for programmatic static serving (CLI)
 * - {@link registerStaticFileServing} — Low-level Fastify plugin registration
 *
 * @module @factory/control-plane
 */
export { StaticServeModule } from "./static-serve.module.js";
export { configureStaticServing, registerStaticFileServing } from "./configure-static-serving.js";
