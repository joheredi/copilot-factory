/**
 * Tests for the Scheduler service.
 *
 * The scheduler is the core assignment engine: it selects ready tasks,
 * matches them to compatible worker pools, acquires leases, and creates
 * worker dispatch jobs. These tests validate the scheduling algorithm,
 * pool matching logic, concurrency handling, and error recovery.
 *
 * @module @factory/application/services/scheduler.service.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { JobType, TaskPriority, TaskStatus, WorkerPoolType } from "@factory/domain";

import {
  createSchedulerService,
  isPoolCompatible,
  hasPoolCapacity,
  selectBestPool,
  comparePriority,
} from "./scheduler.service.js";
import type {
  SchedulerService,
  ScheduleSuccessResult,
  ScheduleNoAssignmentResult,
} from "./scheduler.service.js";
import type {
  SchedulableTask,
  SchedulablePool,
  SchedulerUnitOfWork,
  SchedulerTransactionRepositories,
} from "../ports/scheduler.ports.js";
import type { LeaseService, LeaseAcquisitionResult } from "./lease.service.js";
import type { JobQueueService, CreateJobResult } from "./job-queue.service.js";
import type { QueuedJob } from "../ports/job-queue.ports.js";
import type { CreatedLease, LeaseAcquisitionTask } from "../ports/lease.ports.js";
import type { AuditEventRecord } from "../ports/repository.ports.js";
import { ExclusivityViolationError, TaskNotReadyForLeaseError } from "../errors.js";

// ---------------------------------------------------------------------------
// Test helpers — factory functions for test data
// ---------------------------------------------------------------------------

let idCounter = 0;

function nextId(): string {
  idCounter++;
  return `test-id-${String(idCounter)}`;
}

function createTask(overrides: Partial<SchedulableTask> = {}): SchedulableTask {
  return {
    taskId: nextId(),
    repositoryId: "repo-1",
    priority: TaskPriority.MEDIUM,
    status: TaskStatus.READY,
    requiredCapabilities: [],
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

function createPool(overrides: Partial<SchedulablePool> = {}): SchedulablePool {
  return {
    poolId: nextId(),
    poolType: WorkerPoolType.DEVELOPER,
    capabilities: [],
    maxConcurrency: 5,
    activeLeaseCount: 0,
    defaultTimeoutSec: 3600,
    enabled: true,
    ...overrides,
  };
}

function createMockLeaseResult(
  taskId: string,
  poolId: string,
  workerId: string,
): LeaseAcquisitionResult {
  return {
    lease: {
      leaseId: nextId(),
      taskId,
      workerId,
      poolId,
      status: "LEASED",
      leasedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    } as CreatedLease,
    task: {
      id: taskId,
      status: TaskStatus.ASSIGNED,
      version: 2,
      currentLeaseId: "lease-1",
    } as LeaseAcquisitionTask,
    auditEvent: {
      id: nextId(),
      entityType: "task",
      entityId: taskId,
      eventType: "entity.transition.READY.to.ASSIGNED",
      actorType: "system",
      actorId: "scheduler",
      oldState: JSON.stringify({ status: "READY" }),
      newState: JSON.stringify({ status: "ASSIGNED" }),
      metadata: null,
      createdAt: new Date(),
    } as AuditEventRecord,
  };
}

function createMockDispatchJob(taskId: string): CreateJobResult {
  return {
    job: {
      jobId: nextId(),
      jobType: JobType.WORKER_DISPATCH,
      entityType: "task",
      entityId: taskId,
      payloadJson: {},
      status: "pending",
      attemptCount: 0,
      runAfter: null,
      leaseOwner: null,
      parentJobId: null,
      jobGroupId: null,
      dependsOnJobIds: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as QueuedJob,
  };
}

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

interface MockDeps {
  unitOfWork: SchedulerUnitOfWork;
  leaseService: LeaseService;
  jobQueueService: JobQueueService;
  taskRepo: { findReadyByPriority: ReturnType<typeof vi.fn> };
  poolRepo: { findEnabledByType: ReturnType<typeof vi.fn> };
}

function createMockDeps(): MockDeps {
  const taskRepo = {
    findReadyByPriority: vi.fn().mockReturnValue([]),
  };
  const poolRepo = {
    findEnabledByType: vi.fn().mockReturnValue([]),
  };
  const unitOfWork: SchedulerUnitOfWork = {
    runInTransaction<T>(fn: (repos: SchedulerTransactionRepositories) => T): T {
      return fn({ task: taskRepo, pool: poolRepo });
    },
  };

  const leaseService: LeaseService = {
    acquireLease: vi.fn(),
  };

  const jobQueueService: JobQueueService = {
    createJob: vi.fn(),
    claimJob: vi.fn(),
    startJob: vi.fn(),
    completeJob: vi.fn(),
    failJob: vi.fn(),
    areJobDependenciesMet: vi.fn(),
    findJobsByGroup: vi.fn(),
  };

  return { unitOfWork, leaseService, jobQueueService, taskRepo, poolRepo };
}

function createService(deps: MockDeps): SchedulerService {
  return createSchedulerService(deps.unitOfWork, deps.leaseService, deps.jobQueueService, nextId);
}

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe("isPoolCompatible", () => {
  /**
   * Validates that a pool with no capabilities is compatible with a task
   * that also has no requirements. This is the common case for simple
   * tasks that don't need specialized worker capabilities.
   */
  it("returns true when task has no required capabilities", () => {
    const task = createTask({ requiredCapabilities: [] });
    const pool = createPool({ capabilities: [] });
    expect(isPoolCompatible(task, pool)).toBe(true);
  });

  /**
   * Validates that a pool providing all required capabilities matches.
   * This ensures the capability intersection logic works correctly.
   */
  it("returns true when pool provides all required capabilities", () => {
    const task = createTask({ requiredCapabilities: ["typescript", "react"] });
    const pool = createPool({ capabilities: ["typescript", "react", "database"] });
    expect(isPoolCompatible(task, pool)).toBe(true);
  });

  /**
   * Validates that a pool missing even one required capability is rejected.
   * Partial capability matches must NOT qualify — the pool must satisfy
   * every requirement the task declares.
   */
  it("returns false when pool is missing a required capability", () => {
    const task = createTask({ requiredCapabilities: ["typescript", "react"] });
    const pool = createPool({ capabilities: ["typescript"] });
    expect(isPoolCompatible(task, pool)).toBe(false);
  });

  /**
   * Validates that a pool with no capabilities rejects a task with requirements.
   * Edge case: empty capabilities array means the pool can't handle specialized work.
   */
  it("returns false when pool has no capabilities but task requires some", () => {
    const task = createTask({ requiredCapabilities: ["typescript"] });
    const pool = createPool({ capabilities: [] });
    expect(isPoolCompatible(task, pool)).toBe(false);
  });
});

