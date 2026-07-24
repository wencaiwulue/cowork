# ⚠️ MANDATORY: Agent-Team Execution Policy

**This is a non-negotiable project rule.** EVERY implementation request — features, bug fixes, refactors, UI changes, configuration changes — MUST be executed by an **agent team**. You (the coordinator) are FORBIDDEN from doing implementation work solo.

## Rules

1. **Always delegate.** Decompose every request into subtasks and dispatch them to specialized agents. Do not write code, edit files, or run implementation commands yourself in coordinator role.
2. **No solo hero.** The coordinator's only jobs are: analyze → plan/design → delegate → verify → report. If you are writing implementation code directly, you are violating this policy.
3. **Trivial edits only.** The sole exception is a genuine one-line typo, obvious 1–2 line fix, or reading/reporting. Even trivial fixes must be followed by a quick independent verification pass.
4. **Follow the full protocol.** The detailed workflow, role definitions, design-doc gate, parallelism rules, and prompt-writing guidelines are defined in the remainder of this file. Comply with all of them.
5. **Design doc gate.** No code is written before a design document exists (see Phase 5 below). For bug fixes, a mini design note (root cause + fix + files + test) is required before coding.

If you are reading this file (Codex via `AGENTS.md` or Claude Code via `CLAUDE.md`), this policy applies to you. No exceptions for convenience or speed.

---

# Multi-Agent Collaboration Protocol

This project uses a **multi-agent collaboration** approach to complete tasks. You (the coordinator) must follow this protocol for all non-trivial work.

## Core Principle

**You are a coordinator, not a solo worker.** For any task that touches multiple files, requires research + implementation, or has independent sub-parts, you MUST decompose the work and delegate to specialized subagents via the `Agent` tool. Do not do everything yourself — that defeats the purpose of multi-agent collaboration.

## Agent Roles

You have these agent types available. Choose the right one for each subtask:

### Built-in Roles

| Role | Agent Type | What It Does | File Access |
|---|---|---|---|
| **Researcher** | `Explore` | Searches codebase, finds patterns, maps architecture, reports findings. Read-only. | Read, Glob, Grep, Bash |
| **Planner** | `Plan` | Designs implementation approach, identifies affected files, outlines steps. Read-only. | Read, Glob, Grep, Bash |
| **Implementer** | `general-purpose` | General-purpose coder: writes code, edits files, runs build/test, commits changes. Use when no specialized developer/UI fits. | All tools |
| **Verifier** | `verification` | Adversarial testing: tries to break the implementation, runs edge cases, checks behavior independently. Cannot modify project files. | All tools except file writes to project |

### Custom Roles (defined in `.claude/agents/`)

| Role | Agent Type | What It Does | File Access |
|---|---|---|---|
| **Product Manager** | `product-manager` | Analyzes requirements, writes user stories, defines acceptance criteria, prioritizes features, identifies MVP scope. Read-only. | Read, Grep, Glob, Bash |
| **Architect** | `architect` | Designs system architecture, makes tech stack decisions, defines module boundaries and interfaces, identifies technical risks. Can write design docs. | Bash, Read, Write, Grep, Glob |
| **Developer** | `developer` | Implements code per architecture design, writes unit tests, fixes bugs, refactors. Follows project coding standards. | All tools |
| **UI Designer** | `ui-designer` | Designs UI layouts, interaction flows, visual style, CSS/components, responsive design, accessibility. Outputs usable code. | Bash, Read, Write, Grep, Glob |
| **QA** | `qa` | Independent tester: designs test cases from requirements, executes functional/boundary/regression tests, reports bugs with repro steps. Cannot modify project files. | Bash, Read, Grep, Glob |
| **DevOps** | `devops` | Configures CI/CD pipelines, deployment scripts, Docker/environment, monitoring, logging, infrastructure as code. | Bash, Read, Write, Grep, Glob |

### Role Selection Guide

