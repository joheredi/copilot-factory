/**
 * NestJS module for review cycle management and artifact retrieval.
 *
 * Owns controllers and services for:
 * - Artifact tree listing and packet content retrieval
 * - Review cycle history with specialist/lead decisions
 * - Review cycle packet detail
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T084-api-artifacts-reviews.md}
 */
import { Module } from "@nestjs/common";

import { ArtifactsController } from "./artifacts.controller.js";
import { ArtifactsService } from "./artifacts.service.js";
import { ReviewsController } from "./reviews.controller.js";
import { ReviewsService } from "./reviews.service.js";

/** Feature module for review pipeline and artifact retrieval endpoints. */
@Module({
  controllers: [ArtifactsController, ReviewsController],
  providers: [ArtifactsService, ReviewsService],
})
export class ReviewModule {}
