/**
 * NestJS module for operator actions on tasks.
 *
 * Owns the controller and service for operator-initiated task actions
 * such as pause, resume, cancel, requeue, force-unblock, change priority,
 * reassign pool, rerun review, override merge order, and reopen.
 *
 * All actions validate preconditions and create audit events with
 * `actorType: "operator"` for traceability.
 *
 * Imports {@link EventsModule} to provide the {@link DomainEventBroadcasterAdapter}
 * for real-time WebSocket event broadcasting after state transitions.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/prd/006-additional-refinements.md} §6.2
 */
import { Module } from "@nestjs/common";

import { EventsModule } from "../events/events.module.js";
import { OperatorActionsController } from "./operator-actions.controller.js";
import { OperatorActionsService } from "./operator-actions.service.js";

/** Feature module for operator action endpoints. */
@Module({
  imports: [EventsModule],
  controllers: [OperatorActionsController],
  providers: [OperatorActionsService],
})
export class OperatorActionsModule {}