describe("hasPoolCapacity", () => {
  /**
   * Validates that a pool with no active leases has capacity.
   * This is the basic capacity check — empty pools should accept work.
   */
  it("returns true when pool has available slots", () => {
    const pool = createPool({ maxConcurrency: 5, activeLeaseCount: 3 });
    expect(hasPoolCapacity(pool)).toBe(true);
  });

  /**
   * Validates that a pool at its concurrency limit is considered full.
   * The scheduler must not attempt to assign tasks to full pools.
   */
  it("returns false when pool is at max concurrency", () => {
    const pool = createPool({ maxConcurrency: 5, activeLeaseCount: 5 });
    expect(hasPoolCapacity(pool)).toBe(false);
  });

  /**
   * Validates the boundary condition: 0 active leases with maxConcurrency > 0.
   */
  it("returns true when pool is completely empty", () => {
    const pool = createPool({ maxConcurrency: 3, activeLeaseCount: 0 });
    expect(hasPoolCapacity(pool)).toBe(true);
  });
});

describe("selectBestPool", () => {
  /**
   * Validates that the pool with the most available capacity is selected.
   * This spreads load across pools to prevent any single pool from
   * becoming a bottleneck.
   */
  it("selects pool with most available capacity", () => {
    const poolA = createPool({ poolId: "pool-a", maxConcurrency: 5, activeLeaseCount: 4 });
    const poolB = createPool({ poolId: "pool-b", maxConcurrency: 10, activeLeaseCount: 2 });
    const poolC = createPool({ poolId: "pool-c", maxConcurrency: 3, activeLeaseCount: 1 });

    const result = selectBestPool([poolA, poolB, poolC]);
    expect(result).toBe(poolB); // 8 available vs 2 vs 1
  });

  /**
   * Validates that pools at capacity are skipped entirely.
   * Only pools with available slots should be considered.
   */
  it("skips pools at max concurrency", () => {
    const fullPool = createPool({ poolId: "full", maxConcurrency: 5, activeLeaseCount: 5 });
    const availablePool = createPool({
      poolId: "available",
      maxConcurrency: 5,
      activeLeaseCount: 3,
    });

    const result = selectBestPool([fullPool, availablePool]);
    expect(result).toBe(availablePool);
  });

  /**
   * Validates that undefined is returned when no pool has capacity.
   * The scheduler should handle this case by reporting "all_pools_at_capacity".
   */
  it("returns undefined when all pools are full", () => {
    const pool = createPool({ maxConcurrency: 5, activeLeaseCount: 5 });
    expect(selectBestPool([pool])).toBeUndefined();
  });

  /**
   * Validates the edge case of an empty pool list.
   */
  it("returns undefined for empty pool list", () => {
    expect(selectBestPool([])).toBeUndefined();
  });
});

