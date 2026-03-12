/**
 * NestJS application bootstrap for the control-plane service.
 *
 * Starts a Fastify-backed HTTP server with:
 * - OpenTelemetry tracing initialized before app creation
 * - CORS enabled for local UI development
 * - OpenAPI/Swagger documentation at /api/docs
 * - Global exception filter for structured error responses
 * - Global Zod validation pipe for request validation
 *
 * @see docs/prd/007-technical-architecture.md §7.1 for stack rationale
 * @see docs/prd/007-technical-architecture.md §7.14 for observability architecture
 * @module @factory/control-plane
 */
import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { initTracing } from "@factory/observability";
import type { TracingHandle } from "@factory/observability";

import { AppModule } from "./app.module.js";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter.js";
import { ZodValidationPipe } from "./common/pipes/zod-validation.pipe.js";

/** Default port for the control-plane HTTP server. */
const DEFAULT_PORT = 3000;

/**
 * Initialize OpenTelemetry tracing before the NestJS app bootstraps.
 *
 * Must happen before any HTTP modules are loaded so that the HTTP
 * instrumentation can monkey-patch Node.js `http`/`https` modules.
 *
 * @see docs/prd/007-technical-architecture.md §7.14 for observability architecture.
 */
const tracingHandle: TracingHandle = initTracing({
  serviceName: "factory-control-plane",
  serviceVersion: "0.1.0",
  otlpEndpoint: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? "http://localhost:4318",
  enableOtlpExporter: process.env["OTEL_TRACING_ENABLED"] !== "false",
  enableConsoleExporter: process.env["NODE_ENV"] === "development",
});

/**
 * Bootstrap the NestJS application with Fastify adapter.
 *
 * Configures CORS, global pipes/filters, and Swagger documentation
 * before starting the HTTP listener. OpenTelemetry tracing is initialized
 * at module load time (before this function runs) to ensure HTTP
 * instrumentation captures all requests.
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
  tracingHandle.shutdown().finally(() => process.exit(1));
});

// Graceful shutdown: flush pending spans before process exit
function handleShutdown(): void {
  tracingHandle.shutdown().finally(() => process.exit(0));
}
process.on("SIGTERM", handleShutdown);
process.on("SIGINT", handleShutdown);
