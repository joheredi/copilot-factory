/**
 * NestJS module for merge queue management and merge detail retrieval.
 *
 * Owns controllers and services for merge queue status and
 * validation run retrieval per task.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T084-api-artifacts-reviews.md}
 */
import { Module } from "@nestjs/common";

import { MergeDetailsController } from "./merge-details.controller.js";
import { MergeDetailsService } from "./merge-details.service.js";
import { MergeQueueController } from "./merge-queue.controller.js";
import { MergeQueueService } from "./merge-queue.service.js";

/** Feature module for merge queue and merge detail endpoints. */
@Module({
  controllers: [MergeDetailsController, MergeQueueController],
  providers: [MergeDetailsService, MergeQueueService],
})
export class MergeModule {}
