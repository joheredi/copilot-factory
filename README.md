# Autonomous Software Factory

**Deterministic orchestration meets ephemeral AI agents for end-to-end autonomous software delivery.**

The Autonomous Software Factory is a local-first platform that coordinates bounded AI coding agents through a deterministic control plane. It turns a backlog of tasks into shipped, validated code — handling scheduling, isolated development, multi-perspective review, serialized merging, and post-merge validation — while keeping a human operator fully in control.

> **The core insight:** Treat AI agents as ephemeral, replaceable workers inside a deterministic state machine — not as autonomous entities. The orchestrator owns state, safety, and policy. Agents provide judgment. This eliminates the reproducibility and safety crisis that plagues autonomous coding tools today.

---

## The Problem

Autonomous coding agents are powerful, but deploying them at scale is dangerous:

- **No reproducibility** — conversational agent memory drifts, making runs impossible to replay or audit.
- **No safety guarantees** — agents self-assign work, skip reviews, or merge without checks.
- **Context bloat** — long-lived agents accumulate stale context, leading to hallucinations and regressions.
- **Merge chaos** — parallel agents create conflicting changes with no coordination.
- **No operator visibility** — when something goes wrong, there's no way to inspect, pause, or intervene.

Teams need the throughput of autonomous agents **with** the safety, auditability, and control of deterministic software.

---

## The Vision

A platform where **deterministic orchestration software** manages the entire software delivery lifecycle, delegating judgment-heavy work to **ephemeral, bounded AI agents** that operate one task at a time in isolated workspaces.

Every state transition is deterministic. Every handoff is a structured artifact. Every decision is auditable. And a human operator can inspect, pause, override, or intervene at any point through a local web UI.

---

## Key Principles

| Principle                         | What it means                                                                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Deterministic + Agentic Split** | AI handles code reasoning and review judgment. Deterministic software handles state transitions, queues, dependencies, policies, and merges.                                 |
| **Ephemeral Stateless Workers**   | No long-lived agent memory. Each worker starts fresh with only the context it needs. Artifacts — not conversation history — are the source of truth.                         |
| **Packetized Handoffs**           | Structured JSON packets flow between stages. Every handoff is versioned, validatable, and machine-readable. No transcript-based knowledge transfer.                          |
| **Bounded Autonomy**              | Agents act within strict role and policy gates. They propose results; the orchestrator commits transitions. Agents never self-assign, self-approve, or self-merge.           |
| **Operator-First Control**        | Pause, resume, requeue, reprioritize, override merge ordering, inspect artifacts, reopen tasks — humans stay in the loop.                                                    |
| **Local-First, Scale-Later**      | Runs on a single developer's laptop with SQLite and Git worktrees. Clear migration path to Postgres, object storage, and multi-node deployment without redesigning the core. |

---

## How It Works

A task flows through a dependency-aware pipeline with isolated execution at every stage:

```
┌─────────┐   ┌──────────┐   ┌────────────┐   ┌─────────────┐   ┌──────────┐   ┌───────┐   ┌──────┐
│ Backlog  │──▶│ Schedule │──▶│  Develop   │──▶│   Review    │──▶│  Merge   │──▶│ Valid. │──▶│ Done │
│          │   │ & Assign │   │ (isolated) │   │ (multi-PoV) │   │ (serial) │   │       │   │      │
└─────────┘   └──────────┘   └────────────┘   └─────────────┘   └──────────┘   └───────┘   └──────┘
```

