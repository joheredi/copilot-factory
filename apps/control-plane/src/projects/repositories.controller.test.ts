/**
 * Tests for the repositories controller.
 *
 * Verifies HTTP-layer behavior by mocking the {@link RepositoriesService}.
 * Tests cover successful CRUD operations and NotFoundException handling
 * for missing entities.
 *
 * @module @factory/control-plane
 */
import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RepositoriesController } from "./repositories.controller.js";
import type { RepositoriesService } from "./repositories.service.js";

/** Factory for a fake repository object. */
function fakeRepository(overrides: Record<string, unknown> = {}) {
  return {
    repositoryId: "repo-1",
    projectId: "proj-1",
    name: "Test Repo",
    remoteUrl: "https://github.com/test/repo.git",
    defaultBranch: "main",
    localCheckoutStrategy: "worktree",
    credentialProfileId: null,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Map a fake repository to the expected response shape (repositoryId → id). */
function expectedRepository(repo: ReturnType<typeof fakeRepository>) {
  const { repositoryId, ...rest } = repo;
  return { id: repositoryId, ...rest };
}

describe("RepositoriesController", () => {
  let controller: RepositoriesController;
  let service: {
    create: ReturnType<typeof vi.fn>;
    findByProjectId: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      create: vi.fn(),
      findByProjectId: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    // Instantiate directly — vitest uses esbuild which doesn't support
    // emitDecoratorMetadata, so NestJS DI cannot resolve constructor params.
    controller = new RepositoriesController(service as unknown as RepositoriesService);
  });

  /**
   * Validates that create delegates to the service with the correct
   * projectId and DTO.
   */
  it("should create a repository", () => {
    const repo = fakeRepository();
    service.create.mockReturnValue(repo);

    const dto = {
      name: "Test Repo",
      remoteUrl: "https://github.com/test/repo.git",
      defaultBranch: "main",
      localCheckoutStrategy: "worktree" as const,
      status: "active",
    };

    const result = controller.create("proj-1", dto);

    expect(service.create).toHaveBeenCalledWith("proj-1", dto);
    expect(result).toEqual(expectedRepository(repo));
  });

  /**
   * Validates that listing repositories delegates pagination to the service.
   */
  it("should list repositories for a project", () => {
    const response = {
      data: [fakeRepository()],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    service.findByProjectId.mockReturnValue(response);

    const result = controller.findByProjectId("proj-1", {
      page: 1,
      limit: 20,
    });

    expect(service.findByProjectId).toHaveBeenCalledWith("proj-1", 1, 20);
    expect(result).toEqual({
      data: response.data.map(expectedRepository),
      meta: response.meta,
    });
  });

  /**
   * Validates that findById returns the repository when it exists.
   */
  it("should return a repository by ID", () => {
    const repo = fakeRepository();
    service.findById.mockReturnValue(repo);

    const result = controller.findById("repo-1");

    expect(result).toEqual(expectedRepository(repo));
  });

  /**
   * Validates that findById throws NotFoundException for missing entities.
   */
  it("should throw NotFoundException when repository not found", () => {
    service.findById.mockReturnValue(undefined);

    expect(() => controller.findById("missing")).toThrow(NotFoundException);
  });

  /**
   * Validates that update returns the updated repository.
   */
  it("should update a repository", () => {
    const repo = fakeRepository({ name: "Updated" });
    service.update.mockReturnValue(repo);

    const result = controller.update("repo-1", { name: "Updated" });

    expect(result).toEqual(expectedRepository(repo));
  });

  /**
   * Validates that update throws NotFoundException for missing entities.
   */
  it("should throw NotFoundException when updating non-existent repository", () => {
    service.update.mockReturnValue(undefined);

    expect(() => controller.update("missing", { name: "Updated" })).toThrow(NotFoundException);
  });

  /**
   * Validates that delete succeeds when the repository exists.
   */
  it("should delete a repository", () => {
    service.delete.mockReturnValue(true);

    expect(() => controller.delete("repo-1")).not.toThrow();
  });

  /**
   * Validates that delete throws NotFoundException for missing entities.
   */
  it("should throw NotFoundException when deleting non-existent repository", () => {
    service.delete.mockReturnValue(false);

    expect(() => controller.delete("missing")).toThrow(NotFoundException);
  });
});
