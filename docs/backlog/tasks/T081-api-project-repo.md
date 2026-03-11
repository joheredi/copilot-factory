# T081: Implement Project and Repository CRUD endpoints

| Field                     | Value                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T081                                                                                                                |
| **Epic**                  | [E017: REST API Layer](../epics/E017-rest-api.md)                                                                   |
| **Type**                  | feature                                                                                                             |
| **Status**                | done                                                                                                                |
| **Priority**              | P0                                                                                                                  |
| **Owner**                 | backend-engineer                                                                                                    |
| **AI Executable**         | Yes                                                                                                                 |
| **Human Review Required** | Yes                                                                                                                 |
| **Dependencies**          | [T008](./T008-migration-project-repo.md), [T014](./T014-entity-repositories.md), [T080](./T080-nestjs-bootstrap.md) |
| **Blocks**                | [T089](./T089-react-spa-init.md)                                                                                    |

---

## Description

Create REST endpoints for Project and Repository CRUD operations.

## Goal

Enable project and repository management through the API.

## Scope

### In Scope

- POST/GET/PUT/DELETE /api/projects
- POST/GET/PUT/DELETE /api/projects/:id/repositories
- GET /api/repositories/:id
- Request/response DTOs with validation
- Pagination for list endpoints

### Out of Scope

- Repository cloning/sync operations
- Credential management

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`
- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Create ProjectsController and RepositoriesController in apps/control-plane/src/modules/
2. DTOs: CreateProjectDto, UpdateProjectDto, CreateRepositoryDto, etc.
3. List endpoints support ?page=&limit= query params
4. Return 404 for missing entities, 400 for validation errors
5. Wire to repository layer via service classes

## Acceptance Criteria

- [ ] All CRUD operations work for Projects and Repositories
- [ ] Validation rejects invalid input
- [ ] Pagination works correctly
- [ ] 404 returned for missing entities

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

API tests for all endpoints

### Suggested Validation Commands

```bash
pnpm test --filter @factory/control-plane -- --grep api/project
```

## Risks / Notes

API design should be stable. Review endpoint structure before implementing.

## Follow-on Tasks

T089
