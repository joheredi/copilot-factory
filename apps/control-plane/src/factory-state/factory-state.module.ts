/**
 * NestJS module for the factory start/pause state management.
 *
 * @module @factory/control-plane/factory-state
 */

import { Module } from "@nestjs/common";

import { AutomationModule } from "../automation/automation.module.js";
import { EventsModule } from "../events/events.module.js";
import { FactoryStateController } from "./factory-state.controller.js";

@Module({
  imports: [AutomationModule, EventsModule],
  controllers: [FactoryStateController],
})
export class FactoryStateModule {}
