# T071: Implement summarization packet generation for retries

| Field | Value |
|---|---|
| **ID** | T071 |
| **Epic** | [E014: Artifact Service](../epics/E014-artifact-service.md) |
| **Type** | feature |
| **Status** | pending |
| **Priority** | P1 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T069](./T069-artifact-storage.md), [T034](./T034-crash-recovery-artifacts.md) |
| **Blocks** | None |

---

## Description

Generate summarization packets that condense failed-run artifacts into bounded context for the next retry attempt.

## Goal

Give retry workers useful context about prior failures without overwhelming them with full logs.

## Scope

### In Scope

- Summarize failed run: what was attempted, what failed, partial output
- Bounded size (cap summary length)
- Include in TaskPacket.context.prior_partial_work
- Reference full artifacts for detailed inspection

### Out of Scope

- AI-generated summaries (use structured extraction)
- Cross-run analysis

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/007-technical-architecture.md`

## Implementation Guidance

1. Create packages/application/src/services/summarization.service.ts
2. generateRetrySummary(taskId, failedRunId): extract key info from failed run artifacts
3. Include: what files were modified, what validations ran, what failed, partial result if any
4. Cap total summary at ~2000 characters for context efficiency
5. Store summary as artifact, reference it in prior_partial_work

## Acceptance Criteria

- [ ] Summary captures key failure information
- [ ] Summary is bounded in size
- [ ] Summary stored as artifact and referenced correctly

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Generate summary from a simulated failed run

### Suggested Validation Commands

```bash
pnpm test --filter @factory/application -- --grep summariz
```

## Risks / Notes

Summaries must be useful but not too verbose. Balance is key.

## Follow-on Tasks

None
