/**
 * Tests for the artifacts service.
 *
 * Verifies artifact tree assembly and packet content retrieval using
 * an in-memory SQLite database with Drizzle migrations applied. Tests
 * validate that the service correctly aggregates data from multiple
 * repository tables and handles missing entities gracefully.
 *
 * @module @factory/control-plane
 */
import { NotFoundException } from "@nestjs/common";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { ArtifactsService } from "./artifacts.service.js";
import { createProjectRepository } from "../infrastructure/repositories/project.repository.js";
import { createRepositoryRepository } from "../infrastructure/repositories/repository.repository.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import { createReviewCycleRepository } from "../infrastructure/repositories/review-cycle.repository.js";
import { createReviewPacketRepository } from "../infrastructure/repositories/review-packet.repository.js";
import { createLeadReviewDecisionRepository } from "../infrastructure/repositories/lead-review-decision.repository.js";
import { createValidationRunRepository } from "../infrastructure/repositories/validation-run.repository.js";
import { createMergeQueueItemRepository } from "../infrastructure/repositories/merge-queue-item.repository.js";
import type { DatabaseConnection } from "../infrastructure/database/connection.js";

/** Path to Drizzle migration files. */
const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;

/** Create an in-memory test database with all migrations applied. */
function createTestConnection(): DatabaseConnection {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return {
    db,
    sqlite,
    close: () => sqlite.close(),
    healthCheck: () => ({ ok: true, walMode: true, foreignKeys: true }),
    writeTransaction: <T>(fn: (d: typeof db) => T): T => {
      const runner = sqlite.transaction(() => fn(db));
      return runner.immediate() as T;
    },
  };
}

/** Seed a project and repository for FK constraints. */
function seedProjectAndRepo(db: ReturnType<typeof drizzle>): {
  projectId: string;
  repositoryId: string;
} {
  const projectId = randomUUID();
  const repositoryId = randomUUID();
  const projectRepo = createProjectRepository(db);
  projectRepo.create({
    projectId,
    name: `Project-${projectId.slice(0, 8)}`,
    owner: "test-owner",
  });
  const repoRepo = createRepositoryRepository(db);
  repoRepo.create({
    repositoryId,
    projectId,
    name: `Repo-${repositoryId.slice(0, 8)}`,
    remoteUrl: "https://github.com/test/repo.git",
    defaultBranch: "main",
    localCheckoutStrategy: "worktree",
    status: "active",
  });
  return { projectId, repositoryId };
}

/** Seed a task for FK constraints. */
function seedTask(db: ReturnType<typeof drizzle>, repositoryId: string): string {
  const taskId = randomUUID();
  const taskRepo = createTaskRepository(db);
  taskRepo.create({
    taskId,
    repositoryId,
    title: "Test Task",
    taskType: "feature",
    priority: "medium",
    source: "manual",
    status: "IN_DEVELOPMENT",
  });
  return taskId;
}

