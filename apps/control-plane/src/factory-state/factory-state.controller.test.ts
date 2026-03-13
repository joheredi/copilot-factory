/**
 * Tests for the FactoryStateController.
 *
 * Validates the start/pause REST API using a mock AutomationService
 * and a mock EventBroadcasterService.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { FactoryStateController } from "./factory-state.controller.js";
import type { AutomationService } from "../automation/automation.service.js";
import type { EventBroadcasterService } from "../events/event-broadcaster.service.js";

function createMockAutomation(paused = true): AutomationService {
  return {
    paused,
    start: vi.fn(function (this: { paused: boolean }) {
      this.paused = false;
    }),
    pause: vi.fn(function (this: { paused: boolean }) {
      this.paused = true;
    }),
  } as unknown as AutomationService;
}

function createMockBroadcaster(): EventBroadcasterService {
  return {
    broadcastToChannel: vi.fn(),
  } as unknown as EventBroadcasterService;
}

describe("FactoryStateController", () => {
  let automation: AutomationService;
  let broadcaster: EventBroadcasterService;
  let controller: FactoryStateController;

  beforeEach(() => {
    automation = createMockAutomation(true);
    broadcaster = createMockBroadcaster();
    controller = new FactoryStateController(automation, broadcaster);
  });

  it("returns paused state by default", () => {
    const result = controller.getState();
    expect(result.state).toBe("paused");
  });

  it("returns running state after start", () => {
    controller.start();
    const result = controller.getState();
    expect(result.state).toBe("running");
  });

  it("start() calls automation.start() and returns running", () => {
    const result = controller.start();
    expect(result.state).toBe("running");
    expect(automation.start).toHaveBeenCalled();
  });

  it("pause() calls automation.pause() and returns paused", () => {
    // Start first so pause does something
    controller.start();
    const result = controller.pause();
    expect(result.state).toBe("paused");
    expect(automation.pause).toHaveBeenCalled();
  });

  it("start() broadcasts state change via WebSocket", () => {
    controller.start();
    expect(broadcaster.broadcastToChannel).toHaveBeenCalledWith(
      "queue",
      expect.objectContaining({
        type: "factory.state_changed",
        data: { state: "running" },
      }),
    );
  });

  it("pause() broadcasts state change via WebSocket", () => {
    controller.start();
    controller.pause();
    expect(broadcaster.broadcastToChannel).toHaveBeenCalledWith(
      "queue",
      expect.objectContaining({
        type: "factory.state_changed",
        data: { state: "paused" },
      }),
    );
  });
});
