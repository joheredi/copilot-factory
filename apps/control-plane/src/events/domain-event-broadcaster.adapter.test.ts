/**
 * Tests for the DomainEventBroadcasterAdapter.
 *
 * Validates that domain events from the TransitionService are correctly
 * mapped to WebSocket FactoryEvents and broadcast to the right channels
 * and entity rooms. This is the critical integration point between the
 * deterministic state transition engine and real-time UI updates.
 *
 * Uses a mock EventBroadcasterService to capture broadcast calls without
 * requiring actual WebSocket infrastructure.
 *
 * @module @factory/control-plane/events
 */
import type { Server } from "socket.io";
import { describe, expect, it, beforeEach, vi } from "vitest";

import type { DomainEvent } from "@factory/application";
import {
  TaskStatus,
  WorkerLeaseStatus,
  ReviewCycleStatus,
  MergeQueueItemStatus,
} from "@factory/domain";

import { DomainEventBroadcasterAdapter } from "./domain-event-broadcaster.adapter.js";
import { EventBroadcasterService } from "./event-broadcaster.service.js";
import { QueueWorkerEventsService } from "./queue-worker-events.service.js";
import { EventsGateway } from "./events.gateway.js";
import { EventChannel } from "./types.js";
import type { FactoryEvent } from "./types.js";

/**
 * Create a mock socket.io server that records all emit calls.
 * Reused from the event-broadcaster tests for consistency.
 */
function createMockServer() {
  const emitCalls: Array<{ room: string; event: string; data: FactoryEvent }> = [];
  return {
    emitCalls,
    to: vi.fn((room: string) => ({
      emit: vi.fn((event: string, data: FactoryEvent) => {
        emitCalls.push({ room, event, data });
      }),
    })),
  };
}

/**
 * Create a mock ModuleRef that returns the given QueueWorkerEventsService.
 */
function createMockModuleRef(queueWorkerEvents?: QueueWorkerEventsService) {
  return {
    get: vi.fn((_type: unknown, _opts?: unknown) => {
      if (queueWorkerEvents) return queueWorkerEvents;
      throw new Error("Provider not found");
    }),
  } as never;
}

/**
 * Helper to create a task.transitioned domain event with sensible defaults.
 */
function createTaskTransitionedEvent(
  overrides: Partial<{
    entityId: string;
    fromStatus: TaskStatus;
    toStatus: TaskStatus;
    newVersion: number;
    actorType: string;
    actorId: string;
  }> = {},
): DomainEvent {
  return {
    type: "task.transitioned" as const,
    entityType: "task" as const,
    entityId: overrides.entityId ?? "task-001",
    fromStatus: overrides.fromStatus ?? TaskStatus.BACKLOG,
    toStatus: overrides.toStatus ?? TaskStatus.QUEUED,
    newVersion: overrides.newVersion ?? 2,
    actor: {
      type: overrides.actorType ?? "system",
      id: overrides.actorId ?? "scheduler",
    },
    timestamp: new Date("2026-03-12T05:30:00.000Z"),
  };
}

