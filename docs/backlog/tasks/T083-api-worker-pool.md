# T083: Implement WorkerPool and AgentProfile endpoints

| Field                     | Value                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **ID**                    | T083                                                                                                               |
| **Epic**                  | [E017: REST API Layer](../epics/E017-rest-api.md)                                                                  |
| **Type**                  | feature                                                                                                            |
| **Status**                | pending                                                                                                            |
| **Priority**              | P1                                                                                                                 |
| **Owner**                 | backend-engineer                                                                                                   |
| **AI Executable**         | Yes                                                                                                                |
| **Human Review Required** | Yes                                                                                                                |
| **Dependencies**          | [T010](./T010-migration-worker-pool.md), [T014](./T014-entity-repositories.md), [T080](./T080-nestjs-bootstrap.md) |
| **Blocks**                | [T089](./T089-react-spa-init.md)                                                                                   |

---

## Description

Create REST endpoints for WorkerPool and AgentProfile management.

## Goal

Enable pool configuration through the API.

## Scope

### In Scope

- POST/GET/PUT /api/pools
- GET /api/pools/:id/workers (active workers)
- POST/GET/PUT /api/pools/:id/profiles
- Pool enable/disable
- Concurrency limit management

### Out of Scope

- Worker process management
- Pool performance metrics

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/002-data-model.md`
- `docs/prd/006-additional-refinements.md`

## Implementation Guidance

1. Create PoolsController and ProfilesController
2. Pool creation requires: name, pool_type, provider, runtime, model, max_concurrency
3. Profile creation requires: pool_id, prompt_template_id, policy references
4. GET pools includes current worker count and active task count
5. Enable/disable via PUT /api/pools/:id with enabled field

## Acceptance Criteria

- [ ] Pool CRUD works correctly
- [ ] Profile CRUD linked to pool
- [ ] Pool status includes active worker count
- [ ] Disable prevents new assignments

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

API tests for pool and profile management

### Suggested Validation Commands

```bash
pnpm test --filter @factory/control-plane -- --grep api/pool
```

## Risks / Notes

Pool configuration changes should not affect in-progress work.

## Follow-on Tasks

T089
