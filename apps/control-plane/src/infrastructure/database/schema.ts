/**
 * Drizzle ORM schema definitions for the control-plane database.
 *
 * Entity table schemas are added incrementally by E002 migration tasks:
 * - T008: Project, Repository, WorkflowTemplate
 * - T009: Task, TaskDependency
 * - T010: WorkerPool, Worker, AgentProfile, PromptTemplate
 * - T011: TaskLease, ReviewCycle, ReviewPacket, LeadReviewDecision
 * - T012: MergeQueueItem, ValidationRun, Job
 * - T013: AuditEvent, PolicySet
 *
 * Import `* as schema` to pass all tables to Drizzle's relational query
 * builder when needed.
 *
 * @module
 */

// This empty export establishes the file as an ESM module.
// Remove it once the first table definition is added.
export {};
