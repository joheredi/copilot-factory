/**
 * Application-layer adapter factories for the automation runtime.
 *
 * These helpers bridge the functional repositories in the control-plane app
 * to the narrow ports consumed by application services such as readiness,
 * lease acquisition, job queue management, and scheduling.
 *
 * @module @factory/control-plane/automation
 */

import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";

import {
  VersionConflictError,
  type JobQueueTransactionRepositories,
  type JobQueueUnitOfWork,
  type LeaseUnitOfWork,
  type LeaseTransactionRepositories,
  type ReadinessTransactionRepositories,
  type ReadinessUnitOfWork,
  type SchedulerTickTransactionRepositories,
  type SchedulerTickUnitOfWork,
  type SchedulerTransactionRepositories,
  type SchedulerUnitOfWork,
  type QueuedJob,
  type WorkerDispatchUnitOfWork,
  type WorkerDispatchTransactionRepositories,
  type WorkerSpawnContext,
  type SupervisorWorkspacePaths,
  type SupervisorTimeoutSettings,
  type SupervisorOutputSchemaExpectation,
  type WorkerSupervisorUnitOfWork,
  type WorkerSupervisorTransactionRepositories,
  type SupervisedWorker,
  type WorkerEntityStatus,
  type HeartbeatUnitOfWork,
  type HeartbeatTransactionRepositories,
  type HeartbeatLeaseRepositoryPort,
  type HeartbeatableLease,
  type StaleLeaseRecord,
} from "@factory/application";
import {
  AgentRole,
  JobStatus,
  TaskPriority,
  TaskStatus,
  WorkerLeaseStatus,
  isTerminalState,
  type DependencyType,
  type JobType,
  type TaskStatus as DomainTaskStatus,
  type WorkerPoolType,
} from "@factory/domain";
import type { TaskPacket } from "@factory/schemas";

import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import { createAuditEventPortAdapter } from "../infrastructure/unit-of-work/repository-adapters.js";
import { createJobRepository, type Job } from "../infrastructure/repositories/job.repository.js";
import { createRepositoryRepository } from "../infrastructure/repositories/repository.repository.js";
import { createTaskDependencyRepository } from "../infrastructure/repositories/task-dependency.repository.js";
import { createTaskLeaseRepository } from "../infrastructure/repositories/task-lease.repository.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import { createWorkerPoolRepository } from "../infrastructure/repositories/worker-pool.repository.js";
import { createWorkerRepository } from "../infrastructure/repositories/worker.repository.js";
import { createAgentProfileRepository } from "../infrastructure/repositories/agent-profile.repository.js";
import { createPromptTemplateRepository } from "../infrastructure/repositories/prompt-template.repository.js";

const ACTIVE_LEASE_STATUSES: ReadonlySet<string> = new Set([
  WorkerLeaseStatus.LEASED,
  WorkerLeaseStatus.STARTING,
  WorkerLeaseStatus.RUNNING,
  WorkerLeaseStatus.HEARTBEATING,
  WorkerLeaseStatus.COMPLETING,
]);

const JOB_DEPENDENCY_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  JobStatus.COMPLETED,
  JobStatus.FAILED,
]);

const JOB_NON_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  JobStatus.PENDING,
  JobStatus.CLAIMED,
  JobStatus.RUNNING,
]);

