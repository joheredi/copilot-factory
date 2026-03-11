# Formal Architecture Document

## 1.1 Purpose

The Autonomous Software Factory is a configurable platform for end-to-end software task execution using ephemeral AI coding/review agents coordinated by deterministic orchestration software. The platform is designed to maximize throughput, reproducibility, auditability, and bounded context while minimizing unstructured autonomy and uncontrolled agent drift.

The system supports:

- backlog analysis and task selection
- dependency-aware scheduling
- isolated developer execution
- multi-perspective review workflows
- practical lead-review consolidation
- serialized or policy-driven merges
- post-merge validation and recovery
- operator visibility and intervention through a local web UI
- high configurability of pools, prompts, policies, routing, gates, and execution rules

## 1.2 Product Goals

- Execute software work autonomously across multiple tasks without allowing context bloat.
- Treat agents as bounded workers inside a deterministic control system.
- Support configurable pools of implementation and review agents.
- Maintain strict exclusivity so a task is never developed by multiple agents at the same time.
- Provide transparent operational visibility through a local-first control UI.
- Support multiple repositories, projects, and workflow policies.
- Allow operators to tune quality thresholds, merge behavior, reviewer routing, and escalation rules.
- Preserve a complete audit trail of every state transition, artifact, prompt, decision, and merge.

## 1.3 Non-Goals

- Fully replacing human engineering leadership in high-ambiguity work.
- Allowing unrestricted autonomous repo-wide refactoring without policy controls.
- Relying on long-lived agent memory or conversation history as the source of truth.
- Letting agents self-assign, self-approve, or self-merge without orchestration policies.

## 1.4 Architectural Principles

1. **Deterministic control plane, agentic worker plane**
   System-level decisions are owned by deterministic services; agents provide bounded judgment and execution.

2. **Ephemeral single-task execution**
   Agents run in isolated processes/workspaces, perform one task, emit artifacts, and exit.

3. **Artifact-based handoffs**
   Stages exchange structured packets rather than raw transcripts.

4. **Context minimization by design**
   Each worker receives only task-relevant context, not full system history.

5. **Configurable but policy-governed autonomy**
   Operators may configure prompts, pools, routing, and gates, but must do so within enforced safety and quality constraints.

6. **Observability and intervention first**
   Every workflow phase must be visible and operable from the UI.

7. **Queue-based, state-driven operation**
   Work flows through explicit states and queues controlled by the orchestrator.

### 1.4.1 Terminology

The following terms have precise meanings throughout all documents:

- **Agent**: an AI model invocation that performs bounded judgment or execution (e.g., developer agent, reviewer agent). Agents are stateless and ephemeral.
- **Worker**: an OS process or container that hosts an agent invocation. One worker runs one agent for one task. Workers are created, monitored, and destroyed by the Worker Supervisor.
- **Runner / Execution Adapter**: the abstraction layer that translates orchestrator run commands into a specific execution backend (e.g., Copilot CLI adapter, local LLM adapter). Runners implement the worker runtime interface.
- **Pool**: a logical grouping of workers sharing runtime configuration, model/provider, concurrency limits, and policy defaults.
- **Profile**: a behavioral contract attached to a pool defining prompt template, tool policies, validation expectations, and role behavior. Multiple profiles may exist within one pool.

## 1.5 High-Level System Overview

The platform is split into two major planes.

### Control Plane (deterministic)

Responsible for:

- project/repo registration
- task registry and dependency graph
- readiness computation
- task leasing and locks
- queue management
- worker assignment
- reviewer routing
- merge queue serialization
- state transitions
- policy enforcement
- artifact persistence
- audit logging
- metrics and analytics
- operator commands from UI/API

### Worker Plane (ephemeral agents and deterministic job runners)

Responsible for:

- backlog analysis (optional AI)
- implementation execution
- specialized review
- lead review consolidation
- merge conflict assistance when permitted
- post-merge verification reasoning when needed
- deterministic validation jobs (tests, lint, static analysis, policy checks)

## 1.6 Core Components

### 1.6.1 Project Registry

Stores repository definitions, branches, access methods, policies, task sources, and workflow templates.

### 1.6.2 Task Intelligence Service

Produces ranked candidate tasks from the backlog, enriched with:

- priority
- risk
- estimated scope
- required skills
- dependency implications
- suggested reviewers
- suggested file scope

This service may combine deterministic scoring with an AI planning agent.

### 1.6.3 Dependency and Readiness Engine

Deterministically computes:

- blocked vs ready tasks
- reverse-dependency unblocks
- task graph integrity
- circular dependency detection

### 1.6.4 Scheduler

Selects the next assignable task and allocates it to an available worker from a compatible pool.

Scheduler responsibilities:

- honor priorities and SLA rules
- prevent duplicate assignment
- honor task affinity/pool requirements
- allocate retry work intelligently
- lease tasks with TTL and heartbeat expectations

### 1.6.5 Workspace Manager

Creates and tears down isolated workspaces using clone/worktree/container strategies.
It prepares:

- branch checkout
- task packet injection
- tool configuration
- credentials/secrets mounting per policy
- execution sandboxing

### 1.6.6 Developer Agent Pool

