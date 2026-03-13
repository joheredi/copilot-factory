# T122: Write CLI and import documentation

| Field                     | Value                                                                      |
| ------------------------- | -------------------------------------------------------------------------- |
| **ID**                    | T122                                                                       |
| **Epic**                  | [E024: CLI Package & Single-Command Startup](../epics/E024-cli-package.md) |
| **Type**                  | documentation                                                              |
| **Status**                | done                                                                       |
| **Priority**              | P2                                                                         |
| **Owner**                 | technical-writer                                                           |
| **AI Executable**         | Yes                                                                        |
| **Human Review Required** | Yes                                                                        |
| **Dependencies**          | [T121](./T121-cli-entry-point.md)                                          |
| **Blocks**                | None                                                                       |

---

## Description

Write documentation for the CLI package and update existing docs to include the import feature. Covers the root README quick-start, a dedicated CLI README, and updates to the user guide.

## Goal

Ensure users can discover, install, and use the factory CLI and import features through clear documentation.

## Scope

### In Scope

- Update root `README.md` Getting Started section with `npx @copilot/factory` quick-start
- Create `apps/cli/README.md` with full CLI documentation (flags, examples, configuration)
- Update `docs/user-guide.md` with new sections for Task Import and CLI usage
- Include examples of the import flow (path input, preview, import)

### Out of Scope

- API reference docs (auto-generated from Swagger)
- Internal architecture docs

## Context Files

The implementing agent should read these files before starting:

- `README.md` (current getting started section)
- `docs/user-guide.md` (current user guide)
- `apps/cli/src/cli.ts` (CLI implementation from T121)

## Implementation Guidance

1. Update `README.md` Getting Started section — add a "Quick Start" block before the existing setup instructions:
   ```
   ### Quick Start
   npx @copilot/factory
   ```
2. Create `apps/cli/README.md` documenting all CLI flags, environment variables, and usage examples
3. Add "Task Import" section to `docs/user-guide.md` covering the web UI import dialog flow
4. Add "CLI Usage" section to `docs/user-guide.md` covering single-command startup

## Acceptance Criteria

- [ ] Root README has a quick-start section with `npx @copilot/factory`
- [ ] `apps/cli/README.md` documents all flags and options
- [ ] User guide covers the import dialog flow with step descriptions
- [ ] User guide covers CLI startup with flag reference

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Read through the docs and verify they are accurate and complete.

### Suggested Validation Commands

```bash
pnpm format:check
```

## Risks / Notes

None. Documentation-only task.

## Follow-on Tasks

None
