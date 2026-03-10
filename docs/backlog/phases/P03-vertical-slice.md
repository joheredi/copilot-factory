# P03: First End-to-End Vertical Slice

## Goal

Complete the worker runtime, workspace management, validation runner, review pipeline, merge pipeline, artifact service, and API layer to achieve a full task lifecycle from BACKLOG to DONE.

## Why This Phase Exists

This proves the system works end-to-end. It is the V1 proof of concept.

## Included Epics

- [E008](../epics/E008-workspace-management.md): Workspace Management
- [E009](../epics/E009-worker-runtime.md): Worker Runtime & Execution
- [E011](../epics/E011-validation-runner.md): Validation Runner
- [E012](../epics/E012-review-pipeline.md): Review Pipeline
- [E013](../epics/E013-merge-pipeline.md): Merge Pipeline
- [E014](../epics/E014-artifact-service.md): Artifact Service
- [E015](../epics/E015-audit-events.md): Audit & Event System
- [E017](../epics/E017-rest-api.md): REST API Layer

## Included Tasks

T039, T040, T041, T042, T043, T044, T045, T046, T047, T054, T055, T056, T057, T058, T059, T060, T061, T062, T063, T064, T065, T066, T067, T068, T069, T070, T071, T072, T073, T074, T075, T080, T081, T082, T083, T084, T085

## Exit Criteria

- A task can be created via API and driven through the full lifecycle to DONE
- Worker executes in isolated workspace and submits valid packets
- Review pipeline routes, reviews, and consolidates
- Merge queue processes and merges correctly
- All artifacts persisted and retrievable
- Audit trail complete for every transition

## Risks

Copilot CLI integration may require experimentation. Merge pipeline has complex failure modes.
