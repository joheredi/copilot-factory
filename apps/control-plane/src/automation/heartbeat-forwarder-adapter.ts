/**
 * Adapter that bridges the {@link HeartbeatForwarderPort} to the
 * {@link HeartbeatService}.
 *
 * The Worker Supervisor emits heartbeat events as it streams worker output.
 * This adapter translates those into `receiveHeartbeat()` calls so the
 * lease state machine progresses (LEASED → STARTING → RUNNING →
 * HEARTBEATING → COMPLETING) and leases stay alive.
 *
 * Errors are caught and logged — a heartbeat failure must never crash the
 * worker process.
 *
 * @module @factory/control-plane/automation/heartbeat-forwarder-adapter
 */

import type { HeartbeatForwarderPort } from "@factory/application";
import type { HeartbeatService } from "@factory/application";
import type { Logger } from "@factory/observability";
import { createLogger } from "@factory/observability";

/**
 * Dependencies required to construct the heartbeat forwarder adapter.
 */
export interface HeartbeatForwarderDependencies {
  /** The heartbeat service that manages lease heartbeats. */
  readonly heartbeatService: HeartbeatService;
  /** Optional logger override (defaults to a module-scoped logger). */
  readonly logger?: Logger;
}

/** System actor identity used when forwarding heartbeats on behalf of the worker supervisor. */
const SUPERVISOR_ACTOR = { type: "system" as const, id: "worker-supervisor" };

/**
 * Create a {@link HeartbeatForwarderPort} adapter backed by the
 * {@link HeartbeatService}.
 *
 * Each call to `forwardHeartbeat()` delegates to
 * `heartbeatService.receiveHeartbeat()`, mapping the `isTerminal` flag to the
 * `completing` parameter. Errors are caught and logged so that a transient
 * heartbeat failure (e.g. version conflict, expired lease) does not propagate
 * to the worker runtime and terminate the worker process.
 *
 * @param deps - The heartbeat service and optional logger.
 * @returns A {@link HeartbeatForwarderPort} implementation.
 */
export function createHeartbeatForwarderAdapter(
  deps: HeartbeatForwarderDependencies,
): HeartbeatForwarderPort {
  const { heartbeatService } = deps;
  const logger = deps.logger ?? createLogger("heartbeat-forwarder");

  return {
    forwardHeartbeat(leaseId: string, workerId: string, isTerminal: boolean): void {
      try {
        heartbeatService.receiveHeartbeat({
          leaseId,
          completing: isTerminal,
          actor: SUPERVISOR_ACTOR,
        });
      } catch (error: unknown) {
        logger.warn("Heartbeat forwarding failed", {
          leaseId,
          workerId,
          isTerminal,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