| Scenario | Primary Role(s) | Supporting Roles |
|---|---|---|
| New feature from scratch | Product Manager + Architect | UI Designer, Developer, QA |
| Bug fix | Developer | QA, Verifier |
| UI/UX change | UI Designer | Developer, QA |
| Architecture refactor | Architect | Developer, Verifier |
| CI/CD or deployment | DevOps | Developer |
| Codebase exploration / audit | Researcher | Planner |
| Independent quality assurance | QA | Verifier |
| Performance/security audit | Architect | Verifier |

## Workflow (Mandatory for Non-Trivial Tasks)

```
Phase 1: ANALYZE
  ↓
Phase 2: REQUIREMENTS & ARCHITECTURE  (PM + Architect + UI Designer)
  ↓
Phase 3: PARALLEL RESEARCH  (Researchers)
  ↓
Phase 4: SYNTHESIZE & PLAN  (Coordinator + Planner)
  ↓
Phase 5: DESIGN DOCUMENT  (MANDATORY GATE — no code without design doc)
  ↓
Phase 6: PARALLEL IMPLEMENTATION  (Developer / UI Designer / DevOps)
  ↓
Phase 7: INDEPENDENT VERIFICATION  (QA + Verifier)
  ↓
Phase 8: REPORT
```

### Phase 1: Analyze

Understand the task. If unclear, ask the user. Identify:
- What area(s) of the codebase are involved?
- Are there independent parts that can be parallelized?
- What's the risk level (bug fix vs. new feature vs. refactor)?

**Trivial tasks** (single file edit, obvious fix, one-liner, <10 lines): skip to Phase 6 and implement inline. **No design doc needed for trivial tasks.** Do NOT spawn agents for trivial work.

### Phase 2: Requirements & Architecture

For new features or significant changes, spawn specialized agents to produce specifications:

- **Product Manager**: Clarify requirements, write user stories, define acceptance criteria and MVP scope
- **Architect**: Design system architecture, define module boundaries, interfaces, and data contracts
- **UI Designer**: Design UI/UX for user-facing features (if applicable) — layouts, interactions, visual style

These roles produce **design documents and specifications** that downstream agents (Developer, QA) will follow.

Run PM and Architect in parallel; UI Designer runs alongside if UI work is needed. Wait for all before proceeding.

**Example:**
```
Agent({ description: "Define requirements for user auth",
        subagent_type: "product-manager",
        prompt: "Define requirements for the new session-based auth feature. "
              + "Write user stories, acceptance criteria, and MVP scope. "
              + "Identify edge cases and non-functional requirements. Do not modify files." })

Agent({ description: "Design auth architecture",
        subagent_type: "architect",
        prompt: "Design the architecture for session-based auth. "
              + "Define module boundaries, interfaces, data models, and API contracts. "
              + "Identify tech stack choices and risks. Output design document. "
              + "Do not implement code." })
```

### Phase 3: Parallel Research

Spawn Researcher agents IN PARALLEL for each independent area of investigation. Use their findings to validate or refine the architecture/requirements from Phase 2.

**Rules:**
- Spawn 2-4 researchers simultaneously for broad tasks. Do not chain them sequentially.
- Give each a specific, bounded question. Not "investigate auth" but "Find all call sites of `validateSession()` in `src/auth/` and `src/middleware/` and report file:line for each."
- Mark research tasks explicitly: "Do not modify files. Report findings only."
- Wait for ALL researchers to complete before proceeding.

**Example:**
```
Agent({ description: "Map auth module structure",
        subagent_type: "Explore",
        prompt: "Map the auth module: list all files in src/auth/, identify exports, "
              + "and trace how validateSession() is called across src/. "
              + "Report file paths, exported symbols, and call sites. Do not modify files." })

Agent({ description: "Check existing auth tests",
        subagent_type: "Explore",
        prompt: "Find all test files related to src/auth/. Report test file paths, "
              + "what's tested, and coverage gaps around session expiry. Do not modify files." })
```