describe("comparePriority", () => {
  /**
   * Validates the priority ordering: CRITICAL < HIGH < MEDIUM < LOW.
   * This is the fundamental invariant of the scheduler's task selection.
   */
  it("orders CRITICAL before HIGH", () => {
    expect(comparePriority(TaskPriority.CRITICAL, TaskPriority.HIGH)).toBeLessThan(0);
  });

  it("orders HIGH before MEDIUM", () => {
    expect(comparePriority(TaskPriority.HIGH, TaskPriority.MEDIUM)).toBeLessThan(0);
  });

  it("orders MEDIUM before LOW", () => {
    expect(comparePriority(TaskPriority.MEDIUM, TaskPriority.LOW)).toBeLessThan(0);
  });

  it("returns 0 for equal priorities", () => {
    expect(comparePriority(TaskPriority.HIGH, TaskPriority.HIGH)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scheduler service integration tests
// ---------------------------------------------------------------------------

describe("SchedulerService", () => {
  let deps: MockDeps;
  let service: SchedulerService;

  beforeEach(() => {
    idCounter = 0;
    deps = createMockDeps();
    service = createService(deps);
  });

  describe("scheduleNext — no ready tasks", () => {
    /**
     * Validates that the scheduler returns a clear "no_ready_tasks" signal
     * when the READY queue is empty. This is the normal idle state — the
     * scheduler should report this without attempting pool queries.
     */
    it("returns no_ready_tasks when no tasks are in READY status", () => {
      deps.taskRepo.findReadyByPriority.mockReturnValue([]);

      const result = service.scheduleNext();

      expect(result.assigned).toBe(false);
      expect((result as ScheduleNoAssignmentResult).reason).toBe("no_ready_tasks");
      expect((result as ScheduleNoAssignmentResult).candidatesEvaluated).toBe(0);
    });
  });

  describe("scheduleNext — no compatible pools", () => {
    /**
     * Validates that the scheduler reports "no_compatible_pools" when
     * there are ready tasks but no enabled DEVELOPER pools exist.
     * This prevents the scheduler from attempting lease acquisition
     * when there's nowhere to dispatch work.
     */
    it("returns no_compatible_pools when no developer pools exist", () => {
      const task = createTask();
      deps.taskRepo.findReadyByPriority.mockReturnValue([task]);
      deps.poolRepo.findEnabledByType.mockReturnValue([]);

      const result = service.scheduleNext();

      expect(result.assigned).toBe(false);
      expect((result as ScheduleNoAssignmentResult).reason).toBe("no_compatible_pools");
      expect(deps.poolRepo.findEnabledByType).toHaveBeenCalledWith(WorkerPoolType.DEVELOPER);
    });
  });

  describe("scheduleNext — successful assignment", () => {
    /**
     * Validates the happy-path flow: a ready task is matched to a compatible
     * pool, a lease is acquired, and a dispatch job is created. This is the
     * core scheduling cycle and the primary success path.
     */
    it("assigns highest-priority task to compatible pool", () => {
      const task = createTask({ taskId: "task-1", priority: TaskPriority.HIGH });
      const pool = createPool({
        poolId: "pool-1",
        capabilities: [],
        maxConcurrency: 5,
        activeLeaseCount: 0,
        defaultTimeoutSec: 1800,
      });

      deps.taskRepo.findReadyByPriority.mockReturnValue([task]);
      deps.poolRepo.findEnabledByType.mockReturnValue([pool]);

      const mockLease = createMockLeaseResult("task-1", "pool-1", "test-id-5");
      const mockJob = createMockDispatchJob("task-1");
      vi.mocked(deps.leaseService.acquireLease).mockReturnValue(mockLease);
      vi.mocked(deps.jobQueueService.createJob).mockReturnValue(mockJob);

      const result = service.scheduleNext();

      expect(result.assigned).toBe(true);
      const success = result as ScheduleSuccessResult;
      expect(success.assignment.task.taskId).toBe("task-1");
      expect(success.assignment.pool.poolId).toBe("pool-1");
      expect(success.assignment.leaseResult).toBe(mockLease);
      expect(success.assignment.dispatchJob).toBe(mockJob);
    });

    /**
     * Validates that the lease is acquired with the correct parameters:
     * - taskId from the selected task
     * - workerId from the id generator
     * - poolId from the selected pool
     * - ttlSeconds from the pool's defaultTimeoutSec
     * - actor is the system scheduler
     * - metadata includes scheduling context
     */
    it("acquires lease with correct parameters", () => {
      const task = createTask({ taskId: "task-1", priority: TaskPriority.CRITICAL });
      const pool = createPool({
        poolId: "pool-1",
        defaultTimeoutSec: 900,
      });

      deps.taskRepo.findReadyByPriority.mockReturnValue([task]);
      deps.poolRepo.findEnabledByType.mockReturnValue([pool]);

      const mockLease = createMockLeaseResult("task-1", "pool-1", "test-id-5");
      vi.mocked(deps.leaseService.acquireLease).mockReturnValue(mockLease);
      vi.mocked(deps.jobQueueService.createJob).mockReturnValue(createMockDispatchJob("task-1"));

      service.scheduleNext();

      expect(deps.leaseService.acquireLease).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          poolId: "pool-1",
          ttlSeconds: 900,
          actor: { type: "system", id: "scheduler" },
          metadata: expect.objectContaining({
            scheduledPriority: TaskPriority.CRITICAL,
            poolType: WorkerPoolType.DEVELOPER,
          }),
        }),
      );
    });

    /**
     * Validates that the worker dispatch job is created with the correct
     * payload, including task, lease, pool, and capability information.
     * The worker supervisor uses this payload to spawn the right worker.
     */
    it("creates worker dispatch job with correct payload", () => {
      const task = createTask({
        taskId: "task-1",
        priority: TaskPriority.HIGH,
        requiredCapabilities: ["typescript"],
      });
      const pool = createPool({ poolId: "pool-1", capabilities: ["typescript"] });

      deps.taskRepo.findReadyByPriority.mockReturnValue([task]);
      deps.poolRepo.findEnabledByType.mockReturnValue([pool]);

      const mockLease = createMockLeaseResult("task-1", "pool-1", "test-id-5");
      vi.mocked(deps.leaseService.acquireLease).mockReturnValue(mockLease);
      vi.mocked(deps.jobQueueService.createJob).mockReturnValue(createMockDispatchJob("task-1"));

      service.scheduleNext();

      expect(deps.jobQueueService.createJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobType: JobType.WORKER_DISPATCH,
          entityType: "task",
          entityId: "task-1",
          payloadJson: expect.objectContaining({
            taskId: "task-1",
            leaseId: mockLease.lease.leaseId,
            poolId: "pool-1",
            priority: TaskPriority.HIGH,
            requiredCapabilities: ["typescript"],
          }),
        }),
      );
    });
  });

  describe("scheduleNext — capability matching", () => {
    /**
     * Validates that the scheduler skips pools that don't satisfy a task's
     * capability requirements and finds a compatible pool further in the list.
     * This ensures capability filtering works within the scheduling loop.
     */
    it("skips incompatible pools and selects compatible one", () => {
      const task = createTask({
        taskId: "task-1",
        requiredCapabilities: ["typescript", "react"],
      });
      const incompatiblePool = createPool({
        poolId: "pool-no-react",
        capabilities: ["typescript"],
        maxConcurrency: 5,
        activeLeaseCount: 0,
      });
      const compatiblePool = createPool({
        poolId: "pool-react",
        capabilities: ["typescript", "react", "css"],
        maxConcurrency: 5,
        activeLeaseCount: 0,
      });

      deps.taskRepo.findReadyByPriority.mockReturnValue([task]);
      deps.poolRepo.findEnabledByType.mockReturnValue([incompatiblePool, compatiblePool]);

      const mockLease = createMockLeaseResult("task-1", "pool-react", "test-id-7");
      vi.mocked(deps.leaseService.acquireLease).mockReturnValue(mockLease);
      vi.mocked(deps.jobQueueService.createJob).mockReturnValue(createMockDispatchJob("task-1"));

      const result = service.scheduleNext();

      expect(result.assigned).toBe(true);
      const success = result as ScheduleSuccessResult;
      expect(success.assignment.pool.poolId).toBe("pool-react");
    });

    /**
     * Validates that when no pool has the required capabilities, the
     * scheduler moves to the next candidate task rather than failing.
     * A task requiring rare capabilities shouldn't block other tasks.
     */
    it("tries next task when no pool matches capability requirements", () => {
      const hardTask = createTask({
        taskId: "hard-task",
        priority: TaskPriority.HIGH,
        requiredCapabilities: ["rust", "wasm"],
      });
      const easyTask = createTask({
        taskId: "easy-task",
        priority: TaskPriority.MEDIUM,
        requiredCapabilities: [],
      });

      const pool = createPool({
        poolId: "ts-pool",
        capabilities: ["typescript"],
        maxConcurrency: 5,
        activeLeaseCount: 0,
      });

      deps.taskRepo.findReadyByPriority.mockReturnValue([hardTask, easyTask]);
      deps.poolRepo.findEnabledByType.mockReturnValue([pool]);

      const mockLease = createMockLeaseResult("easy-task", "ts-pool", "test-id-8");
      vi.mocked(deps.leaseService.acquireLease).mockReturnValue(mockLease);
      vi.mocked(deps.jobQueueService.createJob).mockReturnValue(createMockDispatchJob("easy-task"));

      const result = service.scheduleNext();

      expect(result.assigned).toBe(true);
      const success = result as ScheduleSuccessResult;
      expect(success.assignment.task.taskId).toBe("easy-task");
    });
  });

  describe("scheduleNext — concurrency limits", () => {
    /**
     * Validates that the scheduler respects pool concurrency limits.
     * When all compatible pools are at max capacity, the scheduler
     * reports "all_pools_at_capacity" — it does not over-commit.
     */
    it("returns all_pools_at_capacity when all pools are full", () => {
      const task = createTask();
      const fullPool = createPool({
        maxConcurrency: 3,
        activeLeaseCount: 3,
      });

      deps.taskRepo.findReadyByPriority.mockReturnValue([task]);
      deps.poolRepo.findEnabledByType.mockReturnValue([fullPool]);

      const result = service.scheduleNext();

      expect(result.assigned).toBe(false);
      expect((result as ScheduleNoAssignmentResult).reason).toBe("all_pools_at_capacity");
      expect(deps.leaseService.acquireLease).not.toHaveBeenCalled();
    });

    /**
     * Validates that among multiple pools, the scheduler selects the pool
     * with the most available capacity for load spreading.
     */
    it("selects pool with most available capacity for load spreading", () => {
      const task = createTask({ taskId: "task-1" });
      const busyPool = createPool({
        poolId: "busy",
        maxConcurrency: 5,
        activeLeaseCount: 4,
      });
      const freePool = createPool({
        poolId: "free",
        maxConcurrency: 5,
        activeLeaseCount: 1,
      });

      deps.taskRepo.findReadyByPriority.mockReturnValue([task]);
      deps.poolRepo.findEnabledByType.mockReturnValue([busyPool, freePool]);

      const mockLease = createMockLeaseResult("task-1", "free", "test-id-6");
      vi.mocked(deps.leaseService.acquireLease).mockReturnValue(mockLease);
      vi.mocked(deps.jobQueueService.createJob).mockReturnValue(createMockDispatchJob("task-1"));

      const result = service.scheduleNext();

      expect(result.assigned).toBe(true);
      expect((result as ScheduleSuccessResult).assignment.pool.poolId).toBe("free");
    });
  });

  describe("scheduleNext — duplicate assignment prevention", () => {
    /**
     * Validates that ExclusivityViolationError from the lease service
     * (indicating another scheduler tick already assigned this task)
     * is handled gracefully by moving to the next candidate task.
     * This is the primary duplicate assignment prevention mechanism.
     */
    it("skips task on ExclusivityViolationError and tries next", () => {
      const contestedTask = createTask({ taskId: "contested", priority: TaskPriority.HIGH });
      const availableTask = createTask({ taskId: "available", priority: TaskPriority.MEDIUM });
      const pool = createPool({ poolId: "pool-1" });

      deps.taskRepo.findReadyByPriority.mockReturnValue([contestedTask, availableTask]);
      deps.poolRepo.findEnabledByType.mockReturnValue([pool]);

      vi.mocked(deps.leaseService.acquireLease)
        .mockImplementationOnce(() => {
          throw new ExclusivityViolationError("contested", "existing-lease-1");
        })
        .mockReturnValueOnce(createMockLeaseResult("available", "pool-1", "test-id-8"));
      vi.mocked(deps.jobQueueService.createJob).mockReturnValue(createMockDispatchJob("available"));

      const result = service.scheduleNext();

      expect(result.assigned).toBe(true);
      expect((result as ScheduleSuccessResult).assignment.task.taskId).toBe("available");
    });

    /**
     * Validates that TaskNotReadyForLeaseError (task was transitioned
     * away from READY by another process) is also handled gracefully.
     */
    it("skips task on TaskNotReadyForLeaseError and tries next", () => {
      const staleTask = createTask({ taskId: "stale", priority: TaskPriority.HIGH });
      const freshTask = createTask({ taskId: "fresh", priority: TaskPriority.MEDIUM });
      const pool = createPool({ poolId: "pool-1" });

      deps.taskRepo.findReadyByPriority.mockReturnValue([staleTask, freshTask]);
      deps.poolRepo.findEnabledByType.mockReturnValue([pool]);

      vi.mocked(deps.leaseService.acquireLease)
        .mockImplementationOnce(() => {
          throw new TaskNotReadyForLeaseError("stale", "ASSIGNED");
        })
        .mockReturnValueOnce(createMockLeaseResult("fresh", "pool-1", "test-id-8"));
      vi.mocked(deps.jobQueueService.createJob).mockReturnValue(createMockDispatchJob("fresh"));

      const result = service.scheduleNext();

      expect(result.assigned).toBe(true);
      expect((result as ScheduleSuccessResult).assignment.task.taskId).toBe("fresh");
    });

    /**
     * Validates that when ALL candidate tasks are contended (all have
     * active leases), the scheduler reports "all_candidates_contended".
     * This distinguishes from "no_ready_tasks" for observability.
     */
    it("returns all_candidates_contended when every task has active lease", () => {
      const task1 = createTask({ taskId: "task-1" });
      const task2 = createTask({ taskId: "task-2" });
      const pool = createPool({ poolId: "pool-1" });

      deps.taskRepo.findReadyByPriority.mockReturnValue([task1, task2]);
      deps.poolRepo.findEnabledByType.mockReturnValue([pool]);

      vi.mocked(deps.leaseService.acquireLease).mockImplementation(() => {
        throw new ExclusivityViolationError("any", "existing-lease");
      });

      const result = service.scheduleNext();

      expect(result.assigned).toBe(false);
      expect((result as ScheduleNoAssignmentResult).reason).toBe("all_candidates_contended");
      expect((result as ScheduleNoAssignmentResult).candidatesEvaluated).toBe(2);
    });
  });

  describe("scheduleNext — error propagation", () => {
    /**
     * Validates that unexpected errors from the lease service propagate
     * to the caller. Only ExclusivityViolationError and
     * TaskNotReadyForLeaseError are swallowed — all other errors indicate
     * real problems that must surface for investigation.
     */
    it("propagates unexpected errors from lease service", () => {
      const task = createTask();
      const pool = createPool();

      deps.taskRepo.findReadyByPriority.mockReturnValue([task]);
      deps.poolRepo.findEnabledByType.mockReturnValue([pool]);

      vi.mocked(deps.leaseService.acquireLease).mockImplementation(() => {
        throw new Error("database connection lost");
      });

      expect(() => service.scheduleNext()).toThrow("database connection lost");
    });
  });

  describe("scheduleNext — candidate limit", () => {
    /**
     * Validates that the candidateLimit parameter is respected.
     * This prevents the scheduler from loading the entire READY queue
     * on every tick when there are thousands of tasks.
     */
    it("passes candidate limit to task query", () => {
      deps.taskRepo.findReadyByPriority.mockReturnValue([]);

      service.scheduleNext(10);

      expect(deps.taskRepo.findReadyByPriority).toHaveBeenCalledWith(10);
    });

    /**
     * Validates the default candidate limit is used when not specified.
     */
    it("uses default candidate limit of 50", () => {
      deps.taskRepo.findReadyByPriority.mockReturnValue([]);

      service.scheduleNext();

      expect(deps.taskRepo.findReadyByPriority).toHaveBeenCalledWith(50);
    });
  });

  describe("scheduleNext — priority ordering", () => {
    /**
     * Validates that the scheduler processes tasks in the order returned
     * by the repository (which should be priority-ordered). The first
     * assignable task wins, ensuring CRITICAL tasks are always tried first.
     */
    it("assigns first assignable task from priority-ordered list", () => {
      const criticalTask = createTask({
        taskId: "critical-1",
        priority: TaskPriority.CRITICAL,
      });
      const lowTask = createTask({
        taskId: "low-1",
        priority: TaskPriority.LOW,
      });

      const pool = createPool({ poolId: "pool-1" });

      // Repository returns them in priority order (CRITICAL first)
      deps.taskRepo.findReadyByPriority.mockReturnValue([criticalTask, lowTask]);
      deps.poolRepo.findEnabledByType.mockReturnValue([pool]);

      const mockLease = createMockLeaseResult("critical-1", "pool-1", "test-id-5");
      vi.mocked(deps.leaseService.acquireLease).mockReturnValue(mockLease);
      vi.mocked(deps.jobQueueService.createJob).mockReturnValue(
        createMockDispatchJob("critical-1"),
      );

      const result = service.scheduleNext();

      expect(result.assigned).toBe(true);
      expect((result as ScheduleSuccessResult).assignment.task.taskId).toBe("critical-1");
      // Should NOT have tried the low-priority task
      expect(deps.leaseService.acquireLease).toHaveBeenCalledTimes(1);
    });
  });

  describe("scheduleNext — lease TTL", () => {
    /**
     * Validates that the pool's defaultTimeoutSec is used as the lease TTL.
     * Different pools may have different timeout configurations based on
     * their workload characteristics.
     */
    it("uses pool defaultTimeoutSec as lease TTL", () => {
      const task = createTask({ taskId: "task-1" });
      const pool = createPool({ poolId: "pool-1", defaultTimeoutSec: 7200 });

      deps.taskRepo.findReadyByPriority.mockReturnValue([task]);
      deps.poolRepo.findEnabledByType.mockReturnValue([pool]);

      const mockLease = createMockLeaseResult("task-1", "pool-1", "test-id-5");
      vi.mocked(deps.leaseService.acquireLease).mockReturnValue(mockLease);
      vi.mocked(deps.jobQueueService.createJob).mockReturnValue(createMockDispatchJob("task-1"));

      service.scheduleNext();

      expect(deps.leaseService.acquireLease).toHaveBeenCalledWith(
        expect.objectContaining({ ttlSeconds: 7200 }),
      );
    });

    /**
     * Validates fallback to default 3600s TTL when pool has 0 timeout.
     * This prevents infinite leases from misconfigured pools.
     */
    it("falls back to 3600s TTL when pool timeout is 0", () => {
      const task = createTask({ taskId: "task-1" });
      const pool = createPool({ poolId: "pool-1", defaultTimeoutSec: 0 });

      deps.taskRepo.findReadyByPriority.mockReturnValue([task]);
      deps.poolRepo.findEnabledByType.mockReturnValue([pool]);

      const mockLease = createMockLeaseResult("task-1", "pool-1", "test-id-5");
      vi.mocked(deps.leaseService.acquireLease).mockReturnValue(mockLease);
      vi.mocked(deps.jobQueueService.createJob).mockReturnValue(createMockDispatchJob("task-1"));

      service.scheduleNext();

      expect(deps.leaseService.acquireLease).toHaveBeenCalledWith(
        expect.objectContaining({ ttlSeconds: 3600 }),
      );
    });
  });
});
