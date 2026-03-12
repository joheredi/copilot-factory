/**
 * Service for agent profile management — creation, listing, detail retrieval,
 * update, and deletion.
 *
 * Agent profiles define the behavioral contract for AI agents: which prompt
 * template to use and which policies govern tool access, file scope,
 * validation, review, budget, and retry behavior. Each profile is attached
 * to exactly one worker pool.
 *
 * @module @factory/control-plane
 * @see {@link file://docs/prd/002-data-model.md} §2.3 AgentProfile
 * @see {@link file://docs/prd/006-additional-refinements.md} §6.1
 */
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { DATABASE_CONNECTION } from "../infrastructure/database/database.module.js";
import { createAgentProfileRepository } from "../infrastructure/repositories/agent-profile.repository.js";
import { createWorkerPoolRepository } from "../infrastructure/repositories/worker-pool.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import type { AgentProfile } from "../infrastructure/repositories/agent-profile.repository.js";
import type { CreateProfileDto } from "./dtos/create-profile.dto.js";
import type { UpdateProfileDto } from "./dtos/update-profile.dto.js";

/**
 * Manages agent profile lifecycle — CRUD operations scoped to a parent pool.
 *
 * Profiles are the behavioral contracts that define how AI agents behave.
 * Multiple profiles can be attached to a single pool, allowing different
 * behavioral configurations to coexist (e.g., aggressive vs conservative
 * review prompts on the same reviewer pool).
 */
@Injectable()
export class ProfilesService {
  /** @param conn Injected database connection. */
  constructor(@Inject(DATABASE_CONNECTION) private readonly conn: DatabaseConnection) {}

  /**
   * Create a new agent profile attached to the specified pool.
   *
   * Validates that the parent pool exists before creating the profile.
   * Returns `null` if the pool does not exist.
   *
   * @param poolId Parent pool UUID (from route parameter).
   * @param dto Validated creation payload.
   * @returns The newly created profile, or `null` if pool not found.
   */
  create(poolId: string, dto: CreateProfileDto): AgentProfile | null {
    return this.conn.writeTransaction((db) => {
      const poolRepo = createWorkerPoolRepository(db);
      const pool = poolRepo.findById(poolId);
      if (!pool) {
        return null;
      }

      const repo = createAgentProfileRepository(db);
      return repo.create({
        agentProfileId: randomUUID(),
        poolId,
        promptTemplateId: dto.promptTemplateId ?? null,
        toolPolicyId: dto.toolPolicyId ?? null,
        commandPolicyId: dto.commandPolicyId ?? null,
        fileScopePolicyId: dto.fileScopePolicyId ?? null,
        validationPolicyId: dto.validationPolicyId ?? null,
        reviewPolicyId: dto.reviewPolicyId ?? null,
        budgetPolicyId: dto.budgetPolicyId ?? null,
        retryPolicyId: dto.retryPolicyId ?? null,
      });
    });
  }

  /**
   * List all agent profiles for a given pool.
   *
   * @param poolId Parent pool UUID.
   * @returns Array of profiles attached to the pool.
   */
  findByPoolId(poolId: string): AgentProfile[] {
    const repo = createAgentProfileRepository(this.conn.db);
    return repo.findByPoolId(poolId);
  }

  /**
   * Find a single agent profile by ID, scoped to a pool.
   *
   * Returns `undefined` if the profile does not exist or does not
   * belong to the specified pool.
   *
   * @param poolId Parent pool UUID.
   * @param profileId Profile UUID.
   * @returns The profile or `undefined` if not found or wrong pool.
   */
  findById(poolId: string, profileId: string): AgentProfile | undefined {
    const repo = createAgentProfileRepository(this.conn.db);
    const profile = repo.findById(profileId);
    if (!profile || profile.poolId !== poolId) {
      return undefined;
    }
    return profile;
  }

  /**
   * Update an agent profile's policy references.
   *
   * Validates that the profile exists and belongs to the specified pool.
   * Returns `undefined` if not found or wrong pool.
   *
   * @param poolId Parent pool UUID.
   * @param profileId Profile UUID.
   * @param dto Validated update payload.
   * @returns The updated profile or `undefined` if not found.
   */
  update(poolId: string, profileId: string, dto: UpdateProfileDto): AgentProfile | undefined {
    return this.conn.writeTransaction((db) => {
      const repo = createAgentProfileRepository(db);
      const existing = repo.findById(profileId);
      if (!existing || existing.poolId !== poolId) {
        return undefined;
      }

      const data: Record<string, unknown> = {};
      if (dto.promptTemplateId !== undefined) data["promptTemplateId"] = dto.promptTemplateId;
      if (dto.toolPolicyId !== undefined) data["toolPolicyId"] = dto.toolPolicyId;
      if (dto.commandPolicyId !== undefined) data["commandPolicyId"] = dto.commandPolicyId;
      if (dto.fileScopePolicyId !== undefined) data["fileScopePolicyId"] = dto.fileScopePolicyId;
      if (dto.validationPolicyId !== undefined) data["validationPolicyId"] = dto.validationPolicyId;
      if (dto.reviewPolicyId !== undefined) data["reviewPolicyId"] = dto.reviewPolicyId;
      if (dto.budgetPolicyId !== undefined) data["budgetPolicyId"] = dto.budgetPolicyId;
      if (dto.retryPolicyId !== undefined) data["retryPolicyId"] = dto.retryPolicyId;

      return repo.update(profileId, data);
    });
  }

  /**
   * Delete an agent profile by ID, scoped to a pool.
   *
   * Validates that the profile belongs to the specified pool before
   * deleting. Returns false if not found or wrong pool.
   *
   * @param poolId Parent pool UUID.
   * @param profileId Profile UUID.
   * @returns True if deleted, false if not found or wrong pool.
   */
  delete(poolId: string, profileId: string): boolean {
    return this.conn.writeTransaction((db) => {
      const repo = createAgentProfileRepository(db);
      const existing = repo.findById(profileId);
      if (!existing || existing.poolId !== poolId) {
        return false;
      }
      return repo.delete(profileId);
    });
  }
}
