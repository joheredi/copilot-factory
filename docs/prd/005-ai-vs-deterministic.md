## 5. AI vs Deterministic Software Comparison

### 5.1 Guiding Rule

Use AI where judgment, summarization, prioritization, or code reasoning is needed. Use deterministic software where repeatability, correctness, safety, and state ownership matter.

### 5.2 Best Owned by Deterministic Software

- task state transitions
- task locking and exclusivity
- queue operations
- dependency graph enforcement
- worker leases and timeouts
- heartbeats and crash recovery
- branch naming and workspace lifecycle
- artifact persistence
- schema validation
- command policy enforcement
- file scope enforcement
- reviewer routing rules execution
- merge queue ordering
- git merge execution
- validation command execution
- audit logging
- metrics aggregation
- access control and secret handling

### 5.3 Best Owned by AI Agents

- backlog prioritization recommendations
- task decomposition suggestions
- code implementation
- semantic code review
- risk explanation
- consolidation of reviewer feedback
- summarization of previous attempts
- conflict reasoning when deterministic merge cannot proceed cleanly
- regression triage interpretation

### 5.4 Hybrid Areas

#### Task Selection

- deterministic: eligibility, dependency readiness, SLA filters
- AI: ranking recommendation, risk analysis, decomposition hints

#### Review Routing

- deterministic: rules based on tags, paths, repo settings (owns routing decisions)
- AI: optional suggestion of additional reviewer domains, limited to adding optional (not required) reviewers. AI suggestions are evaluated by the deterministic router and may be ignored. The lead reviewer cannot request additional review rounds; if unsatisfied, the lead reviewer must choose `escalate` instead of looping.

#### Merge Handling

- deterministic: queueing, rebase attempts, merge execution, validations
- AI: assist only when conflict semantics are non-trivial and policy permits

#### Retry and Escalation

- deterministic: thresholds, counters, dead-letter behavior
- AI: explain likely failure root cause and recommend best next action

### 5.5 Anti-Patterns to Avoid

- agents owning task state
- agents deciding they are done without schema-backed output
- agents reading full project history by default
- agents merging directly into main without merge queue controls
- using AI to replace policy enforcement
- letting all reviewers comment on all changes by default
- using chat transcripts as system memory

### 5.6 Decision Table

| Area                      | AI      | Deterministic | Recommendation                        |
| ------------------------- | ------- | ------------- | ------------------------------------- |
| Task readiness            | No      | Yes           | Deterministic                         |
| Task ranking              | Yes     | Partial       | Hybrid                                |
| Assignment                | No      | Yes           | Deterministic                         |
| Implementation            | Yes     | No            | AI                                    |
| Lint/test execution       | No      | Yes           | Deterministic                         |
| Review analysis           | Yes     | Partial       | AI-led with deterministic routing     |
| Approval state transition | No      | Yes           | Deterministic after lead decision     |
| Merge queue ordering      | No      | Yes           | Deterministic                         |
| Merge conflict execution  | Partial | Yes           | Deterministic first, AI assist second |
| Audit trail               | No      | Yes           | Deterministic                         |
| Escalation thresholds     | No      | Yes           | Deterministic                         |
| Failure explanation       | Yes     | No            | AI                                    |

---
