# T080: Implement NestJS application bootstrap and module structure

| Field                     | Value                                                                                                                                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                    | T080                                                                                                                                                                                                                                                                         |
| **Epic**                  | [E017: REST API Layer](../epics/E017-rest-api.md)                                                                                                                                                                                                                            |
| **Type**                  | foundation                                                                                                                                                                                                                                                                   |
| **Status**                | pending                                                                                                                                                                                                                                                                      |
| **Priority**              | P0                                                                                                                                                                                                                                                                           |
| **Owner**                 | backend-engineer                                                                                                                                                                                                                                                             |
| **AI Executable**         | Yes                                                                                                                                                                                                                                                                          |
| **Human Review Required** | Yes                                                                                                                                                                                                                                                                          |
| **Dependencies**          | [T002](./T002-typescript-config.md), [T006](./T006-sqlite-drizzle-setup.md)                                                                                                                                                                                                  |
| **Blocks**                | [T078](./T078-prometheus-endpoint.md), [T081](./T081-api-project-repo.md), [T082](./T082-api-task-management.md), [T083](./T083-api-worker-pool.md), [T084](./T084-api-artifacts-reviews.md), [T085](./T085-api-audit-policy-config.md), [T086](./T086-websocket-gateway.md) |

---

## Description

Bootstrap the NestJS application in apps/control-plane with module structure matching the domain modules, global error handling, request validation, and OpenAPI documentation.

## Goal

Establish the API framework so endpoint implementation can proceed in parallel.

## Scope

### In Scope

- NestJS app bootstrap with @nestjs/core
- Module structure matching domain modules
- Global exception filter
- Request validation with class-validator or Zod
- OpenAPI/Swagger documentation setup
- Health check endpoint
- CORS configuration for local UI

### Out of Scope

- Specific CRUD endpoints (T081-T085)
- Authentication (deferred for V1 local mode)

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Install @nestjs/core, @nestjs/common, @nestjs/platform-fastify (or express)
2. Create AppModule importing feature modules: ProjectsModule, TasksModule, WorkersModule, etc.
3. Set up global validation pipe with Zod or class-validator
4. Set up global exception filter that returns structured error responses
5. Add @nestjs/swagger for OpenAPI docs at /api/docs
6. Add health endpoint at GET /health
7. Configure CORS to allow localhost origins

## Acceptance Criteria

- [ ] NestJS app starts successfully
- [ ] GET /health returns 200
- [ ] OpenAPI docs accessible at /api/docs
- [ ] Global error handling returns structured errors
- [ ] Request validation rejects invalid input

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Start app and test health endpoint

### Suggested Validation Commands

```bash
cd apps/control-plane && pnpm dev
```

```bash
curl http://localhost:3000/health
```

## Risks / Notes

NestJS module wiring can be complex. Start with minimal modules and expand.

## Follow-on Tasks

T078, T081, T082, T083, T084, T085, T086