const PRIORITY_RANK: Record<string, number> = {
  [TaskPriority.CRITICAL]: 0,
  [TaskPriority.HIGH]: 1,
  [TaskPriority.MEDIUM]: 2,
  [TaskPriority.LOW]: 3,
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function mapJob(job: Job): QueuedJob {
  return {
    jobId: job.jobId,
    jobType: job.jobType as JobType,
    entityType: job.entityType ?? null,
    entityId: job.entityId ?? null,
    payloadJson: job.payloadJson ?? null,
    status: job.status as (typeof JobStatus)[keyof typeof JobStatus],
    attemptCount: job.attemptCount,
    runAfter: job.runAfter ?? null,
    leaseOwner: job.leaseOwner ?? null,
    parentJobId: job.parentJobId ?? null,
    jobGroupId: job.jobGroupId ?? null,
    dependsOnJobIds: job.dependsOnJobIds ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function createReadinessUnitOfWork(conn: DatabaseConnection): ReadinessUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: ReadinessTransactionRepositories) => T): T {
      const taskRepo = createTaskRepository(conn.db);
      const dependencyRepo = createTaskDependencyRepository(conn.db);

      return fn({
        task: {
          findById(taskId) {
            const task = taskRepo.findById(taskId);
            if (!task) {
              return undefined;
            }

            return {
              taskId: task.taskId,
              status: task.status as DomainTaskStatus,
            };
          },
        },
        taskDependency: {
          findByTaskId(taskId) {
            return dependencyRepo.findByTaskId(taskId).map((edge) => ({
              taskDependencyId: edge.taskDependencyId,
              taskId: edge.taskId,
              dependsOnTaskId: edge.dependsOnTaskId,
              dependencyType: edge.dependencyType as DependencyType,
              isHardBlock: edge.isHardBlock === 1,
            }));
          },
          findByDependsOnTaskId(dependsOnTaskId) {
            return dependencyRepo.findByDependsOnTaskId(dependsOnTaskId).map((edge) => ({
              taskDependencyId: edge.taskDependencyId,
              taskId: edge.taskId,
              dependsOnTaskId: edge.dependsOnTaskId,
              dependencyType: edge.dependencyType as DependencyType,
              isHardBlock: edge.isHardBlock === 1,
            }));
          },
        },
      });
    },
  };
}

export function createLeaseUnitOfWork(conn: DatabaseConnection): LeaseUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: LeaseTransactionRepositories) => T): T {
      return conn.writeTransaction((db) => {
        const taskRepo = createTaskRepository(db);
        const leaseRepo = createTaskLeaseRepository(db);

        return fn({
          task: {
            findById(taskId) {
              const task = taskRepo.findById(taskId);
              if (!task) {
                return undefined;
              }

              return {
                id: task.taskId,
                status: task.status as DomainTaskStatus,
                version: task.version,
                currentLeaseId: task.currentLeaseId ?? null,
              };
            },
            updateStatusAndLeaseId(taskId, expectedVersion, newStatus, leaseId) {
              const updated = taskRepo.update(taskId, expectedVersion, {
                status: newStatus,
                currentLeaseId: leaseId,
              });

              return {
                id: updated.taskId,
                status: updated.status as DomainTaskStatus,
                version: updated.version,
                currentLeaseId: updated.currentLeaseId ?? null,
              };
            },
          },
          lease: {
            findActiveByTaskId(taskId) {
              const lease = leaseRepo.findActiveByTaskId(taskId);
              if (!lease) {
                return undefined;
              }

              return {
                leaseId: lease.leaseId,
                taskId: lease.taskId,
                status: lease.status as (typeof WorkerLeaseStatus)[keyof typeof WorkerLeaseStatus],
              };
            },
            create(data) {
              const lease = leaseRepo.create({
                leaseId: data.leaseId,
                taskId: data.taskId,
                workerId: data.workerId,
                poolId: data.poolId,
                status: data.status,
                expiresAt: data.expiresAt,
              });

              return {
                leaseId: lease.leaseId,
                taskId: lease.taskId,
                workerId: lease.workerId,
                poolId: lease.poolId,
                status: lease.status as (typeof WorkerLeaseStatus)[keyof typeof WorkerLeaseStatus],
                leasedAt: lease.leasedAt,
                expiresAt: lease.expiresAt,
              };
            },
          },
          auditEvent: createAuditEventPortAdapter(db),
        });
      });
    },
  };
}

