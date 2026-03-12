/**
 * Tests for OpenTelemetry span instrumentation across orchestration services.
 *
 * These tests verify that each service correctly creates, attributes, and
 * finalises OTel spans so that production traces are accurate and actionable.
 * Business-logic correctness is covered by each service's own test suite;
 * here we focus exclusively on observability contracts.
 *
 * @module @factory/application/services/orchestration-spans.test
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import {
  initTracing,
  getTracer,
  SpanStatusCode,
  SpanNames,
  SpanAttributes,
  InMemorySpanExporter,
} from "@factory/observability";
import type { TracingHandle } from "@factory/observability";
import {
  TaskStatus,
  WorkerLeaseStatus,
  JobType,
  TaskPriority,
  WorkerPoolType,
} from "@factory/domain";
// ── Service factories ────────────────────────────────────────────────────────
import { createTransitionService } from "./transition.service.js";
import { createSchedulerService } from "./scheduler.service.js";
import { createHeartbeatService } from "./heartbeat.service.js";
import { createReviewRouterService } from "./review-router.service.js";
import { createValidationRunnerService } from "./validation-runner.service.js";

// ── Shared tracing setup ─────────────────────────────────────────────────────
// We initialise the global OTel provider once for the whole file. Calling
// shutdown() between tests would destroy the provider and leave module-level
// tracers (created via `getTracer()` at import time) pointing at a no-op.
// Instead, we reset the exporter between tests to get a clean span list.

let handle: TracingHandle | undefined;
const exporter = new InMemorySpanExporter();

beforeAll(() => {
  handle = initTracing({
    enableOtlpExporter: false,
    enableConsoleExporter: false,
    enableHttpInstrumentation: false,
    additionalExporters: [exporter],
  });
});

beforeEach(() => {
  exporter.reset();
});

afterAll(async () => {
  if (handle) {
    await handle.shutdown();
    handle = undefined;
  }
});

// ── Shared actor constant ────────────────────────────────────────────────────

const SYSTEM_ACTOR = { type: "system", id: "test" } as const;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. TransitionService — task.transition span
// ═══════════════════════════════════════════════════════════════════════════════

describe("TransitionService spans", () => {
  /**
   * Builds a minimal UnitOfWork + EventEmitter pair that satisfies the
   * transition service's dependency contract for a READY → ASSIGNED transition.
   */
  function buildTransitionDeps(task?: { id: string; status: string; version: number }) {
    const stored = task ?? {
      id: "task-1",
      status: TaskStatus.READY,
      version: 1,
    };

    const unitOfWork = {
      runInTransaction<T>(fn: (repos: any) => T): T {
        return fn({
          task: {
            findById: (id: string) => (id === stored.id ? { ...stored } : undefined),
            updateStatus: (id: string, expectedVersion: number, newStatus: string) => ({
              id,
              status: newStatus,
              version: expectedVersion + 1,
            }),
          },
          auditEvent: {
            create: (input: any) => ({ id: "audit-1", ...input, createdAt: new Date() }),
          },
        });
      },
    };

    const eventEmitter = { emit: vi.fn() };
    return { unitOfWork, eventEmitter };
  }

  /** Verifies that a successful transition emits a span with the correct name and attributes. */
  it("creates a span with correct name and attributes on success", () => {
    const { unitOfWork, eventEmitter } = buildTransitionDeps();
    const service = createTransitionService(unitOfWork as any, eventEmitter);

    service.transitionTask("task-1", TaskStatus.ASSIGNED, { leaseAcquired: true }, SYSTEM_ACTOR);

    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name === SpanNames.TASK_TRANSITION);

    expect(span).toBeDefined();
    expect(span!.attributes[SpanAttributes.TASK_ID]).toBe("task-1");
    expect(span!.attributes[SpanAttributes.TASK_STATE_TO]).toBe(TaskStatus.ASSIGNED);
    expect(span!.attributes[SpanAttributes.TASK_STATE_FROM]).toBe(TaskStatus.READY);
    expect(span!.status.code).toBe(SpanStatusCode.OK);
  });

  /** Verifies that a failed transition sets ERROR status and still ends the span. */
  it("sets ERROR status when the transition throws", () => {
    const { unitOfWork, eventEmitter } = buildTransitionDeps();
    const service = createTransitionService(unitOfWork as any, eventEmitter);

    expect(() =>
      service.transitionTask(
        "nonexistent-task",
        TaskStatus.ASSIGNED,
        { leaseAcquired: true },
        SYSTEM_ACTOR,
      ),
    ).toThrow();

    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name === SpanNames.TASK_TRANSITION);

    expect(span).toBeDefined();
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
    expect(span!.status.message).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SchedulerService — task.assign span
// ═══════════════════════════════════════════════════════════════════════════════

describe("SchedulerService spans", () => {
  function buildSchedulerDeps(opts?: { noTasks?: boolean; noPools?: boolean }) {
    const tasks = opts?.noTasks
      ? []
      : [
          {
            taskId: "task-42",
            repositoryId: "repo-1",
            priority: TaskPriority.HIGH,
            status: TaskStatus.READY,
            requiredCapabilities: ["typescript"],
            createdAt: new Date(),
          },
        ];

    const pools = opts?.noPools
      ? []
      : [
          {
            poolId: "pool-dev",
            poolType: WorkerPoolType.DEVELOPER,
            capabilities: ["typescript", "react"],
            maxConcurrency: 5,
            activeLeaseCount: 0,
            defaultTimeoutSec: 300,
            enabled: true,
          },
        ];

    const unitOfWork = {
      runInTransaction<T>(fn: (repos: any) => T): T {
        return fn({
          task: { findReadyByPriority: () => tasks },
          pool: { findEnabledByType: () => pools },
        });
      },
    };

    const leaseService = {
      acquireLease: vi.fn().mockReturnValue({
        lease: {
          leaseId: "lease-1",
          taskId: "task-42",
          workerId: "w-1",
          poolId: "pool-dev",
          status: WorkerLeaseStatus.LEASED,
          leasedAt: new Date(),
          expiresAt: new Date(Date.now() + 300_000),
        },
        task: { id: "task-42", status: TaskStatus.ASSIGNED, version: 2 },
        auditEvent: { id: "audit-1" },
      }),
    };

    const jobQueueService = {
      createJob: vi.fn().mockReturnValue({
        job: {
          id: "job-1",
          jobType: JobType.WORKER_DISPATCH,
          status: "pending",
        },
      }),
    };

    return { unitOfWork, leaseService, jobQueueService };
  }

  /** Verifies that a successful assignment emits the task.assign span with key attributes. */
  it("creates a span with correct name and attributes on assignment", () => {
    const { unitOfWork, leaseService, jobQueueService } = buildSchedulerDeps();
    const service = createSchedulerService(
      unitOfWork as any,
      leaseService as any,
      jobQueueService as any,
      () => "w-1",
    );

    const result = service.scheduleNext();

    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name === SpanNames.TASK_ASSIGN);

    expect(span).toBeDefined();
    expect(span!.attributes[SpanAttributes.TASK_ID]).toBe("task-42");
    expect(span!.attributes[SpanAttributes.POOL_ID]).toBe("pool-dev");
    expect(span!.attributes[SpanAttributes.WORKER_ID]).toBe("w-1");
    expect(span!.attributes[SpanAttributes.RESULT_STATUS]).toBe("assigned");
    expect(span!.status.code).toBe(SpanStatusCode.OK);
    expect(result.assigned).toBe(true);
  });

  /** Verifies the span records a "no_ready_tasks" result when no tasks are available. */
  it("records no_ready_tasks result status when queue is empty", () => {
    const { unitOfWork, leaseService, jobQueueService } = buildSchedulerDeps({
      noTasks: true,
    });
    const service = createSchedulerService(
      unitOfWork as any,
      leaseService as any,
      jobQueueService as any,
      () => "w-1",
    );

    service.scheduleNext();

    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name === SpanNames.TASK_ASSIGN);

    expect(span).toBeDefined();
    expect(span!.attributes[SpanAttributes.RESULT_STATUS]).toBe("no_ready_tasks");
  });

  /** Verifies that an unexpected error sets ERROR span status. */
  it("sets ERROR status when an unexpected error is thrown", () => {
    const unitOfWork = {
      runInTransaction: () => {
        throw new Error("db failure");
      },
    };
    const service = createSchedulerService(unitOfWork as any, {} as any, {} as any, () => "w-1");

    expect(() => service.scheduleNext()).toThrow("db failure");

    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name === SpanNames.TASK_ASSIGN);

    expect(span).toBeDefined();
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
    expect(span!.status.message).toBe("db failure");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. HeartbeatService — worker.heartbeat span
// ═══════════════════════════════════════════════════════════════════════════════

describe("HeartbeatService spans", () => {
  function buildHeartbeatDeps(lease?: { leaseId: string; status: string }) {
    const stored = lease ?? {
      leaseId: "lease-1",
      taskId: "task-1",
      workerId: "worker-1",
      status: WorkerLeaseStatus.RUNNING,
      heartbeatAt: new Date(Date.now() - 10_000),
      expiresAt: new Date(Date.now() + 300_000),
      leasedAt: new Date(Date.now() - 60_000),
    };

    const unitOfWork = {
      runInTransaction<T>(fn: (repos: any) => T): T {
        return fn({
          lease: {
            findById: (id: string) => (id === stored.leaseId ? { ...stored } : undefined),
            updateHeartbeat: (
              _leaseId: string,
              _expectedStatus: string,
              newStatus: string,
              heartbeatAt: Date,
              newExpiresAt?: Date,
            ) => ({
              ...stored,
              status: newStatus,
              heartbeatAt,
              expiresAt: newExpiresAt ?? stored.expiresAt,
            }),
          },
          auditEvent: {
            create: (input: any) => ({
              id: "audit-hb-1",
              ...input,
              createdAt: new Date(),
            }),
          },
        });
      },
    };

    const eventEmitter = { emit: vi.fn() };
    const clock = () => new Date();
    return { unitOfWork, eventEmitter, clock };
  }

  /** Verifies that a heartbeat creates a span with lease.id and result.status attributes. */
  it("creates a span with correct name and attributes on success", () => {
    const { unitOfWork, eventEmitter, clock } = buildHeartbeatDeps();
    const service = createHeartbeatService(unitOfWork as any, eventEmitter, clock);

    service.receiveHeartbeat({
      leaseId: "lease-1",
      actor: SYSTEM_ACTOR,
    });

    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name === SpanNames.WORKER_HEARTBEAT);

    expect(span).toBeDefined();
    expect(span!.attributes["lease.id"]).toBe("lease-1");
    expect(span!.attributes[SpanAttributes.RESULT_STATUS]).toBeDefined();
    expect(span!.status.code).toBe(SpanStatusCode.OK);
  });

  /** Verifies that a heartbeat for a missing lease sets ERROR status on the span. */
  it("sets ERROR status when the lease is not found", () => {
    const { unitOfWork, eventEmitter, clock } = buildHeartbeatDeps();
    const service = createHeartbeatService(unitOfWork as any, eventEmitter, clock);

    expect(() =>
      service.receiveHeartbeat({
        leaseId: "nonexistent",
        actor: SYSTEM_ACTOR,
      }),
    ).toThrow();

    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name === SpanNames.WORKER_HEARTBEAT);

    expect(span).toBeDefined();
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ReviewRouterService — review.route span
// ═══════════════════════════════════════════════════════════════════════════════

describe("ReviewRouterService spans", () => {
  /** Verifies that routing creates a span with risk.level and result.status attributes. */
  it("creates a span with correct name and attributes on success", () => {
    const service = createReviewRouterService();

    service.routeReview({
      changedFilePaths: ["src/index.ts"],
      taskTags: ["bugfix"],
      riskLevel: "low",
      repositoryRequiredReviewers: [],
      routingConfig: { rules: [] },
    });

    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name === SpanNames.REVIEW_ROUTE);

    expect(span).toBeDefined();
    expect(span!.attributes["risk.level"]).toBe("low");
    expect(span!.attributes[SpanAttributes.RESULT_STATUS]).toBe("routed");
    expect(span!.status.code).toBe(SpanStatusCode.OK);
  });

  /** Verifies that an error in routing (e.g. bad config) sets ERROR status. */
  it("sets ERROR status when routing throws", () => {
    const service = createReviewRouterService();

    // Pass null to force an internal error
    expect(() => service.routeReview(null as any)).toThrow();

    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name === SpanNames.REVIEW_ROUTE);

    expect(span).toBeDefined();
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ValidationRunnerService — validation.run span
// ═══════════════════════════════════════════════════════════════════════════════

describe("ValidationRunnerService spans", () => {
  function buildValidationDeps(opts?: { shouldFail?: boolean }) {
    const executor = {
      executeCheck: vi.fn().mockImplementation(async (params: any) => ({
        checkName: params.checkName,
        command: params.command,
        status: opts?.shouldFail ? "failed" : "passed",
        durationMs: 42,
      })),
    };
    return { executor };
  }

  function validationPolicy(profileName: string) {
    return {
      profiles: {
        [profileName]: {
          required_checks: ["lint"],
          optional_checks: [],
          commands: { lint: "pnpm lint" },
          fail_on_skipped_required_check: true,
        },
      },
    };
  }

  /** Verifies that a successful validation run creates a span with task and profile attributes. */
  it("creates a span with correct name and attributes on success", async () => {
    const { executor } = buildValidationDeps();
    const service = createValidationRunnerService(executor as any);

    await service.runValidation({
      taskId: "task-v1",
      profileName: "ci",
      validationPolicy: validationPolicy("ci"),
      workspacePath: "/tmp/ws",
    });

    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name === SpanNames.VALIDATION_RUN);

    expect(span).toBeDefined();
    expect(span!.attributes[SpanAttributes.TASK_ID]).toBe("task-v1");
    expect(span!.attributes[SpanAttributes.VALIDATION_PROFILE]).toBe("ci");
    expect(span!.attributes[SpanAttributes.RESULT_STATUS]).toBeDefined();
    expect(span!.status.code).toBe(SpanStatusCode.OK);
  });

  /** Verifies that a missing profile causes ERROR status on the span. */
  it("sets ERROR status when the profile is missing", async () => {
    const { executor } = buildValidationDeps();
    const service = createValidationRunnerService(executor as any);

    await expect(
      service.runValidation({
        taskId: "task-v2",
        profileName: "nonexistent",
        validationPolicy: validationPolicy("ci"),
        workspacePath: "/tmp/ws",
      }),
    ).rejects.toThrow();

    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name === SpanNames.VALIDATION_RUN);

    expect(span).toBeDefined();
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
    expect(span!.status.message).toBeDefined();
  });

  /** Verifies that a validation with failed checks still completes with OK status. */
  it("records result status for failed checks without setting ERROR", async () => {
    const { executor } = buildValidationDeps({ shouldFail: true });
    const service = createValidationRunnerService(executor as any);

    const _result = await service.runValidation({
      taskId: "task-v3",
      profileName: "ci",
      validationPolicy: validationPolicy("ci"),
      workspacePath: "/tmp/ws",
    });

    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name === SpanNames.VALIDATION_RUN);

    expect(span).toBeDefined();
    expect(span!.attributes[SpanAttributes.RESULT_STATUS]).toBe("failed");
    // The span status is still OK — a "failed" validation is a normal business outcome
    expect(span!.status.code).toBe(SpanStatusCode.OK);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Parent-child span relationships
// ═══════════════════════════════════════════════════════════════════════════════

describe("Parent-child span relationships", () => {
  /**
   * Verifies that spans created inside an active parent context correctly
   * report the parent's span ID, enabling distributed-trace stitching.
   */
  it("child span references the parent span context", () => {
    const tracer = getTracer("test-parent-child");

    tracer.startActiveSpan("parent.operation", (parentSpan) => {
      const parentCtx = parentSpan.spanContext();

      tracer.startActiveSpan("child.operation", (childSpan) => {
        childSpan.setStatus({ code: SpanStatusCode.OK });
        childSpan.end();
      });

      parentSpan.setStatus({ code: SpanStatusCode.OK });
      parentSpan.end();

      const spans = exporter.getFinishedSpans();
      const child = spans.find((s) => s.name === "child.operation");
      const parent = spans.find((s) => s.name === "parent.operation");

      expect(parent).toBeDefined();
      expect(child).toBeDefined();
      // OTel v2 uses parentSpanContext (object) instead of parentSpanId (string)
      expect(child!.parentSpanContext?.spanId).toBe(parentCtx.spanId);
      expect(child!.parentSpanContext?.traceId).toBe(parentCtx.traceId);
    });
  });

  /**
   * Verifies that a service span inherits the parent context when called
   * inside an active span, enabling end-to-end trace correlation.
   */
  it("review router span inherits parent context from caller", () => {
    const tracer = getTracer("test-orchestration");
    const service = createReviewRouterService();

    tracer.startActiveSpan("orchestration.step", (parentSpan) => {
      service.routeReview({
        changedFilePaths: [],
        taskTags: [],
        riskLevel: "medium",
        repositoryRequiredReviewers: [],
        routingConfig: { rules: [] },
      });

      parentSpan.setStatus({ code: SpanStatusCode.OK });
      parentSpan.end();

      const spans = exporter.getFinishedSpans();
      const routeSpan = spans.find((s) => s.name === SpanNames.REVIEW_ROUTE);
      const parentCtx = parentSpan.spanContext();

      expect(routeSpan).toBeDefined();
      expect(routeSpan!.parentSpanContext?.spanId).toBe(parentCtx.spanId);
      expect(routeSpan!.parentSpanContext?.traceId).toBe(parentCtx.traceId);
    });
  });
});