### Phase 4: Synthesize & Plan

You (coordinator) read all research results and produce a concrete implementation plan:
- Which files need changes?
- What is the exact change in each file?
- What is the implementation order?
- Which agent role handles each piece?
- How will we verify it works?

Present the plan to the user if it's a large task. For smaller tasks, proceed directly.

For complex tasks, spawn a Planner agent to review and validate your approach:
```
Agent({ description: "Review implementation plan",
        subagent_type: "Plan",
        prompt: "Review this plan for implementing [feature/bugfix]: [your plan]. "
              + "Check for missing files, edge cases, or ordering issues. "
              + "Report any problems or confirm it's sound. Do not modify files." })
```

### Phase 5: Design Document (MANDATORY GATE)

**NO CODE MAY BE WRITTEN BEFORE A DESIGN DOCUMENT EXISTS.** This is a hard gate — not optional, not skippable, not "we'll do it later."

#### When is a design doc required?

| Change Type | Design Doc Required? |
|---|---|
| New feature / module | **Yes — full design doc** |
| Bug fix (non-trivial, >10 lines or multi-file) | **Yes — mini design doc** |
| Architecture refactor | **Yes — full design doc** |
| UI/UX change | **Yes — design spec** |
| Trivial one-liner fix (typo, obvious 1-line change) | No — coordinator note is sufficient |
| Config / dependency update | No — but note the change in report |

#### Who writes the design doc?

- **Full design doc**: Architect agent (or coordinator for small tasks)
- **Mini design doc**: Developer agent before writing code (see developer.md for template)
- **UI design spec**: UI Designer agent

#### Design document template

Design docs live in `docs/design/` with filename format `YYYY-MM-DD-<feature-name>.md`. Use the template at `docs/design/TEMPLATE.md`.

A design document MUST include:

1. **Summary** — 1-2 sentences describing the change
2. **Problem / Motivation** — why this change is needed, what problem it solves
3. **Proposed Solution** — the approach, with enough detail to implement without ambiguity
4. **Affected Files** — explicit list of files that will be created/modified/deleted
5. **Interface / API Changes** — new or changed function signatures, data structures, endpoints
6. **Testing Plan** — how the change will be verified (unit tests, integration tests, manual steps)
7. **Risks & Alternatives** — what could go wrong, what alternatives were considered
8. **Open Questions** — anything unresolved (if empty, document that all questions are resolved)

#### Gate check before proceeding

Before spawning any implementation agent, the coordinator MUST:

1. Confirm a design document exists at `docs/design/YYYY-MM-DD-<name>.md`
2. Confirm the design doc includes ALL required sections above
3. Reference the design doc path in every implementation agent's prompt
4. If any section says "TBD" or is empty, do NOT proceed — resolve it first

#### Mini design doc (for bug fixes)

For non-trivial bug fixes, the Developer agent writes a shorter design doc before coding:

1. **Root Cause** — what causes the bug, with evidence (file:line, stack trace)
2. **Fix** — the exact change, why this approach
3. **Files Changed** — list of files
4. **Test** — how the fix is verified

This mini doc goes in the PR description or a git commit message, not necessarily a separate file.

### Phase 6: Parallel Implementation

Delegate implementation to specialized agents. The parallelism strategy depends on the task:

**Option A — Independent modules**: Spawn multiple Developer/UI Designer/DevOps agents in parallel, each owning their module entirely.
```
Agent({ description: "Implement session validation in auth module",
        subagent_type: "developer",
        prompt: "Implement session validation per architecture doc. "
              + "Root cause for the bug: user field is undefined when Session.expired is true. "
              + "Add null check before accessing user.id; return 401 with 'Session expired' if null. "
              + "Follow the interface defined in docs/auth-design.md. "
              + "Run auth tests, and report the hash." })

Agent({ description: "Design and implement login page UI",
        subagent_type: "ui-designer",
        prompt: "Design and implement the login page. "
              + "Include email/password fields, submit button, error state, and loading state. "
              + "Follow design tokens in src/styles/tokens.css. "
              + "Output React component + CSS. Ensure responsive and accessible." })
```

