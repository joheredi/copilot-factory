/**
 * Adapter that bridges the {@link OutputForwarderPort} to the
 * {@link QueueWorkerEventsService}.
 *
 * The Worker Supervisor emits stdout/stderr events as it streams worker output.
 * This adapter translates those into `broadcastWorkerOutput()` calls so the
 * web UI receives real-time output updates via WebSocket.
 *
 * Errors are caught and logged — an output forwarding failure must never
 * crash the worker process.
 *
 * @module @factory/control-plane/automation/output-forwarder-adapter
 */

import type { OutputForwarderPort, SupervisorRunOutputStream } from "@factory/application";
import type { Logger } from "@factory/observability";
import { createLogger } from "@factory/observability";

import type { QueueWorkerEventsService } from "../events/queue-worker-events.service.js";

/**
 * Dependencies required to construct the output forwarder adapter.
 */
export interface OutputForwarderDependencies {
  /** The events service that broadcasts output to WebSocket clients. */
  readonly queueWorkerEventsService: QueueWorkerEventsService;
  /** Optional logger override (defaults to a module-scoped logger). */
  readonly logger?: Logger;
}

/**
 * Create an {@link OutputForwarderPort} adapter backed by the
 * {@link QueueWorkerEventsService}.
 *
 * Each call to `forwardOutput()` delegates to
 * `queueWorkerEventsService.broadcastWorkerOutput()`, which batches
 * events within a 200ms window before broadcasting via WebSocket.
 *
 * @param deps - The events service and optional logger.
 * @returns An {@link OutputForwarderPort} implementation.
 */
export function createOutputForwarderAdapter(
  deps: OutputForwarderDependencies,
): OutputForwarderPort {
  const { queueWorkerEventsService } = deps;
  const logger = deps.logger ?? createLogger("output-forwarder");

  return {
    forwardOutput(workerId: string, event: SupervisorRunOutputStream): void {
      try {
        queueWorkerEventsService.broadcastWorkerOutput(
          workerId,
          event.type,
          event.content,
          event.timestamp,
        );
      } catch (error: unknown) {
        logger.warn("Output forwarding failed", {
          workerId,
          stream: event.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
