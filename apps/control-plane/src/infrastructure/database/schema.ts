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

import { sql } from "drizzle-orm";
import { index, sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

// ─── T008: Project, Repository, WorkflowTemplate ───────────────────────────

/**
 * Workflow template table — defines reusable orchestration policies for
 * task selection, review routing, merge strategy, validation, retry, and
 * escalation. Referenced by Project as the default workflow configuration.
 *
 * Policy columns (task_selection_policy, review_routing_policy, merge_policy)
 * are stored as JSON text in SQLite. Drizzle handles serialization.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 WorkflowTemplate
 */
export const workflowTemplates = sqliteTable("workflow_template", {
  /** Unique identifier (UUID). */
  workflowTemplateId: text("workflow_template_id").primaryKey(),

  /** Human-readable template name. */
  name: text("name").notNull(),

  /** Optional longer description of this workflow template. */
  description: text("description"),

  /**
   * JSON object defining how tasks are selected and prioritized for scheduling.
   * Schema validated at the application layer, stored opaquely here.
   */
  taskSelectionPolicy: text("task_selection_policy", { mode: "json" }),

  /**
   * JSON object defining how review cycles route to specialist and lead reviewers.
   * Includes reviewer-pool mapping, required-review counts, and routing rules.
   */
  reviewRoutingPolicy: text("review_routing_policy", { mode: "json" }),

  /**
   * JSON object defining the merge strategy (rebase, squash, merge-commit),
   * conflict classification (reworkable vs irrecoverable), and post-merge policy.
   */
  mergePolicy: text("merge_policy", { mode: "json" }),

  /**
   * FK to a validation policy (defined in T013 PolicySet migration).
   * Nullable until PolicySet table exists; no DB-level FK constraint yet.
   */
  validationPolicyId: text("validation_policy_id"),

  /**
   * FK to a retry policy (defined in T013 PolicySet migration).
   * Nullable until PolicySet table exists; no DB-level FK constraint yet.
   */
  retryPolicyId: text("retry_policy_id"),

  /**
   * FK to an escalation policy (defined in T013 PolicySet migration).
   * Nullable until PolicySet table exists; no DB-level FK constraint yet.
   */
  escalationPolicyId: text("escalation_policy_id"),

  /** Row creation timestamp (Unix epoch seconds). */
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),

  /** Row last-update timestamp (Unix epoch seconds). */
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Project table — top-level organizational unit that groups repositories.
 * Each project has an optional default workflow template and policy set
 * that new tasks inherit unless overridden.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Project
 */
export const projects = sqliteTable("project", {
  /** Unique identifier (UUID). */
  projectId: text("project_id").primaryKey(),

  /** Human-readable project name. Must be unique across the system. */
  name: text("name").notNull().unique(),

  /** Optional longer description of this project. */
  description: text("description"),

  /** Owner identifier (user or team). */
  owner: text("owner").notNull(),

  /**
   * FK to the default WorkflowTemplate used for new tasks in this project.
   * Nullable — projects can exist without a default template.
   */
  defaultWorkflowTemplateId: text("default_workflow_template_id").references(
    () => workflowTemplates.workflowTemplateId,
  ),

  /**
   * FK to the default PolicySet (defined in T013).
   * Nullable until PolicySet table exists; no DB-level FK constraint yet.
   */
  defaultPolicySetId: text("default_policy_set_id"),

  /** Row creation timestamp (Unix epoch seconds). */
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),

  /** Row last-update timestamp (Unix epoch seconds). */
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Repository table — a git repository belonging to a project.
 * Tasks are scoped to repositories. Each repository tracks its remote URL,
 * default branch, checkout strategy, and operational status.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Repository
 */
export const repositories = sqliteTable(
  "repository",
  {
    /** Unique identifier (UUID). */
    repositoryId: text("repository_id").primaryKey(),

    /** FK to the parent project. Enforced at DB level. */
    projectId: text("project_id")
      .notNull()
      .references(() => projects.projectId),

    /** Human-readable repository name. */
    name: text("name").notNull(),

    /** Git remote URL for cloning and fetching. */
    remoteUrl: text("remote_url").notNull(),

    /**
     * Default branch name (e.g. "main"). Used as the merge target and
     * base for worktree creation.
     */
    defaultBranch: text("default_branch").notNull().default("main"),

    /**
     * Strategy for creating local checkouts — e.g. "worktree", "clone".
     * Stored as text; validated at the application layer.
     */
    localCheckoutStrategy: text("local_checkout_strategy").notNull(),

    /**
     * Optional reference to a credential profile for repository authentication.
     * Nullable — local repos may not require credentials.
     */
    credentialProfileId: text("credential_profile_id"),

    /**
     * Repository operational status (e.g. "active", "archived", "error").
     * Stored as text; validated at the application layer.
     */
    status: text("status").notNull(),

    /** Row creation timestamp (Unix epoch seconds). */
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    /** Row last-update timestamp (Unix epoch seconds). */
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    /** Index for lookups by parent project. */
    index("idx_repository_project_id").on(table.projectId),
    /** Index for filtering repositories by status. */
    index("idx_repository_status").on(table.status),
  ],
);

// ─── T009: Task, TaskDependency ─────────────────────────────────────────────

/**
 * Task table — the central work item in the factory. Each task is scoped to
 * a repository and progresses through the task state machine defined in
 * PRD 002 §2.1. Tasks carry all lifecycle metadata including retry counts,
 * review rounds, and an optimistic concurrency version token.
 *
 * JSON array columns (acceptance_criteria, definition_of_done,
 * required_capabilities, suggested_file_scope) are stored as JSON text in
 * SQLite. Drizzle handles serialization via `{ mode: "json" }`.
 *
 * FK references to TaskLease (T011), ReviewCycle (T011), and MergeQueueItem
 * (T012) are nullable text columns with no DB-level FK constraint until those
 * tables exist.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: Task
 */
export const tasks = sqliteTable(
  "task",
  {
    /** Unique identifier (UUID). */
    taskId: text("task_id").primaryKey(),

    /** FK to the parent repository. Enforced at DB level. */
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.repositoryId),

    /**
     * External reference linking this task to an outside system
     * (e.g. GitHub issue number, Jira ticket ID). Nullable.
     */
    externalRef: text("external_ref"),

    /** Human-readable task title. */
    title: text("title").notNull(),

    /** Optional longer description of the task. */
    description: text("description"),

    /**
     * Classification of the work type (e.g. "feature", "bug_fix", "refactor").
     * Stored as text; validated at the application layer against TaskType enum.
     */
    taskType: text("task_type").notNull(),

    /**
     * Scheduling priority (e.g. "critical", "high", "medium", "low").
     * Stored as text; validated at the application layer against TaskPriority enum.
     */
    priority: text("priority").notNull(),

    /**
     * Optional severity level for bug/incident tasks.
     * Stored as text; validated at the application layer against IssueSeverity enum.
     */
    severity: text("severity"),

    /**
     * Current state in the task lifecycle state machine.
     * Stored as text; validated at the application layer against TaskStatus enum.
     */
    status: text("status").notNull(),

    /**
     * How this task was created (e.g. "manual", "automated", "follow_up").
     * Stored as text; validated at the application layer against TaskSource enum.
     */
    source: text("source").notNull(),

    /**
     * JSON array of acceptance criteria strings that must be satisfied
     * before the task can be considered complete.
     */
    acceptanceCriteria: text("acceptance_criteria", { mode: "json" }),

    /**
     * JSON array of definition-of-done checklist items.
     */
    definitionOfDone: text("definition_of_done", { mode: "json" }),

    /**
     * Optional estimated effort size (t-shirt sizing: "xs"–"xl").
     * Stored as text; validated at the application layer against EstimatedSize enum.
     */
    estimatedSize: text("estimated_size"),

    /**
     * Optional risk level affecting review routing and validation strictness.
     * Stored as text; validated at the application layer against RiskLevel enum.
     */
    riskLevel: text("risk_level"),

    /**
     * JSON array of capability strings required to work on this task
     * (e.g. ["typescript", "react", "database"]). Used for worker matching.
     */
    requiredCapabilities: text("required_capabilities", { mode: "json" }),

    /**
     * JSON array of glob patterns defining the suggested file scope
     * (e.g. ["apps/control-plane/src/modules/leases/**"]).
     * Enforcement level is determined by the effective file scope policy.
     */
    suggestedFileScope: text("suggested_file_scope", { mode: "json" }),

    /**
     * Git branch name for this task's development work. Set when the task
     * enters IN_DEVELOPMENT. Nullable before assignment.
     */
    branchName: text("branch_name"),

    /**
     * FK to the current active TaskLease (defined in T011).
     * Nullable text — no DB-level FK constraint until TaskLease table exists.
     */
    currentLeaseId: text("current_lease_id"),

    /**
     * FK to the current ReviewCycle (defined in T011).
     * Nullable text — no DB-level FK constraint until ReviewCycle table exists.
     */
    currentReviewCycleId: text("current_review_cycle_id"),

    /**
     * FK to the current MergeQueueItem (defined in T012).
     * Nullable text — no DB-level FK constraint until MergeQueueItem table exists.
     */
    mergeQueueItemId: text("merge_queue_item_id"),

    /**
     * Number of times this task has been retried after failure.
     * Used by the retry/escalation policy to determine next action.
     */
    retryCount: integer("retry_count").notNull().default(0),

    /**
     * Number of completed review rounds. Incremented each time a ReviewCycle
     * completes with REJECTED status and a new cycle begins.
     */
    reviewRoundCount: integer("review_round_count").notNull().default(0),

    /** Row creation timestamp (Unix epoch seconds). */
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    /** Row last-update timestamp (Unix epoch seconds). */
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    /**
     * Optimistic concurrency token. Incremented on every state transition.
     * Callers must include the current version in transition requests;
     * conflicting transitions are rejected.
     *
     * @see {@link file://docs/prd/002-data-model.md} §2.4 Key Invariants
     */
    version: integer("version").notNull().default(1),

    /**
     * Timestamp when the task reached a terminal state (DONE, FAILED,
     * ESCALATED, or CANCELLED). Nullable until completion.
     */
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => [
    /** Composite index for the common query pattern: tasks in a repo by status. */
    index("idx_task_repository_id_status").on(table.repositoryId, table.status),
    /** Index for global status queries (e.g. all READY tasks). */
    index("idx_task_status").on(table.status),
    /** Index for priority-based scheduling queries. */
    index("idx_task_priority").on(table.priority),
  ],
);

/**
 * Task dependency table — models directed edges in the task dependency graph.
 * Each row represents a relationship where `task_id` depends on
 * `depends_on_task_id` with a given dependency type and blocking semantics.
 *
 * A unique constraint on (task_id, depends_on_task_id) prevents duplicate
 * dependency edges. Circular dependencies are detected at the application
 * layer (DAG validation in T035).
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: TaskDependency
 */
export const taskDependencies = sqliteTable(
  "task_dependency",
  {
    /** Unique identifier (UUID). */
    taskDependencyId: text("task_dependency_id").primaryKey(),

    /** FK to the dependent task (the task that waits). */
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.taskId),

    /** FK to the dependency task (the task that must complete first). */
    dependsOnTaskId: text("depends_on_task_id")
      .notNull()
      .references(() => tasks.taskId),

    /**
     * Type of dependency relationship (e.g. "blocks", "relates_to", "parent_child").
     * Stored as text; validated at the application layer against DependencyType enum.
     */
    dependencyType: text("dependency_type").notNull(),

    /**
     * Whether this dependency is a hard block on task readiness.
     * When true (1) and dependency_type is "blocks", the dependent task cannot
     * enter READY until the dependency task reaches DONE.
     * Stored as integer (SQLite boolean): 1 = true, 0 = false.
     */
    isHardBlock: integer("is_hard_block").notNull().default(1),

    /** Row creation timestamp (Unix epoch seconds). */
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    /** Unique constraint preventing duplicate dependency edges. */
    uniqueIndex("idx_task_dependency_unique").on(table.taskId, table.dependsOnTaskId),
    /** Index for forward lookups: "what does this task depend on?" */
    index("idx_task_dependency_task_id").on(table.taskId),
    /** Index for reverse lookups: "what tasks depend on this one?" */
    index("idx_task_dependency_depends_on").on(table.dependsOnTaskId),
  ],
);

// ─── T010: WorkerPool, Worker, AgentProfile, PromptTemplate ─────────────────

/**
 * Worker pool table — defines a pool of workers with shared configuration
 * for concurrency limits, timeouts, token budgets, and capabilities.
 * Pools are typed by role (developer, reviewer, lead-reviewer, etc.) and
 * can be enabled/disabled independently.
 *
 * JSON columns (capabilities, repo_scope_rules) are stored as JSON text
 * in SQLite. Drizzle handles serialization via `{ mode: "json" }`.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: WorkerPool
 */
export const workerPools = sqliteTable(
  "worker_pool",
  {
    /** Unique identifier (UUID). */
    workerPoolId: text("worker_pool_id").primaryKey(),

    /** Human-readable pool name. */
    name: text("name").notNull(),

    /**
     * The functional role this pool serves (e.g. "developer", "reviewer").
     * Stored as text; validated at the application layer against WorkerPoolType enum.
     */
    poolType: text("pool_type").notNull(),

    /**
     * AI provider identifier (e.g. "copilot", "openai", "anthropic").
     * Nullable — may not be set for non-AI pools.
     */
    provider: text("provider"),

    /**
     * Runtime environment identifier (e.g. "copilot-cli", "docker").
     * Nullable — determined at execution time if not pre-configured.
     */
    runtime: text("runtime"),

    /**
     * AI model identifier (e.g. "gpt-4", "claude-3-opus").
     * Nullable — may inherit from provider defaults.
     */
    model: text("model"),

    /**
     * Maximum number of concurrent workers allowed in this pool.
     * Controls resource utilization and rate limiting.
     */
    maxConcurrency: integer("max_concurrency").notNull().default(1),

    /**
     * Default timeout in seconds for worker runs in this pool.
     * Can be overridden per-task. Nullable — falls back to system default.
     */
    defaultTimeoutSec: integer("default_timeout_sec"),

    /**
     * Default token budget for AI model calls per worker run.
     * Nullable — falls back to system default.
     */
    defaultTokenBudget: integer("default_token_budget"),

    /**
     * Cost profile identifier for billing and resource tracking.
     * Nullable — may not be needed for local-first deployments.
     */
    costProfile: text("cost_profile"),

    /**
     * JSON array of capability strings this pool provides
     * (e.g. ["typescript", "react", "database"]). Used for task-to-pool matching.
     */
    capabilities: text("capabilities", { mode: "json" }),

    /**
     * JSON object defining repository scope rules that restrict which
     * repositories this pool can operate on. Schema validated at the
     * application layer.
     */
    repoScopeRules: text("repo_scope_rules", { mode: "json" }),

    /**
     * Whether this pool is currently active and accepting work.
     * Stored as integer (SQLite boolean): 1 = enabled, 0 = disabled.
     */
    enabled: integer("enabled").notNull().default(1),

    /** Row creation timestamp (Unix epoch seconds). */
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    /** Row last-update timestamp (Unix epoch seconds). */
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    /** Index for filtering pools by type (e.g. all "developer" pools). */
    index("idx_worker_pool_pool_type").on(table.poolType),
    /** Index for filtering enabled/disabled pools. */
    index("idx_worker_pool_enabled").on(table.enabled),
  ],
);

/**
 * Worker table — represents an individual worker instance belonging to a pool.
 * Tracks the worker's operational status, host information, heartbeat timing,
 * and current task assignment. Health metadata is stored as JSON for
 * extensible diagnostics.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: Worker
 */
export const workers = sqliteTable(
  "worker",
  {
    /** Unique identifier (UUID). */
    workerId: text("worker_id").primaryKey(),

    /** FK to the parent worker pool. Enforced at DB level. */
    poolId: text("pool_id")
      .notNull()
      .references(() => workerPools.workerPoolId),

    /** Human-readable worker name or identifier. */
    name: text("name").notNull(),

    /**
     * Current operational status of the worker (e.g. "online", "offline", "busy", "draining").
     * Stored as text; validated at the application layer.
     */
    status: text("status").notNull(),

    /**
     * Hostname or address where this worker is running.
     * Nullable — may not be meaningful for embedded workers.
     */
    host: text("host"),

    /**
     * Version string for the worker runtime (e.g. "copilot-cli/1.2.3").
     * Nullable — set at worker registration.
     */
    runtimeVersion: text("runtime_version"),

    /**
     * Timestamp of the last heartbeat received from this worker.
     * Used for staleness detection and lease reclaim. Nullable before first heartbeat.
     */
    lastHeartbeatAt: integer("last_heartbeat_at", { mode: "timestamp" }),

    /**
     * FK to the task currently assigned to this worker.
     * Nullable when the worker is idle. References the existing tasks table.
     */
    currentTaskId: text("current_task_id").references(() => tasks.taskId),

    /**
     * Identifier for the current execution run.
     * Nullable text — no DB-level FK constraint; execution run table
     * will be defined in a future migration.
     */
    currentRunId: text("current_run_id"),

    /**
     * JSON object containing extensible health diagnostics
     * (e.g. memory usage, CPU load, error counts). Schema is not
     * enforced at the DB level.
     */
    healthMetadata: text("health_metadata", { mode: "json" }),
  },
  (table) => [
    /** Index for lookups by parent pool. */
    index("idx_worker_pool_id").on(table.poolId),
    /** Index for filtering workers by operational status. */
    index("idx_worker_status").on(table.status),
  ],
);

/**
 * Prompt template table — stores versioned prompt templates for AI agent
 * roles. Each template defines the input/output schema and stop conditions
 * for a specific agent role. Templates are referenced by AgentProfile.
 *
 * JSON columns (input_schema, output_schema, stop_conditions) are stored
 * as JSON text in SQLite. Drizzle handles serialization.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: PromptTemplate
 */
export const promptTemplates = sqliteTable(
  "prompt_template",
  {
    /** Unique identifier (UUID). */
    promptTemplateId: text("prompt_template_id").primaryKey(),

    /** Human-readable template name. */
    name: text("name").notNull(),

    /**
     * Version string for this template (e.g. "1.0.0").
     * Allows multiple versions of the same logical template to coexist.
     */
    version: text("version").notNull(),

    /**
     * The agent role this template is designed for (e.g. "developer", "reviewer").
     * Stored as text; validated at the application layer against AgentRole enum.
     */
    role: text("role").notNull(),

    /**
     * The actual prompt template text. May contain placeholders for
     * variable substitution at runtime.
     */
    templateText: text("template_text").notNull(),

    /**
     * JSON schema defining the expected input structure for this template.
     * Validated at the application layer.
     */
    inputSchema: text("input_schema", { mode: "json" }),

    /**
     * JSON schema defining the expected output structure from the AI agent.
     * Used for structured output validation.
     */
    outputSchema: text("output_schema", { mode: "json" }),

    /**
     * JSON array of stop condition definitions that determine when
     * the agent should terminate execution.
     */
    stopConditions: text("stop_conditions", { mode: "json" }),

    /** Row creation timestamp (Unix epoch seconds). */
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    /** Index for filtering templates by agent role. */
    index("idx_prompt_template_role").on(table.role),
  ],
);

/**
 * Agent profile table — defines the configuration for an AI agent attached
 * to a worker pool. Each profile references a prompt template and a set of
 * policy IDs that govern the agent's behavior during execution.
 *
 * Policy reference columns (tool_policy_id, command_policy_id, etc.) are
 * nullable text columns with no DB-level FK constraint until the PolicySet
 * table is defined in T013.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: AgentProfile
 */
export const agentProfiles = sqliteTable(
  "agent_profile",
  {
    /** Unique identifier (UUID). */
    agentProfileId: text("agent_profile_id").primaryKey(),

    /** FK to the parent worker pool. Enforced at DB level. */
    poolId: text("pool_id")
      .notNull()
      .references(() => workerPools.workerPoolId),

    /**
     * FK to the prompt template used by this profile.
     * Nullable — profile may be created before a template is assigned.
     */
    promptTemplateId: text("prompt_template_id").references(() => promptTemplates.promptTemplateId),

    /**
     * FK to the tool policy (defined in T013 PolicySet migration).
     * Nullable until PolicySet table exists; no DB-level FK constraint.
     */
    toolPolicyId: text("tool_policy_id"),

    /**
     * FK to the command policy (defined in T013 PolicySet migration).
     * Nullable until PolicySet table exists; no DB-level FK constraint.
     */
    commandPolicyId: text("command_policy_id"),

    /**
     * FK to the file scope policy (defined in T013 PolicySet migration).
     * Nullable until PolicySet table exists; no DB-level FK constraint.
     */
    fileScopePolicyId: text("file_scope_policy_id"),

    /**
     * FK to the validation policy (defined in T013 PolicySet migration).
     * Nullable until PolicySet table exists; no DB-level FK constraint.
     */
    validationPolicyId: text("validation_policy_id"),

    /**
     * FK to the review policy (defined in T013 PolicySet migration).
     * Nullable until PolicySet table exists; no DB-level FK constraint.
     */
    reviewPolicyId: text("review_policy_id"),

    /**
     * FK to the budget policy (defined in T013 PolicySet migration).
     * Nullable until PolicySet table exists; no DB-level FK constraint.
     */
    budgetPolicyId: text("budget_policy_id"),

    /**
     * FK to the retry policy (defined in T013 PolicySet migration).
     * Nullable until PolicySet table exists; no DB-level FK constraint.
     */
    retryPolicyId: text("retry_policy_id"),
  },
  (table) => [
    /** Index for lookups by parent pool. */
    index("idx_agent_profile_pool_id").on(table.poolId),
  ],
);

// ─── T011: TaskLease, ReviewCycle, ReviewPacket, LeadReviewDecision ─────────

/**
 * Task lease table — tracks the assignment of a task to a worker for execution.
 * Each lease represents a bounded work session: a worker acquires a lease,
 * sends heartbeats, and either completes or is reclaimed on timeout/crash.
 *
 * Only one active lease (non-terminal status) may exist per task at any time.
 * This invariant is enforced at the application layer; the DB stores the full
 * lease history for audit purposes.
 *
 * The `partial_result_artifact_refs` JSON column stores artifact paths captured
 * during crash recovery, enabling the next worker to resume partial work.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: TaskLease
 */
export const taskLeases = sqliteTable(
  "task_lease",
  {
    /** Unique identifier (UUID). */
    leaseId: text("lease_id").primaryKey(),

    /** FK to the task being worked on. Enforced at DB level. */
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.taskId),

    /**
     * Identifier of the worker holding this lease.
     * Nullable text — no DB-level FK constraint; the worker may be an
     * ephemeral process not registered in the workers table.
     */
    workerId: text("worker_id").notNull(),

    /**
     * FK to the worker pool that dispatched this lease.
     * Enforced at DB level — the pool must exist for scheduling traceability.
     */
    poolId: text("pool_id")
      .notNull()
      .references(() => workerPools.workerPoolId),

    /** Timestamp when the lease was acquired (Unix epoch seconds). */
    leasedAt: integer("leased_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    /**
     * Timestamp when the lease expires if no heartbeat is received.
     * Set at lease acquisition based on the pool's default_timeout_sec.
     */
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),

    /**
     * Timestamp of the most recent heartbeat from the worker.
     * Updated on each heartbeat to track worker liveness. Nullable before
     * the first heartbeat is received.
     */
    heartbeatAt: integer("heartbeat_at", { mode: "timestamp" }),

    /**
     * Current lease status in the worker lease lifecycle.
     * Stored as text; validated at the application layer against
     * WorkerLeaseStatus enum.
     */
    status: text("status").notNull(),

    /**
     * Reason the lease was reclaimed, if applicable.
     * Nullable — only set when the lease transitions to RECLAIMED or
     * TIMED_OUT status. Stored as text for flexibility.
     */
    reclaimReason: text("reclaim_reason"),

    /**
     * JSON array of artifact reference paths captured during crash recovery
     * or lease reclaim. Enables the next worker to access partial results.
     * Nullable — empty when no partial artifacts were captured.
     */
    partialResultArtifactRefs: text("partial_result_artifact_refs", { mode: "json" }),
  },
  (table) => [
    /** Index for lookups by task — "what leases exist for this task?" */
    index("idx_task_lease_task_id").on(table.taskId),
    /** Index for lookups by worker — "what is this worker working on?" */
    index("idx_task_lease_worker_id").on(table.workerId),
    /** Index for filtering leases by status (e.g. all active leases). */
    index("idx_task_lease_status").on(table.status),
  ],
);

/**
 * Review cycle table — tracks a single cycle of specialist + lead review
 * for a task. Each rework cycle creates a new ReviewCycle record. A task may
 * have many ReviewCycle records over its lifetime, but only one may be in a
 * non-terminal status at any time (enforced at the application layer).
 *
 * `required_reviewers` and `optional_reviewers` are JSON arrays of reviewer
 * pool/role identifiers. The review router populates these when the cycle
 * is created.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: ReviewCycle
 */
export const reviewCycles = sqliteTable(
  "review_cycle",
  {
    /** Unique identifier (UUID). */
    reviewCycleId: text("review_cycle_id").primaryKey(),

    /** FK to the task under review. Enforced at DB level. */
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.taskId),

    /**
     * Current status in the review cycle lifecycle.
     * Stored as text; validated at the application layer against
     * ReviewCycleStatus enum.
     */
    status: text("status").notNull(),

    /**
     * JSON array of reviewer identifiers that must submit reviews before
     * the cycle can proceed to lead review consolidation.
     */
    requiredReviewers: text("required_reviewers", { mode: "json" }),

    /**
     * JSON array of reviewer identifiers whose reviews are informational
     * but not required for cycle progression.
     */
    optionalReviewers: text("optional_reviewers", { mode: "json" }),

    /** Timestamp when the review cycle was started (Unix epoch seconds). */
    startedAt: integer("started_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    /**
     * Timestamp when the review cycle reached a terminal state.
     * Nullable until the cycle completes.
     */
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => [
    /** Index for lookups by task — "what review cycles exist for this task?" */
    index("idx_review_cycle_task_id").on(table.taskId),
    /** Index for filtering cycles by status (e.g. all in-progress cycles). */
    index("idx_review_cycle_status").on(table.status),
  ],
);

/**
 * Review packet table — stores the structured result of a single specialist
 * reviewer's assessment of a task within a review cycle. Each reviewer
 * produces one ReviewPacket per review cycle.
 *
 * The `severity_summary` JSON object contains counts of issues by severity
 * level (e.g. { critical: 0, high: 1, medium: 3, low: 2 }). The full
 * structured review is in `packet_json`.
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: ReviewPacket
 */
export const reviewPackets = sqliteTable(
  "review_packet",
  {
    /** Unique identifier (UUID). */
    reviewPacketId: text("review_packet_id").primaryKey(),

    /** FK to the task being reviewed. Enforced at DB level. */
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.taskId),

    /** FK to the parent review cycle. Enforced at DB level. */
    reviewCycleId: text("review_cycle_id")
      .notNull()
      .references(() => reviewCycles.reviewCycleId),

    /**
     * FK to the pool that dispatched the reviewer.
     * Nullable text — no DB-level FK constraint until needed by query patterns.
     */
    reviewerPoolId: text("reviewer_pool_id"),

    /**
     * Type of reviewer that produced this packet (e.g. "developer", "reviewer").
     * Stored as text; validated at the application layer.
     */
    reviewerType: text("reviewer_type").notNull(),

    /**
     * Specialist reviewer verdict: "approved", "changes_requested", or "escalated".
     * Stored as text; validated at the application layer against ReviewVerdict enum.
     */
    verdict: text("verdict").notNull(),

    /**
     * JSON object summarizing issue counts by severity level.
     * Example: { "critical": 0, "high": 1, "medium": 3, "low": 2 }
     */
    severitySummary: text("severity_summary", { mode: "json" }),

    /**
     * Full structured review packet as JSON. Contains the complete review
     * output including issues, suggestions, and metadata. Schema validated
     * at the application layer against ReviewPacket Zod schema.
     */
    packetJson: text("packet_json", { mode: "json" }),

    /** Row creation timestamp (Unix epoch seconds). */
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    /** Composite index for the common query: "all reviews in a cycle for a task." */
    index("idx_review_packet_task_cycle").on(table.taskId, table.reviewCycleId),
    /** Index for filtering packets by verdict. */
    index("idx_review_packet_verdict").on(table.verdict),
  ],
);

/**
 * Lead review decision table — stores the lead reviewer's consolidated
 * decision for a review cycle. Each review cycle has at most one lead
 * review decision. The lead reviewer considers all specialist ReviewPackets
 * and makes a final determination.
 *
 * `follow_up_task_refs` is a JSON array of task reference identifiers
 * for tasks created as follow-ups when the decision is "approved_with_follow_up".
 *
 * @see {@link file://docs/prd/002-data-model.md} §2.3 Entity: LeadReviewDecision
 */
export const leadReviewDecisions = sqliteTable(
  "lead_review_decision",
  {
    /** Unique identifier (UUID). */
    leadReviewDecisionId: text("lead_review_decision_id").primaryKey(),

    /** FK to the task under review. Enforced at DB level. */
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.taskId),

    /** FK to the parent review cycle. Enforced at DB level. */
    reviewCycleId: text("review_cycle_id")
      .notNull()
      .references(() => reviewCycles.reviewCycleId),

    /**
     * Lead reviewer's consolidated decision.
     * Stored as text; validated at the application layer against
     * LeadReviewDecision enum values.
     */
    decision: text("decision").notNull(),

    /**
     * Count of blocking issues identified across all specialist reviews.
     * Must be ≥ 1 when decision is "changes_requested" (enforced at app layer).
     */
    blockingIssueCount: integer("blocking_issue_count").notNull().default(0),

    /**
     * Count of non-blocking issues identified across all specialist reviews.
     */
    nonBlockingIssueCount: integer("non_blocking_issue_count").notNull().default(0),

    /**
     * JSON array of follow-up task reference identifiers.
     * Populated when decision is "approved_with_follow_up".
     * Nullable when no follow-up tasks are needed.
     */
    followUpTaskRefs: text("follow_up_task_refs", { mode: "json" }),

    /**
     * Full structured lead review decision packet as JSON. Contains the
     * complete consolidation output. Schema validated at the application
     * layer against LeadReviewDecisionPacket Zod schema.
     */
    packetJson: text("packet_json", { mode: "json" }),

    /** Row creation timestamp (Unix epoch seconds). */
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    /** Index for lookups by task — "all lead decisions for this task." */
    index("idx_lead_review_decision_task_id").on(table.taskId),
    /** Index for lookups by review cycle — typically one decision per cycle. */
    index("idx_lead_review_decision_cycle_id").on(table.reviewCycleId),
  ],
);
