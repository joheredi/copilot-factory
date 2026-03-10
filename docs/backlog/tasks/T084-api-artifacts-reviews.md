# T084: Implement Artifact and Review packet retrieval endpoints

| Field | Value |
|---|---|
| **ID** | T084 |
| **Epic** | [E017: REST API Layer](../epics/E017-rest-api.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P1 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T070](./T070-artifact-retrieval.md), [T080](./T080-nestjs-bootstrap.md) |
| **Blocks** | [T089](./T089-react-spa-init.md) |

---

## Description

Create REST endpoints for retrieving artifacts, packets, and review decisions.

## Goal

Enable the UI to display task artifacts, review details, and merge results.

## Scope

### In Scope

- GET /api/tasks/:id/artifacts (artifact tree)
- GET /api/tasks/:id/packets/:packetId
- GET /api/tasks/:id/reviews (review cycle history)
- GET /api/tasks/:id/reviews/:cycleId/packets
- GET /api/tasks/:id/merge (merge details)

### Out of Scope

- Artifact upload
- Artifact deletion

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Create ArtifactsController and ReviewsController
2. Artifact tree endpoint: list all artifacts for a task organized by type
3. Packet endpoint: return parsed JSON packet content
4. Review history: all review cycles with their specialist and lead decisions
5. Merge details: merge packet, validation results, post-merge analysis if any

## Acceptance Criteria

- [ ] Artifact tree correctly organized
- [ ] Packets returned as parsed JSON
- [ ] Review history includes all cycles and decisions
- [ ] Missing artifacts handled gracefully

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Seed data and test retrieval endpoints

### Suggested Validation Commands

```bash
pnpm test --filter @factory/control-plane -- --grep api/artifact
```

## Risks / Notes

Large artifacts may need streaming. For V1, full response is acceptable.

## Follow-on Tasks

T089
