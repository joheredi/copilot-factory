/**
 * Service for broadcasting queue and worker status events via WebSocket.
 *
 * Provides higher-level event broadcasting on top of the low-level
 * {@link EventBroadcasterService}: heartbeat throttling, pool aggregate
 * summaries, merge queue position updates, and periodic job queue
 * depth gauges.
 *
 * This service is called by the {@link DomainEventBroadcasterAdapter} after
 * individual domain events are broadcast, and by future heartbeat handlers
 * for throttled heartbeat delivery. It also runs an autonomous polling loop
 * for queue depth metrics.
 *
 * @see docs/backlog/tasks/T088-queue-worker-events.md
 * @see docs/prd/007-technical-architecture.md §7.7 — Event architecture
 * @module @factory/control-plane/events
 */
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";

import { createLogger } from "@factory/observability";
import type { Logger } from "@factory/observability";

import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import { createWorkerRepository } from "../infrastructure/repositories/worker.repository.js";
import { createJobRepository } from "../infrastructure/repositories/job.repository.js";
import { createMergeQueueItemRepository } from "../infrastructure/repositories/merge-queue-item.repository.js";

import { EventBroadcasterService } from "./event-broadcaster.service.js";
import { EventChannel } from "./types.js";

/**
 * Snapshot of a worker's pool membership, used by {@link broadcastPoolSummary}
 * to compute aggregate pool statistics after a worker status change.
 */
interface WorkerPoolSnapshot {
  /** The pool this worker belongs to. */
  poolId: string;
  /** All workers currently registered in the pool. */
  poolWorkers: Array<{ status: string }>;
}

/**
 * Snapshot of a merge queue for a repository, used by {@link broadcastMergeQueueUpdate}
 * to broadcast current queue positions after an item changes.
 */
interface MergeQueueSnapshot {
  /** Repository whose merge queue changed. */
  repositoryId: string;
  /** All merge queue items for the repository, ordered by position. */
  items: Array<{
    mergeQueueItemId: string;
    taskId: string;
    position: number;
    status: string;
  }>;
}

/**
 * Snapshot of pending job counts by type, used by {@link broadcastQueueDepths}
 * to broadcast the current queue depth gauge.
 */
interface QueueDepthSnapshot {
  /** Pending job count per job type. */
  depths: Record<string, number>;
  /** Total pending jobs across all types. */
  totalPending: number;
}

/**
 * Broadcasts aggregate worker pool and queue status events via WebSocket.
 *
 * Complements the {@link DomainEventBroadcasterAdapter} which handles
 * individual entity-level domain events. This service adds:
 *
 * 1. **Heartbeat throttling** — limits heartbeat broadcasts to at most
 *    once per {@link HEARTBEAT_THROTTLE_MS} per worker to prevent flooding.
 * 2. **Pool summaries** — broadcasts aggregate pool stats (worker counts
 *    by status) when any worker in the pool changes status.
 * 3. **Merge queue positions** — broadcasts the full ordered queue for
 *    a repository when any item changes.
 * 4. **Queue depth gauge** — periodically polls pending job counts by
 *    type and broadcasts as a gauge metric.
 */
@Injectable()
export class QueueWorkerEventsService implements OnModuleInit, OnModuleDestroy {
  /** Minimum milliseconds between heartbeat broadcasts for the same worker. */
  static readonly HEARTBEAT_THROTTLE_MS = 5_000;

  /** Milliseconds between queue depth gauge broadcasts. */
  static readonly QUEUE_DEPTH_INTERVAL_MS = 5_000;

  /** Prune throttle entries older than this many milliseconds. */
  static readonly THROTTLE_CLEANUP_AGE_MS = 30_000;

  /** Milliseconds to batch output events before broadcasting. */
  static readonly OUTPUT_BATCH_INTERVAL_MS = 200;

  private readonly logger: Logger;

  /**
   * Tracks the last heartbeat broadcast timestamp per worker ID.
   * Entries are pruned during the periodic queue depth polling cycle.
   */
  private readonly heartbeatLastBroadcast = new Map<string, number>();