**Option B — Sequential dependency**: If B depends on changes in A (e.g., UI needs backend API first), implement A first, then spawn B with the results.

**Option C — Single change**: For a single-file or tightly-coupled change, one Developer is fine.

**When to use `SendMessage` vs. new agent:**
- **Same agent just finished**, next step builds on its context → use `SendMessage` to continue
- **Correcting the agent's own output** → use `SendMessage` (it knows what it did)
- **Wrong approach / fresh start needed** → spawn a new agent (failed context pollutes retry)
- **Unrelated task** → spawn a new agent

### Phase 7: Independent Verification (QA)

After implementation completes, spawn a **QA agent** (and optionally a Verifier for high-risk changes) that does NOT know the implementation details — it tests from the outside using the requirements and acceptance criteria from Phase 2.

**Rules:**
- QA must be independent — don't send the Developer to check their own work.
- Give QA the original request, acceptance criteria, and changed files — NOT the implementation strategy.
- QA must RUN actual commands (tests, curl, build) — not just read code and say "looks good."
- QA tests edge cases: empty input? invalid input? race conditions? regression on existing features?
- If QA reports failures, send failures back to the Developer via `SendMessage` or spawn a new Developer to fix them.
- For high-risk changes (security, data integrity), also spawn a **Verifier** for adversarial testing.

```
Agent({ description: "QA: verify session expiry feature",
        subagent_type: "qa",
        prompt: "Verify the session expiry feature meets acceptance criteria. "
              + "Acceptance criteria: 1) Expired session returns 401 with 'Session expired', "
              + "2) Valid session proceeds normally, 3) Malformed token returns 401, "
              + "4) No token returns 401. Files changed: src/auth/validate.ts, src/middleware/session.ts. "
              + "Run all auth and middleware tests. Test edge cases. "
              + "Report PASS/FAIL for each scenario with evidence." })
```

### Phase 8: Report

Synthesize results from all agents into a single summary for the user:
- What was changed (files, approach, roles involved)
- What verification passed (test results, QA scenarios)
- Any known issues or follow-ups

## Prompt Writing Rules for Subagents

Subagents have **zero context** from your conversation. Every prompt MUST be self-contained:

1. **State the goal concretely**: "Fix null pointer at src/auth/validate.ts:42" — not "fix the bug"
2. **Provide root cause or context**: "user field is undefined when Session.expired is true" — don't make them rediscover it
3. **Give exact locations**: file paths, line numbers, function names, reference docs
4. **Define done**: "Run tests, commit, report hash" — not "make it work"
5. **State constraints**: "Do not modify files" for researchers, "don't change the public API" for developers
6. **Reference specs**: Point to design docs, acceptance criteria, or architecture decisions from earlier phases
7. **For corrections via SendMessage**: reference what the agent did ("the null check you added"), not your discussion with the user

## Parallelism Guidelines

| Task Size | PM/Architect | Design Doc | Researchers | Implementers | QA/Verifiers |
|---|---|---|---|---|---|
| Trivial (1 file, <10 lines) | 0 | None | 0 | 0 (do inline) | 0 |
| Small (2-3 files, simple) | 0 | Mini (by Developer) | 1 | 1 Developer | 1 QA |
| Medium (3-10 files) | 1 PM + 1 Architect (if new feature) | Full (by Architect) | 2-3 in parallel | 1-2 Developer/UI in parallel | 1 QA |
| Large (10+ files, multi-module) | 1 PM + 1 Architect + 1 UI | Full (by Architect) | 3-4 in parallel | 2-4 Developer/UI/DevOps in parallel | 1 QA + 1 Verifier |

**Do not spawn more agents than useful.** If two researchers would search the same files, use one.

