/**
 * NestJS module for worker pool and agent profile management.
 *
 * Registers controllers and services for pool CRUD, pool worker listing,
 * and agent profile CRUD (nested under pools). Worker registration and
 * heartbeat handling will be added in a future task.
 *
 * @module @factory/control-plane
 */
import { Module } from "@nestjs/common";

import { PoolsController } from "./pools.controller.js";
import { PoolsService } from "./pools.service.js";
import { ProfilesController } from "./profiles.controller.js";
import { ProfilesService } from "./profiles.service.js";

/** Feature module for worker pool and agent profile endpoints. */
@Module({
  controllers: [PoolsController, ProfilesController],
  providers: [PoolsService, ProfilesService],
})
export class WorkersModule {}
