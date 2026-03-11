# T095: Build task detail timeline view

| Field                     | Value                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| **ID**                    | T095                                                               |
| **Epic**                  | [E020: Web UI Feature Views](../epics/E020-web-ui-features.md)     |
| **Type**                  | feature                                                            |
| **Status**                | pending                                                            |
| **Priority**              | P1                                                                 |
| **Owner**                 | frontend-engineer                                                  |
| **AI Executable**         | Yes                                                                |
| **Human Review Required** | Yes                                                                |
| **Dependencies**          | [T090](./T090-api-client-tanstack.md), [T092](./T092-app-shell.md) |
| **Blocks**                | [T104](./T104-ui-operator-task.md)                                 |

---

## Description

Build the task detail view showing complete task information, audit timeline, packets, and artifacts.

## Goal

Enable operators to inspect any task and reconstruct what happened.

## Scope

### In Scope

- Task metadata display (all fields)
- Audit timeline (chronological events)
- Packet display (task packet, dev result, review decisions)
- Artifact listing with download links
- Dependency display
- Current state with visual indicator

### Out of Scope

- Operator action controls (T104)
- Diff viewer

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/001-architecture.md`

## Implementation Guidance

1. Create apps/web-ui/src/features/task-detail/TaskDetailPage.tsx
2. Tabs: Overview, Timeline, Packets, Artifacts, Dependencies
3. Timeline: vertical list of audit events with timestamps and actors
4. Packets: JSON viewer for each packet type with syntax highlighting
5. Artifacts: tree view matching filesystem layout
6. Dependencies: list with status badges and links to dependent tasks

## Acceptance Criteria

- [ ] All task metadata displayed
- [ ] Timeline shows complete history
- [ ] Packets rendered with syntax highlighting
- [ ] Artifacts listed and downloadable
- [ ] Dependencies navigable

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

View task detail for a task with full lifecycle data

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm dev
```

## Risks / Notes

JSON viewer for large packets may be slow. Use lazy rendering.

## Follow-on Tasks

T104
