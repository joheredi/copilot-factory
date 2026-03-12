# T143: Build init interactive flow and registration

| Field                     | Value                                                            |
| ------------------------- | ---------------------------------------------------------------- |
| **ID**                    | T143                                                             |
| **Epic**                  | [E026: CLI Init & Project Onboarding](../epics/E026-cli-init.md) |
| **Type**                  | feature                                                          |
| **Status**                | pending                                                          |
| **Priority**              | P0                                                               |
| **Owner**                 | platform-engineer                                                |
| **AI Executable**         | Yes                                                              |
| **Human Review Required** | Yes                                                              |
| **Dependencies**          | [T142](./T142-init-project-detection.md)                         |
| **Blocks**                | [T144](./T144-init-idempotent.md)                                |

---

## Description

Build the complete `factory init` command that ties together detection, confirmation, registration, and optional task import. The command shows auto-detected values, prompts for overrides or missing values, creates the project and repository in the database (using the service layer directly, no HTTP), optionally runs task import, and writes a `.copilot-factory.json` marker file.

## Goal

Deliver the full init UX: one command to register a project with the factory, with minimal prompting and maximum auto-detection.

## Scope

### In Scope

- Register `init` subcommand in the CLI entry point (`apps/cli/src/cli.ts`)
- Show detected values with check marks: `✓ Detected project: my-app`
- For null detections, prompt interactively (using `readline` or a prompts library)
- Call `ensureFactoryHome()` and `runMigrations()` before any DB writes
- Create Project record using `ProjectsService.create()` or direct DB insert
- Create Repository record using `RepositoriesService.create()` or direct DB insert
- Optional task import: prompt "Import tasks from local directory? (path or Enter to skip)"
  - If path provided, call import discovery + execute (reuse from T115/T116 or call the service layer directly)
- Write `.copilot-factory.json` to cwd: `{ "projectId": "...", "repositoryId": "...", "factoryHome": "~/.copilot-factory" }`
- Print summary: project registered, tasks imported, next steps (`Run npx @copilot/factory start`)

### Out of Scope

- Idempotent re-run (T144)
- Starting the factory (T145)

## Context Files

The implementing agent should read these files before starting:

- `apps/cli/src/cli.ts` — CLI entry point (from T119/T121)
- `apps/cli/src/detect.ts` — detection module (from T142)
- `apps/cli/src/paths.ts` — path helpers (from T140)
- `apps/cli/src/migrate.ts` — migration runner (from T141)
- `apps/control-plane/src/projects/projects.service.ts` — `create()` method
- `apps/control-plane/src/projects/repositories.service.ts` — `create()` method
- `apps/control-plane/src/import/import.service.ts` — `discover()` and `execute()` methods (from T115/T116)

## Implementation Guidance

1. Create `apps/cli/src/commands/init.ts`
2. Add `init` subcommand to the Commander program in `cli.ts`:
   ```typescript
   program
     .command("init")
     .description("Register this project with the factory")
     .action(async () => {
       await runInit(process.cwd());
     });
   ```
3. `runInit(cwd)` flow:
   a. Call `detectAll(cwd)` to get metadata
   b. Print detected values with `✓` prefix (green if detected, yellow `?` if prompting)
   c. For null values, use `readline.createInterface` to prompt:
   ```
   ? Project name: ▌
   ```
   d. Call `ensureFactoryHome()` from paths module
   e. Call `runMigrations(getDbPath(), migrationsFolder)` from migrate module
   f. Open a DB connection using `createDatabaseConnection({ filePath: getDbPath() })`
   g. In a write transaction:
   - Insert project: `INSERT INTO project (...) VALUES (...) ON CONFLICT (name) DO NOTHING`
   - Insert repository: `INSERT INTO repository (...) VALUES (...) ON CONFLICT (remote_url) DO NOTHING`
     h. Prompt for task import path (optional)
     i. If path provided, call import logic (service layer or direct parser calls)
     j. Write `.copilot-factory.json` to cwd
     k. Close DB connection
     l. Print summary
4. Use simple `console.log` with ANSI colors for the output (or a library like `chalk`)
5. Write tests: mock readline, verify DB writes, verify marker file

## Acceptance Criteria

- [ ] `factory init` shows detected metadata with check marks
- [ ] Prompts for missing values (project name, owner if not detected)
- [ ] Creates `~/.copilot-factory/` and runs migrations automatically
- [ ] Creates Project record in the database
- [ ] Creates Repository record in the database
- [ ] Optional task import works when a path is provided
- [ ] Writes `.copilot-factory.json` to the project root
- [ ] Prints summary with next steps
- [ ] Handles Ctrl+C during prompts gracefully (no crash, no partial writes)

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Run init in this repository's root and verify the project is registered.

### Suggested Validation Commands

```bash
cd /path/to/my-project && node apps/cli/dist/cli.js init
```

## Risks / Notes

- Direct DB writes (not HTTP) mean the factory doesn't need to be running for init. This is by design.
- The `ON CONFLICT DO NOTHING` pattern handles basic idempotency. T144 extends this to update-on-re-run.
- If the import pipeline (E023) tasks aren't complete yet, the optional task import prompt can be skipped/disabled initially.

## Follow-on Tasks

T144
