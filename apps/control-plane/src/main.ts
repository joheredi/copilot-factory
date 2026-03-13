/**
 * Standalone entry point for the control-plane service.
 *
 * Initializes OpenTelemetry tracing, creates the NestJS application via
 * {@link createApp}, starts the HTTP listener, and wires up graceful
 * shutdown. This module is executed directly by `pnpm dev` / `pnpm start`
 * in the control-plane workspace.
 *
 * For programmatic use (e.g., the CLI entry point in `apps/cli`), import
 * {@link createApp} from `@factory/control-plane` instead — it gives full
 * control over the application lifecycle without side effects.
 *
 * @see docs/prd/007-technical-architecture.md §7.1 for stack rationale
 * @see docs/prd/007-technical-architecture.md §7.14 for observability architecture
 * @module @factory/control-plane
 */
import { initTracing } from "@factory/observability";
import type { TracingHandle } from "@factory/observability";

import { createApp } from "./bootstrap.js";

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

// Start the server when executed directly
async function main(): Promise<void> {
  const app = await createApp();
  const port = Number(process.env["PORT"]) || DEFAULT_PORT;
  await app.listen(port, "0.0.0.0");
}

main().catch((err: unknown) => {
  console.error("Failed to start control-plane:", err);
  tracingHandle.shutdown().finally(() => process.exit(1));
});

// Graceful shutdown: flush pending spans before process exit
function handleShutdown(): void {
  tracingHandle.shutdown().finally(() => process.exit(0));
}
process.on("SIGTERM", handleShutdown);
process.on("SIGINT", handleShutdown);
