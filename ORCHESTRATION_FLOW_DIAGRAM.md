# Application Services Orchestration Flow Diagram

## Task Lifecycle State Machine

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        TASK STATE MACHINE FLOW                          │
└─────────────────────────────────────────────────────────────────────────┘

                           ┌──────────────┐
                           │   CREATED    │
                           └──────┬───────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │      READY              │
                    │  (Scheduler picks up)   │
                    └─────────────┬──────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          │    (no pools,         │ (acquired lease)      │ (capacity issue)
          │     capacity)         │                       │ (retries failed)
          │                       │                       │
          v                       v                       v
    ┌─────────────┐         ┌──────────────┐         ┌────────────┐
    │   FAILED    │         │   ASSIGNED   │         │ ESCALATED  │
    │ (terminal)  │         │              │         │(need help) │
    └─────────────┘         └────────┬─────┘         └────────────┘
                                     │
                      (worker starting execution)
                                     │
                            ┌────────▼──────────┐
                            │ IN_DEVELOPMENT    │
                            │ (worker running)  │
                            └────────┬───────────┘
                                     │
                   ┌─────────────────┼──────────────────┐
                   │                 │                  │
                   │(heartbeat timeout (completed OK)  │(error result)
                   │ or crash)        │                 │
                   │                  │                 │
                   v                  v                 v
              ┌─────────┐    ┌──────────────────┐  ┌────────────┐
              │ FAILED  │    │  DEV_COMPLETE    │  │ FAILED     │
              │         │    │  (validation OK) │  │(validation │
              └─────────┘    └────────┬─────────┘  │ failed)    │
                                      │            └────────────┘
                   ┌──────────────────┼──────────────────┐
                   │(Reviewer Dispatch │                 │
                   │ creates jobs)     │                 │
                   │                   │                 │
                   v                   v                 v
            ┌──────────────┐   ┌─────────────────┐  ┌────────────┐
            │  IN_REVIEW   │   │   FAILED        │  │ ESCALATED  │
            │(review jobs  │   │                 │  │            │
            │  running)    │   └─────────────────┘  └────────────┘
            └──────┬───────┘
                   │
    ┌──────────────┼──────────────┬──────────────┐
    │              │              │              │
(approved)    (changes         (escalated)
    │          requested)            │
    │              │                 │
    v              v                 v
┌─────────┐  ┌──────────────┐  ┌───────────────┐
│APPROVED │  │CHANGES_      │  │  ESCALATED    │
│         │  │REQUESTED     │  │               │
└────┬────┘  │(→ IN_DEVEL.  │  │(need manual   │
     │       │ for round 2) │  │ intervention) │
     │       └──────────────┘  └───────────────┘
     │
(Merge Queue:   │
 enqueue for    │
 merge)         │
     │          │
     v          │
┌─────────────────────┐
│ QUEUED_FOR_MERGE    │
│(waiting in queue)   │
└────────┬────────────┘
         │
(Merge Executor:
 dequeue & rebase)
         │
    ┌────┴────┐
    │          │
(success)  (conflict)
    │          │
    v          v
┌─────────────┐ ┌───────────────────────┐
│  MERGING    │ │CHANGES_REQUESTED or   │
│             │ │FAILED (based on class)│
└────┬────────┘ └───────────────────────┘
     │
(push OK)
     │
     v
┌──────────────────────────────┐
│POST_MERGE_VALIDATION         │
│(merge-gate validation runs)  │
└────┬────────┬────────────────┘
     │        │
(pass)    (fail)
     │        │
     v        v
  ┌─────┐   ┌──────────────┐
  │DONE │   │CHANGES_      │
  │     │   │REQUESTED     │
  └─────┘   │(→ IN_DEVEL.) │
            └──────────────┘
