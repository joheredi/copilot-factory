Complete ONE task per loop. After completion, exit the copilot CLI. NEVER work on a second task.

## Available tooling beyond subagents

Use these tools directly from the main context when they provide faster or
more precise results than spawning a subagent:

- **TypeScript LSP** — use `goToDefinition`, `findReferences`,
  `goToImplementation`, `hover`, `documentSymbol`, `workspaceSymbol`,
  `incomingCalls`, `outgoingCalls`, and `rename` for precise code navigation.
  Prefer LSP over grep when looking up symbols, call sites, or type info.

## Context Stack — loaded deterministically every loop

These files form the context stack that is loaded at the start of every
iteration. Load the same stack every loop to ensure consistency:

- **`.github/copilot-instructions.md`** — loaded automatically by Copilot.
  Architecture, conventions, and build/test commands (once they exist). This
  is the project's technical standard library.
- **`docs/backlog/index.md`** — read via subagent. The master backlog with
  epic overview, phase sequencing, dependency graph, and links to all task
  files. This is the primary task routing table.
- **`docs/backlog/agents/execution-rules.md`** — read via subagent. Rules
  for how AI agents navigate the backlog, determine readiness, and handle
  parallel vs sequential work.

> **Your primary context window is a scheduler.** Do NOT read large files
> directly. Use subagents for all exploration, file reading, and searching.
> Reserve the main context for decision-making and orchestration.

---

## Phase 1: ORIENT — Pick the next task

1. Use a subagent to read `docs/backlog/agents/execution-rules.md` for
   execution rules and readiness criteria.
2. Use a subagent to read `docs/backlog/index.md` and identify ready tasks.
   A task is ready when all its `Dependencies` are `done` and its status is
   `pending`. Prioritize P0 tasks before P1, P1 before P2.
