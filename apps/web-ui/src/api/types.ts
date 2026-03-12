/**
 * Shared API response types for the Factory control-plane REST API.
 *
 * These types mirror the DTOs returned by the NestJS control-plane
 * backend. They are manually maintained to match the backend schemas.
 *
 * @see apps/control-plane — controller DTOs for canonical shapes
 */

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/** Standard paginated response envelope used by all list endpoints. */
export interface PaginatedResponse<T> {
  readonly items: T[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly hasMore: boolean;
}

/** Pagination query parameters accepted by list endpoints. */
export interface PaginationParams {
  readonly page?: number;
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * Structured error response returned by the control-plane API.
 * Matches the global exception filter format.
 */
export interface ApiError {
  readonly statusCode: number;
  readonly error: string;
  readonly message: string;
  readonly details?: unknown;
  readonly timestamp: string;
  readonly path: string;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/** Response from `GET /health`. */
export interface HealthResponse {
  readonly status: string;
  readonly service: string;
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly owner: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProjectInput {
  readonly name: string;
  readonly description?: string;
  readonly owner: string;
}

export interface UpdateProjectInput {
  readonly name?: string;
  readonly description?: string;
  readonly owner?: string;
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export interface Repository {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly remoteUrl: string;
  readonly defaultBranch: string;
  readonly localCheckoutStrategy: string;
  readonly credentialProfileId: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateRepositoryInput {
  readonly name: string;
  readonly remoteUrl: string;
  readonly defaultBranch: string;
  readonly localCheckoutStrategy: string;
  readonly credentialProfileId?: string;
  readonly status?: string;
}

export interface UpdateRepositoryInput {
  readonly name?: string;
  readonly remoteUrl?: string;
  readonly defaultBranch?: string;
  readonly localCheckoutStrategy?: string;
  readonly credentialProfileId?: string;
  readonly status?: string;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskType =
  | "feature"
  | "bug_fix"
  | "refactor"
  | "chore"
  | "documentation"
  | "test"
  | "spike";

export type TaskPriority = "critical" | "high" | "medium" | "low";

export type TaskSource = "manual" | "automated" | "follow_up" | "decomposition";

export type TaskSize = "xs" | "s" | "m" | "l" | "xl";

export type RiskLevel = "high" | "medium" | "low";

export interface Task {
  readonly id: string;
  readonly repositoryId: string;
  readonly title: string;
  readonly description: string | null;
  readonly taskType: TaskType;
  readonly priority: TaskPriority;
  readonly status: string;
  readonly source: TaskSource;
  readonly externalRef: string | null;
  readonly severity: string | null;
  readonly acceptanceCriteria: string[] | null;
  readonly definitionOfDone: string[] | null;
  readonly estimatedSize: TaskSize | null;
  readonly riskLevel: RiskLevel | null;
  readonly requiredCapabilities: string[] | null;
  readonly suggestedFileScope: string[] | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateTaskInput {
  readonly repositoryId: string;
  readonly title: string;
  readonly description?: string;
  readonly taskType: TaskType;
  readonly priority: TaskPriority;
  readonly source?: TaskSource;
  readonly externalRef?: string;
  readonly severity?: string;
  readonly acceptanceCriteria?: string[];
  readonly definitionOfDone?: string[];
  readonly estimatedSize?: TaskSize;
  readonly riskLevel?: RiskLevel;
  readonly requiredCapabilities?: string[];
  readonly suggestedFileScope?: string[];
}

export interface UpdateTaskInput {
  readonly title?: string;
  readonly description?: string;
  readonly priority?: TaskPriority;
  readonly externalRef?: string;
  readonly severity?: string;
  readonly acceptanceCriteria?: string[];
  readonly definitionOfDone?: string[];
  readonly estimatedSize?: TaskSize;
  readonly riskLevel?: RiskLevel;
  readonly requiredCapabilities?: string[];
  readonly suggestedFileScope?: string[];
  /** Required for optimistic concurrency control. */
  readonly version: number;
}

export interface TaskListParams extends PaginationParams {
  readonly status?: string;
  readonly repositoryId?: string;
  readonly priority?: string;
  readonly taskType?: string;
}

// ---------------------------------------------------------------------------
// Operator Actions
// ---------------------------------------------------------------------------

export interface OperatorActionInput {
  readonly actorId: string;
  readonly reason: string;
}

export interface ChangePriorityInput extends OperatorActionInput {
  readonly priority: TaskPriority;
}

export interface ReassignPoolInput extends OperatorActionInput {
  readonly poolId: string;
}

export interface CancelTaskInput extends OperatorActionInput {
  readonly acknowledgeInProgressWork?: boolean;
}

export interface ResolveEscalationInput extends OperatorActionInput {
  readonly resolutionType: "retry" | "cancel" | "mark_done";
  readonly poolId?: string;
  readonly evidence?: string;
}

export interface OverrideMergeOrderInput extends OperatorActionInput {
  readonly position: number;
}

export interface OperatorActionResult {
  readonly task: Task;
  readonly auditEvent: AuditEvent;
}

// ---------------------------------------------------------------------------
// Worker Pools
// ---------------------------------------------------------------------------

export type PoolType = "developer" | "reviewer" | "lead-reviewer" | "merge-assist" | "planner";

export interface WorkerPool {
  readonly id: string;
  readonly name: string;
  readonly poolType: PoolType;
  readonly provider: string | null;
  readonly runtime: string | null;
  readonly model: string | null;
  readonly maxConcurrency: number;
  readonly defaultTimeoutSec: number | null;
  readonly defaultTokenBudget: number | null;
  readonly costProfile: string | null;
  readonly capabilities: string[] | null;
  readonly repoScopeRules: Record<string, unknown> | null;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreatePoolInput {
  readonly name: string;
  readonly poolType: PoolType;
  readonly provider?: string;
  readonly runtime?: string;
  readonly model?: string;
  readonly maxConcurrency?: number;
  readonly defaultTimeoutSec?: number;
  readonly defaultTokenBudget?: number;
  readonly costProfile?: string;
  readonly capabilities?: string[];
  readonly repoScopeRules?: Record<string, unknown>;
  readonly enabled?: boolean;
}

export interface UpdatePoolInput {
  readonly name?: string;
  readonly poolType?: PoolType;
  readonly provider?: string;
  readonly runtime?: string;
  readonly model?: string;
  readonly maxConcurrency?: number;
  readonly defaultTimeoutSec?: number;
  readonly defaultTokenBudget?: number;
  readonly costProfile?: string;
  readonly capabilities?: string[];
  readonly repoScopeRules?: Record<string, unknown>;
  readonly enabled?: boolean;
}

export interface PoolListParams extends PaginationParams {
  readonly poolType?: string;
  readonly enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Agent Profiles
// ---------------------------------------------------------------------------

export interface AgentProfile {
  readonly id: string;
  readonly poolId: string;
  readonly promptTemplateId: string | null;
  readonly toolPolicyId: string | null;
  readonly commandPolicyId: string | null;
  readonly fileScopePolicyId: string | null;
  readonly validationPolicyId: string | null;
  readonly reviewPolicyId: string | null;
  readonly budgetPolicyId: string | null;
  readonly retryPolicyId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateAgentProfileInput {
  readonly promptTemplateId?: string;
  readonly toolPolicyId?: string;
  readonly commandPolicyId?: string;
  readonly fileScopePolicyId?: string;
  readonly validationPolicyId?: string;
  readonly reviewPolicyId?: string;
  readonly budgetPolicyId?: string;
  readonly retryPolicyId?: string;
}

export interface UpdateAgentProfileInput {
  readonly promptTemplateId?: string;
  readonly toolPolicyId?: string;
  readonly commandPolicyId?: string;
  readonly fileScopePolicyId?: string;
  readonly validationPolicyId?: string;
  readonly reviewPolicyId?: string;
  readonly budgetPolicyId?: string;
  readonly retryPolicyId?: string;
}

// ---------------------------------------------------------------------------
// Reviews & Artifacts
// ---------------------------------------------------------------------------

export interface ReviewCycle {
  readonly cycleId: string;
  readonly taskId: string;
  readonly status: string;
  readonly specialistCount: number;
  readonly leadDecision: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReviewHistoryResponse {
  readonly taskId: string;
  readonly cycles: ReviewCycle[];
}

export interface ReviewPacket {
  readonly packetId: string;
  readonly cycleId: string;
  readonly reviewerType: string;
  readonly verdict: string;
  readonly content: unknown;
  readonly createdAt: string;
}

export interface ReviewCyclePacketsResponse {
  readonly cycleId: string;
  readonly packets: ReviewPacket[];
  readonly leadDecision: unknown | null;
}

export interface ArtifactNode {
  readonly type: string;
  readonly id: string;
  readonly label: string;
  readonly children?: ArtifactNode[];
}

export interface ArtifactTree {
  readonly taskId: string;
  readonly artifacts: ArtifactNode[];
}

export interface PacketContent {
  readonly packetId: string;
  readonly content: unknown;
  readonly source: string;
}

export interface MergeDetail {
  readonly taskId: string;
  readonly mergeQueueItem: unknown | null;
  readonly validationRuns: unknown[];
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEvent {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly eventType: string;
  readonly actorType: string;
  readonly actorId: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: string;
}

export interface AuditListParams extends PaginationParams {
  readonly entityType?: string;
  readonly entityId?: string;
  readonly eventType?: string;
  readonly actorType?: string;
  readonly actorId?: string;
  readonly start?: string;
  readonly end?: string;
}

// ---------------------------------------------------------------------------
// Policies & Config
// ---------------------------------------------------------------------------

export interface PolicySet {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly schedulingPolicyJson: unknown | null;
  readonly reviewPolicyJson: unknown | null;
  readonly mergePolicyJson: unknown | null;
  readonly securityPolicyJson: unknown | null;
  readonly validationPolicyJson: unknown | null;
  readonly budgetPolicyJson: unknown | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpdatePolicySetInput {
  readonly name?: string;
  readonly version?: number;
  readonly schedulingPolicyJson?: unknown;
  readonly reviewPolicyJson?: unknown;
  readonly mergePolicyJson?: unknown;
  readonly securityPolicyJson?: unknown;
  readonly validationPolicyJson?: unknown;
  readonly budgetPolicyJson?: unknown;
}

export interface EffectiveConfig {
  readonly layers: Record<string, unknown>[];
  readonly effective: Record<string, unknown>;
}
