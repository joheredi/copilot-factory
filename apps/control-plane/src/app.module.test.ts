/**
 * Tests for the NestJS application bootstrap and module wiring.
 *
 * These tests verify the AppModule compiles correctly and all feature
 * modules are properly wired. If module wiring breaks, the entire API
 * service fails to start. These tests catch configuration errors early
 * without requiring a running HTTP server.
 *
 * @module @factory/control-plane
 */
import { Test, TestingModule } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { AppModule } from "./app.module.js";
import { HealthController } from "./health/health.controller.js";

describe("AppModule", () => {
  /**
   * Verifies that the root AppModule and all its imported feature modules
   * compile successfully through NestJS dependency injection. If any module
   * has a circular dependency, missing provider, or invalid import, this
   * test will fail with a clear error from NestJS's DI container.
   */
  it("should compile the application module", async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(module).toBeDefined();
  });

  /**
   * Verifies that the HealthController is registered and resolvable.
   * This is a smoke test — if the controller can be resolved, the
   * module wiring for the health endpoint is correct.
   */
  it("should resolve the HealthController", async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const controller = module.get<HealthController>(HealthController);
    expect(controller).toBeDefined();
    expect(controller.getHealth).toBeDefined();
  });
});
