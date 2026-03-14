/**
 * Background automation runtime for task readiness, scheduling, and worker dispatch.
 *
 * This service is the glue between the control-plane NestJS process and the
 * application-layer orchestration services. It periodically:
 *
 * - reconciles waiting tasks from `BACKLOG` / `BLOCKED` into `READY` / `BLOCKED`
 * - seeds the recurring scheduler tick job on startup
 * - processes scheduler ticks so eligible `READY` tasks become `ASSIGNED`
 * - dispatches `WORKER_DISPATCH` jobs to spawn ephemeral worker processes
 *
 * Worker dispatch is fire-and-forget: each dispatch runs asynchronously and
 * does not block the synchronous `runCycle()`. Active dispatches are tracked
 * so the service can await in-flight work during shutdown.
 *
 * @module @factory/control-plane/automation
 */

import { randomUUID } from "node:crypto";

import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import {
  EntityNotFoundError,
  InvalidTransitionError,
  VersionConflictError,
  createJobQueueService,
  createLeaseService,
  createReadinessService,
  createSchedulerService,
  createSchedulerTickService,
  createTransitionService,
  createWorkerDispatchService,
  createWorkerSupervisorService,
  createHeartbeatService,
  type DomainEventEmitter,
  type InitializeTickResult,
  type ProcessTickResult,
  type ProcessDispatchResult,
  type ReadinessResult,
  type WorkerDispatchService,
} from "@factory/application";
import { TaskStatus, type TransitionContext } from "@factory/domain";
import { createLogger } from "@factory/observability";
import type { Logger } from "@factory/observability";

import { DomainEventBroadcasterAdapter } from "../events/domain-event-broadcaster.adapter.js";
import { DATABASE_CONNECTION } from "../infrastructure/database/database.module.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import { createSqliteUnitOfWork } from "../infrastructure/unit-of-work/sqlite-unit-of-work.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import {
  createJobQueueUnitOfWork,
  createLeaseUnitOfWork,
  createReadinessUnitOfWork,
  createSchedulerTickUnitOfWork,
  createSchedulerUnitOfWork,
  createWorkerDispatchUnitOfWork,
  createWorkerSupervisorUnitOfWork,
  createHeartbeatUnitOfWork,
} from "./application-adapters.js";
import { createHeartbeatForwarderAdapter } from "./heartbeat-forwarder-adapter.js";
import {
  createInfrastructureAdapters,
  resolveInfrastructureConfig,
} from "./infrastructure-adapters.js";

export interface ReadinessReconciliationResult {
  readonly evaluatedCount: number;
  readonly transitionedToReady: number;
  readonly transitionedToBlocked: number;
}

const AUTOMATION_ACTOR = {
  type: "system",
  id: "automation-runtime",
} as const;

@Injectable()
export class AutomationService implements OnModuleInit, OnModuleDestroy {
  static readonly POLL_INTERVAL_MS = 1_000;
  static readonly SCHEDULER_TICK_INTERVAL_MS = 1_000;

  private readonly logger: Logger;
  private readonly transitionService;
  private readonly readinessService;
  private readonly schedulerTickService;
  private readonly workerDispatchService: WorkerDispatchService;
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Global factory pause flag. When true, `runCycle()` skips readiness
   * reconciliation, scheduler ticks, and worker dispatch — effectively
   * stopping the production line. Active workers already dispatched
   * continue to completion.
   *
   * Starts paused by default so the operator must explicitly start the
   * factory after reviewing the imported backlog.
   */
  private _paused = true;

  /** Returns the current factory running state. */
  get paused(): boolean {
    return this._paused;
  }

  /** Resume the factory production line. */
  start(): void {
    if (!this._paused) return;
    this._paused = false;
    this.logger.info("Factory production line started");
  }

  /** Pause the factory — stops scheduling new tasks but active workers continue. */
  pause(): void {
    if (this._paused) return;
    this._paused = true;
    this.logger.info("Factory production line paused");
  }

