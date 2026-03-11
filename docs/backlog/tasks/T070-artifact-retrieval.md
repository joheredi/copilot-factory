# T070: Implement artifact reference resolution and retrieval

| Field                     | Value                                                       |
| ------------------------- | ----------------------------------------------------------- |
| **ID**                    | T070                                                        |
| **Epic**                  | [E014: Artifact Service](../epics/E014-artifact-service.md) |
| **Type**                  | feature                                                     |
| **Status**                | done                                                        |
| **Priority**              | P0                                                          |
| **Owner**                 | backend-engineer                                            |
| **AI Executable**         | Yes                                                         |
| **Human Review Required** | Yes                                                         |
| **Dependencies**          | [T069](./T069-artifact-storage.md)                          |
| **Blocks**                | [T084](./T084-api-artifacts-reviews.md)                     |

---

## Description

Implement artifact retrieval by reference path and by entity query (all artifacts for a task, run, review cycle, etc.).

## Goal

Make artifacts easily retrievable for the UI, API, and internal services.

## Scope

### In Scope

- getArtifact(repoId, taskId, artifactRef) -> content
- listArtifacts(repoId, taskId) -> artifact tree
- listRunArtifacts(repoId, taskId, runId) -> artifact list
- JSON artifact deserialization with schema version handling

### Out of Scope

- Artifact search/indexing
- Artifact streaming

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Create retrieval methods in the artifact store
2. Resolve relative refs to absolute filesystem paths
3. List artifacts by walking the directory tree
4. For JSON artifacts: parse and return typed content
5. Handle missing artifacts gracefully (return null, not throw)

## Acceptance Criteria

- [ ] Artifacts retrievable by ref path
- [ ] Listing returns correct artifact tree
- [ ] Missing artifacts handled gracefully
- [ ] JSON artifacts parsed correctly

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Store artifacts, then retrieve by various methods

### Suggested Validation Commands

```bash
pnpm test --filter @factory/infrastructure -- --grep artifact-retriev
```

## Risks / Notes

Directory traversal security — ensure paths stay within artifact root.

## Follow-on Tasks

T084
