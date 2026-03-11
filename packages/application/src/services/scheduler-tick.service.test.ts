/**
 * Tests for the scheduler tick service.
 *
 * These tests verify the recurring SCHEDULER_TICK job lifecycle:
 * initialization (seeding the first tick job), tick processing
 * (claim → schedule loop → complete → reschedule), and edge cases
 * like duplicate prevention and empty scheduling passes.
 *
 * The scheduler tick service is a critical orchestration component —
 * it is the heartbeat that drives automatic task-to-worker assignment.
 * Without it, no tasks would be scheduled unless manually triggered.
 *
 * @module @factory/application/services/scheduler-tick.service.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { JobType, JobStatus } from "@factory/domain";

import type { SchedulerTickUnitOfWork } from "../ports/scheduler-tick.ports.js";
import type {
  JobQueueService,
  CreateJobResult,
  ClaimJobResult,
  CompleteJobResult,
} from "./job-queue.service.js";
import type { SchedulerService, ScheduleResult } from "./scheduler.service.js";
import type { QueuedJob } from "../ports/job-queue.ports.js";

import {
  createSchedulerTickService,
  DEFAULT_TICK_INTERVAL_MS,
  DEFAULT_CANDIDATE_LIMIT,
  DEFAULT_LEASE_OWNER,
} from "./scheduler-tick.service.js";
import type { SchedulerTickDependencies } from "./scheduler-tick.service.js";

// ---------------------------------------------------------------------------
// Test helpers — mock factories
// ---------------------------------------------------------------------------

const BASE_TIMESTAMP = new Date("2025-01-01T00:00:00Z");

let jobIdCounter = 0;

/**
 * Creates a mock QueuedJob with sensible defaults.
 * Every field is overridable via the `overrides` parameter.
 */
function createMockJob(overrides: Partial<QueuedJob> = {}): QueuedJob {
  jobIdCounter++;
  return {
    jobId: `job-${jobIdCounter}`,
    jobType: JobType.SCHEDULER_TICK,
    entityType: null,
    entityId: null,
    payloadJson: null,
    status: JobStatus.PENDING,
    attemptCount: 0,
    runAfter: null,
    leaseOwner: null,
    parentJobId: null,
    jobGroupId: null,
    dependsOnJobIds: null,
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP,
    ...overrides,
  };
}

/**
 * Creates a mock SchedulerTickUnitOfWork that tracks
 * the countNonTerminalByType calls and returns a configurable count.
 */
function createMockUnitOfWork(nonTerminalCount: number = 0): {
  unitOfWork: SchedulerTickUnitOfWork;
  calls: { countNonTerminalByType: Array<{ jobType: string }> };
} {
  const calls: { countNonTerminalByType: Array<{ jobType: string }> } = {
    countNonTerminalByType: [],
  };

  const unitOfWork: SchedulerTickUnitOfWork = {
    runInTransaction<T>(
      fn: (repos: { job: { countNonTerminalByType: (jt: string) => number } }) => T,
    ): T {
      return fn({
        job: {
          countNonTerminalByType(jobType: string): number {
            calls.countNonTerminalByType.push({ jobType });
            return nonTerminalCount;
          },
        },
      });
    },
  };

  return { unitOfWork, calls };
}

/**
 * Tracking structure for mock JobQueueService calls.
 */
interface JobQueueCalls {
  createJob: Array<{ jobType: string; runAfter?: Date | null }>;
  claimJob: Array<{ jobType: string; leaseOwner: string }>;
  completeJob: Array<{ jobId: string }>;
}

/**
 * Creates a mock JobQueueService with configurable behaviors.
 *
 * @param claimResult - What `claimJob` returns (null = no job available)
 * @param createJobId - Job ID to use for created jobs (auto-increments)
 */