describe("ArtifactsService", () => {
  let conn: DatabaseConnection;
  let service: ArtifactsService;

  beforeEach(() => {
    conn = createTestConnection();
    service = new ArtifactsService(conn);
  });

  /**
   * Validates that getArtifactTree returns undefined for a task that
   * does not exist in the database.
   */
  it("should return undefined for non-existent task", () => {
    const result = service.getArtifactTree("non-existent");
    expect(result).toBeUndefined();
  });

  /**
   * Validates that getArtifactTree returns an empty artifact tree
   * when a task exists but has no associated artifacts.
   */
  it("should return empty artifact tree for task with no artifacts", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const taskId = seedTask(conn.db, repositoryId);

    const result = service.getArtifactTree(taskId);

    expect(result).toEqual({
      taskId,
      reviewPackets: [],
      leadReviewDecisions: [],
      validationRuns: [],
      mergeQueueItem: null,
    });
  });

  /**
   * Validates that getArtifactTree correctly aggregates review packets,
   * lead decisions, validation runs, and merge queue items from the DB.
   */
  it("should return populated artifact tree with all artifact types", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const taskId = seedTask(conn.db, repositoryId);

    const cycleRepo = createReviewCycleRepository(conn.db);
    const rpRepo = createReviewPacketRepository(conn.db);
    const ldRepo = createLeadReviewDecisionRepository(conn.db);
    const vrRepo = createValidationRunRepository(conn.db);
    const mqRepo = createMergeQueueItemRepository(conn.db);

    const cycleId = randomUUID();
    cycleRepo.create({ reviewCycleId: cycleId, taskId, status: "APPROVED" });

    const rpId = randomUUID();
    rpRepo.create({
      reviewPacketId: rpId,
      taskId,
      reviewCycleId: cycleId,
      reviewerType: "security",
      verdict: "approved",
      packetJson: { packet_type: "review_packet" },
    });

    const ldId = randomUUID();
    ldRepo.create({
      leadReviewDecisionId: ldId,
      taskId,
      reviewCycleId: cycleId,
      decision: "approved",
      blockingIssueCount: 0,
      nonBlockingIssueCount: 2,
      packetJson: { packet_type: "lead_review_decision_packet" },
    });

    const vrId = randomUUID();
    vrRepo.create({
      validationRunId: vrId,
      taskId,
      runScope: "pre_merge",
      status: "passed",
    });

    const mqId = randomUUID();
    mqRepo.create({
      mergeQueueItemId: mqId,
      taskId,
      repositoryId,
      position: 1,
      status: "queued",
    });

    const result = service.getArtifactTree(taskId);

    expect(result).toBeDefined();
    expect(result!.taskId).toBe(taskId);
    expect(result!.reviewPackets).toHaveLength(1);
    expect(result!.reviewPackets[0].reviewPacketId).toBe(rpId);
    expect(result!.reviewPackets[0].verdict).toBe("approved");
    expect(result!.leadReviewDecisions).toHaveLength(1);
    expect(result!.leadReviewDecisions[0].leadReviewDecisionId).toBe(ldId);
    expect(result!.leadReviewDecisions[0].decision).toBe("approved");
    expect(result!.validationRuns).toHaveLength(1);
    expect(result!.validationRuns[0].validationRunId).toBe(vrId);
    expect(result!.mergeQueueItem).toBeDefined();
    expect(result!.mergeQueueItem!.mergeQueueItemId).toBe(mqId);
  });

  /**
   * Validates that getPacketContent throws NotFoundException when the
   * task does not exist.
   */
  it("should throw NotFoundException for packet retrieval on missing task", () => {
    expect(() => service.getPacketContent("non-existent", "packet-1")).toThrow(NotFoundException);
  });

  /**
   * Validates that getPacketContent returns undefined when the packet
   * ID does not match any review packet or lead decision for the task.
   */
  it("should return undefined for non-existent packet", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const taskId = seedTask(conn.db, repositoryId);

    const result = service.getPacketContent(taskId, "non-existent");
    expect(result).toBeUndefined();
  });

  /**
   * Validates that getPacketContent returns a review packet's content
   * when the packetId matches a review packet belonging to the task.
   */
  it("should return review packet content by ID", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const taskId = seedTask(conn.db, repositoryId);

    const cycleRepo = createReviewCycleRepository(conn.db);
    const rpRepo = createReviewPacketRepository(conn.db);

    const cycleId = randomUUID();
    cycleRepo.create({ reviewCycleId: cycleId, taskId, status: "APPROVED" });

    const rpId = randomUUID();
    const packetData = { packet_type: "review_packet", verdict: "approved", summary: "LGTM" };
    rpRepo.create({
      reviewPacketId: rpId,
      taskId,
      reviewCycleId: cycleId,
      reviewerType: "architecture",
      verdict: "approved",
      packetJson: packetData,
    });

    const result = service.getPacketContent(taskId, rpId);

    expect(result).toBeDefined();
    expect(result!.packetId).toBe(rpId);
    expect(result!.packetSource).toBe("review_packet");
    expect(result!.content).toEqual(packetData);
  });

  /**
   * Validates that getPacketContent returns a lead review decision's
   * content when the packetId matches a lead decision belonging to the task.
   */
  it("should return lead review decision content by ID", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const taskId = seedTask(conn.db, repositoryId);

    const cycleRepo = createReviewCycleRepository(conn.db);
    const ldRepo = createLeadReviewDecisionRepository(conn.db);

    const cycleId = randomUUID();
    cycleRepo.create({ reviewCycleId: cycleId, taskId, status: "APPROVED" });

    const ldId = randomUUID();
    const decisionData = {
      packet_type: "lead_review_decision_packet",
      decision: "approved",
      summary: "All clear",
    };
    ldRepo.create({
      leadReviewDecisionId: ldId,
      taskId,
      reviewCycleId: cycleId,
      decision: "approved",
      blockingIssueCount: 0,
      nonBlockingIssueCount: 0,
      packetJson: decisionData,
    });

    const result = service.getPacketContent(taskId, ldId);

    expect(result).toBeDefined();
    expect(result!.packetId).toBe(ldId);
    expect(result!.packetSource).toBe("lead_review_decision");
    expect(result!.content).toEqual(decisionData);
  });

  /**
   * Validates that getPacketContent does not return packets belonging
   * to a different task, enforcing task-scoped access control.
   */
  it("should not return packets from a different task", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const taskId1 = seedTask(conn.db, repositoryId);
    const taskId2 = seedTask(conn.db, repositoryId);

    const cycleRepo = createReviewCycleRepository(conn.db);
    const rpRepo = createReviewPacketRepository(conn.db);

    const cycleId = randomUUID();
    cycleRepo.create({ reviewCycleId: cycleId, taskId: taskId1, status: "APPROVED" });

    const rpId = randomUUID();
    rpRepo.create({
      reviewPacketId: rpId,
      taskId: taskId1,
      reviewCycleId: cycleId,
      reviewerType: "security",
      verdict: "approved",
      packetJson: {},
    });

    // Attempt to retrieve task1's packet using task2's ID
    const result = service.getPacketContent(taskId2, rpId);
    expect(result).toBeUndefined();
  });
});