  /**
   * Tracks in-flight dispatch promises so we can await them during shutdown
   * and report concurrency in logs.
   */
  private readonly activeDispatches: Set<Promise<ProcessDispatchResult>> = new Set();

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly conn: DatabaseConnection,
    @Inject(DomainEventBroadcasterAdapter) eventEmitter: DomainEventEmitter,
  ) {
    this.logger = createLogger("automation-runtime");

    this.transitionService = createTransitionService(createSqliteUnitOfWork(conn), eventEmitter);
    this.readinessService = createReadinessService(createReadinessUnitOfWork(conn));

    const jobQueueService = createJobQueueService(createJobQueueUnitOfWork(conn), randomUUID);
    const leaseService = createLeaseService(createLeaseUnitOfWork(conn), eventEmitter, randomUUID);
    const schedulerService = createSchedulerService(
      createSchedulerUnitOfWork(conn),
      leaseService,
      jobQueueService,
      randomUUID,
    );

    this.schedulerTickService = createSchedulerTickService(
      {
        unitOfWork: createSchedulerTickUnitOfWork(conn),
        jobQueueService,
        schedulerService,
        clock: () => new Date(),
      },
      {
        tickIntervalMs: AutomationService.SCHEDULER_TICK_INTERVAL_MS,
      },
    );

    // ── Worker dispatch chain ──────────────────────────────────────────────
    // HeartbeatService → HeartbeatForwarder → InfraAdapters → SupervisorService → DispatchService
    const clock = () => new Date();

    const heartbeatService = createHeartbeatService(
      createHeartbeatUnitOfWork(conn),
      eventEmitter,
      clock,
    );

    const heartbeatForwarder = createHeartbeatForwarderAdapter({ heartbeatService });

    const infraConfig = resolveInfrastructureConfig();
    const { workspaceProvider, packetMounter, runtimeAdapter } =
      createInfrastructureAdapters(infraConfig);

    const workerSupervisorService = createWorkerSupervisorService({
      unitOfWork: createWorkerSupervisorUnitOfWork(conn),
      eventEmitter,
      workspaceProvider,
      packetMounter,
      runtimeAdapter,
      heartbeatForwarder,
      leaseTransitioner: {
        transitionLease: (leaseId, targetStatus, context) => {
          this.transitionService.transitionLease(leaseId, targetStatus, context, AUTOMATION_ACTOR);
        },
      },
      clock,
    });

    this.workerDispatchService = createWorkerDispatchService({
      unitOfWork: createWorkerDispatchUnitOfWork(conn),
      jobQueueService,
      workerSupervisorService,
      clock,
    });
  }

  onModuleInit(): void {
    const initializeResult = this.initializeSchedulerTick();
    this.runCycle();
    this.startPolling();

    this.logger.info("Automation runtime started", {
      pollIntervalMs: AutomationService.POLL_INTERVAL_MS,
      schedulerTickIntervalMs: AutomationService.SCHEDULER_TICK_INTERVAL_MS,
      seededSchedulerTick: initializeResult.created,
    });
  }

  onModuleDestroy(): void {
    this.stopPolling();

    // Best-effort drain: log if there are in-flight dispatches but do not
    // block module teardown indefinitely — NestJS shutdown hooks are sync.
    if (this.activeDispatches.size > 0) {
      this.logger.info("Automation runtime stopping with active dispatches", {
        activeDispatchCount: this.activeDispatches.size,
      });
    }

    this.logger.info("Automation runtime stopped");
  }

  initializeSchedulerTick(): InitializeTickResult {
    return this.schedulerTickService.initialize();
  }

  reconcileTaskReadiness(): ReadinessReconciliationResult {
    const taskRepo = createTaskRepository(this.conn.db);
    const candidates = [
      ...taskRepo.findByStatus(TaskStatus.BACKLOG),
      ...taskRepo.findByStatus(TaskStatus.BLOCKED),
    ];

    let transitionedToReady = 0;
    let transitionedToBlocked = 0;

    for (const task of candidates) {
      const readiness = this.readinessService.computeReadiness(task.taskId);

      if (task.status === TaskStatus.BACKLOG && readiness.status === "READY") {
        if (
          this.tryTransitionTask(
            task.taskId,
            TaskStatus.READY,
            { allDependenciesResolved: true, hasPolicyBlockers: false },
            readiness,
          )
        ) {
          transitionedToReady++;
        }
        continue;
      }

      if (task.status === TaskStatus.BACKLOG && readiness.status === "BLOCKED") {
        if (
          this.tryTransitionTask(task.taskId, TaskStatus.BLOCKED, { hasBlockers: true }, readiness)
        ) {
          transitionedToBlocked++;
        }
        continue;
      }

      if (task.status === TaskStatus.BLOCKED && readiness.status === "READY") {
        if (
          this.tryTransitionTask(
            task.taskId,
            TaskStatus.READY,
            { allDependenciesResolved: true, hasPolicyBlockers: false },
            readiness,
          )
        ) {
          transitionedToReady++;
        }
      }
    }

    return {
      evaluatedCount: candidates.length,
      transitionedToReady,
      transitionedToBlocked,
    };
  }

  processSchedulerTick(): ProcessTickResult {
    return this.schedulerTickService.processTick();
  }

  /**
   * Fire-and-forget dispatch: dequeues a WORKER_DISPATCH job and spawns a
   * worker process via the supervisor. The returned promise is tracked in
   * `activeDispatches` so we can log concurrency and drain on shutdown.
   *
   * Errors are caught and logged — they never propagate to `runCycle()`.
   */
  processWorkerDispatches(): void {
    const promise = this.workerDispatchService.processDispatch();

    this.activeDispatches.add(promise);

    promise
      .then((result) => {
        if (result.processed) {
          if (result.dispatched) {
            this.logger.info("Worker dispatch succeeded", {
              jobId: result.jobId,
              taskId: result.taskId,
              workerId: result.workerId,
            });
          } else {
            this.logger.warn("Worker dispatch failed", {
              jobId: result.jobId,
              taskId: result.taskId,
              reason: result.reason,
              error: result.error,
            });
          }
        }
      })
      .catch((error: unknown) => {
        this.logger.error("Worker dispatch unexpected error", {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.activeDispatches.delete(promise);
      });
  }

  private runCycle(): void {
    if (this._paused) return;

    try {
      const readiness = this.reconcileTaskReadiness();
      const tickResult = this.processSchedulerTick();

      // Fire-and-forget: dispatches run asynchronously and do not block
      // the synchronous automation cycle.
      this.processWorkerDispatches();

      if (
        readiness.transitionedToReady > 0 ||
        readiness.transitionedToBlocked > 0 ||
        (tickResult.processed && tickResult.summary.assignmentCount > 0)
      ) {
        this.logger.info("Automation cycle made progress", {
          evaluatedTasks: readiness.evaluatedCount,
          transitionedToReady: readiness.transitionedToReady,
          transitionedToBlocked: readiness.transitionedToBlocked,
          schedulerProcessed: tickResult.processed,
          assignments: tickResult.processed ? tickResult.summary.assignmentCount : 0,
          activeDispatches: this.activeDispatches.size,
        });
      }
    } catch (error: unknown) {
      this.logger.error("Automation cycle failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private startPolling(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.runCycle();
    }, AutomationService.POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  private tryTransitionTask(
    taskId: string,
    targetStatus: TaskStatus,
    context: TransitionContext,
    readiness: ReadinessResult,
  ): boolean {
    try {
      this.transitionService.transitionTask(taskId, targetStatus, context, AUTOMATION_ACTOR, {
        triggeredBy: "automation-runtime",
        readinessStatus: readiness.status,
      });
      return true;
    } catch (error: unknown) {
      if (
        error instanceof EntityNotFoundError ||
        error instanceof InvalidTransitionError ||
        error instanceof VersionConflictError
      ) {
        this.logger.debug("Skipped readiness transition", {
          taskId,
          targetStatus,
          error: error.message,
        });
        return false;
      }

      throw error;
    }
  }
}
