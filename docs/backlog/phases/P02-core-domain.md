# P02: Core Domain Skeleton

## Goal

Implement the state machines, transition engine, job queue, scheduler, lease management, dependency engine, and policy system — the deterministic control plane core.

## Why This Phase Exists

The control plane core is the foundation of correctness. All orchestration, scheduling, and safety depends on these modules.

## Included Epics

- [E003](../epics/E003-state-machine-transition.md): State Machine & Transition Engine
- [E005](../epics/E005-job-queue-scheduling.md): Job Queue & Scheduling
- [E006](../epics/E006-lease-management.md): Lease Management & Heartbeats
- [E007](../epics/E007-dependency-readiness.md): Dependency & Readiness Engine
- [E010](../epics/E010-policy-configuration.md): Policy & Configuration

## Included Tasks

T015, T016, T017, T018, T019, T025, T026, T027, T028, T029, T030, T031, T032, T033, T034, T035, T036, T037, T038, T048, T049, T050, T051, T052, T053

## Exit Criteria

- State machine validates all transitions correctly
- Job queue supports claim/complete/fail with dependencies
- Scheduler assigns tasks to pools
- Leases enforce exclusivity with heartbeat monitoring
- Dependencies compute readiness correctly
- All policies resolve and snapshot correctly

## Risks

State machine complexity. Concurrency in lease management. Policy resolution precedence.
