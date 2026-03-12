/**
 * Handles HTTP requests for agent profile management, scoped to a parent pool.
 *
 * Agent profiles define the behavioral contract for AI agents: prompt
 * template, tool/command/file policies, validation/review/budget/retry
 * policies. Profiles are always accessed through their parent pool.
 *
 * All write operations return the created/updated entity. Not-found
 * conditions throw {@link NotFoundException} which the global exception
 * filter maps to 404.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/prd/002-data-model.md} §2.3 AgentProfile
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Inject,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";

import { CreateProfileDto } from "./dtos/create-profile.dto.js";
import { UpdateProfileDto } from "./dtos/update-profile.dto.js";
import { ProfilesService } from "./profiles.service.js";
import type { AgentProfile } from "../infrastructure/repositories/agent-profile.repository.js";

/**
 * REST controller for agent profile CRUD, nested under pools.
 *
 * Endpoints:
 * - `POST /pools/:poolId/profiles` — Create a profile in a pool
 * - `GET /pools/:poolId/profiles` — List profiles for a pool
 * - `GET /pools/:poolId/profiles/:profileId` — Get a single profile
 * - `PUT /pools/:poolId/profiles/:profileId` — Update a profile
 * - `DELETE /pools/:poolId/profiles/:profileId` — Delete a profile
 */
@ApiTags("profiles")
@Controller("pools/:poolId/profiles")
export class ProfilesController {
  /** @param profilesService Injected profiles service. */
  constructor(@Inject(ProfilesService) private readonly profilesService: ProfilesService) {}

  /**
   * Create a new agent profile in the specified pool.
   *
   * All policy references are optional — profiles can be created
   * incrementally as policies are defined.
   *
   * @param poolId Parent pool UUID.
   * @param dto Validated creation payload.
   * @returns The newly created profile.
   * @throws NotFoundException if the parent pool does not exist.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create an agent profile in a pool" })
  @ApiParam({ name: "poolId", description: "Parent pool UUID" })
  @ApiResponse({ status: 201, description: "Profile created." })
  @ApiResponse({ status: 400, description: "Validation failed." })
  @ApiResponse({ status: 404, description: "Pool not found." })
  create(@Param("poolId") poolId: string, @Body() dto: CreateProfileDto): AgentProfile {
    const profile = this.profilesService.create(poolId, dto);
    if (!profile) {
      throw new NotFoundException(`Pool with ID "${poolId}" not found`);
    }
    return profile;
  }

  /**
   * List all agent profiles for a pool.
   *
   * @param poolId Parent pool UUID.
   * @returns Array of profiles attached to the pool.
   */
  @Get()
  @ApiOperation({ summary: "List agent profiles for a pool" })
  @ApiParam({ name: "poolId", description: "Parent pool UUID" })
  @ApiResponse({ status: 200, description: "Profile list." })
  findByPoolId(@Param("poolId") poolId: string): AgentProfile[] {
    return this.profilesService.findByPoolId(poolId);
  }

  /**
   * Get a single agent profile by ID, scoped to a pool.
   *
   * @param poolId Parent pool UUID.
   * @param profileId Profile UUID.
   * @returns The profile.
   * @throws NotFoundException if the profile does not exist or wrong pool.
   */
  @Get(":profileId")
  @ApiOperation({ summary: "Get agent profile by ID" })
  @ApiParam({ name: "poolId", description: "Parent pool UUID" })
  @ApiParam({ name: "profileId", description: "Profile UUID" })
  @ApiResponse({ status: 200, description: "Profile detail." })
  @ApiResponse({ status: 404, description: "Profile not found." })
  findById(@Param("poolId") poolId: string, @Param("profileId") profileId: string): AgentProfile {
    const profile = this.profilesService.findById(poolId, profileId);
    if (!profile) {
      throw new NotFoundException(`Profile with ID "${profileId}" not found in pool "${poolId}"`);
    }
    return profile;
  }

  /**
   * Update an agent profile's policy references.
   *
   * Only provided fields are updated. Pass `null` to clear a policy reference.
   *
   * @param poolId Parent pool UUID.
   * @param profileId Profile UUID.
   * @param dto Validated update payload.
   * @returns The updated profile.
   * @throws NotFoundException if the profile does not exist or wrong pool.
   */
  @Put(":profileId")
  @ApiOperation({ summary: "Update agent profile" })
  @ApiParam({ name: "poolId", description: "Parent pool UUID" })
  @ApiParam({ name: "profileId", description: "Profile UUID" })
  @ApiResponse({ status: 200, description: "Profile updated." })
  @ApiResponse({ status: 400, description: "Validation failed." })
  @ApiResponse({ status: 404, description: "Profile not found." })
  update(
    @Param("poolId") poolId: string,
    @Param("profileId") profileId: string,
    @Body() dto: UpdateProfileDto,
  ): AgentProfile {
    const profile = this.profilesService.update(poolId, profileId, dto);
    if (!profile) {
      throw new NotFoundException(`Profile with ID "${profileId}" not found in pool "${poolId}"`);
    }
    return profile;
  }

  /**
   * Delete an agent profile by ID, scoped to a pool.
   *
   * @param poolId Parent pool UUID.
   * @param profileId Profile UUID.
   * @throws NotFoundException if the profile does not exist or wrong pool.
   */
  @Delete(":profileId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete agent profile" })
  @ApiParam({ name: "poolId", description: "Parent pool UUID" })
  @ApiParam({ name: "profileId", description: "Profile UUID" })
  @ApiResponse({ status: 204, description: "Profile deleted." })
  @ApiResponse({ status: 404, description: "Profile not found." })
  delete(@Param("poolId") poolId: string, @Param("profileId") profileId: string): void {
    const deleted = this.profilesService.delete(poolId, profileId);
    if (!deleted) {
      throw new NotFoundException(`Profile with ID "${profileId}" not found in pool "${poolId}"`);
    }
  }
}