describe("DomainEventBroadcasterAdapter", () => {
  let adapter: DomainEventBroadcasterAdapter;
  let gateway: EventsGateway;
  let broadcaster: EventBroadcasterService;
  let mockServer: ReturnType<typeof createMockServer>;
  let mockQueueWorkerEvents: QueueWorkerEventsService;

  beforeEach(() => {
    gateway = new EventsGateway();
    mockServer = createMockServer();
    gateway.server = mockServer as unknown as Server;
    broadcaster = new EventBroadcasterService(gateway);
    mockQueueWorkerEvents = {
      broadcastPoolSummary: vi.fn(),
      broadcastMergeQueueUpdate: vi.fn(),
    } as unknown as QueueWorkerEventsService;
    const mockModuleRef = createMockModuleRef(mockQueueWorkerEvents);
    adapter = new DomainEventBroadcasterAdapter(broadcaster, mockModuleRef);
    // Trigger onModuleInit to resolve the QueueWorkerEventsService
    adapter.onModuleInit();
  });

  describe("task events", () => {
    /**
     * Validates that task state transitions are broadcast to both the
     * entity-specific room and the tasks channel. This is the primary
     * use case for T087 — UI clients subscribed to a specific task
     * or the tasks channel must both receive the event.
     */
    it("should broadcast task transitions to entity room and tasks channel", () => {
      const event = createTaskTransitionedEvent();

      adapter.emit(event);

      // broadcastToEntity emits to entity room + channel room = 2 calls
      expect(mockServer.emitCalls).toHaveLength(2);
      expect(mockServer.emitCalls[0]!.room).toBe("tasks:task-001");
      expect(mockServer.emitCalls[1]!.room).toBe(EventChannel.Tasks);
    });

    /**
     * Validates the event type mapping from domain event format to
     * WebSocket event format. Domain events use "task.transitioned"
     * while WebSocket clients expect "task.state_changed".
     */
    it("should map task.transitioned to task.state_changed event type", () => {
      adapter.emit(createTaskTransitionedEvent());

      const emitted = mockServer.emitCalls[0]!.data;
      expect(emitted.type).toBe("task.state_changed");
    });

    /**
     * Validates that the event payload contains the state transition
     * details that UI clients need to update their display: fromState,
     * toState, actor info, and the new entity version.
     */
    it("should include fromState, toState, actor, and version in event data", () => {
      adapter.emit(
        createTaskTransitionedEvent({
          fromStatus: TaskStatus.READY,
          toStatus: TaskStatus.ASSIGNED,
          newVersion: 5,
          actorType: "system",
          actorId: "scheduler-01",
        }),
      );

      const emitted = mockServer.emitCalls[0]!.data;
      expect(emitted.data).toEqual({
        fromState: TaskStatus.READY,
        toState: TaskStatus.ASSIGNED,
        newVersion: 5,
        actorType: "system",
        actorId: "scheduler-01",
      });
    });

    /**
     * Validates that the event timestamp is correctly converted from
     * the domain event's Date object to an ISO 8601 string, which is
     * the format expected by WebSocket clients.
     */
    it("should convert timestamp to ISO string", () => {
      adapter.emit(createTaskTransitionedEvent());

      const emitted = mockServer.emitCalls[0]!.data;
      expect(emitted.timestamp).toBe("2026-03-12T05:30:00.000Z");
    });

    /**
     * Validates that the entityId is included in the broadcast so
     * clients subscribed to a channel can filter by entity.
     */
    it("should include entityId in the broadcast", () => {
      adapter.emit(createTaskTransitionedEvent({ entityId: "task-xyz" }));

      const emitted = mockServer.emitCalls[0]!.data;
      expect(emitted.entityId).toBe("task-xyz");
    });

    /**
     * Validates that the channel field is correctly set to Tasks
     * for task transition events.
     */
    it("should set channel to Tasks for task events", () => {
      adapter.emit(createTaskTransitionedEvent());

      const emitted = mockServer.emitCalls[0]!.data;
      expect(emitted.channel).toBe(EventChannel.Tasks);
    });
  });

  describe("task-lease events", () => {
    /**
     * Validates that task lease transitions route to the Workers channel.
     * Leases represent worker assignments, so they belong with worker events.
     */
    it("should broadcast lease transitions to Workers channel", () => {
      const event: DomainEvent = {
        type: "task-lease.transitioned",
        entityType: "task-lease",
        entityId: "lease-001",
        fromStatus: WorkerLeaseStatus.IDLE,
        toStatus: WorkerLeaseStatus.LEASED,
        actor: { type: "system", id: "scheduler" },
        timestamp: new Date("2026-03-12T05:30:00.000Z"),
      };

      adapter.emit(event);

      expect(mockServer.emitCalls).toHaveLength(2);
      expect(mockServer.emitCalls[0]!.room).toBe("workers:lease-001");
      expect(mockServer.emitCalls[1]!.room).toBe(EventChannel.Workers);
      expect(mockServer.emitCalls[0]!.data.type).toBe("task_lease.state_changed");
    });
  });

  describe("review-cycle events", () => {
    /**
     * Validates that review cycle transitions route to the Tasks channel.
     * Reviews are conceptually part of the task lifecycle, so they
     * appear alongside task events in the UI.
     */
    it("should broadcast review cycle transitions to Tasks channel", () => {
      const event: DomainEvent = {
        type: "review-cycle.transitioned",
        entityType: "review-cycle",
        entityId: "review-001",
        fromStatus: ReviewCycleStatus.NOT_STARTED,
        toStatus: ReviewCycleStatus.ROUTED,
        actor: { type: "system", id: "review-router" },
        timestamp: new Date("2026-03-12T05:30:00.000Z"),
      };

      adapter.emit(event);

      expect(mockServer.emitCalls).toHaveLength(2);
      expect(mockServer.emitCalls[0]!.room).toBe("tasks:review-001");
      expect(mockServer.emitCalls[1]!.room).toBe(EventChannel.Tasks);
      expect(mockServer.emitCalls[0]!.data.type).toBe("review_cycle.state_changed");
    });
  });

  describe("merge-queue-item events", () => {
    /**
     * Validates that merge queue item transitions route to the Queue channel.
     * The merge queue has its own dedicated channel for UI separation.
     */
    it("should broadcast merge queue transitions to Queue channel", () => {
      const event: DomainEvent = {
        type: "merge-queue-item.transitioned",
        entityType: "merge-queue-item",
        entityId: "merge-001",
        fromStatus: MergeQueueItemStatus.ENQUEUED,
        toStatus: MergeQueueItemStatus.PREPARING,
        actor: { type: "system", id: "merge-coordinator" },
        timestamp: new Date("2026-03-12T05:30:00.000Z"),
      };

      adapter.emit(event);

      expect(mockServer.emitCalls).toHaveLength(2);
      expect(mockServer.emitCalls[0]!.room).toBe("queue:merge-001");
      expect(mockServer.emitCalls[1]!.room).toBe(EventChannel.Queue);
      expect(mockServer.emitCalls[0]!.data.type).toBe("merge_queue_item.state_changed");
    });
  });

  describe("error handling", () => {
    /**
     * Validates the critical safety property: the adapter MUST NOT throw
     * even when the broadcaster fails. The state transition has already
     * been committed to the database — throwing here would propagate an
     * error back to the caller for a side effect that cannot be rolled back.
     */
    it("should not throw when broadcaster throws", () => {
      vi.spyOn(broadcaster, "broadcastToEntity").mockImplementation(() => {
        throw new Error("socket.io exploded");
      });

      expect(() => adapter.emit(createTaskTransitionedEvent())).not.toThrow();
    });

    /**
     * Validates that events with unknown entity types are silently skipped.
     * This provides forward compatibility if new entity types are added
     * to the domain layer before the WebSocket channel mapping is updated.
     */
    it("should skip unknown entity types without throwing", () => {
      const event = {
        type: "unknown.transitioned",
        entityType: "unknown-entity",
        entityId: "unk-001",
        actor: { type: "system", id: "test" },
        timestamp: new Date(),
      } as unknown as DomainEvent;

      expect(() => adapter.emit(event)).not.toThrow();
      expect(mockServer.emitCalls).toHaveLength(0);
    });

    /**
     * Validates that the adapter handles server-not-ready gracefully.
     * During application startup, the WebSocket server may not be
     * initialized yet. Events emitted during this window should be
     * silently dropped.
     */
    it("should handle server not ready gracefully", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Server type requires full socket.io initialization
      gateway.server = undefined as any;

      expect(() => adapter.emit(createTaskTransitionedEvent())).not.toThrow();
    });
  });

  describe("event type mapping", () => {
    /**
     * Validates that all known domain event types are correctly mapped
     * to their WebSocket counterparts. This is a completeness check
     * to catch missing mappings when new domain events are added.
     */
    it("should map all known domain event types", () => {
      const events: DomainEvent[] = [
        createTaskTransitionedEvent(),
        {
          type: "task-lease.transitioned",
          entityType: "task-lease",
          entityId: "l-1",
          fromStatus: WorkerLeaseStatus.IDLE,
          toStatus: WorkerLeaseStatus.LEASED,
          actor: { type: "system", id: "s" },
          timestamp: new Date(),
        },
        {
          type: "review-cycle.transitioned",
          entityType: "review-cycle",
          entityId: "r-1",
          fromStatus: ReviewCycleStatus.NOT_STARTED,
          toStatus: ReviewCycleStatus.ROUTED,
          actor: { type: "system", id: "s" },
          timestamp: new Date(),
        },
        {
          type: "merge-queue-item.transitioned",
          entityType: "merge-queue-item",
          entityId: "m-1",
          fromStatus: MergeQueueItemStatus.ENQUEUED,
          toStatus: MergeQueueItemStatus.PREPARING,
          actor: { type: "system", id: "s" },
          timestamp: new Date(),
        },
      ];

      const expectedTypes = [
        "task.state_changed",
        "task_lease.state_changed",
        "review_cycle.state_changed",
        "merge_queue_item.state_changed",
      ];

      for (let i = 0; i < events.length; i++) {
        mockServer.emitCalls.length = 0;
        adapter.emit(events[i]!);
        expect(mockServer.emitCalls[0]!.data.type).toBe(expectedTypes[i]);
      }
    });

    /**
     * Validates that unmapped event types fall back to the original
     * domain event type string. This prevents silent data loss if a
     * new event type is added without updating the mapping.
     */
    it("should fall back to original type for unmapped event types", () => {
      const event: DomainEvent = {
        type: "worker.status-changed",
        entityType: "worker",
        entityId: "w-1",
        fromStatus: "starting" as never,
        toStatus: "running" as never,
        actor: { type: "system", id: "supervisor" },
        timestamp: new Date(),
      };

      adapter.emit(event);

      expect(mockServer.emitCalls[0]!.data.type).toBe("worker.status_changed");
    });
  });

  describe("T088 enrichment broadcasting", () => {
    /**
     * Validates that worker status change events trigger a pool summary
     * broadcast via QueueWorkerEventsService. This keeps the pool
     * monitoring panel updated when any worker in a pool changes state.
     */
    it("should trigger pool summary on worker status change", () => {
      const event: DomainEvent = {
        type: "worker.status-changed",
        entityType: "worker",
        entityId: "w-1",
        fromStatus: "idle" as never,
        toStatus: "running" as never,
        actor: { type: "system", id: "supervisor" },
        timestamp: new Date(),
      };

      adapter.emit(event);

      expect(mockQueueWorkerEvents.broadcastPoolSummary).toHaveBeenCalledWith("w-1");
    });

    /**
     * Validates that merge queue item transitions trigger a merge queue
     * position broadcast. This keeps the merge queue view updated when
     * items are enqueued, dequeued, or change status.
     */
    it("should trigger merge queue update on merge queue item transition", () => {
      const event: DomainEvent = {
        type: "merge-queue-item.transitioned",
        entityType: "merge-queue-item",
        entityId: "mqi-1",
        fromStatus: MergeQueueItemStatus.ENQUEUED,
        toStatus: MergeQueueItemStatus.PREPARING,
        actor: { type: "system", id: "merge-coordinator" },
        timestamp: new Date(),
      };

      adapter.emit(event);

      expect(mockQueueWorkerEvents.broadcastMergeQueueUpdate).toHaveBeenCalledWith("mqi-1");
    });

    /**
     * Validates that task events do NOT trigger enrichment broadcasts.
     * Pool summaries and merge queue updates are only relevant for
     * worker and merge-queue-item entity types.
     */
    it("should not trigger enrichment for task events", () => {
      adapter.emit(createTaskTransitionedEvent());

      expect(mockQueueWorkerEvents.broadcastPoolSummary).not.toHaveBeenCalled();
      expect(mockQueueWorkerEvents.broadcastMergeQueueUpdate).not.toHaveBeenCalled();
    });

    /**
     * Validates that enrichment failures do not prevent the primary
     * domain event from being broadcast. Enrichment is supplementary —
     * the entity-level event is the critical path.
     */
    it("should not fail if enrichment throws", () => {
      vi.mocked(mockQueueWorkerEvents.broadcastPoolSummary).mockImplementation(() => {
        throw new Error("enrichment exploded");
      });

      const event: DomainEvent = {
        type: "worker.status-changed",
        entityType: "worker",
        entityId: "w-1",
        fromStatus: "idle" as never,
        toStatus: "running" as never,
        actor: { type: "system", id: "supervisor" },
        timestamp: new Date(),
      };

      // Should not throw and primary event should still be broadcast
      expect(() => adapter.emit(event)).not.toThrow();
      expect(mockServer.emitCalls.length).toBeGreaterThan(0);
      expect(mockServer.emitCalls[0]!.data.type).toBe("worker.status_changed");
    });

    /**
     * Validates that the adapter works correctly when QueueWorkerEventsService
     * is not available via ModuleRef. This supports environments where the
     * service is not registered.
     */
    it("should work without QueueWorkerEventsService", () => {
      const mockModuleRef = createMockModuleRef(undefined);
      const adapterWithoutEnrichment = new DomainEventBroadcasterAdapter(
        broadcaster,
        mockModuleRef,
      );
      adapterWithoutEnrichment.onModuleInit();

      const event: DomainEvent = {
        type: "worker.status-changed",
        entityType: "worker",
        entityId: "w-1",
        fromStatus: "idle" as never,
        toStatus: "running" as never,
        actor: { type: "system", id: "supervisor" },
        timestamp: new Date(),
      };

      expect(() => adapterWithoutEnrichment.emit(event)).not.toThrow();
      expect(mockServer.emitCalls.length).toBeGreaterThan(0);
    });
  });
});
