# T069: Implement filesystem artifact storage

| Field | Value |
|---|---|
| **ID** | T069 |
| **Epic** | [E014: Artifact Service](../epics/E014-artifact-service.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T004](./T004-vitest-setup.md) |
| **Blocks** | [T070](./T070-artifact-retrieval.md), [T071](./T071-retry-summarization.md), [T072](./T072-partial-work-snapshot.md), [T095](./T095-ui-task-detail.md) |

---

## Description

Implement the filesystem-based artifact storage service with the structured directory layout from §7.11.

## Goal

Provide reliable artifact persistence that can be upgraded to object storage later.

## Scope

### In Scope

- Store artifacts at /artifacts/repositories/{repoId}/tasks/{taskId}/...
- Subdirectories: packets/, runs/{runId}/(logs|outputs|validation), reviews/{reviewCycleId}/, merges/, summaries/
- storeArtifact(path, content) and storeJSON(path, object)
- Atomic write (write to temp, rename)

### Out of Scope

- Content-addressable storage
- Object storage backend

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Create packages/infrastructure/src/artifacts/artifact-store.ts
2. Use the layout from §7.11 as the directory structure
3. storeArtifact: create directories, write file atomically (write to .tmp, rename)
4. storePacket: serialize JSON, store at packets/{packetType}-{id}.json
5. storeLog: store at runs/{runId}/logs/{logName}.log
6. All paths are relative to the artifact root, stored as artifact_refs in entities

## Acceptance Criteria

- [ ] Artifacts stored in correct directory structure
- [ ] Writes are atomic (no partial files on crash)
- [ ] Directory creation is idempotent
- [ ] artifact_refs are relative paths

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Store and retrieve various artifact types

### Suggested Validation Commands

```bash
pnpm test --filter @factory/infrastructure -- --grep artifact-store
```

## Risks / Notes

Filesystem operations are not transactional with DB. Accept eventual consistency.

## Follow-on Tasks

T070, T071, T072, T095
