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
} from "@factory/application";
import {
  JobStatus,
  TaskPriority,
  TaskStatus,
  WorkerLeaseStatus,
  type DependencyType,
  type JobType,
  type TaskStatus as DomainTaskStatus,
  type WorkerPoolType,
} from "@factory/domain";

import type { DatabaseConnection } from "../infrastructure/database/connection.js";
import { createAuditEventPortAdapter } from "../infrastructure/unit-of-work/repository-adapters.js";
import { createJobRepository, type Job } from "../infrastructure/repositories/job.repository.js";
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
