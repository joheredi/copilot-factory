/**
 * Tests for the policies controller.
 *
 * Verifies HTTP-layer behavior by mocking the {@link PoliciesService}.
 * Each test validates a single aspect: successful responses, delegation
 * to the service, and NotFoundException for missing entities.
 *
 * @module @factory/control-plane
 */
import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { PoliciesController } from "./policies.controller.js";
import type { PoliciesService, PaginatedPolicySetResponse } from "./policies.service.js";
import type { PolicySet } from "../infrastructure/repositories/policy-set.repository.js";

/** Factory for a fake paginated policy set response. */
function fakePaginatedPolicies(
  overrides: Partial<PaginatedPolicySetResponse> = {},
): PaginatedPolicySetResponse {
  return {
    data: [],
    meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    ...overrides,
  };
}

/** Factory for a fake policy set. */
function fakePolicySet(overrides: Partial<PolicySet> = {}): PolicySet {
  return {
    policySetId: "ps-1",
    name: "default",
    version: "1.0.0",
    schedulingPolicyJson: null,
    reviewPolicyJson: null,
    mergePolicyJson: null,
    securityPolicyJson: null,
    validationPolicyJson: null,
    budgetPolicyJson: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/** Map a fake policy set to the expected response shape (policySetId → id). */
function expectedPolicySet(ps: PolicySet) {
  const { policySetId, ...rest } = ps;
  return { id: policySetId, ...rest };
}

describe("PoliciesController", () => {
  let controller: PoliciesController;
  let service: {
    findAll: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      findAll: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
    };
    controller = new PoliciesController(service as unknown as PoliciesService);
  });

  /**
   * Validates that findAll delegates to the service with correct pagination.
   */
  it("should delegate findAll to the service", () => {
    const expected = fakePaginatedPolicies({
      data: [fakePolicySet()],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    service.findAll.mockReturnValue(expected);

    const result = controller.findAll({ page: 1, limit: 20 });

    expect(service.findAll).toHaveBeenCalledWith(1, 20);
    expect(result).toEqual({
      data: expected.data.map(expectedPolicySet),
      meta: expected.meta,
    });
  });

  /**
   * Validates that findById returns the policy set when it exists.
   */
  it("should return policy set by ID", () => {
    const policySet = fakePolicySet({ policySetId: "ps-1" });
    service.findById.mockReturnValue(policySet);

    const result = controller.findById("ps-1");

    expect(service.findById).toHaveBeenCalledWith("ps-1");
    expect(result).toEqual(expectedPolicySet(policySet));
  });

  /**
   * Validates that findById throws NotFoundException for missing policy sets.
   * The global exception filter maps this to 404.
   */
  it("should throw NotFoundException when policy set not found", () => {
    service.findById.mockReturnValue(undefined);

    expect(() => controller.findById("non-existent")).toThrow(NotFoundException);
  });

  /**
   * Validates that update delegates to the service and returns the updated set.
   */
  it("should update a policy set and return the result", () => {
    const updated = fakePolicySet({ name: "strict" });
    service.update.mockReturnValue(updated);

    const result = controller.update("ps-1", { name: "strict" });

    expect(service.update).toHaveBeenCalledWith("ps-1", { name: "strict" });
    expect(result).toEqual(expectedPolicySet(updated));
  });

  /**
   * Validates that update throws NotFoundException when the policy set
   * does not exist. Prevents silent no-ops on PUT requests.
   */
  it("should throw NotFoundException when updating non-existent policy set", () => {
    service.update.mockReturnValue(undefined);

    expect(() => controller.update("non-existent", { name: "new" })).toThrow(NotFoundException);
  });
});
