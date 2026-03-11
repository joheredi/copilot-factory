/**
 * Test entity factory functions for creating domain objects with sensible defaults.
 *
 * Each factory produces a plain object matching the shape of common port types
 * from the application layer. Factories accept partial overrides so tests only
 * need to specify the fields relevant to the scenario under test.
 *
 * All generated IDs use the `createTestId` helper to avoid collisions between
 * test cases. Timestamps use a fixed epoch for determinism.
 *
 * @module @factory/testing/fixtures/entity-factories
 */

import {
  TaskStatus,
  TaskType,
  TaskPriority,
  TaskSource,
  EstimatedSize,
  RiskLevel,
  WorkerLeaseStatus,
  ReviewCycleStatus,
  MergeQueueItemStatus,
  WorkerPoolType,
  JobStatus,
  JobType,
  PacketType,
  PacketStatus,
  AgentRole,
  MergeStrategy,
  ValidationRunStatus,
  ValidationRunScope,
} from "@factory/domain";

import { createTestId } from "../index.js";

// ─── Timestamps ─────────────────────────────────────────────────────────────

/** Fixed base timestamp for deterministic factory output: 2025-01-01T00:00:00Z */
const BASE_TIMESTAMP = new Date("2025-01-01T00:00:00.000Z");

// ─── Project ────────────────────────────────────────────────────────────────

/**
 * Shape of a test project entity matching the control-plane schema.
 */
