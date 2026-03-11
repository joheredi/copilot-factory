# AI Agent Execution Guidance

## How to Use This Backlog

This backlog is designed for AI coding agents that execute one task at a time with limited context.

## Core Rules

1. **One task at a time.** Pick one task, complete it, verify it, then move on.
2. **Check dependencies first.** A task is ready only when ALL tasks listed in its Dependencies field have status `done`.
3. **Read context files.** Every task lists recommended files to read before starting. Read them.
4. **Stay in scope.** Only implement what the task's "In Scope" section describes. Do not fix unrelated issues.
5. **Validate before completing.** Run the suggested validation commands. All acceptance criteria must pass.
6. **Stop on ambiguity.** If the task is unclear or you discover a blocking issue, stop and escalate rather than guessing.

## Determining Task Readiness

A task is **ready** when:

- All tasks in its `Dependencies` field are `done`
- The task's `Status` is `pending`
- The task's `Priority` indicates it should be worked on now

A task is **blocked** when:

- Any dependency task is not yet `done`
- The task has an unresolved open question

## Priority Guide

- **P0**: Must be completed in this phase. Critical path.
- **P1**: Should be completed in this phase. Important but not blocking.
- **P2**: Can be deferred if needed. Nice to have in this phase.

## Parallel Work

Tasks can run in parallel when they have no dependency relationship. Within a phase:

- All P0 tasks with satisfied dependencies can run in parallel
- Tasks in different epics are often parallelizable
- Tasks within the same epic are usually sequential

**Safe parallel groups (examples):**

- T001 has no deps — it runs first and alone
- After T001: T002, T003, T004 can run in parallel (they all depend only on T001)
- After E001 is complete: T007, T020 can run in parallel (different epics, shared dep on E001)
- After E002: T015, T025, T035, T048 can all start (different epics)

## Sequential Constraints

These chains MUST be sequential:

- T001 → T002 → T006 → T008-T013 → T014 (monorepo → TypeScript → DB → migrations → repositories)
- T015 → T017 → T018 → T019 (state machine → transition service → atomicity → concurrency)
- T025 → T026 → T027 → T028 (job queue → dependencies → scheduler → tick loop)
- T030 → T031 → T032 → T033 → T034 (lease → heartbeat → graceful → reclaim → recovery)

## Human Checkpoints

These tasks require human review before proceeding:

- **T001** (monorepo structure) — foundational decision affects everything
- **T006** (database setup) — ORM and migration strategy
- **T015** (task state machine) — core correctness
- **T045** (Copilot CLI adapter) — may require experimentation
- **T080** (NestJS bootstrap) — API framework decisions
- **T089** (React SPA init) — frontend framework decisions

## Integration Validation Points

After completing these tasks, run integration validation before proceeding:

- **After P01 (Foundation):** Verify full build + test + lint pipeline works
- **After T014 (repositories):** Verify all entity CRUD works with real SQLite
- **After T019 (concurrency):** Verify concurrent transition safety
- **After T057 (validation gates):** Verify state transitions respect validation
- **After T107 (full lifecycle test):** This IS the integration validation — must pass

## When to Stop and Escalate

Stop work and escalate to a human when:

- A task's acceptance criteria are ambiguous
- You discover a conflict between PRD documents
- A dependency task was completed but its output doesn't match expectations
- You need to make a design decision not covered by the PRD
- Tests fail in a way that suggests a spec issue, not an implementation bug
- You need access to external systems (GitHub, Copilot CLI) that aren't available

## File Organization

```
docs/backlog/
  index.md              — Start here. Master navigation.
  epics/                — One file per epic. Context and task list.
  tasks/                — One file per task. Full implementation spec.
  phases/               — Implementation phases with grouping and exit criteria.
  agents/               — This file. Execution guidance for AI agents.
  backlog.json          — Machine-readable backlog data.
```