```

---

## Service Orchestration Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   COMPLETE ORCHESTRATION PIPELINE                       │
└─────────────────────────────────────────────────────────────────────────┘


PHASE 1: TASK READY & ASSIGNMENT
═════════════════════════════════════════════════════════════════════════

  ┌──────────────┐
  │ Task Created │
  │ in READY     │
  └──────┬───────┘
         │
         ├─→ [Readiness Service]
         │   └─ Check all preconditions
         │
         ├─→ [Scheduler Service] ◄──── Loop: scheduleNext()
         │   ├─ Query READY tasks (by priority)
         │   ├─ Match to compatible pools
         │   ├─ Check pool capacity
         │   └─→ [Lease Service]
         │       └─ acquireLease()
         │          ├─ Verify exclusivity
         │          ├─ Create lease (LEASED)
         │          ├─ Task → ASSIGNED
         │          └─ Emit: task.transitioned event
         │
         └─→ [Job Queue Service]
             └─ createJob(WORKER_DISPATCH)
                ├─ Status: PENDING
                └─ Ready for worker to claim


PHASE 2: WORKER EXECUTION
═════════════════════════════════════════════════════════════════════════

  ┌──────────────────────────┐
  │ Worker claims job        │
  │ (WORKER_DISPATCH)        │
  └──────┬───────────────────┘
         │
         ├─→ [Worker Supervisor Service]
         │   ├─ spawnWorker()
         │   ├─ Create workspace
         │   ├─ Mount context packets
         │   ├─ startRun() via runtime adapter
         │   │
         │   ├─→ [Heartbeat Service]
         │   │   └─ receiveHeartbeat()
         │   │      ├─ Lease: STARTING → RUNNING → HEARTBEATING
         │   │      └─ Emit: task-lease.transitioned
         │   │
         │   ├─ streamRun() (capture output)
         │   ├─ collectArtifacts()
         │   └─ finalizeRun()
         │
         └─→ Task → IN_DEVELOPMENT
             (implicit via first heartbeat)


PHASE 3: WORKER COMPLETION & VALIDATION
═════════════════════════════════════════════════════════════════════════

  ┌──────────────────────────┐
  │ Worker sends terminal    │
  │ heartbeat & result       │
  └──────┬───────────────────┘
         │
         ├─→ [Heartbeat Service]
         │   └─ Lease → COMPLETING
         │
         ├─→ [Output Validator Service]
         │   └─ Validate result packet schema
         │
         ├─→ [Validation Gate Service]
         │   ├─ Check gated transition
         │   ├─ Query validation results
         │   └─ Enforce "default-dev" profile pass
         │
         ├─→ [Transition Service]
         │   └─ Task: IN_DEVELOPMENT → DEV_COMPLETE
         │      ├─ Audit event recorded
         │      └─ Emit: task.transitioned
         │
         └─→ [Validation Packet Emitter Service]
             └─ Assemble & persist result packet


PHASE 4: REVIEW FAN-OUT
═════════════════════════════════════════════════════════════════════════

  ┌──────────────────────────┐
  │ Task reaches DEV_COMPLETE│
  └──────┬───────────────────┘
         │
         ├─→ [Review Router Service] (pure function)
         │   ├─ Analyze: changed files, tags, domain, risk
         │   └─ Return: required & optional reviewers
         │
         ├─→ [Reviewer Dispatch Service]
         │   ├─ Create ReviewCycle (NOT_STARTED → ROUTED)
         │   │
         │   ├─→ [Job Queue Service]
         │   │   ├─ createJob(REVIEWER_DISPATCH) × N specialists
         │   │   └─ createJob(LEAD_REVIEW_CONSOLIDATION)
         │   │      └─ dependsOnJobIds = [all specialist IDs]
         │   │
         │   ├─ Task → IN_REVIEW
         │   ├─ currentReviewCycleId = new cycle
         │   └─ Emit: task.transitioned, review-cycle.transitioned
         │
         └─→ Specialist review jobs ready for dispatch


PHASE 5: SPECIALIST REVIEWS
═════════════════════════════════════════════════════════════════════════

  ┌──────────────────────────┐
  │ Specialist jobs execute  │
  │ (in parallel)            │
  └──────┬───────────────────┘
         │
         ├─ Each specialist claims REVIEWER_DISPATCH job
         │
         ├─→ [Validation Runner Service]
         │   ├─ Load review policy profile
         │   ├─ Execute review checks
         │   └─ Aggregate results
         │
         ├─→ [Validation Packet Emitter Service]
         │   └─ Persist review result packet
         │
         └─→ Job → COMPLETED (or FAILED)
             └─ Specialist packet ready for lead


PHASE 6: LEAD REVIEW CONSOLIDATION
═════════════════════════════════════════════════════════════════════════

  ┌──────────────────────────────────────┐
  │ All specialist jobs terminal         │
  │ (LEAD_REVIEW_CONSOLIDATION ready)    │
  └──────┬───────────────────────────────┘
         │
         ├─→ [Lead Review Consolidation Service]
         │   ├─ Verify all specialist jobs complete
         │   ├─ Gather specialist ReviewPackets
         │   ├─ Fetch review history (prior cycles)
         │   ├─ ReviewCycle → CONSOLIDATING
         │   └─ Emit: review-cycle.transitioned
         │
         └─→ Lead reviewer receives context


PHASE 7: LEAD REVIEW DECISION
═════════════════════════════════════════════════════════════════════════

  ┌──────────────────────────────────────┐
  │ Lead reviewer completes review       │
  │ (emits LeadReviewDecisionPacket)     │
  └──────┬───────────────────────────────┘
         │
         ├─→ [Review Decision Service]
         │   ├─ Validate packet (Zod schema)
         │   ├─ Fetch task & review cycle
         │   ├─ If CHANGES_REQUESTED:
         │   │   └─ Evaluate escalation policy
         │   │      └─ Max review rounds exceeded? → ESCALATE
         │   ├─ Determine target states
         │   ├─ Create LeadReviewDecision record
         │   ├─ Transition ReviewCycle
         │   ├─ Transition Task
         │   │   ├─ APPROVED → ready for merge
         │   │   ├─ CHANGES_REQUESTED → back to development
         │   │   └─ ESCALATED → manual intervention
         │   ├─ If approved_with_follow_up:
         │   │   └─ Create follow-up task skeletons
         │   └─ Emit: task.transitioned, review-cycle.transitioned
         │
         └─→ Outcome determined


PHASE 8: MERGE QUEUEING & EXECUTION
═════════════════════════════════════════════════════════════════════════

  ┌──────────────────────────────────────┐
  │ Task APPROVED                        │
  └──────┬───────────────────────────────┘
         │
         ├─→ [Merge Queue Service]
         │   ├─ enqueueForMerge()
         │   ├─ Create MergeQueueItem (ENQUEUED)
         │   ├─ Task → QUEUED_FOR_MERGE
         │   ├─ Recalculate positions (by priority/time)
         │   └─ Emit: task.transitioned, merge-queue-item.transitioned
         │
         └─→ [Merge Queue Service]
             ├─ dequeueNext()
             │  ├─ Find highest-priority ENQUEUED item
             │  ├─ Item → PREPARING
             │  ├─ Recalculate positions
             │  └─ Return dequeued item
             │
             └─→ [Merge Executor Service]
                 ├─ Item → REBASING, Task → MERGING
                 │
                 ├─ Git rebase onto target branch
                 │  ├─ Success: continue
                 │  └─ Conflict: [Conflict Classifier Service]
                 │     ├─ Classify conflict type
                 │     └─ Item → FAILED, Task → (based on class)
                 │
                 ├─ [Validation Runner Service] (merge-gate profile)
                 │  ├─ Success: continue
                 │  └─ Failure: Item → FAILED, Task → FAILED
                 │
                 ├─ Git push to remote
                 │  ├─ Success: Item → MERGED
                 │  └─ Failure: Item → FAILED
                 │
                 ├─ Task → POST_MERGE_VALIDATION
                 ├─ [Merge Artifact Port]
                 │  └─ Persist MergePacket
                 └─ Emit: task.transitioned, merge-queue-item.transitioned


PHASE 9: POST-MERGE VALIDATION
═════════════════════════════════════════════════════════════════════════

  ┌──────────────────────────────────────┐
  │ Task in POST_MERGE_VALIDATION        │
  └──────┬───────────────────────────────┘
         │
         ├─→ [Validation Gate Service]
         │   └─ Check "merge-gate" profile must pass
         │
         ├─→ [Validation Runner Service]
         │   └─ Execute merge-gate profile checks
         │
         ├─→ [Validation Packet Emitter Service]
         │   └─ Persist validation result packet
         │
         ├─→ [Transition Service]
         │   ├─ Pass: Task → DONE
         │   └─ Fail: Task → CHANGES_REQUESTED (or based on policy)
         │
         └─→ Emit: task.transitioned


PHASE 10: FAILURE RECOVERY (at any phase)
═════════════════════════════════════════════════════════════════════════

  ┌──────────────────────────────────────┐
  │ Heartbeat timeout or crash detected  │
  └──────┬───────────────────────────────┘
         │
         ├─→ [Heartbeat Service]
         │   └─ detectStaleLeases()
         │      └─ Find missed heartbeat or TTL-expired leases
         │
         ├─→ [Lease Reclaim Service]
         │   ├─ Determine reclaim reason (timeout/crash)
         │   ├─ Lease → TIMED_OUT or CRASHED
         │   ├─ Evaluate retry policy
         │   │  ├─ Retry eligible:
         │   │  │  └─ Task → READY (retry_count++)
         │   │  └─ Retries exhausted:
         │   │     └─ Evaluate escalation policy
         │   │        ├─ Task → FAILED
         │   │        └─ Task → ESCALATED
         │   └─ Emit: task.transitioned, task-lease.transitioned
         │
         └─→ [Scheduler Service]
             └─ rescheduleNext() on next cycle


OPTIONAL: TIMEOUT DETECTION BACKGROUND SERVICE
═════════════════════════════════════════════════════════════════════════

  Periodic background process:

  1. [Heartbeat Service] detectStaleLeases()
  2. For each stale lease:
     └─ [Lease Reclaim Service] reclaimLease()
        ├─ Apply retry/escalation policy
        └─ Emit events
```

