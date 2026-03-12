/**
 * Tests for the profiles controller.
 *
 * Verifies HTTP-layer behavior by mocking the {@link ProfilesService}.
 * Each test validates proper delegation to the service and error handling
 * for missing profiles or parent pools.
 *
 * @module @factory/control-plane
 */
import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProfilesController } from "./profiles.controller.js";
import type { ProfilesService } from "./profiles.service.js";

/** Factory for a fake agent profile object with sensible defaults. */
function fakeProfile(overrides: Record<string, unknown> = {}) {
  return {
    agentProfileId: "profile-1",
    poolId: "pool-1",
    promptTemplateId: "template-1",
    toolPolicyId: null,
    commandPolicyId: null,
    fileScopePolicyId: null,
    validationPolicyId: null,
    reviewPolicyId: null,
    budgetPolicyId: null,
    retryPolicyId: null,
    ...overrides,
  };
}

describe("ProfilesController", () => {
  let controller: ProfilesController;
  let service: {
    create: ReturnType<typeof vi.fn>;
    findByPoolId: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      create: vi.fn(),
      findByPoolId: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    controller = new ProfilesController(service as unknown as ProfilesService);
  });

  /**
   * Validates that create delegates to the service with the pool ID
   * from the route parameter and returns the created profile.
   */
  it("should create a profile in a pool", () => {
    const profile = fakeProfile();
    service.create.mockReturnValue(profile);

    const dto = { promptTemplateId: "template-1" };
    const result = controller.create("pool-1", dto);

    expect(service.create).toHaveBeenCalledWith("pool-1", dto);
    expect(result).toEqual(profile);
  });

  /**
   * Validates that create throws NotFoundException when the parent pool
   * does not exist — service returns null for missing pools.
   */
  it("should throw NotFoundException when creating profile in non-existent pool", () => {
    service.create.mockReturnValue(null);

    expect(() => controller.create("missing", {})).toThrow(NotFoundException);
  });

  /**
   * Validates that findByPoolId returns the profile list for the pool.
   */
  it("should list profiles for a pool", () => {
    const profiles = [fakeProfile(), fakeProfile({ agentProfileId: "profile-2" })];
    service.findByPoolId.mockReturnValue(profiles);

    const result = controller.findByPoolId("pool-1");

    expect(service.findByPoolId).toHaveBeenCalledWith("pool-1");
    expect(result).toHaveLength(2);
  });

  /**
   * Validates that findById returns a single profile scoped to the pool.
   */
  it("should return a profile by ID", () => {
    const profile = fakeProfile();
    service.findById.mockReturnValue(profile);

    const result = controller.findById("pool-1", "profile-1");

    expect(service.findById).toHaveBeenCalledWith("pool-1", "profile-1");
    expect(result).toEqual(profile);
  });

  /**
   * Validates that findById throws NotFoundException for missing profiles
   * or profiles in wrong pools.
   */
  it("should throw NotFoundException when profile not found", () => {
    service.findById.mockReturnValue(undefined);

    expect(() => controller.findById("pool-1", "missing")).toThrow(NotFoundException);
  });

  /**
   * Validates that update returns the updated profile.
   */
  it("should update a profile", () => {
    const profile = fakeProfile({ toolPolicyId: "policy-1" });
    service.update.mockReturnValue(profile);

    const dto = { toolPolicyId: "policy-1" };
    const result = controller.update("pool-1", "profile-1", dto);

    expect(service.update).toHaveBeenCalledWith("pool-1", "profile-1", dto);
    expect(result).toEqual(profile);
  });

  /**
   * Validates that update throws NotFoundException for missing profiles.
   */
  it("should throw NotFoundException when updating non-existent profile", () => {
    service.update.mockReturnValue(undefined);

    expect(() => controller.update("pool-1", "missing", {})).toThrow(NotFoundException);
  });

  /**
   * Validates that delete succeeds silently (204) when the profile exists.
   */
  it("should delete a profile", () => {
    service.delete.mockReturnValue(true);

    expect(() => controller.delete("pool-1", "profile-1")).not.toThrow();
    expect(service.delete).toHaveBeenCalledWith("pool-1", "profile-1");
  });

  /**
   * Validates that delete throws NotFoundException for missing profiles.
   */
  it("should throw NotFoundException when deleting non-existent profile", () => {
    service.delete.mockReturnValue(false);

    expect(() => controller.delete("pool-1", "missing")).toThrow(NotFoundException);
  });
});
