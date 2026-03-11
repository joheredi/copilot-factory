import { describe, it, expect } from "vitest";

import {
  createTestProject,
  createTestRepository,
  createTestTask,
  createTestWorkerPool,
  createTestTaskLease,
  createTestReviewCycle,
  createTestMergeQueueItem,
  createTestJob,
  createTestValidationRun,
  createTestSupervisedWorker,
  createTestAuditEvent,
  createTestPacket,
  createTestAgentProfile,
} from "./entity-factories.js";

import {
  TaskStatus,
  TaskType,
  TaskPriority,
  WorkerPoolType,
  WorkerLeaseStatus,
  ReviewCycleStatus,
  MergeQueueItemStatus,
  JobStatus,
  ValidationRunStatus,
  PacketStatus,
  AgentRole,
} from "@factory/domain";

/**
 * Tests for entity factory functions.
 *
 * Entity factories are used across all integration tests. They must produce
 * valid objects with sensible defaults, accept partial overrides, and
 * generate unique IDs to prevent test collisions.
 */
describe("Entity Factories", () => {
  describe("createTestProject", () => {
    /**
     * Validates default project creation produces all required fields.
     */
    it("creates a project with sensible defaults", () => {
      const project = createTestProject();
      expect(project.projectId).toMatch(/^proj-/);
      expect(project.name).toBeTruthy();
      expect(project.owner).toBe("test-owner");
      expect(project.createdAt).toBeInstanceOf(Date);
    });

    /**
     * Validates partial override support.
     */
    it("accepts overrides", () => {
      const project = createTestProject({ name: "my-project", owner: "alice" });
      expect(project.name).toBe("my-project");
      expect(project.owner).toBe("alice");
    });

    /**
     * Validates unique ID generation across calls.
     */
    it("generates unique IDs", () => {
      const p1 = createTestProject();
      const p2 = createTestProject();
      expect(p1.projectId).not.toBe(p2.projectId);
    });
  });

  describe("createTestRepository", () => {
    it("creates a repository with sensible defaults", () => {
      const repo = createTestRepository();
      expect(repo.repositoryId).toMatch(/^repo-/);
      expect(repo.defaultBranch).toBe("main");
      expect(repo.localPath).toContain(repo.repositoryId);
    });

    it("accepts overrides", () => {
      const repo = createTestRepository({ defaultBranch: "develop" });
      expect(repo.defaultBranch).toBe("develop");
    });
  });

  describe("createTestTask", () => {
    /**
     * Validates default task creation with BACKLOG status.
     * Most tests start tasks from BACKLOG and drive them forward.
     */
    it("creates a task with sensible defaults", () => {
      const task = createTestTask();
      expect(task.taskId).toMatch(/^task-/);
      expect(task.status).toBe(TaskStatus.BACKLOG);
      expect(task.taskType).toBe(TaskType.FEATURE);
      expect(task.priority).toBe(TaskPriority.MEDIUM);
      expect(task.version).toBe(1);
    });

    it("accepts status override", () => {
      const task = createTestTask({ status: TaskStatus.READY });
      expect(task.status).toBe(TaskStatus.READY);
    });
  });

  describe("createTestWorkerPool", () => {
    it("creates a developer pool by default", () => {
      const pool = createTestWorkerPool();
      expect(pool.workerPoolId).toMatch(/^pool-/);
      expect(pool.poolType).toBe(WorkerPoolType.DEVELOPER);
      expect(pool.maxConcurrency).toBe(3);
      expect(pool.currentLoad).toBe(0);
    });
  });

  describe("createTestTaskLease", () => {
    /**
     * Validates lease creation with LEASED status and future expiry.
     */
    it("creates a lease with sensible defaults", () => {
      const lease = createTestTaskLease();
      expect(lease.leaseId).toMatch(/^lease-/);
      expect(lease.status).toBe(WorkerLeaseStatus.LEASED);
      expect(lease.attempt).toBe(1);
      expect(lease.expiresAt.getTime()).toBeGreaterThan(lease.createdAt.getTime());
    });
  });

  describe("createTestReviewCycle", () => {
    it("creates a review cycle with NOT_STARTED status", () => {
      const cycle = createTestReviewCycle();
      expect(cycle.reviewCycleId).toMatch(/^review-/);
      expect(cycle.status).toBe(ReviewCycleStatus.NOT_STARTED);
      expect(cycle.cycleNumber).toBe(1);
    });
  });

  describe("createTestMergeQueueItem", () => {
    it("creates a merge queue item with ENQUEUED status", () => {
      const item = createTestMergeQueueItem();
      expect(item.mergeQueueItemId).toMatch(/^mqi-/);
      expect(item.status).toBe(MergeQueueItemStatus.ENQUEUED);
      expect(item.branchName).toContain("factory/");
    });
  });

  describe("createTestJob", () => {
    it("creates a job with PENDING status", () => {
      const job = createTestJob();
      expect(job.jobId).toMatch(/^job-/);
      expect(job.status).toBe(JobStatus.PENDING);
      expect(job.maxAttempts).toBe(3);
      expect(job.attemptCount).toBe(0);
    });
  });

  describe("createTestValidationRun", () => {
    it("creates a validation run with PENDING status", () => {
      const run = createTestValidationRun();
      expect(run.validationRunId).toMatch(/^vrun-/);
      expect(run.status).toBe(ValidationRunStatus.PENDING);
    });
  });

  describe("createTestSupervisedWorker", () => {
    it("creates an idle worker", () => {
      const worker = createTestSupervisedWorker();
      expect(worker.workerId).toMatch(/^worker-/);
      expect(worker.status).toBe("idle");
      expect(worker.currentTaskId).toBeNull();
    });
  });

  describe("createTestAuditEvent", () => {
    it("creates an audit event with sensible defaults", () => {
      const event = createTestAuditEvent();
      expect(event.id).toMatch(/^audit-/);
      expect(event.entityType).toBe("task");
      expect(event.eventType).toBe("task.transitioned");
    });
  });

  describe("createTestPacket", () => {
    it("creates a packet with SUCCESS status", () => {
      const packet = createTestPacket();
      expect(packet.packetId).toMatch(/^packet-/);
      expect(packet.status).toBe(PacketStatus.SUCCESS);
      expect(packet.artifactPath).toContain(packet.taskId);
    });
  });

  describe("createTestAgentProfile", () => {
    it("creates a developer agent profile", () => {
      const profile = createTestAgentProfile();
      expect(profile.agentProfileId).toMatch(/^profile-/);
      expect(profile.role).toBe(AgentRole.DEVELOPER);
    });
  });
});