- **Backlog** — Tasks with dependencies, priorities, and readiness conditions.
- **Schedule & Assign** — Dependency graph resolution, readiness computation, lease-based assignment (one active developer per task).
- **Develop** — Ephemeral agent works in an isolated Git worktree. Produces a structured development result packet.
- **Review** — Multiple specialist reviewers examine the work from different perspectives. A lead reviewer consolidates and decides: approve, reject, or escalate. No endless rejection loops.
- **Merge** — Serialized merge queue prevents conflicts. A merge-assist agent resolves mechanical conflicts without changing scope.
- **Validate** — Post-merge validation catches regressions. Failures trigger automated triage: revert, hotfix, or escalate.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CONTROL PLANE                            │
│                                                                 │
│  ┌───────────┐  ┌───────────┐  ┌──────────┐  ┌─────────────┐   │
│  │ Scheduler  │  │   Lease   │  │  Policy  │  │  Artifact   │   │
│  │  & Queue   │  │  Manager  │  │  Engine  │  │   Store     │   │
│  └───────────┘  └───────────┘  └──────────┘  └─────────────┘   │
│  ┌───────────┐  ┌───────────┐  ┌──────────┐  ┌─────────────┐   │
│  │   State    │  │   Merge   │  │  Audit   │  │  Operator   │   │
│  │  Machine   │  │   Queue   │  │   Log    │  │   Web UI    │   │
│  └───────────┘  └───────────┘  └──────────┘  └─────────────┘   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│             Structured Packet Handoffs (JSON / Zod)             │
├─────────────────────────────────────────────────────────────────┤
│                        WORKER PLANE                             │
│                                                                 │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌─────────────┐    │
│  │Developer │  │ Specialist│  │   Lead   │  │   Merge     │    │
│  │  Agent   │  │ Reviewer  │  │ Reviewer │  │   Assist    │    │
│  └──────────┘  └───────────┘  └──────────┘  └─────────────┘    │
│                                                                 │
│           Ephemeral · Isolated · One task at a time             │
└─────────────────────────────────────────────────────────────────┘
```

**Control Plane** (deterministic) — Owns the task state machine, dependency graph, scheduling, lease management, policy enforcement, artifact persistence, merge queue, and audit logging. All state transitions happen here.

**Worker Plane** (ephemeral) — Runs bounded AI agents for implementation, specialist review, lead review, merge assistance, and post-merge analysis. Workers receive structured input packets and produce structured output packets. They never access global state directly.

---

## Repository Structure

```
apps/
  control-plane/       # NestJS + Fastify backend — REST API, DB, scheduling
  web-ui/              # React SPA operator dashboard (planned)
  worker-runner/       # Worker process supervisor (planned)

packages/
  domain/              # Entities, value objects, state machines, invariants
  application/         # Commands, queries, orchestration use cases
  infrastructure/      # DB repositories, Git services, CLI adapters
  schemas/             # Zod packet schemas for all cross-stage handoffs
  config/              # Hierarchical configuration resolution
  observability/       # Structured logging, tracing, metrics
  ui-components/       # Shared React components (planned)
  testing/             # Test utilities, fakes, fixture helpers

docs/
  *.md                 # 10 architecture/design documents (PRD)
  backlog/             # 111 tasks across 22 epics in 5 phases
  design-decisions/    # Architectural decision records
```

---

## Current Status

| Layer             | Status         | Details                                                              |
| ----------------- | -------------- | -------------------------------------------------------------------- |
| Domain            | ✅ Implemented | Entities, value objects, state machines, enums, invariants           |
| Application       | ✅ Implemented | Commands, queries, orchestrators                                     |
| Infrastructure    | ✅ Implemented | DB repositories, Git services, Copilot CLI adapter, artifact storage |
| Schemas           | ✅ Implemented | Zod packet schemas for all handoff types                             |
| Config            | ✅ Implemented | Hierarchical config resolution, policy loading                       |
| Control Plane API | ✅ Implemented | NestJS + Fastify, SQLite/Drizzle, REST endpoints, Swagger docs       |
| Backlog           | ✅ Complete    | 111 tasks, 22 epics, 5 phases — fully specified                      |
| Web UI            | 🚧 Planned     | Package structure ready                                              |
| Worker Runner     | 🚧 Planned     | Package structure ready                                              |
| Observability     | 🚧 Planned     | Package structure ready                                              |

---

## Tech Stack

- **Language:** TypeScript (strict mode, ESM throughout)
- **Runtime:** Node.js ≥ 20
- **Backend:** NestJS 11 + Fastify
- **Database:** SQLite (better-sqlite3) + Drizzle ORM — Postgres migration path planned
- **Validation:** Zod for all packet schemas and API validation
- **Testing:** Vitest with v8 coverage
- **Monorepo:** pnpm workspaces with TypeScript project references
- **Frontend:** React SPA (planned)
- **Worker Runtime:** Copilot CLI as the first execution adapter

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- pnpm (managed via corepack)

### Setup

```bash
corepack enable
pnpm install
pnpm build
```

### Development

```bash
pnpm test              # Run all tests
pnpm lint              # Lint the entire repo
pnpm format:check      # Check formatting

# Control plane
cd apps/control-plane
pnpm db:migrate        # Apply database migrations
pnpm dev               # Start the dev server (http://localhost:3000)
```

### Documentation

The `docs/` directory contains 10 architecture documents covering the full design:

| Doc | Topic                                          |
| --- | ---------------------------------------------- |
| 001 | System architecture & deployment modes         |
| 002 | Data model, state machines & invariants        |
| 003 | V1 implementation plan & milestones            |
| 004 | Agent contracts & structured I/O               |
| 005 | AI vs. deterministic responsibility boundaries |
| 006 | Product refinements & operator capabilities    |
| 007 | Technical architecture & module layout         |
| 008 | Packet & schema specification                  |
| 009 | Policy & enforcement specification             |
| 010 | Integration contracts                          |

---

## License

Proprietary — All rights reserved.