---

## Service Dependency Graph

```
                    ┌─────────────────────┐
                    │  Transition Service │◄─── Central state authority
                    │ (all transitions)   │
                    └─────────────────────┘
                             ▲
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        │                    │                    │
   ┌────┴─────┐    ┌────────┴─────┐     ┌───────┴──────┐
   │ Scheduler │    │ Worker       │     │ Lease        │
   │ Service   │    │ Supervisor   │     │ Service      │
   └────┬─────┘    └────────┬─────┘     └───────┬──────┘
        │                   │                    │
        │   ┌───────────────┼────────────────┐   │
        │   │               │                │   │
   ┌────┴──────────┐   ┌────┴───┐   ┌──────┴────────────┐
   │ Lease         │   │ Heartbeat   │ Lease Reclaim    │
   │ Service       │   │ Service     │ Service          │
   └───────────────┘   └────────┘    └──────────────────┘
        │                   │                │
        └───────────┬───────┴────────────────┘
                    │
            ┌───────┴──────────┐
            │ Job Queue        │
            │ Service          │
            └──────────────────┘
                    │
        ┌───────────┼───────────┐
        │           │           │
   ┌────┴────┐ ┌────┴──────┐ ┌─┴────────────────┐
   │Reviewer  │ │Lead Review│ │Merge Executor   │
   │Dispatch  │ │Consolid.  │ │Service          │
   │Service   │ │Service    │ └─────────────────┘
   └──────────┘ └───────────┘
        │           │
   ┌────┴───────────┴──────┐
   │ Review Decision       │
   │ Service              │
   └──────────────────────┘
        │
   ┌────┴──────────────┐
   │ Merge Queue       │
   │ Service           │
   └───────────────────┘

Other Services (supporting):
- Validation Gate Service
- Validation Runner Service
- Validation Packet Emitter Service
- Policy Snapshot Service
- Output Validator Service
- Readiness Service
- Dependency Service
- Conflict Classifier Service
```

