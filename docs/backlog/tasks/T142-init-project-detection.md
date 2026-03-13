# T142: Auto-detect project metadata in init command

| Field                     | Value                                                            |
| ------------------------- | ---------------------------------------------------------------- |
| **ID**                    | T142                                                             |
| **Epic**                  | [E026: CLI Init & Project Onboarding](../epics/E026-cli-init.md) |
| **Type**                  | feature                                                          |
| **Status**                | done                                                             |
| **Priority**              | P0                                                               |
| **Owner**                 | platform-engineer                                                |
| **AI Executable**         | Yes                                                              |
| **Human Review Required** | Yes                                                              |
| **Dependencies**          | [T141](./T141-programmatic-migrations.md)                        |
| **Blocks**                | [T143](./T143-init-interactive-flow.md)                          |

---

## Description

Create the project metadata detection module used by `factory init`. When run in a project root, it auto-detects: project name (from `package.json` or directory basename), git remote URL (from `git remote get-url origin`), default branch (from git HEAD reference), and owner (from git config or OS username). Each detection is independent and fails gracefully to a `null` value, which the interactive flow (T143) will prompt for.

## Goal

Minimize the number of prompts during `factory init` by inferring as much as possible from the project directory.

## Scope

### In Scope

- `apps/cli/src/detect.ts` module with:
  - `detectProjectName(cwd: string): string | null` — read `package.json` name field, fallback to `path.basename(cwd)`
  - `detectGitRemoteUrl(cwd: string): string | null` — run `git remote get-url origin`
  - `detectDefaultBranch(cwd: string): string | null` — run `git symbolic-ref refs/remotes/origin/HEAD`, parse branch name, fallback to `"main"`
  - `detectOwner(cwd: string): string | null` — run `git config user.name`, fallback to `os.userInfo().username`
  - `detectAll(cwd: string): ProjectMetadata` — aggregate all detections
- Each function is independently callable and testable
- All git commands use `child_process.execSync` with `{ cwd, stdio: 'pipe' }` and try/catch
- Unit tests with mock filesystem and git state

### Out of Scope

- Interactive prompting (T143)
- Database writes (T143)
- Task import (T143)

## Context Files

The implementing agent should read these files before starting:

- `apps/cli/src/paths.ts` — path helpers (from T140)
- `apps/control-plane/src/projects/dtos/create-project.dto.ts` — required fields: name, owner
- `apps/control-plane/src/projects/dtos/create-repository.dto.ts` — required fields: name, remoteUrl, defaultBranch, localCheckoutStrategy

## Implementation Guidance

1. Create `apps/cli/src/detect.ts`
2. Define `ProjectMetadata` interface:
   ```typescript
   export interface ProjectMetadata {
     projectName: string | null;
     gitRemoteUrl: string | null;
     defaultBranch: string | null;
     owner: string | null;
   }
   ```
3. `detectProjectName`: try `JSON.parse(readFileSync('package.json')).name`, catch → `path.basename(cwd)`
4. `detectGitRemoteUrl`: try `execSync('git remote get-url origin', { cwd, stdio: 'pipe' }).toString().trim()`, catch → `null`
5. `detectDefaultBranch`: try `execSync('git symbolic-ref refs/remotes/origin/HEAD', ...)`, parse `refs/remotes/origin/main` → `main`, catch → `"main"` as safe default
6. `detectOwner`: try `execSync('git config user.name', ...)`, catch → `os.userInfo().username`
7. `detectAll`: call all four, return aggregated object
8. Write tests:
   - Project with package.json → name from package
   - Project without package.json → name from dirname
   - Git repo → remote URL detected
   - No git → remote URL is null
   - No git user.name → OS username used

## Acceptance Criteria

- [ ] Detects project name from `package.json` when present
- [ ] Falls back to directory basename when no `package.json`
- [ ] Detects git remote URL from `git remote get-url origin`
- [ ] Returns `null` for git remote when not a git repo
- [ ] Detects default branch from git symbolic ref
- [ ] Falls back to `"main"` when branch detection fails
- [ ] Detects owner from git config or OS username
- [ ] `detectAll()` returns a complete `ProjectMetadata` object
- [ ] All git failures are caught and return null (never throws)

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

### Suggested Validation Commands

```bash
cd apps/cli && pnpm test -- --grep detect
```

## Risks / Notes

- `execSync` is used for git commands because detection is a one-time init operation, not a hot path. The simplicity outweighs the async overhead.
- On Windows, `git` may not be on PATH. The detection should fail gracefully (return null) rather than crash.

## Follow-on Tasks

T143
