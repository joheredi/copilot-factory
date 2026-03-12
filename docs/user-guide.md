# Autonomous Software Factory — User Guide

**Deterministic orchestration meets ephemeral AI agents for end-to-end autonomous software delivery.**

This guide covers everything you need to install, configure, and operate the Autonomous Software Factory. Whether you are evaluating the platform for the first time or managing production workloads, start here.

---

## Table of Contents

1. [What Is the Autonomous Software Factory?](#1-what-is-the-autonomous-software-factory)
2. [Key Concepts](#2-key-concepts)
3. [Getting Started](#3-getting-started)
4. [The Operator Dashboard (Web UI)](#4-the-operator-dashboard-web-ui)
5. [Managing Tasks](#5-managing-tasks)
6. [The Task Lifecycle](#6-the-task-lifecycle)
7. [Worker Pools and Agent Profiles](#7-worker-pools-and-agent-profiles)
8. [Reviews and Quality Gates](#8-reviews-and-quality-gates)
9. [The Merge Queue](#9-the-merge-queue)
10. [Configuration and Policies](#10-configuration-and-policies)
11. [Operator Actions](#11-operator-actions)
12. [Audit and Observability](#12-audit-and-observability)
13. [Safety and Policy Enforcement](#13-safety-and-policy-enforcement)
14. [REST API Reference](#14-rest-api-reference)
15. [Real-Time Events (WebSocket)](#15-real-time-events-websocket)
16. [Deployment Modes](#16-deployment-modes)
17. [End-to-End Walkthrough](#17-end-to-end-walkthrough)
18. [Troubleshooting](#18-troubleshooting)
19. [Glossary](#19-glossary)

---

## 1. What Is the Autonomous Software Factory?

The Autonomous Software Factory is a local-first platform that turns a backlog of software tasks into shipped, validated code. It coordinates ephemeral AI coding agents through a deterministic control plane — handling scheduling, isolated development, multi-perspective code review, serialized merging, and post-merge validation — while keeping a human operator fully in control.

### The Core Insight

> Treat AI agents as ephemeral, replaceable workers inside a deterministic state machine — not as autonomous entities. The orchestrator owns state, safety, and policy. Agents provide judgment.

### What Problems Does It Solve?

| Problem                    | How the Factory Solves It                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Agent memory drift**     | Workers are ephemeral and stateless. Every handoff is a structured artifact, not a conversation transcript. |
| **No safety guarantees**   | The control plane owns all state transitions. Agents propose; the orchestrator commits.                     |
| **Context bloat**          | Each worker receives only the context it needs for one task, then exits.                                    |
| **Merge chaos**            | A serialized merge queue integrates changes one at a time with validation at every step.                    |
| **No operator visibility** | A web UI and full audit trail let you inspect, pause, override, or intervene at any point.                  |

---

## 2. Key Concepts

Before using the system, familiarize yourself with these core terms.

### Core Entities

| Entity               | Description                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Project**          | An organizational container grouping one or more repositories with shared workflow templates and default policies.       |
| **Repository**       | A Git repository registered with the platform. Has checkout strategy, branch rules, and credential configuration.        |
| **Task**             | A unit of work (feature, bug fix, refactor, etc.) that flows through the full lifecycle from backlog to done.            |
| **Worker Pool**      | A logical group of workers sharing runtime configuration — model/provider, concurrency limits, and cost profile.         |
| **Agent Profile**    | A behavioral contract attached to a pool — prompt template, tool policies, validation expectations, and role definition. |
| **Task Lease**       | A time-limited exclusive lock on a task that prevents duplicate development. Tracks heartbeats and expiry.               |
| **Review Cycle**     | One round of multi-perspective review with specialist reviewers and a lead reviewer.                                     |
| **Merge Queue Item** | An approved task waiting in the serialized merge queue for integration.                                                  |
| **Audit Event**      | An immutable log entry recording every significant system event.                                                         |

### Worker Roles

| Role                    | What It Does                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Planner Agent**       | Analyzes the backlog, ranks tasks by priority and risk, recommends decomposition for large tasks.          |
| **Developer Agent**     | Implements a single task in an isolated Git worktree. Produces a structured development result packet.     |
| **Specialist Reviewer** | Reviews a change from one specific perspective (e.g., security, performance, correctness, architecture).   |
| **Lead Reviewer**       | Consolidates all specialist feedback and makes the final decision: approve, reject, or escalate.           |
| **Merge Assist Agent**  | Analyzes merge conflicts when deterministic rebase fails. Recommends resolution strategy.                  |
| **Post-Merge Analyzer** | Investigates regressions after merge. Determines if the failure is from the merged change or pre-existing. |

### Key Principles

- **Workers propose → Orchestrator commits.** Agents never self-assign, self-approve, or self-merge.
- **Structured packets, not transcripts.** Every stage exchange uses schema-validated JSON, not conversation history.
- **One task, one worker.** Each agent processes exactly one task, then exits.
- **Operator-first control.** Humans can pause, resume, requeue, reprioritize, or override at any point.

---

## 3. Getting Started

### Prerequisites

- **Node.js** ≥ 20
- **pnpm** (managed via corepack)
- **Git** (for worktree-based workspaces)

### Installation

```bash
# Enable pnpm via corepack
corepack enable

# Clone and install
git clone <repository-url>
cd copilot-factory
pnpm install
pnpm build
```

### Starting the Control Plane

```bash
cd apps/control-plane

# Initialize the database (first time only)
pnpm db:migrate

# Start the development server
pnpm dev
```

The control plane API is now running at **http://localhost:3000**.

- **Health check:** `GET http://localhost:3000/health`
- **API documentation (Swagger):** http://localhost:3000/api/docs

### Starting the Web UI

In a separate terminal:

```bash
cd apps/web-ui
pnpm dev
```

The operator dashboard is now available at **http://localhost:5173**.

The Web UI automatically proxies API requests (`/api`) and WebSocket connections (`/socket.io`) to the control plane on port 3000.

### Verifying the Setup

```bash
# Check the control plane is running
curl http://localhost:3000/health

# Expected response:
# { "status": "ok", "service": "factory-control-plane", "timestamp": "..." }
```

### Environment Variables

| Variable                      | Default                 | Description                                     |
| ----------------------------- | ----------------------- | ----------------------------------------------- |
| `PORT`                        | `3000`                  | Control plane HTTP port                         |
| `DATABASE_PATH`               | `./data/factory.db`     | SQLite database file path                       |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OpenTelemetry collector endpoint                |
| `OTEL_TRACING_ENABLED`        | `true`                  | Set to `"false"` to disable tracing             |
| `NODE_ENV`                    | `production`            | Set to `"development"` for console trace output |

---

## 4. The Operator Dashboard (Web UI)

The Web UI is the primary operator interface. It provides real-time visibility into every part of the system and full control over task execution.

### Pages

| Page              | URL            | Purpose                                                                                                   |
| ----------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| **Dashboard**     | `/dashboard`   | System health, task counts by status, worker pool capacity, recent activity feed.                         |
| **Tasks**         | `/tasks`       | Browse and filter all tasks. Create new tasks. Bulk operations.                                           |
| **Task Detail**   | `/tasks/:id`   | Full task timeline, current state, lease info, review history, artifacts, dependencies, operator actions. |
| **Workers**       | `/workers`     | Worker pool list with worker counts, active task counts, and profile summaries.                           |
| **Worker Detail** | `/workers/:id` | Pool configuration, attached profiles, and active worker sessions.                                        |
| **Reviews**       | `/reviews`     | Review center showing active and completed review cycles, specialist packets, and lead decisions.         |
| **Merge Queue**   | `/merge-queue` | Ordered merge queue with status filtering and operator controls for reordering.                           |
| **Configuration** | `/config`      | Policy editor, pool settings, effective configuration viewer.                                             |
| **Audit**         | `/audit`       | Full event log with advanced multi-criteria filtering and time-range search.                              |

### Real-Time Updates

The dashboard receives live updates via WebSocket (Socket.io). When a task changes state, a review completes, or a worker reports status, the UI updates immediately without requiring a page refresh.

---

## 5. Managing Tasks

### Creating a Task

Create a task through the Web UI or the REST API:

```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "repositoryId": "repo-123",
    "title": "Fix login redirect bug",
    "description": "After OAuth callback, user is redirected to /home instead of the original page",
    "taskType": "bug_fix",
    "priority": "high",
    "riskLevel": "medium",
    "acceptanceCriteria": [
      "User is redirected to original page after OAuth",
      "Redirect works for both app and API clients"
    ],
    "dependsOnTaskIds": []
  }'
```

You can also create multiple tasks atomically:

```bash
curl -X POST http://localhost:3000/tasks/batch \
  -H "Content-Type: application/json" \
  -d '{ "tasks": [ ... ] }'
```

### Task Fields

| Field                | Description                                  | Values                                                                      |
| -------------------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| `taskType`           | Kind of work                                 | `feature`, `bug_fix`, `refactor`, `chore`, `documentation`, `test`, `spike` |
| `priority`           | Scheduling order                             | `critical`, `high`, `medium`, `low`                                         |
| `riskLevel`          | Affects review routing and scrutiny          | `high`, `medium`, `low`                                                     |
| `estimatedSize`      | Effort estimate                              | `xs`, `s`, `m`, `l`, `xl`                                                   |
| `source`             | How the task was created                     | `manual`, `automated`, `follow_up`, `decomposition`                         |
| `acceptanceCriteria` | Requirements the implementation must satisfy | Array of strings                                                            |
| `definitionOfDone`   | Completion criteria                          | String                                                                      |
| `suggestedFileScope` | Glob patterns limiting agent file access     | Array of patterns, e.g., `["src/auth/**"]`                                  |

### Browsing and Filtering Tasks

The **Tasks** page (`/tasks`) supports filtering by:

- **Status** — Show only tasks in specific lifecycle states
- **Priority** — Filter by `critical`, `high`, `medium`, or `low`
- **Task type** — Filter by `feature`, `bug_fix`, `refactor`, etc.
- **Repository** — Scope to a specific repository

Filter state is synced to the URL so you can bookmark and share filtered views.

### Viewing Task Details

Click any task to open its detail view (`/tasks/:id`), which shows:

- **Current state** and full state transition timeline
- **Active lease** — which worker is assigned, heartbeat status, time remaining
- **Review history** — all review cycles with specialist and lead feedback
- **Dependencies** — upstream blockers and downstream dependents
- **Artifacts** — development packets, review packets, diffs, logs
- **Audit events** — every state transition and operator action on this task

---

## 6. The Task Lifecycle

Every task flows through a dependency-aware pipeline with isolated execution at each stage.

### State Machine Overview

```
┌─────────┐   ┌──────────┐   ┌────────────┐   ┌─────────────┐   ┌──────────┐   ┌───────┐   ┌──────┐
│ Backlog  │──▶│ Schedule │──▶│  Develop   │──▶│   Review    │──▶│  Merge   │──▶│ Valid. │──▶│ Done │
│          │   │ & Assign │   │ (isolated) │   │ (multi-PoV) │   │ (serial) │   │       │   │      │
└─────────┘   └──────────┘   └────────────┘   └─────────────┘   └──────────┘   └───────┘   └──────┘
```

### All 16 States

| State                   | Description                                                           |
| ----------------------- | --------------------------------------------------------------------- |
| `BACKLOG`               | Task is registered but not yet eligible for scheduling.               |
| `READY`                 | All dependencies satisfied; task is eligible for assignment.          |
| `BLOCKED`               | One or more hard-block dependencies are unsatisfied.                  |
| `ASSIGNED`              | Scheduler has granted a lease to a worker for this task.              |
| `IN_DEVELOPMENT`        | Worker has started execution (first heartbeat received).              |
| `DEV_COMPLETE`          | Worker submitted a valid development result packet.                   |
| `IN_REVIEW`             | Review cycle is active — specialist reviewers are examining the work. |
| `CHANGES_REQUESTED`     | Lead reviewer rejected; task needs rework.                            |
| `APPROVED`              | Lead reviewer approved the implementation.                            |
| `QUEUED_FOR_MERGE`      | Task is waiting in the serialized merge queue.                        |
| `MERGING`               | Merge worker is actively integrating the change.                      |
| `POST_MERGE_VALIDATION` | Post-merge checks (tests, lint, etc.) are running.                    |
| `DONE`                  | Task is complete — code merged and validated.                         |
| `FAILED`                | Unrecoverable failure (execution, merge, or validation).              |
| `ESCALATED`             | Awaiting human operator intervention.                                 |
| `CANCELLED`             | Abandoned by operator or policy.                                      |

### Key Transition Rules

- **`BACKLOG → READY`** — Automatic when all hard-block dependencies are satisfied and no policy blockers remain.
- **`READY → ASSIGNED`** — Scheduler selects the highest-priority ready task and grants an exclusive lease.
- **`ASSIGNED → IN_DEVELOPMENT`** — Worker sends its first heartbeat confirming session start.
- **`IN_DEVELOPMENT → DEV_COMPLETE`** — Worker emits a schema-valid DevResultPacket.
- **`DEV_COMPLETE → IN_REVIEW`** — Review router determines required specialist domains and fans out.
- **`IN_REVIEW → APPROVED`** — Lead reviewer approves (with or without follow-up tasks).
- **`IN_REVIEW → CHANGES_REQUESTED`** — Lead reviewer rejects; task returns to `ASSIGNED` for rework.
- **`APPROVED → QUEUED_FOR_MERGE`** — Automatic enqueue.
- **`MERGING → POST_MERGE_VALIDATION → DONE`** — Successful integration path.
- **Any state → `ESCALATED`** — Automatic (retry limit, critical risk) or operator-initiated.
- **Any state → `CANCELLED`** — Operator or policy decision.

### Dependencies

Tasks can depend on other tasks with three relationship types:

| Type            | Behavior                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `blocks` (hard) | Dependent task cannot enter `READY` until the blocker reaches `DONE`.                            |
| `blocks` (soft) | Informational — the dependent is notified but not blocked.                                       |
| `relates_to`    | Informational link only; no scheduling impact.                                                   |
| `parent_child`  | Hierarchical grouping — parent cannot reach `DONE` until all children are `DONE` or `CANCELLED`. |

- Circular dependencies are rejected at creation time.
- When a dependency completes, all reverse-dependents are automatically re-evaluated for readiness.

---

## 7. Worker Pools and Agent Profiles

### Worker Pools

A **worker pool** is a logical group of workers with shared infrastructure configuration.

| Pool Field            | Description                                                                 |
| --------------------- | --------------------------------------------------------------------------- |
| `name`                | Human-readable name (e.g., "Developer Pool - GPT-4")                        |
| `pool_type`           | `developer`, `reviewer`, `lead-reviewer`, `merge-assist`, `planner`         |
| `provider`            | AI provider (e.g., OpenAI, Anthropic)                                       |
| `model`               | Model identifier (e.g., `gpt-4`, `claude-3`)                                |
| `max_concurrency`     | Maximum simultaneous workers in this pool                                   |
| `default_timeout_sec` | Default lease timeout for workers                                           |
| `capabilities`        | Tags describing what this pool can handle (e.g., `["typescript", "react"]`) |
| `repo_scope_rules`    | Which repositories this pool can serve                                      |

### Managing Pools

```bash
# Create a pool
curl -X POST http://localhost:3000/pools \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Developer Pool",
    "poolType": "developer",
    "provider": "copilot-cli",
    "model": "gpt-4",
    "maxConcurrency": 3,
    "defaultTimeoutSec": 3600
  }'

# List pools
curl http://localhost:3000/pools

# View pool detail with active workers
curl http://localhost:3000/pools/:id
```

### Agent Profiles

Each pool has one or more **agent profiles** that define behavioral contracts:

| Profile Field          | Description                                |
| ---------------------- | ------------------------------------------ |
| `prompt_template_id`   | Which prompt template to use for this role |
| `tool_policy_id`       | Allowed tools and APIs                     |
| `command_policy_id`    | Allowed shell commands                     |
| `file_scope_policy_id` | File access restrictions                   |
| `validation_policy_id` | Required validations before completion     |
| `review_policy_id`     | Review requirements                        |
| `retry_policy_id`      | Retry behavior on failure                  |

Profiles let you run multiple behavioral configurations on the same infrastructure pool, or swap prompts without redefining the pool.

---

## 8. Reviews and Quality Gates

### How Review Works

When a developer agent completes a task, the review system automatically:

1. **Routes** — Determines which specialist review perspectives are needed based on file paths changed, task tags, risk level, and policy rules.
2. **Fans out** — Launches specialist reviewers **in parallel** for maximum speed.
3. **Consolidates** — A lead reviewer reads all specialist feedback and makes the final call.

### Review Cycle States

```
NOT_STARTED → ROUTED → IN_PROGRESS → AWAITING_REQUIRED_REVIEWS → CONSOLIDATING → APPROVED / REJECTED / ESCALATED
```

### Specialist Reviewer Perspectives

The system can route reviews to domain-specific specialists such as:

- **Correctness reviewer** — Does the code do what the task requires?
- **Security reviewer** — Are there vulnerabilities, credential leaks, or injection risks?
- **Architecture reviewer** — Does the change follow established patterns?
- **Performance reviewer** — Are there efficiency concerns?
- **Test quality reviewer** — Are tests sufficient and meaningful?

Routing is policy-driven. For example, you can configure rules like:

- All changes touching `.env` or `secrets/` files → require security review
- All `high` risk tasks → require all specialist perspectives
- All features → require at least 2 specialist reviews

### Lead Reviewer Decisions

The lead reviewer consolidates specialist feedback and chooses one of:

| Decision                    | Effect                                                                   |
| --------------------------- | ------------------------------------------------------------------------ |
| **Approved**                | Task moves to merge queue.                                               |
| **Approved with follow-up** | Task moves to merge queue AND follow-up tasks are automatically created. |
| **Changes requested**       | Task returns to development for rework with specific feedback.           |
| **Escalated**               | Task moves to `ESCALATED` for human operator intervention.               |

The lead reviewer is explicitly designed to **prevent infinite rejection loops** — preferring approval with follow-up tasks when the change is safe and materially satisfies the task requirements.

### Viewing Reviews

The **Reviews** page (`/reviews`) shows:

- Active and completed review cycles
- Specialist review packets with issues, severity, and rationale
- Lead reviewer consolidation and decision
- Review history for tasks that went through multiple rounds

---

## 9. The Merge Queue

### How Merging Works

Approved tasks enter a **serialized merge queue** that integrates changes one at a time. There are two related state machines working together:

**Task states** track the high-level workflow visible to operators:

```
QUEUED_FOR_MERGE → MERGING → POST_MERGE_VALIDATION → DONE
```

**Merge queue item states** track the detailed execution steps within the merge process:

```
ENQUEUED → PREPARING → REBASING → VALIDATING → MERGING → MERGED
```

While a task is in `QUEUED_FOR_MERGE`, its associated merge queue item progresses through the granular steps. Once the item reaches `MERGED`, the task transitions to `MERGING` and then `POST_MERGE_VALIDATION`.

The merge queue item steps are:

1. **Enqueued** — Item is waiting in the queue for a merge worker.
2. **Preparing** — Merge worker is assigned and setting up the workspace.
3. **Rebasing** — Attempting to rebase the task branch onto the latest main branch.
4. **Validating** — Running the full pre-merge validation suite (tests, lint, static analysis).
5. **Merging** — Executing the actual merge if rebase and validation succeed.
6. **Merged** — Merge succeeded. The task then enters post-merge validation.

Merge queue items can also enter **Requeued** (on transient failures or preemption — automatically re-enters as `ENQUEUED`) or **Failed** (on irrecoverable errors).

### Why Serialized?

Serialized merging ensures:

- Mainline is always in a valid state
- Conflicts are detected and resolved before they compound
- Each merged change is individually validated
- Regressions are attributable to a specific task

### Merge Conflict Handling

When a rebase creates conflicts:

1. **Deterministic resolution** — If changes don't overlap, rebase succeeds automatically.
2. **AI-assisted resolution** (if `merge_policy.allow_ai_assist` is enabled) — The merge assist agent analyzes conflicts and recommends:
   - `auto_resolve` — Safe to apply suggested resolution
   - `reject_to_dev` — Send back to the developer for rework
   - `escalate` — Requires human operator intervention
3. **Orchestrator decides** — The merge policy classifies the conflict as reworkable or irrecoverable.

### Operator Controls

From the **Merge Queue** page (`/merge-queue`), operators can:

- View the current queue order and status of each item
- **Override merge ordering** — Reorder tasks in the queue (if policy permits)
- **Remove items** — Pull a task out of the merge queue
- Filter by status (`ENQUEUED`, `PREPARING`, `REBASING`, `VALIDATING`, `MERGING`, `MERGED`)

---

## 10. Configuration and Policies

### Configuration Hierarchy

Configuration resolves through 8 layers, from broadest to most specific (highest precedence wins):

```
1. System Defaults          (built-in sensible defaults)
2. Environment Defaults     (dev vs. production)
3. Organization Defaults    (org-wide rules)
4. Project Defaults         (per-project overrides)
5. Workflow Template         (per-repo workflow)
6. Worker Pool Config       (per-pool settings)
7. Task-Type Overrides      (per task type, e.g., all bug_fix tasks)
8. Task-Level Overrides     (per individual task + operator emergency override)
```

The resolved **effective policy** is passed to every worker as part of their input packet and persisted for auditability.

### The 8 Policy Sub-Systems

#### 1. Command Policy

Controls which shell commands workers can execute.

```json
{
  "mode": "allowlist",
  "allowed_commands": [
    { "command": "pnpm", "allowed_args_prefixes": ["install", "test", "lint", "build"] },
    { "command": "git", "allowed_args_prefixes": ["status", "diff", "add", "commit"] }
  ],
  "denied_patterns": ["rm -rf /", "curl * | sh", "sudo *"],
  "allow_shell_compound_commands": false,
  "allow_subshells": false
}
```

#### 2. File Scope Policy

Restricts which files workers can read and write.

- **`strict`** — Violations immediately fail the run.
- **`audit`** — Violations are logged but allowed.
- **`advisory`** — Informational only.

#### 3. Validation Policy

Defines required checks (unit tests, lint, static analysis) that must pass before a development result is accepted or a merge is permitted.

#### 4. Retry Policy

Controls automatic retry behavior: maximum retry attempts, backoff strategy, and failure classification (transient vs. permanent).

#### 5. Escalation Policy

Defines when tasks automatically escalate to human intervention:

- Task reaches retry limit
- Review rounds exceed threshold (e.g., 3 rejections)
- Critical risk flagged in any packet
- Merge conflicts cannot be resolved
- Policy violations detected

#### 6. Lease Policy

Controls task leasing behavior: lease TTL (time-to-live), heartbeat frequency, and what happens on lease expiry (reclaim and requeue).

#### 7. Retention Policy

Defines how long artifacts, logs, packets, and audit events are retained.

#### 8. Review Policy

Specifies required reviewer count, reviewer domains per task type, and lead review role assignment.

### Editing Configuration

Use the **Configuration** page (`/config`) in the Web UI to:

- View the effective configuration for any scope
- Edit policy settings at any hierarchy level
- Preview how changes cascade through the resolution hierarchy

Or use the API:

```bash
# View current effective configuration
curl http://localhost:3000/config

# Update configuration
curl -X POST http://localhost:3000/config \
  -H "Content-Type: application/json" \
  -d '{ ... }'

# List policy sets
curl http://localhost:3000/policies

# View a specific policy set
curl http://localhost:3000/policies/:id
```

---

## 11. Operator Actions

Operators have full control over every aspect of task execution. These actions are available from both the Web UI and the REST API.

### Task Control Actions

| Action                   | API Endpoint                                   | Valid From States                 | Result State                                                                                    | Notes                                                                                                       |
| ------------------------ | ---------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Pause**                | `POST /tasks/:id/actions/pause`                | Any non-terminal state            | `ESCALATED`                                                                                     | Stops all processing on the task.                                                                           |
| **Resume**               | `POST /tasks/:id/actions/resume`               | `ESCALATED`                       | `ASSIGNED`                                                                                      | A new lease is acquired for the task.                                                                       |
| **Requeue**              | `POST /tasks/:id/actions/requeue`              | `ASSIGNED`, `IN_DEVELOPMENT`      | `READY`                                                                                         | Reclaims the current lease; task re-enters scheduling.                                                      |
| **Force Unblock**        | `POST /tasks/:id/actions/force-unblock`        | `BLOCKED`                         | `READY`                                                                                         | Requires a reason. Sensitive action with elevated audit.                                                    |
| **Change Priority**      | `POST /tasks/:id/actions/change-priority`      | Any state                         | _(unchanged)_                                                                                   | Metadata-only; affects future scheduling order.                                                             |
| **Reassign Pool**        | `POST /tasks/:id/actions/reassign-pool`        | Any non-terminal state            | _(unchanged)_                                                                                   | Metadata-only; records pool hint for the scheduler.                                                         |
| **Rerun Review**         | `POST /tasks/:id/actions/rerun-review`         | `APPROVED`, `IN_REVIEW`           | `DEV_COMPLETE`                                                                                  | Invalidates existing review cycle; triggers new review routing.                                             |
| **Override Merge Order** | `POST /tasks/:id/actions/override-merge-order` | `QUEUED_FOR_MERGE`                | _(unchanged)_                                                                                   | Reorders the merge queue. Sensitive action with elevated audit.                                             |
| **Reopen**               | `POST /tasks/:id/actions/reopen`               | `DONE`, `FAILED`, `CANCELLED`     | `BACKLOG`                                                                                       | No active lease may exist. Resets review cycle and merge refs. Sensitive action.                            |
| **Cancel**               | `POST /tasks/:id/actions/cancel`               | Any non-terminal except `MERGING` | `CANCELLED`                                                                                     | Cannot cancel during merge (would leave repo inconsistent). Requires acknowledgment if work is in progress. |
| **Resolve Escalation**   | `POST /tasks/:id/actions/resolve-escalation`   | `ESCALATED`                       | Depends on resolution: **retry** → `ASSIGNED`, **cancel** → `CANCELLED`, **mark_done** → `DONE` | Mark-done requires evidence.                                                                                |

### When to Use Each Action

- **Pause/Resume** — Hold a task while investigating an issue, then resume when ready. Resume is only available for `ESCALATED` tasks.
- **Requeue** — Retry after transient failures (network, worker crash). Available when a worker is assigned or running.
- **Force Unblock** — Override dependency when you know it's safe to proceed. Only available for `BLOCKED` tasks; requires a written reason.
- **Change Priority** — Respond to shifting business needs. Can be used in any state.
- **Reassign Pool** — Move to a pool with different capabilities or a faster model. Available in any non-terminal state.
- **Rerun Review** — Policy changed, or you want fresh eyes. Available for tasks currently `IN_REVIEW` or already `APPROVED`.
- **Override Merge Order** — Reprioritize the merge queue. Only available for `QUEUED_FOR_MERGE` tasks.
- **Reopen** — Bring a completed, failed, or cancelled task back to the backlog for another attempt.
- **Cancel** — Task is no longer needed. Cannot cancel during `MERGING` to avoid leaving the repository in an inconsistent state.
- **Resolve Escalation** — System escalated automatically; decide the path forward (retry, cancel, or mark as externally done with evidence).

---

## 12. Audit and Observability

### Audit Trail

Every significant event is logged to an **immutable, append-only** audit log:

- State transitions (with before/after state, actor, and timestamp)
- Operator actions (pause, resume, override, etc.)
- Policy decisions (reviewer routing, merge classification)
- Worker events (lease grant, heartbeat, completion, failure)
- Escalation triggers and resolutions
- Artifact references

### Querying the Audit Log

Use the **Audit** page (`/audit`) or the API:

```bash
# Query audit events with filters
curl "http://localhost:3000/audit?entityType=task&entityId=task-456&eventType=state_transition&startTime=2026-03-01T00:00:00Z&endTime=2026-03-12T23:59:59Z"
```

Filter parameters:

| Parameter               | Description                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `entityType`            | `task`, `worker`, `pool`, `review`, `merge`                                            |
| `entityId`              | ID of the specific entity                                                              |
| `eventType`             | `state_transition`, `operator_action`, `policy_decision`, `worker_event`, `escalation` |
| `startTime` / `endTime` | ISO 8601 time range                                                                    |

### OpenTelemetry Tracing

The platform supports distributed tracing via OpenTelemetry:

- **Protocol:** OTLP over HTTP
- **Propagation:** W3C TraceContext
- **Auto-instrumentation:** Inbound and outbound HTTP requests
- **Exporter:** Configurable OTLP endpoint (default `http://localhost:4318`)

Configure tracing with environment variables:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318  # Collector endpoint
OTEL_TRACING_ENABLED=true                           # Enable/disable
NODE_ENV=development                                # Adds console exporter for dev
```

### Health and Metrics

```bash
# Health check
curl http://localhost:3000/health
# → { "status": "ok", "service": "factory-control-plane", "timestamp": "..." }

# Prometheus-compatible metrics
curl http://localhost:3000/metrics
```

---

## 13. Safety and Policy Enforcement

The platform is designed with safety as a first-class concern. All safety boundaries are enforced by **deterministic software**, never delegated to AI agents.

### What the Orchestrator Owns (Never Delegated to AI)

- ✅ Task state transitions and locking
- ✅ Queue operations and dependency graph
- ✅ Worker leases, heartbeats, and timeouts
- ✅ Command and file scope enforcement
- ✅ Reviewer routing and merge queue ordering
- ✅ Git merge execution
- ✅ Validation command execution
- ✅ Artifact persistence and schema validation
- ✅ Audit logging and access control

### Exclusive Task Leasing

Only one active lease exists per task at any time. This prevents two workers from implementing the same task simultaneously. Leases expire automatically if heartbeats stop, and the task is reclaimed and requeued.

### Role-Based Boundaries

- **Developers** can only implement — never review, approve, or merge.
- **Reviewers** can only review — never implement or merge.
- **Lead reviewers** approve or reject, but the orchestrator enforces escalation thresholds to prevent infinite rejection loops.
- **Merge workers** can only merge approved tasks in queue order — no self-selection.

### Command Safety

The command policy defaults to an **allowlist** mode. Workers can only execute explicitly permitted commands with permitted argument prefixes. Dangerous patterns like `rm -rf /`, `sudo`, `curl | sh`, `git push --force`, and `git reset --hard` are blocked by default.

### File Scope Enforcement

Workers are restricted to the file paths defined in the task's `suggestedFileScope` globs. The enforcement level is configurable:

- **`strict`** — Accessing out-of-scope files immediately fails the run.
- **`audit`** — Violations are logged but allowed.
- **`advisory`** — Informational only.

### Automatic Escalation

The system automatically escalates to a human operator when:

- A task reaches its retry limit
- Review rounds exceed the configured threshold
- Any packet contains a `critical` severity risk
- Merge conflicts cannot be resolved (even with AI assist)
- Post-merge validation fails without a clear cause
- A policy violation is detected

### Schema Validation

All agent inputs and outputs are validated against Zod schemas:

- Invalid JSON → run marked `FAILED`, counted against retries
- Valid JSON but schema mismatch → one repair attempt, then `FAILED`
- 3 consecutive schema failures by the same profile → profile disabled and operator alerted

---

## 14. REST API Reference

The full API is documented with OpenAPI/Swagger at **http://localhost:3000/api/docs** when the control plane is running.

### Summary of Endpoints

#### Projects

```
POST   /projects                    Create a project
GET    /projects                    List projects
GET    /projects/:id                Get project detail
PUT    /projects/:id                Update project
```

#### Repositories

```
POST   /projects/:projectId/repositories   Create a repository within a project
GET    /projects/:projectId/repositories   List repositories for a project
GET    /repositories/:id                   Get repository detail
PUT    /repositories/:id                   Update repository
DELETE /repositories/:id                   Delete repository
```

#### Tasks

```
POST   /tasks                       Create a task
POST   /tasks/batch                 Create multiple tasks (atomic)
GET    /tasks                       List tasks (paginated, filterable)
GET    /tasks/:id                   Get task detail
PUT    /tasks/:id                   Update task
GET    /tasks/:id/timeline          Get audit timeline for a task
```

#### Operator Actions

```
POST   /tasks/:id/actions/pause
POST   /tasks/:id/actions/resume
POST   /tasks/:id/actions/requeue
POST   /tasks/:id/actions/force-unblock
POST   /tasks/:id/actions/change-priority
POST   /tasks/:id/actions/reassign-pool
POST   /tasks/:id/actions/rerun-review
POST   /tasks/:id/actions/override-merge-order
POST   /tasks/:id/actions/reopen
POST   /tasks/:id/actions/cancel
POST   /tasks/:id/actions/resolve-escalation
```

#### Reviews

```
GET    /tasks/:taskId/reviews                       List review cycles
GET    /tasks/:taskId/reviews/:cycleId/packets      Get review packets
```

#### Merge Queue

```
GET    /merge-queue                 Get merge queue items
```

Query parameters:

| Parameter      | Type   | Default | Description                                                                                                    |
| -------------- | ------ | ------- | -------------------------------------------------------------------------------------------------------------- |
| `page`         | number | 1       | Page number (1-based)                                                                                          |
| `limit`        | number | 20      | Items per page (1–100)                                                                                         |
| `status`       | string | _(all)_ | Filter by status: `ENQUEUED`, `PREPARING`, `REBASING`, `VALIDATING`, `MERGING`, `MERGED`, `REQUEUED`, `FAILED` |
| `repositoryId` | string | _(all)_ | Filter by repository ID                                                                                        |

#### Worker Pools and Profiles

```
POST   /pools                       Create a pool
GET    /pools                       List pools
GET    /pools/:id                   Get pool detail
PUT    /pools/:id                   Update pool
DELETE /pools/:id                   Delete pool
GET    /pools/:id/workers           List workers in pool
POST   /pools/:poolId/profiles      Create agent profile
GET    /pools/:poolId/profiles      List profiles
GET    /pools/:poolId/profiles/:id  Get profile detail
PUT    /pools/:poolId/profiles/:id  Update profile
DELETE /pools/:poolId/profiles/:id  Delete profile
```

#### Configuration and Policies

```
GET    /config                      Get effective configuration
POST   /config                      Update configuration
GET    /policies                    List policy sets
GET    /policies/:id                Get specific policy set
```

#### Audit

```
GET    /audit                       Query audit log (filterable)
```

#### System

```
GET    /health                      Health check
GET    /metrics                     Prometheus metrics
```

---

## 15. Real-Time Events (WebSocket)

The control plane provides real-time updates via Socket.io on three event channels:

| Channel     | Events                                                   |
| ----------- | -------------------------------------------------------- |
| **tasks**   | Task state transitions, lease changes, new tasks created |
| **workers** | Worker heartbeats, status changes, pool updates          |
| **queue**   | Merge queue additions, removals, status changes          |

The Web UI uses these channels to keep the dashboard current without polling. You can also subscribe from custom integrations:

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3000");

// Subscribe to task events
socket.on("tasks", (event) => {
  console.log("Task event:", event);
});

// Subscribe to a specific task's room for targeted updates
socket.emit("join", { room: "task:task-456" });
```

---

## 16. Deployment Modes

### Local Single-Operator Mode (V1)

**Best for:** Individual developers, evaluation, prototyping.

All components run on a single machine:

- Control plane (NestJS + Fastify) on port 3000
- Web UI (React SPA) on port 5173
- SQLite database (file-based)
- Git worktrees for isolated workspaces
- Copilot CLI as the worker execution adapter

```
┌─────────────────────────────────────────────┐
│   Developer's Laptop                        │
│                                             │
│   Control Plane (localhost:3000)             │
│   Web UI (localhost:5173)                    │
│   SQLite Database (./data/factory.db)        │
│   Git Worktrees (/tmp/factory/worktrees/)    │
│   Copilot CLI Adapter                        │
└─────────────────────────────────────────────┘
```

### Team Lab Mode (Future)

**Best for:** Shared team environments.

- Postgres instead of SQLite (multi-process safe)
- Object storage for artifacts (S3, GCS)
- Multiple orchestrator replicas for availability
- Shared web UI and team-wide audit trail

### Scaled Enterprise Mode (Future)

**Best for:** Large organizations with high throughput needs.

- Kubernetes-based orchestrator cluster
- Distributed tracing and Prometheus metrics
- Enterprise SSO/RBAC
- Multi-tenant policies
- Human approval gates by risk/policy

---

## 17. End-to-End Walkthrough

This section walks through a complete task lifecycle from creation to done.

### Step 1: Create the Task

An operator creates a bug fix task through the UI or API:

```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "repositoryId": "repo-123",
    "title": "Fix login redirect bug",
    "taskType": "bug_fix",
    "priority": "high",
    "riskLevel": "medium",
    "acceptanceCriteria": [
      "User is redirected to original page after OAuth",
      "Redirect works for both app and API clients"
    ]
  }'
```

→ Task created in **`BACKLOG`** state.

### Step 2: Dependency Resolution

The scheduler's reconciliation loop checks the task:

- Hard-block dependencies? None → ✅
- Policy blockers? None → ✅

→ Task transitions to **`READY`**.

### Step 3: Scheduling and Assignment

The scheduler selects the highest-priority ready task and finds an available worker in the developer pool:

- Creates a lease with 1-hour TTL
- Assigns the task to the worker

→ Task transitions to **`ASSIGNED`**.

### Step 4: Developer Agent Execution

The control plane provisions an isolated Git worktree and invokes the worker:

- Worker receives: task packet, repo policy, workspace context, time budget
- Worker checks out a task branch (`task-456-fix-login-redirect`)
- Worker reads the relevant code, implements the fix, runs tests
- Worker emits a **DevResultPacket** with implementation summary, files changed, test results, and risks

→ Task transitions to **`IN_DEVELOPMENT`** → **`DEV_COMPLETE`**.

### Step 5: Review

The review router examines the change and determines required perspectives:

- Files changed include `src/middleware/auth.js` → route to **correctness** and **security** reviewers
- Risk level is `medium` → standard review depth

Both specialist reviewers run in parallel, then the lead reviewer consolidates:

- Specialist 1 (correctness): ✅ Approve — implementation matches acceptance criteria
- Specialist 2 (security): ✅ Approve — no security concerns
- Lead reviewer: **Approved** — change is safe and satisfies the task

→ Task transitions to **`IN_REVIEW`** → **`APPROVED`**.

### Step 6: Merge Queue

The task is automatically enqueued for serialized integration:

1. Merge worker rebases the task branch onto latest main
2. Runs full validation suite (tests, lint) → all pass
3. Executes the merge

→ Task transitions to **`QUEUED_FOR_MERGE`** → **`MERGING`** → **`POST_MERGE_VALIDATION`**.

### Step 7: Done

Post-merge validation passes. The task is complete.

→ Task transitions to **`DONE`**.

The operator can see the full timeline — every state transition, every packet, every review comment — in the task detail view.

---

## 18. Troubleshooting

### Common Issues

#### Control plane won't start

```bash
# Check that the database is initialized
cd apps/control-plane
pnpm db:migrate

# Check that the native SQLite module is compiled
pnpm rebuild better-sqlite3

# Try starting with verbose output
NODE_ENV=development pnpm dev
```

#### Web UI can't connect to API

- Ensure the control plane is running on port 3000
- The Web UI dev server proxies `/api` and `/socket.io` to `localhost:3000`
- Check the browser console for CORS or connection errors

#### Task stuck in `ASSIGNED`

- Check the worker pool — are workers available?
- Check the lease — has the heartbeat expired?
- Use the **Requeue** operator action to force the task back into scheduling

#### Task stuck in `BLOCKED`

- Check dependencies on the task detail page
- Use **Force Unblock** if you know it's safe to proceed (requires a reason)

#### Worker failures

- Check the audit log for error details
- Check if the retry limit has been reached → task will be `ESCALATED`
- Use **Resolve Escalation** to retry, cancel, or mark as externally done

#### Build or test errors

```bash
# Build all packages
pnpm build

# Run all tests
pnpm test

# Run tests for a specific workspace
cd packages/domain && pnpm test

# Lint the codebase
pnpm lint

# Check formatting
pnpm format:check
```

---

## 19. Glossary

| Term                 | Definition                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Agent**            | An AI model invocation that performs bounded judgment or execution (e.g., developer, reviewer). Stateless and ephemeral. |
| **Artifact**         | A structured output produced during any stage — development packets, review packets, diffs, logs.                        |
| **Control Plane**    | The deterministic orchestration layer that owns state, scheduling, policies, and safety.                                 |
| **Effective Policy** | The fully-resolved configuration for a specific task run, after all 8 hierarchy levels are applied.                      |
| **Escalation**       | A task state indicating human operator intervention is required. Can be automatic or manual.                             |
| **Lease**            | A time-limited exclusive lock on a task, ensuring only one worker processes it at a time.                                |
| **Packet**           | A schema-validated JSON document exchanged between stages (e.g., DevResultPacket, ReviewPacket).                         |
| **Pool**             | An operational container grouping workers with shared runtime, model, concurrency, and cost configuration.               |
| **Profile**          | A behavioral contract defining an agent's prompt, tool permissions, file scope, and validation rules.                    |
| **Reconciliation**   | A background process that re-evaluates task readiness, dependency graphs, and lease timeouts.                            |
| **Review Cycle**     | One round of multi-perspective specialist review plus lead reviewer consolidation.                                       |
| **Worker**           | An OS process hosting one agent invocation for one task. Created, monitored, and destroyed by the system.                |
| **Worker Plane**     | The execution layer where ephemeral AI agents and deterministic validators run.                                          |
| **Worktree**         | An isolated Git working tree created for each task, providing workspace separation.                                      |
