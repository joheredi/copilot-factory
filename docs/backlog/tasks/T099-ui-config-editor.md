# T099: Build configuration editor view

| Field | Value |
|---|---|
| **ID** | T099 |
| **Epic** | [E020: Web UI Feature Views](../epics/E020-web-ui-features.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P2 |
| **Owner** | frontend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T090](./T090-api-client-tanstack.md), [T092](./T092-app-shell.md) |
| **Blocks** | None |

---

## Description

Build the configuration editor for viewing and modifying pool configurations, policy sets, prompt templates, and routing rules.

## Goal

Enable operators to tune system behavior through the UI.

## Scope

### In Scope

- Policy set viewer/editor
- Pool configuration editing
- Prompt template viewer
- Review routing rule display
- JSON editor for complex config objects

### Out of Scope

- Config versioning/history
- Config import/export

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/006-additional-refinements.md`

## Implementation Guidance

1. Create apps/web-ui/src/features/config/ConfigEditorPage.tsx
2. Tabs: Policies, Pools, Prompts, Routing Rules
3. Use a JSON editor component for policy objects
4. Show current effective values alongside editable overrides
5. Save changes via API mutation hooks
6. Confirmation dialog before saving changes

## Acceptance Criteria

- [ ] Configuration viewable for all config types
- [ ] Editable config saves correctly
- [ ] Confirmation before save
- [ ] Invalid config rejected with error

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Edit a config value and verify it takes effect

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm dev
```

## Risks / Notes

Config editing can break the system. Add validation and confirmation.

## Follow-on Tasks

None
