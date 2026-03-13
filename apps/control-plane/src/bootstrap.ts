/**
 * Reusable NestJS application factory for the control-plane service.
 *
 * Creates and configures a NestJS Fastify application with all standard
 * middleware (CORS, validation, error handling, Swagger) but does NOT
 * start listening on a port. This separation allows both the standalone
 * `main.ts` entry point and the CLI (`apps/cli`) to share the same
 * application setup logic while controlling the server lifecycle
 * independently.
 *
 * @see docs/backlog/tasks/T121-cli-entry-point.md for CLI integration context
 * @see docs/prd/007-technical-architecture.md §7.1 for stack rationale
 * @module @factory/control-plane
 */
import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module.js";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter.js";
import { ZodValidationPipe } from "./common/pipes/zod-validation.pipe.js";

/**
 * Creates a fully configured NestJS Fastify application without starting
 * the HTTP listener.
 *
 * The returned application has:
 * - CORS enabled for local UI development
 * - Global Zod validation pipe for request validation
 * - Global exception filter for structured error responses
 * - OpenAPI/Swagger documentation at `/api/docs`
 *
 * Callers are responsible for:
 * 1. Initializing OpenTelemetry tracing **before** calling this function
 *    (tracing must be set up before HTTP modules load)
 * 2. Optionally configuring static file serving via `configureStaticServing()`
 * 3. Calling `app.listen(port, host)` to start the server
 * 4. Handling graceful shutdown (SIGINT/SIGTERM)
 *
 * @returns A configured but not-yet-listening NestJS Fastify application.
 *
 * @example
 * ```typescript
 * import { initTracing } from "@factory/observability";
 * import { createApp } from "@factory/control-plane";
 *
 * initTracing({ serviceName: "factory-control-plane" });
 * const app = await createApp();
 * await app.listen(3000, "0.0.0.0");
 * ```
 */
export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: ["error", "warn", "log"],
  });

  // CORS for local UI development (web-ui on different port)
  app.enableCors({
    origin: [/^http:\/\/localhost(:\d+)?$/],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  });

  // Global pipes and filters
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter());

  // OpenAPI/Swagger documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle("Factory Control Plane API")
    .setDescription(
      "REST API for the Autonomous Software Factory control plane — " +
        "manages projects, tasks, workers, reviews, and merge operations.",
    )
    .setVersion("0.1.0")
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document);

  return app;
}
