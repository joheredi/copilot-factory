# Repository overview

This repository is currently a design/specification repository for an "Autonomous Software Factory." The authoritative content lives in `docs/`, and changes here should treat those documents as the source of truth rather than assuming an implemented application already exists.

The architecture is spread across numbered documents instead of a single README:

- `docs/001-architecture.md` defines the product goals, control plane vs worker plane split, major components, deployment modes, and safety/reliability principles.
- `docs/002-data-model.md` defines the task lifecycle state machine, supporting state machines, core entities, and key invariants.
- `docs/003-v1-implementation-plan.md` defines V1 scope, workstreams, milestones, and suggested stack.
- `docs/004-agent-contracts.md` defines the planner/developer/reviewer/lead-reviewer contracts and the requirement for structured inputs/outputs.
- `docs/005-ai-vs-deterministic.md` defines which responsibilities belong to deterministic orchestration versus AI agents.
- `docs/006-additional-refinements.md` adds product/module boundaries and operator-facing capabilities.
- `docs/007-technical-architecture.md` defines the recommended implementation architecture and repository/module layout for the future codebase.

# Build, test, and lint

The repository is a pnpm monorepo. Root-level scripts delegate to workspaces via `pnpm -r run`:

```bash
pnpm install          # Install all dependencies (run after cloning or adding deps)
pnpm build            # Build all packages (delegates to workspace build scripts)
pnpm test             # Run tests in all packages (delegates to workspace test scripts)
pnpm lint             # Lint all packages (delegates to workspace lint scripts)
pnpm format           # Format all packages (delegates to workspace format scripts)
```

> **Note:** Individual workspace build/test/lint scripts are added by subsequent tasks (T002–T004). Until those are complete, root-level `pnpm build`, `pnpm test`, and `pnpm lint` will succeed vacuously (no workspace scripts to run yet).

# TypeScript configuration

- **Base config:** `tsconfig.base.json` at repo root — strict mode, ES2022 target, NodeNext module resolution.
- **Per-workspace config:** Each workspace has `tsconfig.json` extending the base with `composite: true` for project references.
- **Root project references:** `tsconfig.json` at repo root references all 11 workspaces for `tsc --build` ordering.
- **Module system:** ESM throughout (`"type": "module"` in all workspace package.json files). Use `.js` extensions in import paths and `import type` for type-only imports (`verbatimModuleSyntax` is enabled).
- **Cross-package imports:** Resolved via pnpm workspace symlinks + package.json `exports` field. No tsconfig `paths` aliases needed with `moduleResolution: NodeNext`.
- **Build command:** Each workspace uses `tsc --build`. Run `pnpm build` from root to build all.
- **Important:** `outDir`/`rootDir` are set per-workspace (not in base config) because tsconfig `extends` resolves relative paths from the originating config file.

# High-level architecture

The intended system is a local-first orchestration platform for software delivery using bounded AI workers inside a deterministic control plane.

The big-picture split is:

- **Control plane:** owns repositories/projects, task registry, dependency/readiness computation, leases, scheduling, queues, state transitions, policy enforcement, artifact persistence, audit logging, and operator actions.
- **Worker plane:** runs ephemeral single-task agents and deterministic validators for planning, implementation, specialist review, lead review, merge assistance, post-merge analysis, and validation.

The current design strongly prefers:

- TypeScript + Node.js for the backend, ideally as a layered modular monolith.
- React SPA for the local web UI.
- SQLite first, with a path to Postgres later.
- Filesystem artifact storage with structured packet/log directories.
- DB-backed job queues before introducing an external broker.
- Git worktrees for per-task isolated workspaces.
- A pluggable worker runtime with Copilot CLI as the first execution adapter.

The main runtime components described across the docs are the control plane service, worker supervisor, workspace manager, validation runner, artifact service, web UI, and internal scheduler/reconciliation/merge loops.

# Key repository conventions

- Treat deterministic orchestration as the owner of state, safety, and policy. AI agents provide implementation/review judgment, but they do not own task state transitions, assignment, approvals, merges, leases, or policy enforcement.
- Keep the architecture packetized. Cross-stage handoffs are expected to happen through structured task/result/review packets, not free-form transcript history.
- Assume **single-task, bounded-context workers**. Agent behavior throughout the docs is built around one task or one review cycle at a time, isolated workspaces, and explicit stop conditions.
- For exploratory, review, and study work, prefer using as many parallel sub-agents as the task can support. Batch independent investigation threads together instead of handling them serially, and use sub-agents to synthesize architecture, review multiple surfaces, or study related parts of the docs/codebase concurrently.
- Preserve the documented state machine and invariants from `docs/002-data-model.md`. In particular, only one active development lease may exist per task, and workers propose results while the orchestrator commits transitions.
- Preserve the layered architecture from `docs/007-technical-architecture.md`: domain rules/state machines in the domain layer, orchestration in application services, integrations in infrastructure, and controllers/gateways in interface layers.
- Keep policy enforcement outside worker code. Command execution, path restrictions, network/file safety, and merge controls are intended to sit in a policy-aware wrapper between orchestration and execution.
- Keep configuration hierarchical and reproducible. The docs expect layered config resolution and require each worker run to persist its effective configuration snapshot.
- When editing docs, keep them aligned across files. Concepts such as task states, worker roles, pools/profiles, review flow, and local-first topology are intentionally repeated in different documents from different angles; update related docs together when changing those concepts.
- Do not assume implemented modules, apps, or scripts already exist just because the docs describe them. Verify the repository contents first, then write changes that match the current state of the repo.
