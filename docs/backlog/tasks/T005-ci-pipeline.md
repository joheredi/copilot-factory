# T005: Create CI pipeline with GitHub Actions

| Field                     | Value                                                                          |
| ------------------------- | ------------------------------------------------------------------------------ |
| **ID**                    | T005                                                                           |
| **Epic**                  | [E001: Repository & Platform Foundation](../epics/E001-platform-foundation.md) |
| **Type**                  | infra                                                                          |
| **Status**                | pending                                                                        |
| **Priority**              | P0                                                                             |
| **Owner**                 | platform-engineer                                                              |
| **AI Executable**         | Yes                                                                            |
| **Human Review Required** | Yes                                                                            |
| **Dependencies**          | [T003](./T003-eslint-prettier.md), [T004](./T004-vitest-setup.md)              |
| **Blocks**                | None                                                                           |

---

## Description

Create a GitHub Actions CI workflow that runs lint, typecheck, and tests on every push and pull request.

## Goal

Catch errors early and maintain code quality through automated CI.

## Scope

### In Scope

- .github/workflows/ci.yml
- Jobs: install, lint, typecheck, test
- pnpm caching
- Node.js 20+ matrix

### Out of Scope

- Deployment pipelines
- Release automation
- Docker builds

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Create .github/workflows/ci.yml triggered on push and pull_request
2. Use pnpm/action-setup and actions/setup-node with caching
3. Jobs: install -> lint -> typecheck (tsc --noEmit) -> test
4. Use pnpm store cache for faster installs
5. Set fail-fast: false so all checks report independently

## Acceptance Criteria

- [ ] CI workflow file exists and is valid YAML
- [ ] Workflow runs lint, typecheck, and test steps
- [ ] pnpm caching is configured for performance

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Push a commit and verify CI runs all checks

### Suggested Validation Commands

```bash
act -j lint  # if act is available locally
```

## Risks / Notes

CI environment may differ from local. Ensure Node.js version matches .nvmrc.

## Follow-on Tasks

None
