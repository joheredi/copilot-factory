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
import { index, sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
