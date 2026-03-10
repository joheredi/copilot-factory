# T047: Implement policy-aware command wrapper

| Field | Value |
|---|---|
| **ID** | T047 |
| **Epic** | [E009: Worker Runtime & Execution](../epics/E009-worker-runtime.md) |
| **Type** | security |
| **Status** | pending |
| **Priority** | P0 |
| **Owner** | backend-engineer |
| **AI Executable** | Yes |
| **Human Review Required** | Yes |
| **Dependencies** | [T048](./T048-command-policy.md) |
| **Blocks** | [T045](./T045-copilot-cli-adapter.md), [T055](./T055-validation-command-exec.md) |

---

## Description

Build the command execution wrapper that enforces command policy (allowlist, denied patterns, forbidden args) before executing any shell command on behalf of a worker.

## Goal

Prevent workers from executing unauthorized or dangerous commands.

## Scope

### In Scope

- Command validation against allowlist
- Denied pattern matching
- Forbidden arg pattern matching
- Structured command arguments (not raw shell strings)
- Shell compound command and subshell blocking
- Policy violation artifact emission on denied command

### Out of Scope

- Network policy enforcement
- File system monitoring

## Context Files

The implementing agent should read these files before starting:

- `docs/prd/009-policy-and-enforcement-spec.md`

## Implementation Guidance

1. Create packages/infrastructure/src/policy/command-wrapper.ts
2. executeCommand(command, args, policySnapshot): validate then execute
3. Validation: 1) check command in allowed_commands, 2) check args match allowed_args_prefixes, 3) check against denied_patterns, 4) check against forbidden_arg_patterns
4. If allow_shell_compound_commands is false, reject commands with ; && || | etc.
5. If allow_subshells is false, reject $() and backtick substitution
6. On denial: emit policy_violation artifact with details, throw PolicyViolationError
7. Simple glob matching for patterns where * matches remaining args

## Acceptance Criteria

- [ ] Allowed commands execute successfully
- [ ] Denied commands are blocked with clear error
- [ ] Forbidden arg patterns caught after allowlist pass
- [ ] Shell compound commands blocked when policy says no
- [ ] Policy violation artifacts emitted

## Definition of Done

- All acceptance criteria are met
- Tests pass (where applicable)
- Code reviewed
- No regressions introduced

## Validation

Tests with allowlist and various violation scenarios

### Suggested Validation Commands

```bash
pnpm test --filter @factory/infrastructure -- --grep command-wrapper
```

## Risks / Notes

Pattern matching must be thorough. Attackers may try to bypass allowlists.

## Follow-on Tasks

T045, T055
