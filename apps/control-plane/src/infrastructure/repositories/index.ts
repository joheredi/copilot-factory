/**
 * Repository module — data access layer for all control-plane entities.
 *
 * Each repository is a factory function that accepts a Drizzle
 * `BetterSQLite3Database` and returns an object with typed CRUD and query
 * methods. Pass `conn.db` for standalone reads or the `db` argument inside
 * `conn.writeTransaction(db => ...)` for transactional writes.
 *
 * @module
 */

// ─── Repository factories ──────────────────────────────────────────────────
export { createWorkflowTemplateRepository } from "./workflow-template.repository.js";
export { createProjectRepository } from "./project.repository.js";
export { createRepositoryRepository } from "./repository.repository.js";
export { createTaskRepository, VersionConflictError } from "./task.repository.js";
export { createTaskDependencyRepository } from "./task-dependency.repository.js";
export { createWorkerPoolRepository } from "./worker-pool.repository.js";
export { createWorkerRepository } from "./worker.repository.js";
export { createAgentProfileRepository } from "./agent-profile.repository.js";
export { createPromptTemplateRepository } from "./prompt-template.repository.js";
export { createTaskLeaseRepository } from "./task-lease.repository.js";
export { createReviewCycleRepository } from "./review-cycle.repository.js";
export { createReviewPacketRepository } from "./review-packet.repository.js";
export { createLeadReviewDecisionRepository } from "./lead-review-decision.repository.js";
export { createMergeQueueItemRepository } from "./merge-queue-item.repository.js";
export { createValidationRunRepository } from "./validation-run.repository.js";
export { createJobRepository } from "./job.repository.js";
export { createAuditEventRepository } from "./audit-event.repository.js";
export { createPolicySetRepository } from "./policy-set.repository.js";

// ─── Entity row types ──────────────────────────────────────────────────────
export type { WorkflowTemplate, NewWorkflowTemplate } from "./workflow-template.repository.js";
export type { Project, NewProject } from "./project.repository.js";
export type { Repository, NewRepository } from "./repository.repository.js";
export type { Task, NewTask } from "./task.repository.js";
export type { TaskDependency, NewTaskDependency } from "./task-dependency.repository.js";
export type { WorkerPool, NewWorkerPool } from "./worker-pool.repository.js";
export type { Worker, NewWorker } from "./worker.repository.js";
export type { AgentProfile, NewAgentProfile } from "./agent-profile.repository.js";
export type { PromptTemplate, NewPromptTemplate } from "./prompt-template.repository.js";
export type { TaskLease, NewTaskLease } from "./task-lease.repository.js";
export type { ReviewCycle, NewReviewCycle } from "./review-cycle.repository.js";
export type { ReviewPacket, NewReviewPacket } from "./review-packet.repository.js";
export type {
  LeadReviewDecision,
  NewLeadReviewDecision,
} from "./lead-review-decision.repository.js";
export type { MergeQueueItem, NewMergeQueueItem } from "./merge-queue-item.repository.js";
export type { ValidationRun, NewValidationRun } from "./validation-run.repository.js";
export type { Job, NewJob } from "./job.repository.js";
export type { AuditEvent, NewAuditEvent } from "./audit-event.repository.js";
export type { PolicySet, NewPolicySet } from "./policy-set.repository.js";