3. **Pre-flight check:** If build/test tooling exists (`package.json` with
   scripts), use a single subagent to run `pnpm build && pnpm test`.
   If the build or tests fail BEFORE you start your work:
   - Create a task file at `docs/backlog/tasks/` to track the failure.
   - Update `docs/backlog/index.md` to reference it.
   - Commit, push, and **exit**. Do not work on anything else.
     If no build tooling exists yet (e.g., T001 hasn't been completed),
     skip the pre-flight check.
4. Choose the highest-priority ready task. **You decide** what has the
   highest priority — not necessarily the first item in the list.
5. Load the full task file from `docs/backlog/tasks/`. Read ALL of its
   context files listed in "Context Files" via subagents.
6. If a task should be split into smaller tasks, split it: create the new
   task files in `docs/backlog/tasks/`, update `docs/backlog/index.md`,
   commit, push, and **exit** (splitting counts as your one task).

---

## Phase 2: STUDY — Research before coding

Use up to 500 parallel subagents to study the codebase, documents,
dependencies, or web resources. **Do NOT assume something is not
implemented** — always search first. Think hard about what you find.

1. Search the codebase for existing implementations related to your task.
2. Study how related code is structured and what patterns it follows.
3. If the task is already done, update its status to `done` in the task file,
   commit, push, and exit.
4. Read the PRD documents referenced by the task's "Context Files" section
   (under `docs/prd/`) via subagents for design context. These are the
   authoritative specs.

---

## Phase 3: DESIGN — Evaluate approaches before coding

Before writing any code, do a design review using subagents:

1. Identify at least **2 viable approaches** for implementing the task.
2. For each approach, evaluate against these criteria (in priority order):
   - Matches the architecture in `docs/prd/007-technical-architecture.md`
   - Production readiness
   - Idiomatic to the codebase's existing patterns (if code exists)
   - Simple (KISS principle)
   - Security implications
3. Think hard. Choose the approach that best satisfies the criteria.
4. If the decision has systemic impact, record it in
   `docs/design-decisions/<decision-title>.md` (approach chosen, why, and
   what was rejected) so future loops don't revisit the same question.
   - Reference the decision file in JSDoc of the related code to keep a
     two-way link between design decisions and implementation.

---

## Phase 4: IMPLEMENT — Write code and tests

1. Every function must have a unit test.
2. Every function must have JSDoc explaining what it does and why.
3. Every test must document **why it is important and what it validates** —
   future loops will not have your reasoning context. Capture this in
   JSDoc comments on the test.
4. You may add temporary logging if needed to debug issues.
5. After implementing, run the tests **for just the unit of code you changed**
   before proceeding to full validation.
6. **Database changes:** If you add or modify a Drizzle schema, you MUST
   generate and run a migration via `pnpm db:generate && pnpm db:migrate`
   in `apps/control-plane`. Every new table needs correct column types,
   indexes, foreign keys, and defaults. Study existing migrations for the
   exact patterns. Never add a schema definition without a migration.
7. **Respect the layered architecture:** Domain rules and state machines go in
   `packages/domain`, orchestration in `packages/application`, DB/git/runner
   adapters in `packages/infrastructure`, API controllers in
   `apps/control-plane`. See `docs/prd/007-technical-architecture.md` §7.5.

---

## Phase 5: VALIDATE — Back pressure

Build, test, and lint form the **back pressure** that rejects bad code
generation. The faster this wheel turns, the better the outcomes.

Run validation with a **single subagent** (do not fan out builds/tests to
multiple subagents — it causes conflicting backpressure):

```bash
pnpm build && pnpm test
```

If build/test tooling does not exist yet (early foundation tasks), validate
by running the commands specified in the task's "Suggested Validation
Commands" section instead.

### What each validation step catches

- **`pnpm build`** (`tsc --noEmit`) — TypeScript type system catches
  structural errors before runtime.
- **`pnpm test`** (Vitest) — assertions verify correctness. This is the
  primary correctness gate.
- **`pnpm lint`** (ESLint) — catches code quality issues and enforces
  style consistency.

If tests unrelated to your work fail, it is **your job** to resolve them as
part of this increment of change. Think hard when investigating these
failures — do NOT blindly update test expectations to make them pass without
being 100% certain it is the correct thing to do.

### Stuck detection

If validation fails **3 times** on the same issue, stop. Document the blocker
in the task file (set status to `blocked` with a reason), commit, push, and
**exit**. Do not burn the remaining context window retrying.

---

## Phase 6: RECORD — Document and commit

1. Update the task status to `done` in the task file under
   `docs/backlog/tasks/`.
2. Append progress to `progress.md` in the repo root — leave a note for the
   next iteration describing what was done, patterns used, and anything the
   next loop should know.
3. If you learned something about how to build, test, or debug this project,
   update `.github/copilot-instructions.md` via a subagent. Keep updates
   brief and actionable — especially updating build/test/lint commands once
   they are established.
4. If build/lint/format tooling exists, run `pnpm format` and
   `pnpm lint -- --fix` to auto-fix formatting and lint violations before
   committing.
5. `git add -A && git commit` using **conventional commit format**, then
   `git push`.
   - Format: `type(scope): description`
   - Examples: `feat(domain): implement task state machine`,
     `feat(infra): add SQLite Drizzle setup`,
     `test(schemas): add TaskPacket cross-field validation tests`
   - Valid types: `feat`, `fix`, `test`, `chore`, `refactor`, `docs`, `ci`
   - Valid scopes: `domain`, `application`, `infrastructure`, `schemas`,
     `config`, `observability`, `control-plane`, `web-ui`, `worker-runner`,
     `testing`, `infra`, `docs`, `ci`

---

## Phase 7: EXIT

Exit the copilot CLI. If the backlog is complete (no remaining `pending`
tasks), output `<promise>COMPLETED</promise>` before exiting.

---

## Critical Rules (NEVER violate)

9999\. DO NOT IMPLEMENT PLACEHOLDER, STUB, OR MINIMAL IMPLEMENTATIONS. Write
full, complete implementations. If you can't fully implement something,
create tasks for what's missing and exit.

99999\. Use up to 500 parallel subagents for exploring, studying, or searching
code. Use only **1 subagent** for build and test operations.

999999\. If you are stuck on a task (e.g., blocked by a missing dependency,
unclear spec, or repeated failures), document the blocker in the task file
(set status to `blocked` with a reason), commit, push, and exit. Do not
loop forever.

9999999\. When you learn something new about how to build, test, or debug this
project — or discover a pattern that works well — update
`.github/copilot-instructions.md` via a subagent. Keep updates brief and
actionable.

99999999\. When you discover a bug unrelated to your current task, create a
task file in `docs/backlog/tasks/` to track it. Commit and continue with
your current task (do not fix unrelated bugs in-loop unless they block your
work).

999999999\. NEVER commit secrets, API keys, passwords, or credentials. If you
accidentally stage a secret, unstage it and remove it from the file.

9999999999\. Respect the **deterministic control plane / agentic worker plane**
split from the architecture. State transitions, scheduling, leases, policy
enforcement, and audit logging belong in deterministic code. AI agents
provide judgment and execution but never own state directly. See
`docs/prd/005-ai-vs-deterministic.md`.
