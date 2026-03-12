/**
 * Response mappers for normalising database entity shapes to the web-ui API contract.
 *
 * The DB schema uses entity-prefixed primary keys (e.g. `taskId`, `workerPoolId`,
 * `projectId`) while the web-ui frontend consistently expects a flat `id` field.
 * SQLite also stores booleans as 0/1 integers.
 *
 * These mappers are applied at the controller boundary so that service/repository
 * layers remain aligned with the DB schema.
 *
 * @module @factory/control-plane
 */

import type { Task } from "../infrastructure/repositories/task.repository.js";
import type { WorkerPool } from "../infrastructure/repositories/worker-pool.repository.js";
import type { AgentProfile } from "../infrastructure/repositories/agent-profile.repository.js";
import type { Project } from "../infrastructure/repositories/project.repository.js";
import type { Repository } from "../infrastructure/repositories/repository.repository.js";
import type { AuditEvent } from "../infrastructure/repositories/audit-event.repository.js";
import type { TaskLease } from "../infrastructure/repositories/task-lease.repository.js";
import type { ReviewCycle } from "../infrastructure/repositories/review-cycle.repository.js";
import type { PolicySet } from "../infrastructure/repositories/policy-set.repository.js";

// ---------------------------------------------------------------------------
// Generic paginated wrapper — preserves the existing shape, just re-types data
// ---------------------------------------------------------------------------

export interface PaginatedMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface MappedPaginatedResponse<T> {
  data: T[];
  meta: PaginatedMeta;
}

// ---------------------------------------------------------------------------
// Individual entity mappers
// ---------------------------------------------------------------------------

export type TaskResponse = Omit<Task, "taskId"> & { id: string };

export function mapTask(task: Task): TaskResponse {
  const { taskId, ...rest } = task;
  return { id: taskId, ...rest };
}

export type PoolResponse = Omit<WorkerPool, "workerPoolId" | "enabled"> & {
  id: string;
  enabled: boolean;
};

export function mapPool(pool: WorkerPool): PoolResponse {
  const { workerPoolId, enabled, ...rest } = pool;
  return { id: workerPoolId, enabled: Boolean(enabled), ...rest };
}

export type ProfileResponse = Omit<AgentProfile, "agentProfileId"> & { id: string };

export function mapProfile(profile: AgentProfile): ProfileResponse {
  const { agentProfileId, ...rest } = profile;
  return { id: agentProfileId, ...rest };
}

export type ProjectResponse = Omit<Project, "projectId"> & { id: string };

export function mapProject(project: Project): ProjectResponse {
  const { projectId, ...rest } = project;
  return { id: projectId, ...rest };
}

export type RepositoryResponse = Omit<Repository, "repositoryId"> & { id: string };

export function mapRepository(repo: Repository): RepositoryResponse {
  const { repositoryId, ...rest } = repo;
  return { id: repositoryId, ...rest };
}

export type AuditEventResponse = Omit<AuditEvent, "auditEventId" | "metadataJson" | "createdAt"> & {
  id: string;
  metadata: unknown;
  timestamp: string;
};

export function mapAuditEvent(event: AuditEvent): AuditEventResponse {
  const { auditEventId, metadataJson, createdAt, ...rest } = event;
  return {
    id: auditEventId,
    metadata: metadataJson ?? {},
    timestamp: createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
    ...rest,
  };
}

export type TaskLeaseResponse = Omit<TaskLease, "leaseId"> & { leaseId: string };

// TaskLease already uses `leaseId` which the frontend expects — pass through.
export function mapTaskLease(lease: TaskLease): TaskLeaseResponse {
  return lease;
}

export type ReviewCycleResponse = Omit<ReviewCycle, "reviewCycleId"> & {
  cycleId: string;
};

// ReviewCycle uses `reviewCycleId` in DB but frontend expects `cycleId`.
export function mapReviewCycle(cycle: ReviewCycle): ReviewCycleResponse {
  const { reviewCycleId, ...rest } = cycle;
  return { cycleId: reviewCycleId, ...rest };
}

export type PolicySetResponse = Omit<PolicySet, "policySetId"> & { id: string };

export function mapPolicySet(policySet: PolicySet): PolicySetResponse {
  const { policySetId, ...rest } = policySet;
  return { id: policySetId, ...rest };
}

// ---------------------------------------------------------------------------
// Convenience: map paginated response data
// ---------------------------------------------------------------------------

export function mapPaginated<TIn, TOut>(
  response: { data: TIn[]; meta: PaginatedMeta },
  mapper: (item: TIn) => TOut,
): MappedPaginatedResponse<TOut> {
  return { ...response, data: response.data.map(mapper) };
}
