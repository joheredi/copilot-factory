# E023: Task Import Pipeline

## Summary

Enable users to import tasks from local directory structures into the factory. Includes a deterministic parser for markdown and JSON task files, a discovery/preview API, an execution endpoint that auto-creates projects and repositories, and a web UI import dialog.

## Why This Epic Exists

Users have no way to populate the factory with tasks from their existing backlogs. The first-run experience requires manual API calls to create projects, repositories, and tasks one by one. A streamlined import flow lets users point at a directory of task files and import them in bulk, making the factory immediately useful.

## Goals

- Define a canonical task import schema with Zod validation
- Parse markdown task files (metadata tables, headings, checkbox lists) and JSON index files deterministically
- Provide a discovery API that previews parsed tasks without writing to the database
- Provide an execution API that creates project, repository, and tasks in a single flow
- Build a multi-step web UI dialog for the complete import flow
- Document the expected formats and provide an AI prompt template for format conversion

## Scope

### In Scope

- Zod schemas for imported tasks and import manifests
- Markdown parser for `tasks/**/*.md` files with metadata tables
- JSON parser for `backlog.json` and flat `tasks.json` formats
- `POST /import/discover` endpoint (preview only)
- `POST /import/execute` endpoint (creates entities)
- Auto-creation of project and repository during first import
- Web UI import dialog with path input, preview, confirm, and result steps
- Task format reference documentation with AI prompt template

### Out of Scope

- AI-powered parsing of unstructured task formats (future enhancement)
- File upload (the control-plane reads the local filesystem directly)
- Incremental sync or two-way sync with external systems
- Importing epics, phases, or workflow templates

## Dependencies

**Depends on:** E001, E002, E017, E019, E020

**Enables:** None (standalone feature)

## Risks / Notes

- The control-plane reads the local filesystem, which only works in local-first deployment mode. Future multi-node deployments would need a file upload approach.
- The deterministic parser handles known formats; unrecognized structures produce warnings, not errors.
- ExternalRef-based deduplication prevents duplicate imports when re-running on the same directory.

## Tasks

| ID                                                 | Title                                     | Priority | Status  |
| -------------------------------------------------- | ----------------------------------------- | -------- | ------- |
| [T112](../tasks/T112-define-import-schema.md)      | Define task import Zod schemas            | P0       | pending |
| [T113](../tasks/T113-build-markdown-parser.md)     | Build deterministic markdown task parser  | P0       | pending |
| [T114](../tasks/T114-build-json-parser.md)         | Build JSON/backlog.json task parser       | P1       | pending |
| [T115](../tasks/T115-import-discovery-endpoint.md) | Create POST /import/discover endpoint     | P0       | pending |
| [T116](../tasks/T116-import-execute-endpoint.md)   | Create POST /import/execute endpoint      | P0       | pending |
| [T117](../tasks/T117-import-api-hooks.md)          | Create TanStack Query import hooks        | P1       | pending |
| [T118](../tasks/T118-import-dialog-component.md)   | Build Import Tasks multi-step dialog      | P1       | pending |
| [T123](../tasks/T123-import-format-docs.md)        | Write task format reference documentation | P2       | pending |

## Sequencing Notes

T112 (schemas) must be completed first. T113 and T114 (parsers) can run in parallel after T112. T115 and T116 (API) are sequential. T117 and T118 (UI) follow the API work. T123 (docs) can start after parsers are done.

## Completion Criteria

A user can open the web UI, click "Import Tasks", enter a local directory path, preview discovered tasks, and import them into the system — with project and repository auto-created on first import.
