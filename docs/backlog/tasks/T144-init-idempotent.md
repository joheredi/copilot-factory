# T144: Make init safe to re-run

| Field                     | Value                                                            |
| ------------------------- | ---------------------------------------------------------------- |
| **ID**                    | T144                                                             |
| **Epic**                  | [E026: CLI Init & Project Onboarding](../epics/E026-cli-init.md) |
| **Type**                  | feature                                                          |
| **Status**                | done                                                             |
| **Priority**              | P1                                                               |
| **Owner**                 | platform-engineer                                                |
| **AI Executable**         | Yes                                                              |
| **Human Review Required** | Yes                                                              |
| **Dependencies**          | [T143](./T143-init-interactive-flow.md)                          |
| **Blocks**                | [T151](./T151-cli-hero-docs.md)                                  |

---

## Description

Make `factory init` fully idempotent: if the project is already registered (detected via `.copilot-factory.json` or name match in DB), the command updates metadata rather than failing or duplicating. Task re-import uses `externalRef` dedup to skip already-imported tasks.

## Goal

Ensure operators can safely re-run `factory init` to update project metadata or re-import tasks without fear of duplicating data.

## Scope

### In Scope

- Check for `.copilot-factory.json` in cwd on init start — if present, read projectId/repositoryId
- If project already exists in DB (by name or ID), update metadata (owner, description) rather than INSERT
- If repository already registered (by remoteUrl or ID), update rather than INSERT
- Print "Project already registered, updating..." instead of creating
- Task import re-run: existing `externalRef` dedup from T116 handles this automatically
- Update `.copilot-factory.json` with latest IDs

### Out of Scope

- Init from a different directory for the same project (manual conflict resolution)
- Multi-repo per project scenarios

## Context Files

The implementing agent should read these files before starting:

- `apps/cli/src/commands/init.ts` — init flow (from T143)
- `apps/control-plane/src/import/import.service.ts` — externalRef dedup in execute (from T116)

## Implementation Guidance

1. At the start of `runInit()`, check if `.copilot-factory.json` exists in cwd
2. If found, read `projectId` and `repositoryId` from it
3. Query DB for existing project by ID or by name
4. If found: log "Project already registered, updating..." and use UPDATE instead of INSERT
5. If not found: proceed with normal creation flow
6. For repository: same check by ID or remoteUrl
7. Task import: the externalRef dedup in T116 already skips existing tasks — no new code needed
8. Always write/overwrite `.copilot-factory.json` at the end
9. Write tests: init twice in the same directory should not duplicate

## Acceptance Criteria

- [ ] Running `factory init` twice in the same directory does not duplicate the project
- [ ] Second run prints "Project already registered, updating..."
- [ ] Metadata updates (e.g., changed owner) are applied on re-run
- [ ] Task re-import skips already-imported tasks (externalRef dedup)
- [ ] `.copilot-factory.json` is updated with current IDs

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

### Suggested Validation Commands

```bash
cd apps/cli && pnpm test -- --grep idempotent
```

## Risks / Notes

None significant. This is defensive coding on top of the existing init flow.

## Follow-on Tasks

T151