export function createJobQueueUnitOfWork(conn: DatabaseConnection): JobQueueUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: JobQueueTransactionRepositories) => T): T {
      return conn.writeTransaction((db) => {
        const jobRepo = createJobRepository(db);

        return fn({
          job: {
            findById(jobId) {
              const job = jobRepo.findById(jobId);
              return job ? mapJob(job) : undefined;
            },
            findByIds(jobIds) {
              return jobIds.flatMap((jobId) => {
                const job = jobRepo.findById(jobId);
                return job ? [mapJob(job)] : [];
              });
            },
            findByGroupId(groupId) {
              return jobRepo.findByJobGroupId(groupId).map(mapJob);
            },
            create(data) {
              return mapJob(
                jobRepo.create({
                  jobId: data.jobId,
                  jobType: data.jobType,
                  entityType: data.entityType,
                  entityId: data.entityId,
                  payloadJson: data.payloadJson,
                  status: data.status,
                  attemptCount: data.attemptCount,
                  runAfter: data.runAfter,
                  leaseOwner: null,
                  parentJobId: data.parentJobId,
                  jobGroupId: data.jobGroupId,
                  dependsOnJobIds: data.dependsOnJobIds,
                }),
              );
            },
            claimNextByType(jobType, leaseOwner, now) {
              const candidates = jobRepo
                .findByStatus(JobStatus.PENDING)
                .filter((job) => job.jobType === jobType)
                .filter((job) => job.runAfter === null || job.runAfter.getTime() <= now.getTime())
                .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

              for (const candidate of candidates) {
                const dependencyIds = toStringArray(candidate.dependsOnJobIds);
                const dependenciesMet = dependencyIds.every((dependencyId) => {
                  const dependency = jobRepo.findById(dependencyId);
                  return (
                    dependency !== undefined &&
                    JOB_DEPENDENCY_TERMINAL_STATUSES.has(dependency.status)
                  );
                });

                if (!dependenciesMet) {
                  continue;
                }

                const claimed = jobRepo.claimJob(candidate.jobId, leaseOwner);
                if (claimed) {
                  return mapJob(claimed);
                }
              }

              return undefined;
            },
            updateStatus(jobId, expectedStatus, newStatus) {
              const existing = jobRepo.findById(jobId);
              if (!existing || existing.status !== expectedStatus) {
                return undefined;
              }

              const updated = jobRepo.update(jobId, {
                status: newStatus,
              });

              return updated ? mapJob(updated) : undefined;
            },
          },
        });
      });
    },
  };
}

export function createSchedulerUnitOfWork(conn: DatabaseConnection): SchedulerUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: SchedulerTransactionRepositories) => T): T {
      const taskRepo = createTaskRepository(conn.db);
      const poolRepo = createWorkerPoolRepository(conn.db);
      const leaseRepo = createTaskLeaseRepository(conn.db);

      return fn({
        task: {
          findReadyByPriority(limit) {
            return taskRepo
              .findByStatus(TaskStatus.READY)
              .sort((left, right) => {
                const priorityDiff =
                  (PRIORITY_RANK[left.priority] ?? Number.MAX_SAFE_INTEGER) -
                  (PRIORITY_RANK[right.priority] ?? Number.MAX_SAFE_INTEGER);
                if (priorityDiff !== 0) {
                  return priorityDiff;
                }

                return left.createdAt.getTime() - right.createdAt.getTime();
              })
              .slice(0, limit)
              .map((task) => ({
                taskId: task.taskId,
                repositoryId: task.repositoryId,
                priority: task.priority as TaskPriority,
                status: task.status as DomainTaskStatus,
                requiredCapabilities: toStringArray(task.requiredCapabilities),
                createdAt: task.createdAt,
              }));
          },
        },
        pool: {
          findEnabledByType(poolType) {
            const activeLeaseCounts = new Map<string, number>();
            for (const lease of leaseRepo.findAll()) {
              if (!ACTIVE_LEASE_STATUSES.has(lease.status)) {
                continue;
              }

              activeLeaseCounts.set(lease.poolId, (activeLeaseCounts.get(lease.poolId) ?? 0) + 1);
            }

            return poolRepo
              .findEnabled()
              .filter((pool) => pool.poolType === poolType)
              .map((pool) => ({
                poolId: pool.workerPoolId,
                poolType: pool.poolType as WorkerPoolType,
                capabilities: toStringArray(pool.capabilities),
                maxConcurrency: pool.maxConcurrency,
                activeLeaseCount: activeLeaseCounts.get(pool.workerPoolId) ?? 0,
                defaultTimeoutSec: pool.defaultTimeoutSec ?? 0,
                enabled: pool.enabled === 1,
              }));
          },
        },
      });
    },
  };
}

