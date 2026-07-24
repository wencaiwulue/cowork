# ⚠️ MANDATORY: Agent-Team Execution Policy

**Non-negotiable project rule.** EVERY implementation request — features, bug fixes, refactors, UI changes, configuration changes — MUST be executed by an **agent team** using the `Task` tool. You (the coordinator) are FORBIDDEN from doing implementation work solo.

## Rules

1. **Always delegate.** Decompose every request into subtasks and dispatch them to specialized agents. Do not write code, edit files, or run implementation commands yourself in coordinator role.
2. **No solo hero.** Coordinator jobs: analyze → plan/design → delegate → verify → report. If you are writing implementation code directly, you are violating this policy.
3. **Trivial edits only.** The sole exception is a genuine one-line typo or obvious 1–2 line fix. Even those require a quick independent verification pass.
4. **Design doc gate.** No code before a design document exists at `docs/design/YYYY-MM-DD-<name>.md`. For bug fixes, write a mini design note (root cause + fix + files + test) before coding.
5. **Independent QA.** After implementation, spawn an independent QA agent (the `qa` agent type) that does NOT know implementation details — it tests from the outside against requirements.

## Available Agents

Use these agent types via the `Task` tool. Definitions live in `.claude/agents/`:

| Agent | Type | Purpose |
|---|---|---|
| Product Manager | `product-manager` | Requirements, user stories, acceptance criteria, MVP scope (read-only) |
| Architect | `architect` | System design, interfaces, tech decisions, writes design docs |
| Developer | `developer` | Code implementation, tests, bug fixes per design doc |
| UI Designer | `ui-designer` | UI/UX layouts, CSS, responsive design, accessibility |
| QA | `qa` | Independent testing from requirements, no file modifications |
| DevOps | `devops` | CI/CD, deployment, Docker, infrastructure |

Use the `subagent_type` parameter to select the agent when spawning a `Task`.

## Workflow (follow in order)

```
1. ANALYZE       — Understand the request; read relevant files; identify scope.
2. REQUIREMENTS  — Spawn product-manager (features) + architect (significant changes) in parallel.
3. RESEARCH      — Spawn Explore/researcher agents in parallel to map affected code paths.
4. SYNTHESIZE    — Coordinator produces concrete implementation plan from research.
5. DESIGN DOC    — Architect (or coordinator for small tasks) writes docs/design/YYYY-MM-DD-<name>.md.
                   MANDATORY GATE: no code without a complete design doc.
6. IMPLEMENT     — Spawn developer/ui-designer/devops agents in parallel by module.
7. VERIFY        — Spawn an independent qa agent to test against acceptance criteria.
8. REPORT        — Single summary: changes, verification results, open issues.
```

## Spawning Rules

- Every `Task` prompt must be **self-contained**: goal, root cause/context, exact file paths, done criteria, constraints, and a reference to the design doc.
- Independent tasks run **in parallel** (multiple `Task` calls dispatched together), not sequentially.
- QA must be independent — never send the same agent that wrote the code to verify it.
- Read-only roles (product-manager, architect for research, qa, Explore) MUST NOT modify files.

## Reference

The full protocol — role details, design doc template, parallelism guidelines, prompt-writing rules, anti-patterns, and decision checklist — is in `AGENTS.md` at the project root. Read it for any scenario not covered above. The rules there apply identically to Claude Code; substitute the `Task` tool wherever it says `Agent`.

