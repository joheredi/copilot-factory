/**
 * Controller for the global factory start/pause toggle.
 *
 * Provides endpoints to query and control the factory production line state.
 * When paused, the automation runtime stops scheduling new tasks and dispatching
 * workers — but active workers already in flight continue to completion.
 *
 * State changes are broadcast over WebSocket so the UI updates in real time.
 *
 * @module @factory/control-plane/factory-state
 */

import { Controller, Get, Post, Inject } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";

import { AutomationService } from "../automation/automation.service.js";
import { EventBroadcasterService } from "../events/event-broadcaster.service.js";
import { EventChannel } from "../events/types.js";

/** Response shape for the factory state endpoint. */
export interface FactoryStateResponse {
  /** Current factory state: "running" or "paused". */
  state: "running" | "paused";
}

@ApiTags("factory")
@Controller("factory/state")
export class FactoryStateController {
  constructor(
    @Inject(AutomationService)
    private readonly automation: AutomationService,
    @Inject(EventBroadcasterService)
    private readonly broadcaster: EventBroadcasterService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Get factory state",
    description: "Returns whether the factory is running or paused.",
  })
  @ApiResponse({ status: 200, description: "Current factory state." })
  getState(): FactoryStateResponse {
    return { state: this.automation.paused ? "paused" : "running" };
  }

  @Post("start")
  @ApiOperation({
    summary: "Start the factory",
    description: "Resume the production line — scheduling and dispatch begin.",
  })
  @ApiResponse({ status: 200, description: "Factory started." })
  start(): FactoryStateResponse {
    this.automation.start();
    const response: FactoryStateResponse = { state: "running" };
    this.broadcastStateChange(response);
    return response;
  }

  @Post("pause")
  @ApiOperation({
    summary: "Pause the factory",
    description: "Stop scheduling new tasks. Active workers continue to completion.",
  })
  @ApiResponse({ status: 200, description: "Factory paused." })
  pause(): FactoryStateResponse {
    this.automation.pause();
    const response: FactoryStateResponse = { state: "paused" };
    this.broadcastStateChange(response);
    return response;
  }

  private broadcastStateChange(newState: FactoryStateResponse): void {
    this.broadcaster.broadcastToChannel(EventChannel.Queue, {
      type: "factory.state_changed",
      data: { state: newState.state },
    });
  }
}
