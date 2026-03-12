/**
 * Application-layer adapter factories for the automation runtime.
 *
 * These helpers bridge the functional repositories in the control-plane app
 * to the narrow ports consumed by application services such as readiness,
 * lease acquisition, job queue management, and scheduling.
 *
 * @module @factory/control-plane/automation
 */

import type {
  JobQueueTransactionRepositories,
  JobQueueUnitOfWork,
  LeaseUnitOfWork,
  LeaseTransactionRepositories,
  ReadinessTransactionRepositories,
  ReadinessUnitOfWork,
  SchedulerTickTransactionRepositories,
  SchedulerTickUnitOfWork,
  SchedulerTransactionRepositories,
  SchedulerUnitOfWork,
  QueuedJob,
  WorkerDispatchUnitOfWork,
  WorkerDispatchTransactionRepositories,
  WorkerSpawnContext,
  SupervisorWorkspacePaths,
  SupervisorTimeoutSettings,
  SupervisorOutputSchemaExpectation,
} from "@factory/application";
import {
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

import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import { createAuditEventPortAdapter } from "../infrastructure/unit-of-work/repository-adapters.js";
import { createJobRepository, type Job } from "../infrastructure/repositories/job.repository.js";
import { createRepositoryRepository } from "../infrastructure/repositories/repository.repository.js";
import { createTaskDependencyRepository } from "../infrastructure/repositories/task-dependency.repository.js";
import { createTaskLeaseRepository } from "../infrastructure/repositories/task-lease.repository.js";
import { createTaskRepository } from "../infrastructure/repositories/task.repository.js";
import { createWorkerPoolRepository } from "../infrastructure/repositories/worker-pool.repository.js";

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
 * Build a task packet from the raw task database record.
 *
 * The task packet is a flat record containing all task metadata that the
 * worker needs to understand its assignment. It is mounted into the
 * workspace as part of the run context.
 *
 * @param task - The task row from the database.
 * @returns A serializable record of task metadata.
 */
function buildTaskPacket(task: {
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
}): Record<string, unknown> {
  return {
    taskId: task.taskId,
    repositoryId: task.repositoryId,
    externalRef: task.externalRef,
    title: task.title,
    description: task.description,
    taskType: task.taskType,
    priority: task.priority,
    severity: task.severity,
    status: task.status,
    source: task.source,
    acceptanceCriteria: toStringArray(task.acceptanceCriteria),
    definitionOfDone: toStringArray(task.definitionOfDone),
    requiredCapabilities: toStringArray(task.requiredCapabilities),
    suggestedFileScope: toStringArray(task.suggestedFileScope),
    branchName: task.branchName,
  };
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
export function createWorkerDispatchUnitOfWork(conn: DatabaseConnection): WorkerDispatchUnitOfWork {
  return {
    runInTransaction<T>(fn: (repos: WorkerDispatchTransactionRepositories) => T): T {
      const taskRepo = createTaskRepository(conn.db);
      const repoRepo = createRepositoryRepository(conn.db);

      return fn({
        dispatch: {
          resolveSpawnContext(taskId: string): WorkerSpawnContext | null {
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

            const taskPacket = buildTaskPacket(task);

            const workspacePaths: SupervisorWorkspacePaths = {
              worktreePath: `worktrees/${task.taskId}`,
              artifactRoot: `artifacts/${task.taskId}`,
              packetInputPath: `artifacts/${task.taskId}/packets/input`,
              policySnapshotPath: `artifacts/${task.taskId}/policy-snapshot.json`,
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

            return {
              repoPath: repository.remoteUrl,
              workerName,
              runContext: {
                taskPacket,
                effectivePolicySnapshot: {},
                workspacePaths,
                outputSchemaExpectation,
                timeoutSettings,
              },
            };
          },
        },
      });
    },
  };
}
