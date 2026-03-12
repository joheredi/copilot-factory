# T100: Build audit explorer view

| Field                     | Value                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| **ID**                    | T100                                                                                                      |
| **Epic**                  | [E020: Web UI Feature Views](../epics/E020-web-ui-features.md)                                            |
| **Type**                  | feature                                                                                                   |
| **Status**                | done                                                                                                      |
| **Priority**              | P2                                                                                                        |
| **Owner**                 | frontend-engineer                                                                                         |
| **AI Executable**         | Yes                                                                                                       |
| **Human Review Required** | Yes                                                                                                       |
| **Dependencies**          | [T074](./T074-audit-query-service.md), [T090](./T090-api-client-tanstack.md), [T092](./T092-app-shell.md) |
| **Blocks**                | None                                                                                                      |

---

## Description

Build the audit explorer for searching and browsing audit events across the system.

## Goal

Enable operators to investigate and reconstruct system behavior.

## Scope

### In Scope

- Audit event search with filters (entity, time range, actor, event type)
- Timeline display for search results
- Event detail expansion
- Quick link from task detail to task-specific audit trail

### Out of Scope

- Audit analytics
- Audit export

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/001-architecture.md`

## Implementation Guidance

1. Create apps/web-ui/src/features/audit/AuditExplorerPage.tsx
2. Filter bar: entity type, entity ID, time range, actor type, event type
3. Results as timeline with expandable event details
4. Event detail shows: old state, new state, actor, metadata
5. Metadata rendered as formatted JSON

## Acceptance Criteria

- [ ] Search filters work correctly
- [ ] Results ordered chronologically
- [ ] Event details expandable
- [ ] Metadata readable

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Search audit events and verify results

### Suggested Validation Commands

```bash
cd apps/web-ui && pnpm dev
```

## Risks / Notes

Large result sets need pagination. Ensure it's included.

## Follow-on Tasks

None