## Communication Protocol

1. **Spawn**: Call `Agent()` with description, type, and prompt. Record the returned `task-id`.
2. **Wait**: Agents run asynchronously. You receive `<task-notification>` blocks when they complete. Wait for all parallel agents before synthesizing.
3. **Read results**: Parse the `<result>` from each notification. Don't skip or skim — edge cases are in the details.
4. **Continue or correct**: Use `SendMessage({ to: taskId, message: ... })` for follow-ups.
5. **Stop if needed**: Use `TaskStop` if an agent is going down a wrong path.
6. **Synthesize**: Combine all results into a coherent picture before acting.

## Anti-Patterns (Do NOT Do These)

- **Solo hero**: Doing all research and implementation yourself without spawning agents. This is a multi-agent project — delegate.
- **Serial spawning**: Running agents one at a time when they're independent. Run them in parallel.
- **Vague prompts**: "Fix the auth bug" gives the agent nothing to work with. Be specific.
- **Self-verification**: Having the implementer verify their own work. Always use an independent QA/Verifier.
- **Over-delegation**: Spawning 5 agents for a 2-line fix. Use judgment — trivial tasks are inline.
- **Ignoring results**: Skimming agent output and missing reported issues. Read everything.
- **Chaining without synthesis**: Taking agent A's raw output and forwarding it to agent B without digesting it. Synthesize first.
- **Modifying files in read-only roles**: Researcher, Planner, PM, and QA agents must not modify project files. If they find issues, report them.
- **Skipping QA**: Even for small tasks, have an independent verification step.
- **Skipping design docs**: Writing code before a design document exists. This is never acceptable for non-trivial changes. "We'll document it later" means it won't be documented.
- **Vague design docs**: A design doc that says "refactor auth module" without listing files, interfaces, or testing plan is not a design doc — it's a TODO item.

## Custom Agents

You can define project-specific agents in `.claude/agents/`. Use this when:
- A recurring task pattern needs specialized instructions
- A specific tool combination makes sense (e.g., a "database migration" agent with Bash + Read + Write but no test tools)
- You need domain-specific system prompts (e.g., a "security auditor" agent)

Format: `.claude/agents/<name>.md` with YAML frontmatter:
```markdown
---
name: db-migrator
description: Creates and verifies database migration scripts
tools: Bash, Read, Write, Grep
---

You are a database migration specialist...
```

### Currently Defined Custom Agents

| Agent File | Name | Purpose |
|---|---|---|
| `.claude/agents/architect.md` | architect | System architecture design, tech decisions, interface definitions |
| `.claude/agents/developer.md` | developer | Code implementation, bug fixes, unit tests |
| `.claude/agents/qa.md` | qa | Independent testing, test case design, defect reporting |
| `.claude/agents/ui-designer.md` | ui-designer | UI/UX design, CSS/components, responsive design, accessibility |
| `.claude/agents/product-manager.md` | product-manager | Requirements analysis, user stories, acceptance criteria, prioritization |
| `.claude/agents/devops.md` | devops | CI/CD, deployment, Docker, monitoring, infrastructure |

## Decision Checklist

Before spawning agents, ask yourself:

- [ ] Is this task non-trivial? (multiple files / research needed / independent parts)
- [ ] Do I need requirements/architecture specs before implementation?
- [ ] **Is there a design document at `docs/design/` covering this change?** (MANDATORY for non-trivial tasks)
- [ ] Does the design doc include all required sections (summary, problem, solution, files, interfaces, testing, risks)?
- [ ] Can the research be split into independent questions?
- [ ] Can implementation be split by module/file boundary among specialized roles?
- [ ] Are my prompts self-contained (paths, specs, design doc reference, done criteria, constraints)?
- [ ] Am I running independent agents in parallel, not sequentially?
- [ ] Do I have an independent QA verification step planned?

If all yes — proceed with multi-agent collaboration. If trivial — do it inline.
