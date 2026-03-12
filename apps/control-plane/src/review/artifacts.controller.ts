/**
 * REST controller for task artifact retrieval.
 *
 * Exposes endpoints for listing all artifacts associated with a task
 * (organized by type) and retrieving parsed JSON packet content by ID.
 * Routes are nested under `/tasks/:taskId/` to maintain a task-centric
 * URL hierarchy.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/backlog/tasks/T084-api-artifacts-reviews.md}
 */
import { Controller, Get, NotFoundException, Param, Inject } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";

import { ArtifactsService } from "./artifacts.service.js";
import type { ArtifactTree, PacketContent } from "./artifacts.service.js";

/**
 * Handles HTTP requests for task artifact retrieval.
 *
 * Provides an artifact tree endpoint that aggregates metadata from
 * review packets, lead review decisions, validation runs, and merge
 * queue items. Also provides a packet content endpoint that returns
 * the full parsed JSON for a specific packet.
 */
@ApiTags("artifacts")
@Controller("tasks/:taskId")
export class ArtifactsController {
  /** @param artifactsService Injected artifacts service. */
  constructor(@Inject(ArtifactsService) private readonly artifactsService: ArtifactsService) {}

  /**
   * List all artifacts for a task, organized by type.
   *
   * Returns summary metadata for review packets, lead review decisions,
   * validation runs, and merge queue items associated with the task.
   *
   * @param taskId Task UUID.
   * @returns Artifact tree organized by type.
   * @throws NotFoundException if the task does not exist.
   */
  @Get("artifacts")
  @ApiOperation({ summary: "List all artifacts for a task" })
  @ApiParam({ name: "taskId", description: "Task UUID" })
  @ApiResponse({ status: 200, description: "Artifact tree organized by type." })
  @ApiResponse({ status: 404, description: "Task not found." })
  getArtifactTree(@Param("taskId") taskId: string): ArtifactTree {
    const tree = this.artifactsService.getArtifactTree(taskId);
    if (!tree) {
      throw new NotFoundException(`Task with ID "${taskId}" not found`);
    }
    return tree;
  }

  /**
   * Get parsed JSON content of a specific packet.
   *
   * Searches across review packet and lead review decision tables for
   * the given packet ID. Returns the full parsed JSON content along
   * with source metadata indicating which table the packet came from.
   *
   * @param taskId Task UUID.
   * @param packetId Packet UUID (reviewPacketId or leadReviewDecisionId).
   * @returns Parsed packet content with source metadata.
   * @throws NotFoundException if the task or packet does not exist.
   */
  @Get("packets/:packetId")
  @ApiOperation({ summary: "Get parsed packet content by ID" })
  @ApiParam({ name: "taskId", description: "Task UUID" })
  @ApiParam({
    name: "packetId",
    description: "Packet UUID (review packet or lead review decision)",
  })
  @ApiResponse({ status: 200, description: "Parsed packet JSON content." })
  @ApiResponse({ status: 404, description: "Task or packet not found." })
  getPacketContent(
    @Param("taskId") taskId: string,
    @Param("packetId") packetId: string,
  ): PacketContent {
    const content = this.artifactsService.getPacketContent(taskId, packetId);
    if (!content) {
      throw new NotFoundException(`Packet with ID "${packetId}" not found for task "${taskId}"`);
    }
    return content;
  }
}
