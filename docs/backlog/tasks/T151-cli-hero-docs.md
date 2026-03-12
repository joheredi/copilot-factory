# T151: Document the CLI hero experience

| Field                     | Value                                                                    |
| ------------------------- | ------------------------------------------------------------------------ |
| **ID**                    | T151                                                                     |
| **Epic**                  | [E027: Factory Lifecycle & Recovery](../epics/E027-factory-lifecycle.md) |
| **Type**                  | documentation                                                            |
| **Status**                | pending                                                                  |
| **Priority**              | P2                                                                       |
| **Owner**                 | technical-writer                                                         |
| **AI Executable**         | Yes                                                                      |
| **Human Review Required** | Yes                                                                      |
| **Dependencies**          | [T144](./T144-init-idempotent.md), [T149](./T149-workspace-cleanup.md)   |
| **Blocks**                | None                                                                     |

---

## Description

Document the complete CLI hero experience in the user guide and README: `factory init` to register a project, `factory start` to launch the factory, shutdown behavior, and crash recovery guarantees. Includes the directory structure, marker file, auto-detection logic, and what happens when things go wrong.

## Goal

Ensure developers can follow the hero scenario end-to-end from the documentation alone.

## Scope

### In Scope

- Update root `README.md` Quick Start with `npx @copilot/factory init` + `start` flow
- Update `docs/user-guide.md` with new sections:
  - "Getting Started with the CLI" — the hero scenario
  - "factory init" — auto-detection, prompts, marker file, task import
  - "factory start" — flags, banner, static serving
  - "Shutdown & Recovery" — two-phase Ctrl+C, what happens to active workers, recovery guarantees
  - "Global Data Directory" — `~/.copilot-factory/` layout
  - "Multi-Project Support" — multiple projects, dashboard filtering
- Document `.copilot-factory.json` marker file format
- Document `FACTORY_HOME` env var override

### Out of Scope

- API reference (auto-generated from Swagger)
- Internal architecture docs

## Context Files

The implementing agent should read these files before starting:

- `README.md` — current getting started section
- `docs/user-guide.md` — current user guide
- `apps/cli/src/commands/init.ts` — init implementation
- `apps/cli/src/commands/start.ts` — start implementation
- `apps/cli/src/shutdown.ts` — shutdown implementation

## Implementation Guidance

1. Update `README.md` Getting Started — replace the manual setup section with the npx flow
2. Add CLI sections to `docs/user-guide.md` between "Getting Started" and "The Operator Dashboard"
3. Use the hero scenario from the plan as the opening example
4. Document each flag and its default
5. Document the recovery guarantees: "Uncommitted work may be lost, but tasks are always retried or escalated"
6. Document the `~/.copilot-factory/` directory structure

## Acceptance Criteria

- [ ] README has npx quick-start flow
- [ ] User guide documents `factory init` with all auto-detection behavior
- [ ] User guide documents `factory start` with all flags
- [ ] User guide documents shutdown behavior and recovery guarantees
- [ ] User guide documents `~/.copilot-factory/` directory layout
- [ ] User guide documents `.copilot-factory.json` marker file

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

### Suggested Validation Commands

```bash
pnpm format:check
```

## Risks / Notes

None. Documentation-only task.

## Follow-on Tasks

None