export function createSchedulerTickUnitOfWork(conn: DatabaseConnection): SchedulerTickUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: SchedulerTickTransactionRepositories) => T): T {
      const jobRepo = createJobRepository(conn.db);

      return fn({
        job: {
          countNonTerminalByType(jobType) {
            return jobRepo
              .findAll()
              .filter((job) => job.jobType === jobType && JOB_NON_TERMINAL_STATUSES.has(job.status))
              .length;
          },
        },
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Worker Dispatch constants and helpers
// ---------------------------------------------------------------------------

/** Default time budget in seconds for a worker run when no pool timeout is configured. */
const DEFAULT_TIME_BUDGET_SECONDS = 3600;

/** Default interval between worker heartbeats in seconds. */
const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;

/** Number of consecutive missed heartbeats before a worker is considered dead. */
const DEFAULT_MISSED_HEARTBEAT_THRESHOLD = 3;

/** Grace period in seconds after timeout before forceful termination. */
const DEFAULT_GRACE_PERIOD_SECONDS = 60;

/** Schema version for output packet expectations. */
const OUTPUT_SCHEMA_VERSION = "1.0.0";

/** Default stop conditions applied to all worker runs. */
const DEFAULT_STOP_CONDITIONS: readonly string[] = [
  "Stop when the task is complete and all acceptance criteria are met.",
  "Stop if you encounter an unrecoverable error.",
  "Stop when the time budget is exhausted.",
];

/**
 * Map a task type to the expected output packet type.
 *
 * The packet type determines what schema the worker's output must conform to.
 * Each task type produces a specific kind of result packet.
 *
 * @param taskType - The task's classification type from the DB.
 * @returns The expected output packet type string.
 */
function mapTaskTypeToPacketType(taskType: string): string {
  switch (taskType) {
    case "feature":
    case "bug_fix":
    case "refactor":
    case "chore":
      return "development_result";
    case "documentation":
      return "documentation_result";
    case "test":
      return "test_result";
    case "spike":
      return "spike_result";
    default:
      return "development_result";
  }
}

/**
 * Map a task type to the agent role that should execute it.
 *
 * Currently all dispatched tasks are development tasks so this defaults
 * to "developer". As the system evolves this will map review, planning,
 * and merge-assist task types to their respective roles.
 *
 * @param taskType - The task's classification type from the DB.
 * @returns The agent role for the task.
 */
function mapTaskTypeToRole(taskType: string): string {
  switch (taskType) {
    case "feature":
    case "bug_fix":
    case "refactor":
    case "chore":
    case "documentation":
    case "test":
    case "spike":
      return AgentRole.DEVELOPER;
    default:
      return AgentRole.DEVELOPER;
  }
}

/**
 * Build a complete task packet from the task database record and resolved
 * dispatch context.
 *
 * Produces a full {@link TaskPacket} containing all fields required by the
 * worker runtime adapter. Fields not yet stored in the database (e.g.
 * policy references, relational context) are populated with sensible
 * defaults.
 *
 * @param params - All data needed to construct the packet.
 * @returns A complete task packet ready for the worker.
 */
function buildTaskPacket(params: {
  task: {
    taskId: string;
    repositoryId: string;
    externalRef: string | null;
    title: string;
    description: string | null;
    taskType: string;
    priority: string;
    severity: string | null;
    status: string;
    source: string;
    acceptanceCriteria: unknown;
    definitionOfDone: unknown;
    requiredCapabilities: unknown;
    suggestedFileScope: unknown;
    branchName: string | null;
  };
  repository: {
    name: string;
    defaultBranch: string;
  };
  workspacePaths: SupervisorWorkspacePaths;
  timeBudgetSeconds: number;
  expiresAt: string;
  outputSchemaExpectation: SupervisorOutputSchemaExpectation;
}): TaskPacket {
  const {
    task,
    repository,
    workspacePaths,
    timeBudgetSeconds,
    expiresAt,
    outputSchemaExpectation,
  } = params;
  const role = mapTaskTypeToRole(task.taskType);

  return {
    packet_type: "task_packet",
    schema_version: "1.0",
    created_at: new Date().toISOString(),
    task_id: task.taskId,
    repository_id: task.repositoryId,
    role,
    time_budget_seconds: timeBudgetSeconds,
    expires_at: expiresAt,
    task: {
      title: task.title,
      description: task.description ?? "(no description)",
      task_type: task.taskType,
      priority: task.priority ?? "medium",
      severity: task.severity ?? "medium",
      acceptance_criteria: toStringArray(task.acceptanceCriteria),
      definition_of_done: toStringArray(task.definitionOfDone),
      risk_level: "medium",
      suggested_file_scope: toStringArray(task.suggestedFileScope),
      branch_name: task.branchName ?? `task/${task.taskId}`,
    },
    repository: {
      name: repository.name,
      default_branch: repository.defaultBranch,
    },
    workspace: {
      worktree_path: workspacePaths.worktreePath,
      artifact_root: workspacePaths.artifactRoot,
    },
    context: {
      related_tasks: [],
      dependencies: [],
      rejection_context: null,
      code_map_refs: [],
      prior_partial_work: null,
    },
    repo_policy: {
      policy_set_id: "default",
    },
    tool_policy: {
      command_policy_id: "default",
      file_scope_policy_id: "default",
    },
    validation_requirements: {
      profile: "default",
    },
    stop_conditions: [...DEFAULT_STOP_CONDITIONS],
    expected_output: {
      packet_type: outputSchemaExpectation.packetType,
      schema_version: outputSchemaExpectation.schemaVersion,
    },
  } as TaskPacket;
}

// ---------------------------------------------------------------------------
// Worker Dispatch Unit of Work
// ---------------------------------------------------------------------------

/**
 * Create a {@link WorkerDispatchUnitOfWork} bound to the given database
 * connection.
 *
 * This is a read-only adapter that resolves the full {@link WorkerSpawnContext}
 * from a task identifier. It loads the task and its associated repository to
 * build the task packet, workspace paths, timeout settings, and output schema
 * expectation needed by the worker supervisor.
 *
 * Uses `conn.db` directly (no write transaction) because all operations are
 * reads — following the same pattern as {@link createReadinessUnitOfWork} and
 * {@link createSchedulerUnitOfWork}.
 *
 * @param conn - The database connection to bind to.
 * @returns A WorkerDispatchUnitOfWork that resolves spawn context from DB data.
 *
 * @see {@link file://docs/backlog/tasks/T134-worker-dispatch-adapter.md}
 */
export function createWorkerDispatchUnitOfWork(
  conn: DatabaseConnection,
  artifactsRoot?: string,
): WorkerDispatchUnitOfWork {
  const resolvedArtifactsRoot = resolve(
    artifactsRoot ?? process.env["ARTIFACTS_ROOT"] ?? "./data/artifacts",
  );
  return {
    runInTransaction<T>(fn: (repos: WorkerDispatchTransactionRepositories) => T): T {
      const taskRepo = createTaskRepository(conn.db);
      const repoRepo = createRepositoryRepository(conn.db);
      const profileRepo = createAgentProfileRepository(conn.db);
      const promptTemplateRepo = createPromptTemplateRepository(conn.db);

      return fn({
        dispatch: {
          resolveSpawnContext(taskId: string, poolId?: string): WorkerSpawnContext | null {
            const task = taskRepo.findById(taskId);
            if (!task) {
              return null;
            }

            // Reject dispatch for tasks in terminal states
            if (isTerminalState(task.status as DomainTaskStatus)) {
              return null;
            }

            const repository = repoRepo.findById(task.repositoryId);
            if (!repository) {
              return null;
            }

            const workerName = `worker-${task.taskId}`;

            // Build absolute paths for artifacts and ensure directories exist
            const artifactRoot = join(resolvedArtifactsRoot, task.taskId);
            const packetInputDir = join(artifactRoot, "packets", "input");
            const packetInputPath = join(packetInputDir, "task-packet.json");
            const policySnapshotPath = join(artifactRoot, "policy-snapshot.json");

            mkdirSync(packetInputDir, { recursive: true });

            const workspacePaths: SupervisorWorkspacePaths = {
              worktreePath: `worktrees/${task.taskId}`,
              artifactRoot,
              packetInputPath,
              policySnapshotPath,
            };

            const timeBudgetSeconds = DEFAULT_TIME_BUDGET_SECONDS;
            const timeoutSettings: SupervisorTimeoutSettings = {
              timeBudgetSeconds,
              expiresAt: new Date(Date.now() + timeBudgetSeconds * 1000).toISOString(),
              heartbeatIntervalSeconds: DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
              missedHeartbeatThreshold: DEFAULT_MISSED_HEARTBEAT_THRESHOLD,
              gracePeriodSeconds: DEFAULT_GRACE_PERIOD_SECONDS,
            };

            const outputSchemaExpectation: SupervisorOutputSchemaExpectation = {
              packetType: mapTaskTypeToPacketType(task.taskType),
              schemaVersion: OUTPUT_SCHEMA_VERSION,
            };

            const taskPacket = buildTaskPacket({
              task,
              repository: {
                name: repository.name,
                defaultBranch: repository.defaultBranch,
              },
              workspacePaths,
              timeBudgetSeconds,
              expiresAt: timeoutSettings.expiresAt,
              outputSchemaExpectation,
            });

            // Resolve custom prompt template from pool's agent profile
            let customPrompt: string | undefined;
            if (poolId) {
              const profiles = profileRepo.findByPoolId(poolId);
              const profile = profiles[0]; // Use first profile for the pool
              if (profile?.promptTemplateId) {
                const template = promptTemplateRepo.findById(profile.promptTemplateId);
                if (template) {
                  customPrompt = template.templateText;
                }
              }
            }

            return {
              repoPath: repository.localCheckoutPath ?? repository.remoteUrl,
              workerName,
              runContext: {
                taskPacket,
                effectivePolicySnapshot: {},
                workspacePaths,
                outputSchemaExpectation,
                timeoutSettings,
                customPrompt,
              },
            };
          },
        },
      });
    },
  };
}

// ─── Worker Supervisor UoW ──────────────────────────────────────────────────

/**
 * Creates a WorkerSupervisorUnitOfWork that manages worker entity lifecycle.
 *
 * Wraps the worker repository in a write transaction since the supervisor
 * creates, reads, and updates worker records as it orchestrates ephemeral
 * worker processes.
 *
 * @param conn - The database connection to bind to.
 * @returns A WorkerSupervisorUnitOfWork for the worker supervisor service.
 *
 * @see {@link file://docs/backlog/tasks/T137-wire-dispatch-automation.md}
 */
export function createWorkerSupervisorUnitOfWork(
  conn: DatabaseConnection,
): WorkerSupervisorUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: WorkerSupervisorTransactionRepositories) => T): T {
      return conn.writeTransaction((db) => {
        const workerRepo = createWorkerRepository(db);

        return fn({
          worker: {
            create(data) {
              const row = workerRepo.create({
                workerId: data.workerId,
                poolId: data.poolId,
                name: data.name,
                status: data.status,
                currentTaskId: data.currentTaskId,
              });
              return mapWorkerRow(row);
            },

            findById(workerId) {
              const row = workerRepo.findById(workerId);
              if (!row) return undefined;
              return mapWorkerRow(row);
            },

            update(workerId, data) {
              const row = workerRepo.update(workerId, {
                ...(data.status !== undefined && { status: data.status }),
                ...(data.currentRunId !== undefined && { currentRunId: data.currentRunId }),
                ...(data.currentTaskId !== undefined && { currentTaskId: data.currentTaskId }),
                ...(data.lastHeartbeatAt !== undefined && {
                  lastHeartbeatAt: data.lastHeartbeatAt,
                }),
              });
              if (!row) {
                throw new VersionConflictError("Worker", workerId, "exists");
              }
              return mapWorkerRow(row);
            },
          },
        });
      });
    },
  };
}