  /** Pending output batches per worker, flushed after OUTPUT_BATCH_INTERVAL_MS. */
  private readonly outputBatches = new Map<
    string,
    {
      chunks: Array<{ stream: string; content: string; timestamp: string }>;
      timer: ReturnType<typeof setTimeout> | null;
    }
  >();

  /** Handle for the queue depth polling interval. */
  private queueDepthTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Database connection resolved lazily via ModuleRef in onModuleInit.
   *
   * Direct @Inject(DATABASE_CONNECTION) in the EventsModule causes NestJS
   * module compilation to hang (likely due to WebSocket gateway + DB provider
   * resolution ordering). Using ModuleRef.get avoids this by deferring
   * resolution until after the module tree is compiled.
   */
  private conn!: DatabaseConnection;

  constructor(
    @Inject(EventBroadcasterService) private readonly broadcaster: EventBroadcasterService,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {
    this.logger = createLogger("queue-worker-events");
  }

  /**
   * Start the queue depth polling interval on module initialization.
   *
   * Also resolves the database connection lazily via ModuleRef to avoid
   * DI resolution issues during module compilation.
   *
   * The interval runs every {@link QUEUE_DEPTH_INTERVAL_MS} and broadcasts
   * a gauge event with pending job counts grouped by job type.
   */
  onModuleInit(): void {
    this.conn = this.moduleRef.get("DATABASE_CONNECTION", { strict: false });
    this.startQueueDepthPolling();
    this.logger.info("Queue depth polling started", {
      intervalMs: QueueWorkerEventsService.QUEUE_DEPTH_INTERVAL_MS,
    });
  }

  /**
   * Stop the queue depth polling interval and clean up resources.
   */
  onModuleDestroy(): void {
    this.stopQueueDepthPolling();
    this.heartbeatLastBroadcast.clear();

    // Flush any pending output batches before shutdown
    for (const [workerId] of this.outputBatches) {
      this.flushOutputBatch(workerId);
    }
    this.outputBatches.clear();

    this.logger.info("Queue worker events service stopped");
  }

  /**
   * Broadcast a worker heartbeat event, throttled to prevent flooding.
   *
   * If the same worker's heartbeat was broadcast within the last
   * {@link HEARTBEAT_THROTTLE_MS} milliseconds, the broadcast is skipped.
   * This prevents overwhelming UI clients when workers send frequent
   * heartbeats (e.g., every second).
   *
   * @param workerId - Worker that sent the heartbeat
   * @param data - Heartbeat payload (leaseId, heartbeatAt, status, etc.)
   * @returns `true` if the event was broadcast, `false` if throttled
   */
  broadcastHeartbeat(workerId: string, data: Record<string, unknown>): boolean {
    const now = this.getNow();
    const lastBroadcast = this.heartbeatLastBroadcast.get(workerId) ?? 0;

    if (now - lastBroadcast < QueueWorkerEventsService.HEARTBEAT_THROTTLE_MS) {
      this.logger.debug("Heartbeat broadcast throttled", { workerId });
      return false;
    }

    this.heartbeatLastBroadcast.set(workerId, now);

    try {
      this.broadcaster.broadcastToEntity(EventChannel.Workers, workerId, {
        type: "worker.heartbeat",
        data: { workerId, ...data },
      });
      return true;
    } catch (error: unknown) {
      this.logger.error("Failed to broadcast heartbeat event", {
        workerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Broadcast an aggregate pool summary after a worker status change.
   *
   * Queries all workers in the affected pool, computes a status breakdown,
   * and broadcasts the summary to the Workers channel on the pool's
   * entity room. UI clients subscribed to a pool's room receive live
   * pool health updates without polling.
   *
   * @param workerId - Worker whose status changed (used to look up pool)
   */

  /**
   * Broadcast worker output (stdout/stderr) to subscribed clients.
   *
   * Batches output within {@link OUTPUT_BATCH_INTERVAL_MS} to avoid flooding
   * WebSocket connections with per-character output events.
   *
   * @param workerId - Worker producing the output
   * @param stream - Output stream type ("stdout" or "stderr")
   * @param content - Output content
   * @param timestamp - ISO 8601 timestamp of the output
   */
  broadcastWorkerOutput(
    workerId: string,
    stream: string,
    content: string,
    timestamp: string,
  ): void {
    let batch = this.outputBatches.get(workerId);
    if (!batch) {
      batch = { chunks: [], timer: null };
      this.outputBatches.set(workerId, batch);
    }

    batch.chunks.push({ stream, content, timestamp });

    if (!batch.timer) {
      batch.timer = setTimeout(() => {
        this.flushOutputBatch(workerId);
      }, QueueWorkerEventsService.OUTPUT_BATCH_INTERVAL_MS);
      batch.timer.unref();
    }
  }

  private flushOutputBatch(workerId: string): void {
    const batch = this.outputBatches.get(workerId);
    if (!batch || batch.chunks.length === 0) {
      this.outputBatches.delete(workerId);
      return;
    }

    try {
      this.broadcaster.broadcastToEntity(EventChannel.Workers, workerId, {
        type: "worker.output",
        data: {
          workerId,
          chunks: batch.chunks,
        },
      });
    } catch (error: unknown) {
      this.logger.error("Failed to broadcast worker output event", {
        workerId,
        chunkCount: batch.chunks.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.outputBatches.delete(workerId);
  }

  broadcastPoolSummary(workerId: string): void {
    try {
      const snapshot = this.getWorkerPoolSnapshot(workerId);
      if (!snapshot) {
        this.logger.debug("Worker not found or has no pool, skipping pool summary", { workerId });
        return;
      }

      const byStatus: Record<string, number> = {};
      for (const w of snapshot.poolWorkers) {
        byStatus[w.status] = (byStatus[w.status] ?? 0) + 1;
      }

      this.broadcaster.broadcastToEntity(EventChannel.Workers, snapshot.poolId, {
        type: "pool.summary_updated",
        data: {
          poolId: snapshot.poolId,
          totalWorkers: snapshot.poolWorkers.length,
          activeWorkers: byStatus["busy"] ?? 0,
          byStatus,
        },
      });

      this.logger.debug("Pool summary broadcast", {
        poolId: snapshot.poolId,
        totalWorkers: snapshot.poolWorkers.length,
      });
    } catch (error: unknown) {
      this.logger.error("Failed to broadcast pool summary", {
        workerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Broadcast updated merge queue positions after an item changes.
   *
   * Queries all items for the affected repository's merge queue and
   * broadcasts the full ordered list to the Queue channel. UI clients
   * receive the complete queue state to update position displays.
   *
   * @param mergeQueueItemId - Merge queue item that changed
   */
  broadcastMergeQueueUpdate(mergeQueueItemId: string): void {
    try {
      const snapshot = this.getMergeQueueSnapshot(mergeQueueItemId);
      if (!snapshot) {
        this.logger.debug("Merge queue item not found, skipping position broadcast", {
          mergeQueueItemId,
        });
        return;
      }

      this.broadcaster.broadcastToChannel(EventChannel.Queue, {
        type: "merge_queue.positions_updated",
        data: {
          repositoryId: snapshot.repositoryId,
          items: snapshot.items,
        },
      });

      this.logger.debug("Merge queue positions broadcast", {
        repositoryId: snapshot.repositoryId,
        itemCount: snapshot.items.length,
      });
    } catch (error: unknown) {
      this.logger.error("Failed to broadcast merge queue positions", {
        mergeQueueItemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Broadcast current job queue depths as a gauge metric.
   *
   * Queries all PENDING jobs, groups by job type, and broadcasts a
   * single gauge event to the Queue channel. Called periodically by the
   * polling interval and can also be called on demand.
   */
  broadcastQueueDepths(): void {
    try {
      const snapshot = this.getQueueDepthSnapshot();

      this.broadcaster.broadcastToChannel(EventChannel.Queue, {
        type: "queue.depth_updated",
        data: {
          depths: snapshot.depths,
          totalPending: snapshot.totalPending,
        },
      });

      this.logger.debug("Queue depth gauge broadcast", {
        totalPending: snapshot.totalPending,
      });
    } catch (error: unknown) {
      this.logger.error("Failed to broadcast queue depths", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Query the worker and its pool members for aggregate stats.
   *
   * Visible for testing — allows tests to spy on this method to avoid
   * requiring a real database.
   *
   * @param workerId - Worker to look up
   * @returns Pool snapshot or undefined if worker not found / has no pool
   */
  getWorkerPoolSnapshot(workerId: string): WorkerPoolSnapshot | undefined {
    const workerRepo = createWorkerRepository(this.conn.db);
    const worker = workerRepo.findById(workerId);
    if (!worker?.poolId) {
      return undefined;
    }

    const poolWorkers = workerRepo.findByPoolId(worker.poolId);
    return {
      poolId: worker.poolId,
      poolWorkers: poolWorkers.map((w) => ({ status: w.status })),
    };
  }

  /**
   * Query the merge queue items for a repository.
   *
   * Visible for testing — allows tests to spy on this method to avoid
   * requiring a real database.
   *
   * @param mergeQueueItemId - Item to look up
   * @returns Queue snapshot or undefined if item not found
   */
  getMergeQueueSnapshot(mergeQueueItemId: string): MergeQueueSnapshot | undefined {
    const repo = createMergeQueueItemRepository(this.conn.db);
    const item = repo.findById(mergeQueueItemId);
    if (!item) {
      return undefined;
    }

    const items = repo.findByRepositoryId(item.repositoryId);
    return {
      repositoryId: item.repositoryId,
      items: items.map((i) => ({
        mergeQueueItemId: i.mergeQueueItemId,
        taskId: i.taskId,
        position: i.position,
        status: i.status,
      })),
    };
  }

  /**
   * Query pending job counts grouped by type.
   *
   * Visible for testing — allows tests to spy on this method to avoid
   * requiring a real database.
   *
   * @returns Queue depth snapshot with counts by job type
   */
  getQueueDepthSnapshot(): QueueDepthSnapshot {
    const repo = createJobRepository(this.conn.db);
    const pendingJobs = repo.findByStatus("pending");

    const depths: Record<string, number> = {};
    for (const job of pendingJobs) {
      depths[job.jobType] = (depths[job.jobType] ?? 0) + 1;
    }

    return {
      depths,
      totalPending: pendingJobs.length,
    };
  }

  /**
   * Get current timestamp in milliseconds. Overridable for testing.
   * @returns Current time in milliseconds since epoch
   */
  getNow(): number {
    return Date.now();
  }

  /**
   * Start the periodic queue depth polling loop.
   *
   * Each tick broadcasts queue depths and prunes stale throttle entries.
   */
  private startQueueDepthPolling(): void {
    this.queueDepthTimer = setInterval(() => {
      try {
        this.broadcastQueueDepths();
        this.cleanupThrottleMap();
      } catch {
        // Polling failures must not crash the service
      }
    }, QueueWorkerEventsService.QUEUE_DEPTH_INTERVAL_MS);

    // Allow Node.js to exit even if this interval is still running.
    // Without unref(), the timer would keep the event loop alive and
    // block graceful shutdown in tests and during application teardown.
    if (this.queueDepthTimer.unref) {
      this.queueDepthTimer.unref();
    }
  }

  /**
   * Stop the periodic queue depth polling loop.
   */
  private stopQueueDepthPolling(): void {
    if (this.queueDepthTimer) {
      clearInterval(this.queueDepthTimer);
      this.queueDepthTimer = null;
    }
  }

  /**
   * Remove stale entries from the heartbeat throttle map.
   *
   * Entries older than {@link THROTTLE_CLEANUP_AGE_MS} are removed to
   * prevent unbounded memory growth from workers that have disconnected.
   */
  private cleanupThrottleMap(): void {
    const cutoff = this.getNow() - QueueWorkerEventsService.THROTTLE_CLEANUP_AGE_MS;
    for (const [workerId, timestamp] of this.heartbeatLastBroadcast) {
      if (timestamp < cutoff) {
        this.heartbeatLastBroadcast.delete(workerId);
      }
    }
  }
}