export interface TestProject {
  readonly projectId: string;
  readonly name: string;
  readonly description: string | null;
  readonly owner: string;
  readonly defaultWorkflowTemplateId: string | null;
  readonly defaultPolicySetId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Create a test project with sensible defaults.
 * Override any field by passing partial overrides.
 *
 * @param overrides - Partial project fields to override defaults.
 * @returns A complete test project object.
 */
export function createTestProject(overrides: Partial<TestProject> = {}): TestProject {
  return {
    projectId: createTestId("proj"),
    name: `test-project-${createTestId("name")}`,
    description: "A test project for integration tests",
    owner: "test-owner",
    defaultWorkflowTemplateId: null,
    defaultPolicySetId: null,
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP,
    ...overrides,
  };
}

// ─── Repository ─────────────────────────────────────────────────────────────

/**
 * Shape of a test repository entity.
 */
export interface TestRepository {
  readonly repositoryId: string;
  readonly projectId: string;
  readonly name: string;
  readonly localPath: string;
  readonly defaultBranch: string;
  readonly description: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Create a test repository with sensible defaults.
 *
 * @param overrides - Partial repository fields to override defaults.
 * @returns A complete test repository object.
 */
export function createTestRepository(overrides: Partial<TestRepository> = {}): TestRepository {
  const repoId = overrides.repositoryId ?? createTestId("repo");
  return {
    repositoryId: repoId,
    projectId: overrides.projectId ?? createTestId("proj"),
    name: `test-repo-${repoId}`,
    localPath: `/repos/${repoId}`,
    defaultBranch: "main",
    description: null,
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP,
    ...overrides,
  };
}

// ─── Task ───────────────────────────────────────────────────────────────────

/**
 * Shape of a test task entity matching the control-plane schema.
 */
export interface TestTask {
  readonly taskId: string;
  readonly projectId: string;
  readonly repositoryId: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly taskType: TaskType;
  readonly priority: TaskPriority;
  readonly source: TaskSource;
  readonly estimatedSize: EstimatedSize;
  readonly riskLevel: RiskLevel;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Create a test task with sensible defaults.
 * Defaults to BACKLOG status, medium priority, feature type.
 *
 * @param overrides - Partial task fields to override defaults.
 * @returns A complete test task object.
 */
export function createTestTask(overrides: Partial<TestTask> = {}): TestTask {
  return {
    taskId: createTestId("task"),
    projectId: createTestId("proj"),
    repositoryId: createTestId("repo"),
    title: "Test task for integration testing",
    description: null,
    status: TaskStatus.BACKLOG,
    taskType: TaskType.FEATURE,
    priority: TaskPriority.MEDIUM,
    source: TaskSource.MANUAL,
    estimatedSize: EstimatedSize.M,
    riskLevel: RiskLevel.MEDIUM,
    version: 1,
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP,
    ...overrides,
  };
}

// ─── Worker Pool ────────────────────────────────────────────────────────────

/**
 * Shape of a test worker pool entity.
 */
export interface TestWorkerPool {
  readonly workerPoolId: string;
  readonly name: string;
  readonly poolType: WorkerPoolType;
  readonly maxConcurrency: number;
  readonly currentLoad: number;
  readonly agentProfileId: string | null;
  readonly description: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Create a test worker pool with sensible defaults.
 *
 * @param overrides - Partial worker pool fields to override defaults.
 * @returns A complete test worker pool object.
 */
export function createTestWorkerPool(overrides: Partial<TestWorkerPool> = {}): TestWorkerPool {
  return {
    workerPoolId: createTestId("pool"),
    name: "test-dev-pool",
    poolType: WorkerPoolType.DEVELOPER,
    maxConcurrency: 3,
    currentLoad: 0,
    agentProfileId: null,
    description: null,
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP,
    ...overrides,
  };
}

// ─── Task Lease ─────────────────────────────────────────────────────────────

/**
 * Shape of a test task lease entity.
 */
export interface TestTaskLease {
  readonly leaseId: string;
  readonly taskId: string;
  readonly workerId: string;
  readonly poolId: string;
  readonly status: WorkerLeaseStatus;
  readonly attempt: number;
  readonly expiresAt: Date;
  readonly lastHeartbeatAt: Date | null;
  readonly resultPacketId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Create a test task lease with sensible defaults.
 * Defaults to ACTIVE status with a 1-hour expiry.
 *
 * @param overrides - Partial lease fields to override defaults.
 * @returns A complete test task lease object.
 */
export function createTestTaskLease(overrides: Partial<TestTaskLease> = {}): TestTaskLease {
  const expiresAt = new Date(BASE_TIMESTAMP.getTime() + 3600_000); // +1 hour
  return {
    leaseId: createTestId("lease"),
    taskId: createTestId("task"),
    workerId: createTestId("worker"),
    poolId: createTestId("pool"),
    status: WorkerLeaseStatus.LEASED,
    attempt: 1,
    expiresAt,
    lastHeartbeatAt: null,
    resultPacketId: null,
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP,
    ...overrides,
  };
}

// ─── Review Cycle ───────────────────────────────────────────────────────────

/**
 * Shape of a test review cycle entity.
 */
export interface TestReviewCycle {
  readonly reviewCycleId: string;
  readonly taskId: string;
  readonly cycleNumber: number;
  readonly status: ReviewCycleStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Create a test review cycle with sensible defaults.
 *
 * @param overrides - Partial review cycle fields to override defaults.
 * @returns A complete test review cycle object.
 */
export function createTestReviewCycle(overrides: Partial<TestReviewCycle> = {}): TestReviewCycle {
  return {
    reviewCycleId: createTestId("review"),
    taskId: createTestId("task"),
    cycleNumber: 1,
    status: ReviewCycleStatus.NOT_STARTED,
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP,
    ...overrides,
  };
}

// ─── Merge Queue Item ───────────────────────────────────────────────────────

/**
 * Shape of a test merge queue item entity.
 */
export interface TestMergeQueueItem {
  readonly mergeQueueItemId: string;
  readonly taskId: string;
  readonly repositoryId: string;
  readonly status: MergeQueueItemStatus;
  readonly priority: TaskPriority;
  readonly mergeStrategy: MergeStrategy;
  readonly branchName: string;
  readonly position: number;
  readonly enqueuedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Create a test merge queue item with sensible defaults.
 *
 * @param overrides - Partial merge queue item fields to override defaults.
 * @returns A complete test merge queue item object.
 */
export function createTestMergeQueueItem(
  overrides: Partial<TestMergeQueueItem> = {},
): TestMergeQueueItem {
  const taskId = overrides.taskId ?? createTestId("task");
  return {
    mergeQueueItemId: createTestId("mqi"),
    taskId,
    repositoryId: createTestId("repo"),
    status: MergeQueueItemStatus.ENQUEUED,
    priority: TaskPriority.MEDIUM,
    mergeStrategy: MergeStrategy.REBASE_AND_MERGE,
    branchName: `factory/${taskId}`,
    position: 1,
    enqueuedAt: BASE_TIMESTAMP,
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP,
    ...overrides,
  };
}

// ─── Job ────────────────────────────────────────────────────────────────────

/**
 * Shape of a test job entity.
 */
export interface TestJob {
  readonly jobId: string;
  readonly jobType: JobType;
  readonly status: JobStatus;
  readonly payload: Record<string, unknown>;
  readonly priority: number;
  readonly maxAttempts: number;
  readonly attemptCount: number;
  readonly groupId: string | null;
  readonly scheduledAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Create a test job with sensible defaults.
 *
 * @param overrides - Partial job fields to override defaults.
 * @returns A complete test job object.
 */
export function createTestJob(overrides: Partial<TestJob> = {}): TestJob {
  return {
    jobId: createTestId("job"),
    jobType: JobType.VALIDATION_EXECUTION,
    status: JobStatus.PENDING,
    payload: {},
    priority: 0,
    maxAttempts: 3,
    attemptCount: 0,
    groupId: null,
    scheduledAt: BASE_TIMESTAMP,
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP,
    ...overrides,
  };
}

// ─── Validation Run ─────────────────────────────────────────────────────────

/**
 * Shape of a test validation run entity.
 */
export interface TestValidationRun {
  readonly validationRunId: string;
  readonly taskId: string;
  readonly leaseId: string;
  readonly scope: ValidationRunScope;
  readonly status: ValidationRunStatus;
  readonly profileName: string;
  readonly triggeredBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Create a test validation run with sensible defaults.
 *
 * @param overrides - Partial validation run fields to override defaults.
 * @returns A complete test validation run object.
 */
export function createTestValidationRun(
  overrides: Partial<TestValidationRun> = {},
): TestValidationRun {
  return {
    validationRunId: createTestId("vrun"),
    taskId: createTestId("task"),
    leaseId: createTestId("lease"),
    scope: ValidationRunScope.PRE_REVIEW,
    status: ValidationRunStatus.PENDING,
    profileName: "default-dev",
    triggeredBy: "system",
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP,
    ...overrides,
  };
}

// ─── Supervised Worker ──────────────────────────────────────────────────────

/**
 * Shape of a supervised worker entity matching the worker supervisor port.
 */
export interface TestSupervisedWorker {
  readonly workerId: string;
  readonly poolId: string;
  readonly name: string;
  readonly status: string;
  readonly currentTaskId: string | null;
  readonly currentRunId: string | null;
  readonly lastHeartbeatAt: string | null;
}

/**
 * Create a test supervised worker with sensible defaults.
 *
 * @param overrides - Partial worker fields to override defaults.
 * @returns A complete test supervised worker object.
 */
export function createTestSupervisedWorker(
  overrides: Partial<TestSupervisedWorker> = {},
): TestSupervisedWorker {
  return {
    workerId: createTestId("worker"),
    poolId: createTestId("pool"),
    name: "test-worker",
    status: "idle",
    currentTaskId: null,
    currentRunId: null,
    lastHeartbeatAt: null,
    ...overrides,
  };
}

// ─── Audit Event ────────────────────────────────────────────────────────────

/**
 * Shape of a test audit event.
 */
export interface TestAuditEvent {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly eventType: string;
  readonly actorType: string;
  readonly actorId: string;
  readonly oldState: string | null;
  readonly newState: string | null;
  readonly metadata: string | null;
  readonly createdAt: Date;
}

/**
 * Create a test audit event with sensible defaults.
 *
 * @param overrides - Partial audit event fields to override defaults.
 * @returns A complete test audit event object.
 */
export function createTestAuditEvent(overrides: Partial<TestAuditEvent> = {}): TestAuditEvent {
  return {
    id: createTestId("audit"),
    entityType: "task",
    entityId: createTestId("task"),
    eventType: "task.transitioned",
    actorType: "system",
    actorId: "orchestrator",
    oldState: null,
    newState: TaskStatus.READY,
    metadata: null,
    createdAt: BASE_TIMESTAMP,
    ...overrides,
  };
}

// ─── Packet ─────────────────────────────────────────────────────────────────

/**
 * Shape of a test packet record.
 */
export interface TestPacket {
  readonly packetId: string;
  readonly taskId: string;
  readonly leaseId: string;
  readonly packetType: PacketType;
  readonly status: PacketStatus;
  readonly schemaVersion: string;
  readonly artifactPath: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Create a test packet with sensible defaults.
 *
 * @param overrides - Partial packet fields to override defaults.
 * @returns A complete test packet object.
 */
export function createTestPacket(overrides: Partial<TestPacket> = {}): TestPacket {
  const taskId = overrides.taskId ?? createTestId("task");
  const packetId = overrides.packetId ?? createTestId("packet");
  return {
    packetId,
    taskId,
    leaseId: createTestId("lease"),
    packetType: PacketType.DEV_RESULT_PACKET,
    status: PacketStatus.SUCCESS,
    schemaVersion: "1.0",
    artifactPath: `repositories/repo/tasks/${taskId}/packets/dev_result-${packetId}.json`,
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP,
    ...overrides,
  };
}

// ─── Agent Profile ──────────────────────────────────────────────────────────

/**
 * Shape of a test agent profile entity.
 */
export interface TestAgentProfile {
  readonly agentProfileId: string;
  readonly name: string;
  readonly role: AgentRole;
  readonly systemPrompt: string | null;
  readonly modelConfig: Record<string, unknown> | null;
  readonly description: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Create a test agent profile with sensible defaults.
 *
 * @param overrides - Partial agent profile fields to override defaults.
 * @returns A complete test agent profile object.
 */
export function createTestAgentProfile(
  overrides: Partial<TestAgentProfile> = {},
): TestAgentProfile {
  return {
    agentProfileId: createTestId("profile"),
    name: "test-developer-profile",
    role: AgentRole.DEVELOPER,
    systemPrompt: null,
    modelConfig: null,
    description: null,
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP,
    ...overrides,
  };
}
