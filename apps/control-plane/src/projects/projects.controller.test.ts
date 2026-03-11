/**
 * Tests for the projects controller.
 *
 * Verifies HTTP-layer behavior by mocking the {@link ProjectsService}.
 * Each test validates a single aspect of the controller: successful
 * responses, proper delegation to the service, and error handling
 * (NotFoundException for missing entities).
 *
 * @module @factory/control-plane
 */
import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectsController } from "./projects.controller.js";
import type { ProjectsService } from "./projects.service.js";

/** Factory for a fake project object. */
function fakeProject(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "proj-1",
    name: "Test Project",
    description: null,
    owner: "alice",
    defaultWorkflowTemplateId: null,
    defaultPolicySetId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("ProjectsController", () => {
  let controller: ProjectsController;
  let service: {
    create: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      create: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    // Instantiate directly — vitest uses esbuild which doesn't support
    // emitDecoratorMetadata, so NestJS DI cannot resolve constructor params.
    controller = new ProjectsController(service as unknown as ProjectsService);
  });

  /**
   * Validates that create delegates to the service and returns the
   * created project.
   */
  it("should create a project", () => {
    const project = fakeProject();
    service.create.mockReturnValue(project);

    const result = controller.create({ name: "Test Project", owner: "alice" });

    expect(service.create).toHaveBeenCalledWith({
      name: "Test Project",
      owner: "alice",
    });
    expect(result).toEqual(project);
  });

  /**
   * Validates that findAll delegates pagination params to the service.
   */
  it("should list projects with pagination", () => {
    const response = {
      data: [fakeProject()],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    service.findAll.mockReturnValue(response);

    const result = controller.findAll({ page: 1, limit: 20 });

    expect(service.findAll).toHaveBeenCalledWith(1, 20);
    expect(result).toEqual(response);
  });

  /**
   * Validates that findById returns the project when it exists.
   */
  it("should return a project by ID", () => {
    const project = fakeProject();
    service.findById.mockReturnValue(project);

    const result = controller.findById("proj-1");

    expect(result).toEqual(project);
  });

  /**
   * Validates that findById throws NotFoundException for missing entities.
   * The global exception filter maps this to a 404 HTTP response.
   */
  it("should throw NotFoundException when project not found", () => {
    service.findById.mockReturnValue(undefined);

    expect(() => controller.findById("missing")).toThrow(NotFoundException);
  });

  /**
   * Validates that update returns the updated project when it exists.
   */
  it("should update a project", () => {
    const project = fakeProject({ name: "Updated" });
    service.update.mockReturnValue(project);

    const result = controller.update("proj-1", { name: "Updated" });

    expect(result).toEqual(project);
  });

  /**
   * Validates that update throws NotFoundException for missing entities.
   */
  it("should throw NotFoundException when updating non-existent project", () => {
    service.update.mockReturnValue(undefined);

    expect(() => controller.update("missing", { name: "Updated" })).toThrow(NotFoundException);
  });

  /**
   * Validates that delete succeeds silently (204) when the project exists.
   */
  it("should delete a project", () => {
    service.delete.mockReturnValue(true);

    expect(() => controller.delete("proj-1")).not.toThrow();
  });

  /**
   * Validates that delete throws NotFoundException for missing entities.
   */
  it("should throw NotFoundException when deleting non-existent project", () => {
    service.delete.mockReturnValue(false);

    expect(() => controller.delete("missing")).toThrow(NotFoundException);
  });
});
