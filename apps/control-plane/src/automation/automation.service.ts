/**
 * Background automation runtime for task readiness and scheduler ticks.
 *
 * This service is the glue between the control-plane NestJS process and the
 * application-layer orchestration services. It periodically:
 *
 * - reconciles waiting tasks from `BACKLOG` / `BLOCKED` into `READY` / `BLOCKED`
 * - seeds the recurring scheduler tick job on startup
 * - processes scheduler ticks so eligible `READY` tasks become `ASSIGNED`
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
  type DomainEventEmitter,
  type InitializeTickResult,
  type ProcessTickResult,
  type ReadinessResult,
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
} from "./application-adapters.js";

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
  private timer: ReturnType<typeof setInterval> | null = null;

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

  private runCycle(): void {
    try {
      const readiness = this.reconcileTaskReadiness();
      const tickResult = this.processSchedulerTick();

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
