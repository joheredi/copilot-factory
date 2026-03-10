# E017: REST API Layer

## Summary

Build the NestJS control plane API with CRUD endpoints for all entities and management operations.

## Why This Epic Exists

The API is the interface between the UI, operators, and the control plane. All external interaction goes through it.

## Goals

- NestJS app bootstrap with module structure
- CRUD for projects, repositories, tasks
- Worker pool and profile management
- Artifact and review packet retrieval
- Audit, policy, and config endpoints

## Scope

### In Scope

- REST endpoints from docs/prd/007-technical-architecture.md §7.7
- Request validation
- Error handling
- OpenAPI documentation

### Out of Scope

- WebSocket events (E018)
- UI-specific BFF endpoints

## Dependencies

**Depends on:** E002, E003, E014, E015

**Enables:** E018, E019, E021

## Risks / Notes

API design must be stable early since UI depends on it. Versioning strategy needed.

## Tasks

| ID | Title | Priority | Status |
|---|---|---|---|
| [T080](../tasks/T080-nestjs-bootstrap.md) | Implement NestJS application bootstrap and module structure | P0 | pending |
| [T081](../tasks/T081-api-project-repo.md) | Implement Project and Repository CRUD endpoints | P0 | pending |
| [T082](../tasks/T082-api-task-management.md) | Implement Task management endpoints | P0 | pending |
| [T083](../tasks/T083-api-worker-pool.md) | Implement WorkerPool and AgentProfile endpoints | P1 | pending |
| [T084](../tasks/T084-api-artifacts-reviews.md) | Implement Artifact and Review packet retrieval endpoints | P1 | pending |
| [T085](../tasks/T085-api-audit-policy-config.md) | Implement Audit, Policy, and Config endpoints | P1 | pending |

## Sequencing Notes

Tasks within this epic should generally be completed in the order listed. Tasks with explicit dependencies must respect those dependencies.

## Completion Criteria

All entity CRUD operations available via REST. Endpoints validated and documented.