function createMockJobQueueService(
  options: {
    claimResult?: ClaimJobResult | null;
    createJobIdPrefix?: string;
  } = {},
): {
  service: JobQueueService;
  calls: JobQueueCalls;
} {
  const calls: JobQueueCalls = {
    createJob: [],
    claimJob: [],
    completeJob: [],
  };

  let createCounter = 0;
  const prefix = options.createJobIdPrefix ?? "created-job";

  const service: JobQueueService = {
    createJob(data): CreateJobResult {
      createCounter++;
      const jobId = `${prefix}-${createCounter}`;
      calls.createJob.push({
        jobType: data.jobType,
        runAfter: data.runAfter,
      });
      return {
        job: createMockJob({
          jobId,
          jobType: data.jobType,
          runAfter: data.runAfter ?? null,
        }),
      };
    },

    claimJob(jobType, leaseOwner): ClaimJobResult | null {
      calls.claimJob.push({ jobType, leaseOwner });
      return options.claimResult ?? null;
    },

    completeJob(jobId): CompleteJobResult {
      calls.completeJob.push({ jobId });
      return {
        job: createMockJob({ jobId, status: JobStatus.COMPLETED }),
      };
    },

    // Not used by tick service — stubbed
    startJob(): never {
      throw new Error("startJob not expected in tick service tests");
    },
    failJob(): never {
      throw new Error("failJob not expected in tick service tests");
    },
    areJobDependenciesMet(): never {
      throw new Error("areJobDependenciesMet not expected in tick service tests");
    },
    findJobsByGroup(): never {
      throw new Error("findJobsByGroup not expected in tick service tests");
    },
  };

  return { service, calls };
}

/**
 * Creates a mock SchedulerService with configurable `scheduleNext` results.
 *
 * @param results - Array of results to return on successive calls.
 *   When exhausted, returns `{ assigned: false, reason: "no_ready_tasks" }`.
 */
function createMockSchedulerService(results: ScheduleResult[] = []): {
  service: SchedulerService;
  calls: { scheduleNext: Array<{ candidateLimit?: number }> };
} {
  const calls: { scheduleNext: Array<{ candidateLimit?: number }> } = {
    scheduleNext: [],
  };

  let callIndex = 0;

  const service: SchedulerService = {
    scheduleNext(candidateLimit?: number): ScheduleResult {
      calls.scheduleNext.push({ candidateLimit });
      if (callIndex < results.length) {
        return results[callIndex++]!;
      }
      return { assigned: false, reason: "no_ready_tasks", candidatesEvaluated: 0 };
    },
  };

  return { service, calls };
}

/**
 * Creates a complete set of mock dependencies for the tick service.
 */
function createTestDeps(
  options: {
    nonTerminalCount?: number;
    claimResult?: ClaimJobResult | null;
    scheduleResults?: ScheduleResult[];
    clockTime?: Date;
  } = {},
): {
  deps: SchedulerTickDependencies;
  jobQueueCalls: JobQueueCalls;
  schedulerCalls: { scheduleNext: Array<{ candidateLimit?: number }> };
  unitOfWorkCalls: { countNonTerminalByType: Array<{ jobType: string }> };
} {
  const { unitOfWork, calls: unitOfWorkCalls } = createMockUnitOfWork(
    options.nonTerminalCount ?? 0,
  );
  const { service: jobQueueService, calls: jobQueueCalls } = createMockJobQueueService({
    claimResult: options.claimResult,
  });
  const { service: schedulerService, calls: schedulerCalls } = createMockSchedulerService(
    options.scheduleResults ?? [],
  );
  const clock = () => options.clockTime ?? BASE_TIMESTAMP;

  return {
    deps: { unitOfWork, jobQueueService, schedulerService, clock },
    jobQueueCalls,
    schedulerCalls,
    unitOfWorkCalls,
  };
}

// ---------------------------------------------------------------------------
// Helper: create a successful schedule result for concise test setup
// ---------------------------------------------------------------------------

