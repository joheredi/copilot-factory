/**
 * NestJS module for real-time WebSocket event delivery.
 *
 * Registers the {@link EventsGateway} for managing WebSocket connections,
 * the {@link EventBroadcasterService} as the public API for other
 * modules to emit events, and the {@link DomainEventBroadcasterAdapter}
 * which bridges domain events from the transition service to WebSocket
 * broadcasts.
 *
 * The adapter is exported so that modules creating a TransitionService
 * can inject it as the {@link DomainEventEmitter} implementation.
 *
 * @see docs/prd/007-technical-architecture.md §7.7 for event architecture
 * @see docs/backlog/tasks/T087-task-events.md
 * @module @factory/control-plane/events
 */
import { Module } from "@nestjs/common";

import { DomainEventBroadcasterAdapter } from "./domain-event-broadcaster.adapter.js";
import { EventBroadcasterService } from "./event-broadcaster.service.js";
import { EventsGateway } from "./events.gateway.js";

/**
 * Module providing WebSocket event infrastructure.
 *
 * Exports {@link EventBroadcasterService} for direct broadcasting and
 * {@link DomainEventBroadcasterAdapter} for use as a DomainEventEmitter
 * in services that create a TransitionService.
 */
@Module({
  providers: [EventsGateway, EventBroadcasterService, DomainEventBroadcasterAdapter],
  exports: [EventBroadcasterService, DomainEventBroadcasterAdapter],
})
export class EventsModule {}
