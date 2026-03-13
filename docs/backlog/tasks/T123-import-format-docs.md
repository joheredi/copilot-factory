# T123: Write task format reference documentation

| Field                     | Value                                                                        |
| ------------------------- | ---------------------------------------------------------------------------- |
| **ID**                    | T123                                                                         |
| **Epic**                  | [E023: Task Import Pipeline](../epics/E023-task-import.md)                   |
| **Type**                  | documentation                                                                |
| **Status**                | done                                                                         |
| **Priority**              | P2                                                                           |
| **Owner**                 | technical-writer                                                             |
| **AI Executable**         | Yes                                                                          |
| **Human Review Required** | Yes                                                                          |
| **Dependencies**          | [T113](./T113-build-markdown-parser.md), [T114](./T114-build-json-parser.md) |
| **Blocks**                | None                                                                         |

---

## Description

Create a reference document (`docs/TASK_FORMAT.md`) that describes the canonical task file formats supported by the import system. Includes the markdown format (with metadata table fields and section structure), the JSON format (backlog.json and flat array), field mappings between formats and the system data model, and an AI prompt template users can give to Copilot or ChatGPT to convert their existing tasks into the factory format.

## Goal

Enable users to prepare their task files for import without guesswork, and provide a ready-to-use AI prompt for format conversion.

## Scope

### In Scope

- Canonical markdown format: metadata table fields, required vs optional, heading structure, acceptance criteria format
- JSON format: backlog.json schema with epics/tasks, flat tasks.json array
- Field mapping table: markdown field name → JSON field name → system field name (CreateTaskDto)
- Priority mapping: P0→critical, P1→high, P2→medium, P3→low
- Type mapping: foundation→feature, etc.
- Complete example of a valid markdown task file
- Complete example of a valid JSON task entry
- AI prompt template: a ready-to-paste prompt that instructs an AI to convert a user's existing task format into factory-compatible markdown
- Troubleshooting: common parse warnings and how to fix them

### Out of Scope

- Internal parser implementation details
- API documentation (covered in user guide)

## Context Files

The implementing agent should read these files before starting:

- `docs/backlog/tasks/T001-init-monorepo.md` (example markdown format)
- `docs/backlog/backlog.json` (example JSON format, first 100 lines)
- `packages/schemas/src/import/task-import.ts` (canonical schema from T112)

## Implementation Guidance

1. Create `docs/TASK_FORMAT.md`
2. Section 1 — Overview: what formats are supported, when to use each
3. Section 2 — Markdown Format: full field reference with required/optional markers, section headings, checkbox syntax
4. Section 3 — JSON Format: backlog.json schema and flat array schema with JSON examples
5. Section 4 — Field Mapping Table: three-column table mapping between formats
6. Section 5 — Complete Examples: one full markdown file, one full JSON entry
7. Section 6 — AI Prompt Template: a prompt block users can paste into Copilot/ChatGPT that says "Convert the following tasks into factory-compatible markdown format. Here is the expected format: [schema]. Here are my tasks: [paste here]"
8. Section 7 — Troubleshooting: common warnings (missing title, unknown priority, circular dependencies) and fixes

## Acceptance Criteria

- [ ] Markdown format is fully documented with all fields and examples
- [ ] JSON format is fully documented with schema and examples
- [ ] Field mapping table is complete and accurate
- [ ] AI prompt template is provided and tested (produces valid output when used)
- [ ] At least one complete example for each format
- [ ] Troubleshooting section covers the top 5 common issues

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Use the AI prompt template with a sample set of tasks and verify the output parses correctly.

### Suggested Validation Commands

```bash
pnpm format:check
```

## Risks / Notes

The AI prompt template should be robust enough to produce valid output across different AI providers (Copilot, ChatGPT, Claude). Test with at least one.

## Follow-on Tasks

None