function successResult(): ScheduleResult {
  return {
    assigned: true,
    assignment: {
      task: {
        taskId: "task-1",
        repositoryId: "repo-1",
        priority: "MEDIUM" as never,
        status: "READY" as never,
        requiredCapabilities: [],
        createdAt: BASE_TIMESTAMP,
      },
      pool: {
        poolId: "pool-1",
        poolType: "DEVELOPER" as never,
        capabilities: [],
        maxConcurrency: 5,
        activeLeaseCount: 1,
        defaultTimeoutSec: 3600,
        enabled: true,
      },
      leaseResult: {
        lease: { leaseId: "lease-1" },
        auditEvent: { eventId: "audit-1" },
      } as never,
      dispatchJob: {
        job: createMockJob({ jobType: JobType.WORKER_DISPATCH }),
      },
    },
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("SchedulerTickService", () => {
  beforeEach(() => {
    jobIdCounter = 0;
  });

  // -----------------------------------------------------------------------
  // initialize()
  // -----------------------------------------------------------------------

  describe("initialize()", () => {
    /**
     * Verifies that calling initialize() on a fresh system (no existing
     * tick jobs) creates the first SCHEDULER_TICK job. This is the
     * bootstrap path — without this, no ticks would ever run.
     */
    it("creates a tick job when none exists", () => {
      const { deps, jobQueueCalls, unitOfWorkCalls } = createTestDeps({
        nonTerminalCount: 0,
      });
      const service = createSchedulerTickService(deps);

      const result = service.initialize();

      expect(result.created).toBe(true);
      expect(result.jobId).toBeDefined();

      // Should have checked for existing tick jobs
      expect(unitOfWorkCalls.countNonTerminalByType).toHaveLength(1);
      expect(unitOfWorkCalls.countNonTerminalByType[0]!.jobType).toBe(JobType.SCHEDULER_TICK);

      // Should have created exactly one job
      expect(jobQueueCalls.createJob).toHaveLength(1);
      expect(jobQueueCalls.createJob[0]!.jobType).toBe(JobType.SCHEDULER_TICK);
    });

    /**
     * Verifies that initialize() does NOT create a duplicate tick job
     * when one already exists. This prevents tick job accumulation after
     * application restarts — a critical invariant for system stability.
     */
    it("does not create a duplicate when a tick job already exists", () => {
      const { deps, jobQueueCalls } = createTestDeps({
        nonTerminalCount: 1,
      });
      const service = createSchedulerTickService(deps);

      const result = service.initialize();

      expect(result.created).toBe(false);
      expect(result.jobId).toBeUndefined();

      // Should NOT have created any job
      expect(jobQueueCalls.createJob).toHaveLength(0);
    });

    /**
     * Verifies that initialize() handles the case where multiple
     * non-terminal tick jobs exist (e.g., from a race condition during
     * startup). It should still skip creation.
     */
    it("does not create when multiple non-terminal tick jobs exist", () => {
      const { deps, jobQueueCalls } = createTestDeps({
        nonTerminalCount: 3,
      });
      const service = createSchedulerTickService(deps);

      const result = service.initialize();

      expect(result.created).toBe(false);
      expect(jobQueueCalls.createJob).toHaveLength(0);
    });

    /**
     * Verifies that the initial tick job is created without a runAfter
     * delay, making it immediately claimable. The first tick should
     * run as soon as possible after startup.
     */
    it("creates the initial tick job without runAfter delay", () => {
      const { deps, jobQueueCalls } = createTestDeps({
        nonTerminalCount: 0,
      });
      const service = createSchedulerTickService(deps);

      service.initialize();

      // runAfter should not be set for the initial tick
      expect(jobQueueCalls.createJob[0]!.runAfter).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // processTick() — no tick job available
  // -----------------------------------------------------------------------

  describe("processTick() — no tick job available", () => {
    /**
     * Verifies that processTick() gracefully returns when no tick job
     * is claimable. This happens when the tick interval hasn't elapsed
     * yet or another instance already claimed the tick job.
     */
    it("returns skipped result when no tick job is available", () => {
      const { deps, schedulerCalls } = createTestDeps({
        claimResult: null,
      });
      const service = createSchedulerTickService(deps);

      const result = service.processTick();

      expect(result.processed).toBe(false);
      if (!result.processed) {
        expect(result.reason).toBe("no_tick_job");
      }

      // Should NOT have called the scheduler
      expect(schedulerCalls.scheduleNext).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // processTick() — scheduling loop
  // -----------------------------------------------------------------------

  describe("processTick() — scheduling loop", () => {
    /**
     * Verifies the happy path: tick is claimed, scheduler assigns tasks,
     * tick is completed, and the next tick job is created. This is the
     * core lifecycle of the scheduler tick.
     */
    it("processes a tick with one successful assignment", () => {
      const tickJob = createMockJob({
        jobId: "tick-1",
        status: JobStatus.CLAIMED,
      });
      const { deps, jobQueueCalls, schedulerCalls } = createTestDeps({
        claimResult: { job: tickJob },
        scheduleResults: [
          successResult(),
          // Second call returns no more work
        ],
      });
      const service = createSchedulerTickService(deps);

      const result = service.processTick();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.tickJobId).toBe("tick-1");
        expect(result.summary.assignmentCount).toBe(1);
        expect(result.summary.stopReason).toBe("no_ready_tasks");
        expect(result.nextTickJobId).toBeDefined();
      }

      // Should have called scheduleNext twice (one success + one stop)
      expect(schedulerCalls.scheduleNext).toHaveLength(2);

      // Should have completed the tick job
      expect(jobQueueCalls.completeJob).toHaveLength(1);
      expect(jobQueueCalls.completeJob[0]!.jobId).toBe("tick-1");

      // Should have created the next tick job
      expect(jobQueueCalls.createJob).toHaveLength(1);
      expect(jobQueueCalls.createJob[0]!.jobType).toBe(JobType.SCHEDULER_TICK);
    });

    /**
     * Verifies that the scheduling loop handles multiple successive
     * assignments within a single tick before stopping. This is the
     * burst scheduling scenario where many tasks become ready at once.
     */
    it("processes multiple assignments in a single tick", () => {
      const tickJob = createMockJob({
        jobId: "tick-2",
        status: JobStatus.CLAIMED,
      });
      const { deps, schedulerCalls } = createTestDeps({
        claimResult: { job: tickJob },
        scheduleResults: [
          successResult(),
          successResult(),
          successResult(),
          // Fourth call returns no more work
        ],
      });
      const service = createSchedulerTickService(deps);

      const result = service.processTick();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.assignmentCount).toBe(3);
        expect(result.summary.stopReason).toBe("no_ready_tasks");
      }

      // 3 successes + 1 stop = 4 calls
      expect(schedulerCalls.scheduleNext).toHaveLength(4);
    });

    /**
     * Verifies that a tick with zero assignments (no ready tasks)
     * still completes the tick job and creates the next one. The
     * tick loop must always reschedule regardless of work done.
     */
    it("processes a tick with zero assignments (no ready tasks)", () => {
      const tickJob = createMockJob({
        jobId: "tick-3",
        status: JobStatus.CLAIMED,
      });
      const { deps, jobQueueCalls } = createTestDeps({
        claimResult: { job: tickJob },
        scheduleResults: [
          {
            assigned: false,
            reason: "no_ready_tasks",
            candidatesEvaluated: 0,
          },
        ],
      });
      const service = createSchedulerTickService(deps);

      const result = service.processTick();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.assignmentCount).toBe(0);
        expect(result.summary.stopReason).toBe("no_ready_tasks");
      }

      // Still completes and reschedules
      expect(jobQueueCalls.completeJob).toHaveLength(1);
      expect(jobQueueCalls.createJob).toHaveLength(1);
    });

    /**
     * Verifies that the tick correctly reports the stop reason
     * when all pools are at capacity. This signal is important for
     * observability — operators need to know when to add pool capacity.
     */
    it("reports all_pools_at_capacity stop reason", () => {
      const tickJob = createMockJob({
        jobId: "tick-4",
        status: JobStatus.CLAIMED,
      });
      const { deps } = createTestDeps({
        claimResult: { job: tickJob },
        scheduleResults: [
          {
            assigned: false,
            reason: "all_pools_at_capacity",
            candidatesEvaluated: 5,
          },
        ],
      });
      const service = createSchedulerTickService(deps);

      const result = service.processTick();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.stopReason).toBe("all_pools_at_capacity");
      }
    });

    /**
     * Verifies that the tick correctly reports the stop reason
     * when no compatible pools are found. This means the system has
     * tasks but no pools configured to handle them.
     */
    it("reports no_compatible_pools stop reason", () => {
      const tickJob = createMockJob({
        jobId: "tick-5",
        status: JobStatus.CLAIMED,
      });
      const { deps } = createTestDeps({
        claimResult: { job: tickJob },
        scheduleResults: [
          {
            assigned: false,
            reason: "no_compatible_pools",
            candidatesEvaluated: 0,
          },
        ],
      });
      const service = createSchedulerTickService(deps);

      const result = service.processTick();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.stopReason).toBe("no_compatible_pools");
      }
    });

    /**
     * Verifies the stop reason when all candidate tasks were contended
     * (already claimed by another scheduler instance). This is an
     * expected scenario in concurrent scheduling.
     */
    it("reports all_candidates_contended stop reason", () => {
      const tickJob = createMockJob({
        jobId: "tick-6",
        status: JobStatus.CLAIMED,
      });
      const { deps } = createTestDeps({
        claimResult: { job: tickJob },
        scheduleResults: [
          {
            assigned: false,
            reason: "all_candidates_contended",
            candidatesEvaluated: 10,
          },
        ],
      });
      const service = createSchedulerTickService(deps);

      const result = service.processTick();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.stopReason).toBe("all_candidates_contended");
      }
    });

    /**
     * Verifies that some assignments can succeed before the loop
     * stops due to capacity exhaustion. This is the common case
     * where some tasks are assigned but pools fill up mid-tick.
     */
    it("handles mixed results: some assignments then exhaustion", () => {
      const tickJob = createMockJob({
        jobId: "tick-7",
        status: JobStatus.CLAIMED,
      });
      const { deps } = createTestDeps({
        claimResult: { job: tickJob },
        scheduleResults: [
          successResult(),
          successResult(),
          {
            assigned: false,
            reason: "all_pools_at_capacity",
            candidatesEvaluated: 3,
          },
        ],
      });
      const service = createSchedulerTickService(deps);

      const result = service.processTick();

      expect(result.processed).toBe(true);
      if (result.processed) {
        expect(result.summary.assignmentCount).toBe(2);
        expect(result.summary.stopReason).toBe("all_pools_at_capacity");
      }
    });
  });

  // -----------------------------------------------------------------------
  // processTick() — self-rescheduling
  // -----------------------------------------------------------------------

  describe("processTick() — self-rescheduling", () => {
    /**
     * Verifies that the next tick job is created with the correct
     * runAfter timestamp based on the configured interval. This is
     * the core self-rescheduling mechanism that keeps the tick loop
     * running without external coordination.
     */
    it("creates next tick job with default interval", () => {
      const tickJob = createMockJob({
        jobId: "tick-8",
        status: JobStatus.CLAIMED,
      });
      const clockTime = new Date("2025-06-15T12:00:00Z");
      const { deps, jobQueueCalls } = createTestDeps({
        claimResult: { job: tickJob },
        clockTime,
      });
      const service = createSchedulerTickService(deps);

      service.processTick();

      expect(jobQueueCalls.createJob).toHaveLength(1);
      const nextRunAfter = jobQueueCalls.createJob[0]!.runAfter;
      expect(nextRunAfter).toBeInstanceOf(Date);
      expect(nextRunAfter!.getTime()).toBe(clockTime.getTime() + DEFAULT_TICK_INTERVAL_MS);
    });

    /**
     * Verifies that a custom tick interval is respected when creating
     * the next tick job. Operators should be able to tune the interval
     * for their workload.
     */
    it("creates next tick job with custom interval", () => {
      const tickJob = createMockJob({
        jobId: "tick-9",
        status: JobStatus.CLAIMED,
      });
      const clockTime = new Date("2025-06-15T12:00:00Z");
      const customIntervalMs = 30_000; // 30 seconds
      const { deps, jobQueueCalls } = createTestDeps({
        claimResult: { job: tickJob },
        clockTime,
      });
      const service = createSchedulerTickService(deps, {
        tickIntervalMs: customIntervalMs,
      });

      service.processTick();

      const nextRunAfter = jobQueueCalls.createJob[0]!.runAfter;
      expect(nextRunAfter!.getTime()).toBe(clockTime.getTime() + customIntervalMs);
    });

    /**
     * Verifies that the tick job is completed BEFORE the next tick
     * job is created. This ordering ensures the current tick is fully
     * finished before the next one becomes eligible.
     */
    it("completes tick job before creating next", () => {
      const tickJob = createMockJob({
        jobId: "tick-10",
        status: JobStatus.CLAIMED,
      });

      const operationLog: string[] = [];
      const { unitOfWork } = createMockUnitOfWork(0);

      // Custom job queue service that logs operation order
      const jobQueueService: JobQueueService = {
        createJob(data) {
          operationLog.push("createJob");
          return {
            job: createMockJob({ jobType: data.jobType }),
          };
        },
        claimJob() {
          operationLog.push("claimJob");
          return { job: tickJob };
        },
        completeJob(jobId) {
          operationLog.push(`completeJob:${jobId}`);
          return {
            job: createMockJob({ jobId, status: JobStatus.COMPLETED }),
          };
        },
        startJob(): never {
          throw new Error("unexpected");
        },
        failJob(): never {
          throw new Error("unexpected");
        },
        areJobDependenciesMet(): never {
          throw new Error("unexpected");
        },
        findJobsByGroup(): never {
          throw new Error("unexpected");
        },
      };

      const { service: schedulerService } = createMockSchedulerService([]);
      const clock = () => BASE_TIMESTAMP;

      const service = createSchedulerTickService({
        unitOfWork,
        jobQueueService,
        schedulerService,
        clock,
      });

      service.processTick();

      const completeIdx = operationLog.indexOf("completeJob:tick-10");
      const createIdx = operationLog.lastIndexOf("createJob");

      expect(completeIdx).toBeGreaterThanOrEqual(0);
      expect(createIdx).toBeGreaterThanOrEqual(0);
      expect(completeIdx).toBeLessThan(createIdx);
    });
  });

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  describe("configuration", () => {
    /**
     * Verifies that the default candidate limit is passed to
     * scheduleNext. This ensures the tick service correctly delegates
     * the per-pass evaluation limit to the scheduler.
     */
    it("uses default candidate limit", () => {
      const tickJob = createMockJob({
        jobId: "tick-11",
        status: JobStatus.CLAIMED,
      });
      const { deps, schedulerCalls } = createTestDeps({
        claimResult: { job: tickJob },
      });
      const service = createSchedulerTickService(deps);

      service.processTick();

      expect(schedulerCalls.scheduleNext[0]!.candidateLimit).toBe(DEFAULT_CANDIDATE_LIMIT);
    });

    /**
     * Verifies that a custom candidate limit overrides the default.
     * This allows operators to tune how many tasks are evaluated
     * per scheduling pass based on system load.
     */
    it("uses custom candidate limit", () => {
      const tickJob = createMockJob({
        jobId: "tick-12",
        status: JobStatus.CLAIMED,
      });
      const { deps, schedulerCalls } = createTestDeps({
        claimResult: { job: tickJob },
      });
      const service = createSchedulerTickService(deps, {
        candidateLimit: 100,
      });

      service.processTick();

      expect(schedulerCalls.scheduleNext[0]!.candidateLimit).toBe(100);
    });

    /**
     * Verifies that a custom lease owner is used when claiming tick
     * jobs. This supports multi-instance deployments where each
     * scheduler instance needs a unique identity.
     */
    it("uses custom lease owner when claiming tick jobs", () => {
      const { deps, jobQueueCalls } = createTestDeps({
        claimResult: null,
      });
      const service = createSchedulerTickService(deps, {
        leaseOwner: "scheduler-instance-2",
      });

      service.processTick();

      expect(jobQueueCalls.claimJob[0]!.leaseOwner).toBe("scheduler-instance-2");
    });

    /**
     * Verifies that the default lease owner is used when no custom
     * one is provided.
     */
    it("uses default lease owner", () => {
      const { deps, jobQueueCalls } = createTestDeps({
        claimResult: null,
      });
      const service = createSchedulerTickService(deps);

      service.processTick();

      expect(jobQueueCalls.claimJob[0]!.leaseOwner).toBe(DEFAULT_LEASE_OWNER);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    /**
     * Verifies that initialize() can be called multiple times safely.
     * After the first call creates a tick job, subsequent calls should
     * detect it and skip creation (assuming the port reflects the
     * updated state — which in real usage it would via the database).
     */
    it("initialize is idempotent with consistent port state", () => {
      // First call: no existing jobs → creates one
      const { deps: deps1, jobQueueCalls: calls1 } = createTestDeps({
        nonTerminalCount: 0,
      });
      const service1 = createSchedulerTickService(deps1);
      const result1 = service1.initialize();
      expect(result1.created).toBe(true);
      expect(calls1.createJob).toHaveLength(1);

      // Simulate second call with updated state (job now exists)
      const { deps: deps2, jobQueueCalls: calls2 } = createTestDeps({
        nonTerminalCount: 1,
      });
      const service2 = createSchedulerTickService(deps2);
      const result2 = service2.initialize();
      expect(result2.created).toBe(false);
      expect(calls2.createJob).toHaveLength(0);
    });

    /**
     * Verifies that the tick claims a SCHEDULER_TICK job type
     * specifically, not any other job type. This ensures tick processing
     * doesn't accidentally consume worker dispatch or other job types.
     */
    it("claims only SCHEDULER_TICK job type", () => {
      const { deps, jobQueueCalls } = createTestDeps({
        claimResult: null,
      });
      const service = createSchedulerTickService(deps);

      service.processTick();

      expect(jobQueueCalls.claimJob).toHaveLength(1);
      expect(jobQueueCalls.claimJob[0]!.jobType).toBe(JobType.SCHEDULER_TICK);
    });

    /**
     * Verifies that the scheduling loop passes the candidate limit
     * consistently to every call of scheduleNext within a single tick.
     */
    it("passes candidate limit to every scheduleNext call in a tick", () => {
      const tickJob = createMockJob({
        jobId: "tick-13",
        status: JobStatus.CLAIMED,
      });
      const { deps, schedulerCalls } = createTestDeps({
        claimResult: { job: tickJob },
        scheduleResults: [
          successResult(),
          successResult(),
          // Third call stops
        ],
      });
      const service = createSchedulerTickService(deps, {
        candidateLimit: 25,
      });

      service.processTick();

      // All three calls should have the same candidate limit
      expect(schedulerCalls.scheduleNext).toHaveLength(3);
      for (const call of schedulerCalls.scheduleNext) {
        expect(call.candidateLimit).toBe(25);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Constants export verification
  // -----------------------------------------------------------------------

  describe("constants", () => {
    /**
     * Verifies the default tick interval matches the spec (5 seconds).
     */
    it("has correct default tick interval", () => {
      expect(DEFAULT_TICK_INTERVAL_MS).toBe(5_000);
    });

    /**
     * Verifies the default candidate limit matches the scheduler default.
     */
    it("has correct default candidate limit", () => {
      expect(DEFAULT_CANDIDATE_LIMIT).toBe(50);
    });

    /**
     * Verifies the default lease owner identity.
     */
    it("has correct default lease owner", () => {
      expect(DEFAULT_LEASE_OWNER).toBe("scheduler-tick");
    });
  });
});