/**
 * Map a raw worker table row to the SupervisedWorker shape expected by the port.
 *
 * @param row - Raw worker row from the database.
 * @returns A SupervisedWorker with correctly typed fields.
 */
function mapWorkerRow(row: {
  workerId: string;
  poolId: string;
  name: string;
  status: string;
  currentTaskId: string | null;
  currentRunId: string | null;
  lastHeartbeatAt: Date | null;
}): SupervisedWorker {
  return {
    workerId: row.workerId,
    poolId: row.poolId,
    name: row.name,
    status: row.status as WorkerEntityStatus,
    currentTaskId: row.currentTaskId,
    currentRunId: row.currentRunId,
    lastHeartbeatAt: row.lastHeartbeatAt,
  };
}

// ─── Heartbeat UoW ──────────────────────────────────────────────────────────

/**
 * Creates a HeartbeatUnitOfWork for atomic heartbeat and staleness operations.
 *
 * Uses `conn.writeTransaction` for atomicity since heartbeat processing
 * updates lease records and creates audit events. The `findStaleLeases`
 * query uses raw SQLite because it requires a UNION + COALESCE pattern
 * that is simpler in raw SQL than Drizzle's query builder.
 *
 * @param conn - The database connection to bind to.
 * @returns A HeartbeatUnitOfWork for the heartbeat service.
 *
 * @see {@link file://apps/control-plane/src/integration/lease-recovery.integration.test.ts}
 *   Reference implementation used as the template for this adapter.
 * @see {@link file://docs/backlog/tasks/T137-wire-dispatch-automation.md}
 */