A configurable set of implementation workers. Each pool may define:

- model/provider
- CLI/runtime implementation (Copilot CLI, custom runner, local model, etc.)
- concurrency limit
- allowed tools/commands
- token/time budgets
- repo/domain specialization
- cost priority
- quality profile
- default prompt template

### 1.6.7 Review Router

Determines which specialist reviewers should run based on:

- changed files
- tags/domains
- policy rules
- risk profile
- repository settings

### 1.6.8 Specialist Reviewer Pools

Examples:

- correctness reviewer
- security reviewer
- architecture reviewer
- performance reviewer
- test reviewer
- style reviewer
- API surface reviewer
- domain reviewer

Each pool is configurable independently.

### 1.6.9 Lead Reviewer

Consolidates review packets, deduplicates issues, assigns severities, and emits final decision:

- approve
- approve with follow-up
- reject with actionable blockers
- escalate

### 1.6.10 Merge Queue Manager

Maintains ordered approved work awaiting integration.
Supports configurable strategies:

- strict FIFO
- priority-aware
- repo-specific queue
- branch-family queue
- batching policies (future)

### 1.6.11 Merge Worker

Responsible for:

- pulling next approved item
- rebasing or merging on latest main
- rerunning mandatory validations
- completing merge
- updating final task state
- emitting rollback/revert tasks when required

### 1.6.12 Validation Runner

Deterministic execution of:

- tests
- lint/format
- static analysis
- schema validation
- security scans
- policy checks
- build/package validation

### 1.6.13 Artifact Store

Stores structured workflow artifacts:

- task packets
- developer result packets
- review packets
- lead review decisions
- diff metadata
- logs
- test results
- merge reports
- failure reports
- summarization packets for retries

### 1.6.14 Audit and Metrics Service

Tracks:

- every state transition
- who/what caused it
- timing
- retries
- merge latency
- rejection reasons
- regressions
- worker utilization
- cost per task

### 1.6.15 Local Web UI

The recommended UI model is a **local-first web control panel** backed by a local service.

Recommended approach:

- backend: local daemon or server process
- frontend: browser-based SPA
- websocket/event stream for live updates
- SQLite or Postgres for state persistence depending on scale

UI should expose:

- global system health
- queues and task states
- worker pool status
- task details and artifacts
- review decisions
- merge queue
- logs and metrics
- configuration editor
- manual overrides
- replay/rerun controls
- policy violations and escalations

## 1.7 Recommended Deployment Modes

### Local Single-Operator Mode

- local orchestrator service
- local web UI
- SQLite
- filesystem artifact storage
- local workspaces
- suitable for prototyping and power-user operation

### Team Workstation/Lab Mode

- local or LAN-hosted orchestrator
- Postgres
- object storage for artifacts
- multiple execution nodes
- team-shared UI

### Scaled Service Mode

- distributed orchestrator
- shared persistent DB
- queue broker
- multiple worker hosts
- SSO/RBAC
- enterprise audit and approvals

## 1.8 Configurability Model

Config must be first-class and hierarchical.

Suggested precedence:

1. system defaults
2. environment/profile defaults
3. organization/project defaults
4. repository workflow template
5. pool configuration
6. task-type overrides
7. task-level override
8. operator emergency override

Configurable areas:

- task selection scoring weights
- scheduling policy
- pool concurrency
- model/provider per pool
- prompt templates
- validation gates
- reviewer routing rules
- merge ordering policy
- retry thresholds
- escalation thresholds
- workspace isolation strategy
- token/time budgets
- file access policy
- allowed commands/tools
- approval criteria
- audit retention

## 1.9 Local Web UI Recommendation

A local web UI is strongly recommended.

Preferred design:

- backend API + event stream
- frontend dashboard in browser
- local desktop wrapper optional later (Tauri/Electron)

Why browser-first locally:

- fastest to build
- easiest inspection/debugging
- no native app complexity initially
- simple remote upgrade path later

Primary UI views:

1. Dashboard
2. Task board / queues
3. Task detail timeline
4. Worker pools and live sessions
5. Review center
6. Merge queue and integration history
7. Config/policy editor
8. Audit explorer
9. Metrics and analytics
10. Replay/simulation mode

## 1.10 Security and Safety Controls

- command allowlists/denylists
- file/path access boundaries
- secrets scoping per workspace
- explicit approval for sensitive repos or areas
- human gate for production-impacting changes if desired
- full prompt/result logging with redaction controls
- sandboxing for worker execution

## 1.11 Reliability Features

- leases with TTL
- heartbeats
- orphan/stale task recovery
- idempotent state transitions
- resumable orchestration
- queue reconciliation
- branch cleanup jobs
- retry with backoff
- dead-letter queue for repeated failures

## 1.12 Key Failure Mode Strategies

- duplicate assignment → leases + unique active-owner constraint
- infinite review loop → capped review rounds + escalation
- stale approved branch → rebase/revalidate at merge time
- worker crash → heartbeat expiry + reschedule/recover
- noisy over-review → lead reviewer severity normalization
- context explosion → packetized handoffs + summaries
- merge regressions → post-merge validation + revert task generation

---
