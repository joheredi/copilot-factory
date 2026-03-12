/**
 * NestJS module for real-time WebSocket event delivery.
 *
 * Registers the {@link EventsGateway} for managing WebSocket connections
 * and the {@link EventBroadcasterService} as the public API for other
 * modules to emit events. The broadcaster is exported so that feature
 * modules (Tasks, Workers, Merge, etc.) can inject it to push live
 * updates to connected UI clients.
 *
 * @see docs/prd/007-technical-architecture.md §7.7 for event architecture
 * @module @factory/control-plane/events
 */
import { Module } from "@nestjs/common";

import { EventBroadcasterService } from "./event-broadcaster.service.js";
import { EventsGateway } from "./events.gateway.js";

/**
 * Module providing WebSocket event infrastructure.
 *
 * Exports {@link EventBroadcasterService} for use by other modules.
 * Feature modules should import EventsModule and inject the broadcaster
 * to emit domain events to subscribed clients.
 */
@Module({
  providers: [EventsGateway, EventBroadcasterService],
  exports: [EventBroadcasterService],
})
export class EventsModule {}