---

## Key Transaction Boundaries

```
SERVICE TRANSACTION BOUNDARIES
═════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────┐
│ ATOMIC TRANSACTION PATTERN (ALL SERVICES)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  BEGIN TRANSACTION                                              │
│  ├─ Read entity/entities                                        │
│  ├─ Validate state machine transition                           │
│  ├─ Write status update (with optimistic concurrency)           │
│  ├─ Create audit event (ATOMICALLY)                             │
│  └─ [Other business logic writes]                               │
│  COMMIT                                                         │
│                                                                 │
│  [AFTER commit succeeds:]                                       │
│  └─ Emit domain event(s)                                        │
│                                                                 │
│  [Key guarantee: ALL reads/writes succeed, or transaction       │
│   rolls back entirely. Events only emitted on successful        │
│   commit, preventing inconsistency.]                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘


CONCURRENCY CONTROL STRATEGY
═════════════════════════════════════════════════════════════════════════

┌──────────────────────────┐
│ Optimistic Concurrency   │
├──────────────────────────┤
│                          │
│ TASKS (version-based)    │
│ ├─ version column        │
│ ├─ Increment on update   │
│ ├─ Check version before  │
│ │  write                 │
│ └─ VersionConflictError  │
│    if mismatch           │
│                          │
│ OTHER ENTITIES           │
│ (status-based)           │
│ ├─ Check status before   │
│ │  update                │
│ ├─ VersionConflictError  │
│ │  if status changed     │
│ │  concurrently          │
│ └─ Safe for low update   │
│    frequency             │
│                          │
└──────────────────────────┘


EXCLUSIVE OPERATIONS
═════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────┐
│ LEASE ACQUISITION (Atomic & Exclusive) │
├─────────────────────────────────────────┤
│                                         │
│ Within transaction:                     │
│ 1. SELECT * FROM lease                  │
│    WHERE task_id = ? AND status = ?     │
│ 2. IF exists:                           │
│    └─ RAISE ExclusivityViolationError   │
│ 3. ELSE:                                │
│    ├─ INSERT lease                      │
│    ├─ UPDATE task SET status = ASSIGNED │
│    └─ INSERT audit event                │
│                                         │
│ Result: Only ONE lease per task active  │
│                                         │
└─────────────────────────────────────────┘
```