export function createHeartbeatUnitOfWork(conn: DatabaseConnection): HeartbeatUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: HeartbeatTransactionRepositories) => T): T {
      return conn.writeTransaction((db) => {
        const leaseRepo = createTaskLeaseRepository(db);
        const auditEventPort = createAuditEventPortAdapter(db);
        // Raw SQLite handle for the UNION-based staleness query
        const rawSqlite = conn.sqlite;

        const leasePort: HeartbeatLeaseRepositoryPort = {
          findById(leaseId: string): HeartbeatableLease | undefined {
            const lease = leaseRepo.findById(leaseId);
            if (!lease) return undefined;
            return {
              leaseId: lease.leaseId,
              taskId: lease.taskId,
              workerId: lease.workerId,
              status: lease.status as WorkerLeaseStatus,
              heartbeatAt: lease.heartbeatAt,
              expiresAt: lease.expiresAt,
              leasedAt: lease.leasedAt,
            };
          },

          updateHeartbeat(
            leaseId: string,
            expectedStatus: WorkerLeaseStatus,
            newStatus: WorkerLeaseStatus,
            heartbeatAt: Date,
            newExpiresAt?: Date,
          ): HeartbeatableLease {
            const current = leaseRepo.findById(leaseId);
            if (!current || current.status !== expectedStatus) {
              throw new VersionConflictError("TaskLease", leaseId, expectedStatus);
            }
            const updateData: Record<string, unknown> = {
              status: newStatus,
              heartbeatAt,
            };
            if (newExpiresAt !== undefined) {
              updateData["expiresAt"] = newExpiresAt;
            }
            const updated = leaseRepo.update(leaseId, updateData);
            if (!updated) {
              throw new VersionConflictError("TaskLease", leaseId, expectedStatus);
            }
            return {
              leaseId: updated.leaseId,
              taskId: updated.taskId,
              workerId: updated.workerId,
              status: updated.status as WorkerLeaseStatus,
              heartbeatAt: updated.heartbeatAt,
              expiresAt: updated.expiresAt,
              leasedAt: updated.leasedAt,
            };
          },

          findStaleLeases(heartbeatDeadline: Date, ttlDeadline: Date): readonly StaleLeaseRecord[] {
            const heartbeatDeadlineSec = Math.floor(heartbeatDeadline.getTime() / 1000);
            const ttlDeadlineSec = Math.floor(ttlDeadline.getTime() / 1000);

            // Query for heartbeat-stale OR TTL-expired leases using UNION to deduplicate.
            // Uses raw SQLite because the query involves UNION and COALESCE patterns
            // that are simpler to express in raw SQL than Drizzle's query builder.
            const rows = rawSqlite
              .prepare(
                `SELECT lease_id, task_id, worker_id, pool_id, status, heartbeat_at, expires_at, leased_at
                 FROM task_lease
                 WHERE status IN ('STARTING', 'RUNNING', 'HEARTBEATING')
                   AND COALESCE(heartbeat_at, leased_at) < ?
                 UNION
                 SELECT lease_id, task_id, worker_id, pool_id, status, heartbeat_at, expires_at, leased_at
                 FROM task_lease
                 WHERE status IN ('LEASED', 'STARTING', 'RUNNING', 'HEARTBEATING')
                   AND expires_at < ?`,
              )
              .all(heartbeatDeadlineSec, ttlDeadlineSec) as Array<{
              lease_id: string;
              task_id: string;
              worker_id: string;
              pool_id: string;
              status: string;
              heartbeat_at: number | null;
              expires_at: number;
              leased_at: number;
            }>;

            return rows.map((r) => ({
              leaseId: r.lease_id,
              taskId: r.task_id,
              workerId: r.worker_id,
              poolId: r.pool_id,
              status: r.status as WorkerLeaseStatus,
              heartbeatAt: r.heartbeat_at != null ? new Date(r.heartbeat_at * 1000) : null,
              expiresAt: new Date(r.expires_at * 1000),
              leasedAt: new Date(r.leased_at * 1000),
            }));
          },
        };

        return fn({ lease: leasePort, auditEvent: auditEventPort });
      });
    },
  };
}
