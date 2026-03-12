/**
 * Adapter that bridges domain events from the application layer to WebSocket
 * broadcasting in the control plane.
 *
 * Implements the {@link DomainEventEmitter} port so the
 * {@link TransitionService} can publish domain events after state transitions
 * commit. This adapter maps each domain event to the correct
 * {@link EventChannel} and {@link FactoryEvent} structure, then delegates
 * to {@link EventBroadcasterService} for socket.io delivery.
 *
 * Error handling: Per the port contract, this adapter MUST NOT throw.
 * If broadcasting fails, the error is logged and swallowed — the state
 * transition has already committed to the database.
 *
 * @see docs/prd/007-technical-architecture.md §7.7 — Event architecture
 * @see docs/backlog/tasks/T087-task-events.md
 * @see docs/backlog/tasks/T088-queue-worker-events.md
 * @module @factory/control-plane/events
 */
import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";

import type { DomainEventEmitter, DomainEvent } from "@factory/application";
import { createLogger } from "@factory/observability";
import type { Logger } from "@factory/observability";

import { EventBroadcasterService } from "./event-broadcaster.service.js";
import { QueueWorkerEventsService } from "./queue-worker-events.service.js";
import { EventChannel } from "./types.js";

/**
 * Maps domain event entity types to WebSocket event channels.
 *
 * Each entity type produced by the transition service maps to exactly one
 * channel that WebSocket clients subscribe to.
 */
const ENTITY_TYPE_TO_CHANNEL: Record<string, EventChannel> = {
  task: EventChannel.Tasks,
  "task-lease": EventChannel.Workers,
  worker: EventChannel.Workers,
  "review-cycle": EventChannel.Tasks,
  "merge-queue-item": EventChannel.Queue,
};

/**
 * Maps domain event type discriminators to WebSocket event type strings.
 *
 * Domain events use past-tense verbs (e.g., "task.transitioned") while
 * WebSocket events use present-tense descriptors (e.g., "task.state_changed")
 * to match the UI client convention established in T086.
 */
const DOMAIN_EVENT_TYPE_TO_WS_TYPE: Record<string, string> = {
  "task.transitioned": "task.state_changed",
  "task-lease.transitioned": "task_lease.state_changed",
  "review-cycle.transitioned": "review_cycle.state_changed",
  "merge-queue-item.transitioned": "merge_queue_item.state_changed",
  "worker.status-changed": "worker.status_changed",
};

/**
 * Converts a domain event's data payload to the FactoryEvent `data` shape.
 *
 * Extracts the status transition fields and actor info into a flat
 * record suitable for JSON serialization over WebSocket.
 *
 * @param event - The domain event to extract data from
 * @returns Record with fromState, toState, actor fields and any extra fields
 */
function buildEventData(event: DomainEvent): Record<string, unknown> {
  const data: Record<string, unknown> = {
    actorType: event.actor.type,
    actorId: event.actor.id,
  };

  if ("fromStatus" in event && "toStatus" in event) {
    data["fromState"] = event.fromStatus;
    data["toState"] = event.toStatus;
  }

  if ("newVersion" in event) {
    data["newVersion"] = event.newVersion;
  }

  return data;
}

/**
 * Adapter that implements the application-layer DomainEventEmitter port
 * by forwarding domain events to the WebSocket EventBroadcasterService.
 *
 * Injected by NestJS into services that create a TransitionService,
 * replacing the no-op emitter used before T087.
 *
 * Events are broadcast to:
 * 1. The entity-specific room (e.g., "tasks:task-abc-123")
 * 2. The channel room (e.g., "tasks")
 *
 * This dual-emit is handled by {@link EventBroadcasterService.broadcastToEntity}.
 *
 * After broadcasting the individual event, the adapter triggers aggregate
 * enrichment via {@link QueueWorkerEventsService} (T088): pool summaries
 * for worker status changes, and merge queue position updates for queue
 * item transitions. The service reference is resolved lazily via ModuleRef
 * to avoid constructor-level DI coupling.
 */
@Injectable()
export class DomainEventBroadcasterAdapter implements DomainEventEmitter, OnModuleInit {
  private readonly logger: Logger;
  private queueWorkerEvents?: QueueWorkerEventsService;

  constructor(
    private readonly broadcaster: EventBroadcasterService,
    private readonly moduleRef: ModuleRef,
  ) {
    this.logger = createLogger("domain-event-broadcaster");
  }

  /**
   * Lazily resolve QueueWorkerEventsService after module initialization.
   *
   * Uses ModuleRef.get with strict: false to search across the entire
   * module tree. This avoids a direct constructor dependency that could
   * cause DI resolution issues.
   */
  onModuleInit(): void {
    try {
      this.queueWorkerEvents = this.moduleRef.get(QueueWorkerEventsService, { strict: false });
    } catch {
      this.logger.debug("QueueWorkerEventsService not available, enrichment disabled");
    }
  }

  /**
   * Emit a domain event by broadcasting it to WebSocket clients.
   *
   * Maps the domain event to the appropriate channel and event type,
   * then delegates to the EventBroadcasterService. If any step fails,
   * the error is logged and swallowed per the port contract.
   *
   * @param event - Domain event from the transition service
   */
  emit(event: DomainEvent): void {
    try {
      const channel = ENTITY_TYPE_TO_CHANNEL[event.entityType];
      if (!channel) {
        this.logger.warn("Unknown entity type in domain event, skipping broadcast", {
          entityType: event.entityType,
          eventType: event.type,
        });
        return;
      }

      const wsEventType = DOMAIN_EVENT_TYPE_TO_WS_TYPE[event.type] ?? event.type;
      const data = buildEventData(event);
      const timestamp = event.timestamp.toISOString();

      this.broadcaster.broadcastToEntity(channel, event.entityId, {
        type: wsEventType,
        data,
        timestamp,
      });

      this.logger.debug("Domain event broadcast to WebSocket clients", {
        eventType: wsEventType,
        channel,
        entityId: event.entityId,
      });

      // T088: Trigger aggregate enrichment broadcasts after the entity-level event.
      this.emitEnrichment(event);
    } catch (error: unknown) {
      // Per the DomainEventEmitter contract: MUST NOT throw.
      // State transition is already committed — log and continue.
      this.logger.error("Failed to broadcast domain event via WebSocket", {
        eventType: event.type,
        entityId: event.entityId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Trigger aggregate enrichment broadcasts after an entity-level event.
   *
   * Worker status changes trigger a pool summary broadcast so UI clients
   * see updated pool health. Merge queue item transitions trigger a
   * position list broadcast so UI clients see updated queue ordering.
   *
   * Failures are logged and swallowed — enrichment events are supplementary
   * and must not interfere with the primary domain event delivery.
   *
   * @param event - The domain event that was just broadcast
   */
  private emitEnrichment(event: DomainEvent): void {
    if (!this.queueWorkerEvents) {
      return;
    }

    try {
      if (event.entityType === "worker") {
        this.queueWorkerEvents.broadcastPoolSummary(event.entityId);
      }

      if (event.entityType === "merge-queue-item") {
        this.queueWorkerEvents.broadcastMergeQueueUpdate(event.entityId);
      }
    } catch (error: unknown) {
      this.logger.warn("Failed to broadcast enrichment event", {
        eventType: event.type,
        entityId: event.entityId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
