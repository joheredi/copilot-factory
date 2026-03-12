/**
 * Tests for the reviews service.
 *
 * Verifies review history retrieval and review cycle packet listing
 * using an in-memory SQLite database with Drizzle migrations applied.
 * Tests validate correct enrichment of review cycles with lead
 * decisions and specialist packet counts.
 *
 * @module @factory/control-plane
 */
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { ReviewsService } from "./reviews.service.js";
import { createProjectRepository } from "../infrastructure/repositories/project.repository.js";
import { createRepositoryRepository } from "../infrastructure/repositories/repository.repository.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import { createReviewCycleRepository } from "../infrastructure/repositories/review-cycle.repository.js";
import { createReviewPacketRepository } from "../infrastructure/repositories/review-packet.repository.js";
import { createLeadReviewDecisionRepository } from "../infrastructure/repositories/lead-review-decision.repository.js";
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

describe("ReviewsService", () => {
  let conn: DatabaseConnection;
  let service: ReviewsService;

  beforeEach(() => {
    conn = createTestConnection();
    service = new ReviewsService(conn);
  });

  /**
   * Validates that getReviewHistory returns undefined for a task that
   * does not exist in the database.
   */
  it("should return undefined for non-existent task", () => {
    const result = service.getReviewHistory("non-existent");
    expect(result).toBeUndefined();
  });

  /**
   * Validates that getReviewHistory returns an empty cycles list when
   * the task exists but has no review cycles.
   */
  it("should return empty review history for task with no cycles", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const taskId = seedTask(conn.db, repositoryId);

    const result = service.getReviewHistory(taskId);

    expect(result).toEqual({
      taskId,
      reviewCycles: [],
    });
  });

  /**
   * Validates that getReviewHistory correctly enriches review cycles
   * with lead decisions and specialist packet counts.
   */
  it("should return enriched review cycles with decisions and counts", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const taskId = seedTask(conn.db, repositoryId);

    const cycleRepo = createReviewCycleRepository(conn.db);
    const rpRepo = createReviewPacketRepository(conn.db);
    const ldRepo = createLeadReviewDecisionRepository(conn.db);

    const cycleId = randomUUID();
    cycleRepo.create({ reviewCycleId: cycleId, taskId, status: "APPROVED" });

    // Add two specialist packets
    rpRepo.create({
      reviewPacketId: randomUUID(),
      taskId,
      reviewCycleId: cycleId,
      reviewerType: "security",
      verdict: "approved",
      packetJson: {},
    });
    rpRepo.create({
      reviewPacketId: randomUUID(),
      taskId,
      reviewCycleId: cycleId,
      reviewerType: "architecture",
      verdict: "approved",
      packetJson: {},
    });

    // Add lead decision
    const ldId = randomUUID();
    ldRepo.create({
      leadReviewDecisionId: ldId,
      taskId,
      reviewCycleId: cycleId,
      decision: "approved",
      blockingIssueCount: 0,
      nonBlockingIssueCount: 1,
      packetJson: {},
    });

    const result = service.getReviewHistory(taskId);

    expect(result).toBeDefined();
    expect(result!.reviewCycles).toHaveLength(1);
    expect(result!.reviewCycles[0].specialistPacketCount).toBe(2);
    expect(result!.reviewCycles[0].leadReviewDecision).toBeDefined();
    expect(result!.reviewCycles[0].leadReviewDecision!.leadReviewDecisionId).toBe(ldId);
  });

  /**
   * Validates that getReviewHistory returns null leadReviewDecision
   * when a cycle has packets but no consolidated lead decision yet.
   */
  it("should return null lead decision when not yet consolidated", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const taskId = seedTask(conn.db, repositoryId);

    const cycleRepo = createReviewCycleRepository(conn.db);
    const rpRepo = createReviewPacketRepository(conn.db);

    const cycleId = randomUUID();
    cycleRepo.create({ reviewCycleId: cycleId, taskId, status: "IN_PROGRESS" });

    rpRepo.create({
      reviewPacketId: randomUUID(),
      taskId,
      reviewCycleId: cycleId,
      reviewerType: "security",
      verdict: "changes_requested",
      packetJson: {},
    });

    const result = service.getReviewHistory(taskId);

    expect(result!.reviewCycles).toHaveLength(1);
    expect(result!.reviewCycles[0].specialistPacketCount).toBe(1);
    expect(result!.reviewCycles[0].leadReviewDecision).toBeNull();
  });

  /**
   * Validates that getReviewCyclePackets returns undefined for a
   * non-existent task.
   */
  it("should return undefined for review cycle packets on non-existent task", () => {
    const result = service.getReviewCyclePackets("non-existent", "cycle-1");
    expect(result).toBeUndefined();
  });

  /**
   * Validates that getReviewCyclePackets returns undefined when the
   * cycle does not belong to the specified task (cross-task isolation).
   */
  it("should return undefined when cycle belongs to a different task", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const taskId1 = seedTask(conn.db, repositoryId);
    const taskId2 = seedTask(conn.db, repositoryId);

    const cycleRepo = createReviewCycleRepository(conn.db);

    const cycleId = randomUUID();
    cycleRepo.create({ reviewCycleId: cycleId, taskId: taskId1, status: "APPROVED" });

    const result = service.getReviewCyclePackets(taskId2, cycleId);
    expect(result).toBeUndefined();
  });

  /**
   * Validates that getReviewCyclePackets returns all specialist packets
   * and the lead decision for a valid task + cycle combination.
   */
  it("should return specialist packets and lead decision for a cycle", () => {
    const { repositoryId } = seedProjectAndRepo(conn.db);
    const taskId = seedTask(conn.db, repositoryId);

    const cycleRepo = createReviewCycleRepository(conn.db);
    const rpRepo = createReviewPacketRepository(conn.db);
    const ldRepo = createLeadReviewDecisionRepository(conn.db);

    const cycleId = randomUUID();
    cycleRepo.create({ reviewCycleId: cycleId, taskId, status: "APPROVED" });

    const rpId = randomUUID();
    rpRepo.create({
      reviewPacketId: rpId,
      taskId,
      reviewCycleId: cycleId,
      reviewerType: "security",
      verdict: "approved",
      packetJson: { verdict: "approved" },
    });

    const ldId = randomUUID();
    ldRepo.create({
      leadReviewDecisionId: ldId,
      taskId,
      reviewCycleId: cycleId,
      decision: "approved",
      blockingIssueCount: 0,
      nonBlockingIssueCount: 0,
      packetJson: { decision: "approved" },
    });

    const result = service.getReviewCyclePackets(taskId, cycleId);

    expect(result).toBeDefined();
    expect(result!.taskId).toBe(taskId);
    expect(result!.reviewCycleId).toBe(cycleId);
    expect(result!.specialistPackets).toHaveLength(1);
    expect(result!.specialistPackets[0].reviewPacketId).toBe(rpId);
    expect(result!.leadReviewDecision).toBeDefined();
    expect(result!.leadReviewDecision!.leadReviewDecisionId).toBe(ldId);
  });
});
