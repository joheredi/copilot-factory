/**
 * NestJS module for the health check endpoint.
 *
 * @module @factory/control-plane
 */
import { Module } from "@nestjs/common";

import { HealthController } from "./health.controller.js";

/** Registers the health check controller. */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
