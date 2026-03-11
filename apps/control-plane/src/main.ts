/**
 * NestJS application bootstrap for the control-plane service.
 *
 * Starts a Fastify-backed HTTP server with:
 * - CORS enabled for local UI development
 * - OpenAPI/Swagger documentation at /api/docs
 * - Global exception filter for structured error responses
 * - Global Zod validation pipe for request validation
 *
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

/** Default port for the control-plane HTTP server. */
const DEFAULT_PORT = 3000;

/**
 * Bootstrap the NestJS application with Fastify adapter.
 *
 * Configures CORS, global pipes/filters, and Swagger documentation
 * before starting the HTTP listener.
 */
export async function bootstrap(): Promise<NestFastifyApplication> {
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

  const port = Number(process.env["PORT"]) || DEFAULT_PORT;
  await app.listen(port, "0.0.0.0");

  return app;
}

// Start the server when executed directly
bootstrap().catch((err: unknown) => {
  console.error("Failed to start control-plane:", err);
  process.exit(1);
});
