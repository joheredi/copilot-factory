/**
 * NestJS module that hosts the background automation runtime.
 *
 * @module @factory/control-plane/automation
 */

import { Module } from "@nestjs/common";

import { EventsModule } from "../events/events.module.js";
import { AutomationService } from "./automation.service.js";

@Module({
  imports: [EventsModule],
  providers: [AutomationService],
  exports: [AutomationService],
})
export class AutomationModule {}
