# Autonomous Software Factory

A local-first orchestration platform for software delivery using bounded AI workers inside a deterministic control plane.

## Overview

The Autonomous Software Factory coordinates ephemeral AI coding and review agents through deterministic orchestration software. It supports backlog analysis, dependency-aware scheduling, isolated developer execution, multi-perspective review workflows, serialized merges, post-merge validation, and operator visibility through a local web UI.

## Architecture

The system is split into two planes:

- **Control Plane** (deterministic): Owns state transitions, scheduling, leases, policies, queues, artifact persistence, and audit logging.
- **Worker Plane** (ephemeral): Runs bounded AI agents for implementation, review, and validation — one task at a time in isolated workspaces.

For detailed architecture, see `docs/prd/`.

## Repository Structure

```
apps/
  control-plane/     # Backend orchestration service
  web-ui/            # React SPA operator dashboard
  worker-runner/     # Worker process supervisor
packages/
  domain/            # Entities, value objects, state machines
  application/       # Commands, queries, orchestrators
  infrastructure/    # DB repositories, git services, adapters
  schemas/           # Zod packet schemas and validation
  config/            # Hierarchical configuration resolution
  observability/     # Logging, tracing, metrics
  ui-components/     # Shared React components
  testing/           # Test utilities, fakes, fixtures
docs/
  prd/               # Product requirements documents
  backlog/           # Execution-ready task backlog
```

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm (managed via corepack)

### Setup

```bash
corepack enable
pnpm install
```

## License

Proprietary — All rights reserved.
