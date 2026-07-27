# Agent GUI Exposure Plan

This document describes how to expose the current Claude Code agent platform in
the existing Electron desktop application. It is a design and module-boundary
document only; implementation should follow after the interfaces and event model
are reviewed.

## Current Architecture

The desktop app already wraps the CLI runtime instead of reimplementing the
agent loop:

- `desktop/main/sessionHost.ts` launches the local CLI with `-p`,
  `--input-format stream-json`, and `--output-format stream-json`, then sends
  user messages and permission responses over stdin.
- `desktop/main/sessionManager.ts` owns `DesktopSession` lifecycle, stores
  visible messages, tracks activity, forwards runtime events, and handles
  permission responses.
- `desktop/main/messageMapper.ts` converts stream-json runtime events into
  simplified desktop messages and streaming text updates.
- `desktop/preload/preload.ts` exposes a typed `window.claudeDesktop` IPC
  surface to the renderer.
- `desktop/renderer/src/App.tsx` contains the current GUI shell: sessions,
  chat, file tree, diff, editor, terminal, preview, settings, MCP, skills,
  plugins, scheduled tasks, and permission modal.

Agent execution and coordination live in the CLI source tree:

- `src/tools/AgentTool/AgentTool.tsx` is the main user-facing agent launcher.
  It supports specialized agents, background execution, teammate spawning,
  worktree isolation, remote launch when gated, and progress tracking.
- `src/tools/AgentTool/loadAgentsDir.ts` loads built-in, user, project, local,
  managed, flag, and plugin agents, including tools, MCP requirements, hooks,
  skills, memory, model, effort, permission mode, and isolation metadata.
- `src/tasks/LocalAgentTask/LocalAgentTask.tsx` tracks local/background agent
  task state, progress, retained transcripts, result, errors, output files, and
  cancellation.
- `src/tools/TeamCreateTool`, `src/tools/TeamDeleteTool`,
  `src/tools/shared/spawnMultiAgent.ts`, and `src/utils/swarm/*` implement
  team and teammate workflows.
- `src/tools/Task*Tool` and `src/utils/task/framework.ts` provide the shared
  task state used by agents and teams.

The GUI should therefore treat the CLI runtime as the execution boundary. It
should not call `AgentTool.call()` directly from Electron main or renderer.

## GUI Goals

Expose the agent platform as first-class desktop workflows:

- Agent catalog: list built-in, user, project, local, managed, flag, and plugin
  agents with source, description, tools, model, permission mode, MCP
  requirements, skills, hooks, memory, and isolation metadata.
- Agent editing: create, update, and delete user/project agents using the same
  markdown/frontmatter model as `.claude/agents` and the user agent directory.
- Agent launch: start a main session with a selected agent, or launch a
  subagent from an existing session with `description`, `prompt`,
  `subagent_type`, `model`, `run_in_background`, `isolation`, and optional
  teammate fields.
- Background task observability: show local/remote/worktree agent tasks,
  progress summaries, last tool activity, output file, errors, result, token
  count, and stop/resume/read-output actions where supported.
- Team and swarm panel: show teams, members, colors, modes, backend type,
  active status, direct messages, shutdown requests, and cleanup actions.
- Diagnostics: surface missing MCP servers, disallowed tools, unavailable
  remote/worktree modes, hook configuration, skill dependencies, and memory
  snapshot status before launch.
- Permission handling: keep all approval flow on existing stream-json
  `control_request` and `permissions:respond`, but render agent/team-specific
  context in the modal.

## Module Plan

### Desktop Main Service

Add an agent-focused service in `desktop/main` that is responsible for desktop
read/write operations around agent definitions and team metadata:

- Load agent definitions for a workspace through `claude agents --json`, which
  uses the CLI's existing agent loading utilities and keeps Electron main from
  importing runtime-only agent modules directly.
- Normalize definitions into renderer-safe objects. Do not send functions such
  as `getSystemPrompt` over IPC.
- Save and delete user/project agent files through existing filesystem helpers
  and validation rules.
- Keep a local user/project markdown parser as the offline fallback and as the
  prompt-body reader for editable agents.
- Compute diagnostics from agent metadata plus configured MCP/skills/plugins.
- Read team config files through `src/utils/swarm/teamHelpers.ts` and expose a
  renderer-safe team/member summary.

The service should be side-effect-light for read APIs and should keep execution
side effects inside the existing CLI runtime path.

### IPC and Preload API

Extend `desktop/main/ipc.ts`, `desktop/main/main.ts`, and
`desktop/preload/preload.ts` with typed APIs:

- `agents:list(cwd)` returns active/all agents and failed files.
- `agents:get(cwd, agentType, source)` returns one normalized definition.
- `agents:save(cwd, input)` creates or updates a user/project agent.
- `agents:delete(cwd, agentType, source)` deletes a user/project agent.
- `agents:refresh(cwd)` clears relevant caches and reloads definitions.
- `agents:diagnose(cwd, agentType)` returns MCP, tool, skill, hook, memory, and
  isolation readiness.
- `sessions:create` accepts optional agent session settings for launching a
  main-thread agent session.
- `sessions:launchAgentTask(sessionId, input)` sends a structured prompt into
  the selected session that asks the CLI runtime to invoke `AgentTool`.
- `teams:list(cwd)`, `teams:create(sessionId, input)`,
  `teams:members(teamName)`, `teams:send(sessionId, input)`,
  `teams:shutdown(sessionId, input)`, and `teams:delete(sessionId, teamName)`
  expose team management through the current runtime and team files.

All new IPC payloads must be validated in `validateIpcArgs` before reaching
handlers.

### Session and Event Model

Extend the desktop session model without removing the current simple message
list:

- Keep `messages` for chat rendering and backward compatibility.
- Add structured runtime data for `toolUses`, `agentTasks`, `team`, and
  `runtimeEvents`.
- Teach `messageMapper` to recognize:
  - assistant `tool_use` blocks for `Agent`, `Task`, `TeamCreate`,
    `TeamDelete`, and task tools,
  - `tool_result` blocks containing `completed`, `async_launched`,
    `remote_launched`, and `teammate_spawned`,
  - task notification XML emitted by background agents,
  - permission `control_request` events with agent/team context,
  - stream deltas that update in-progress assistant messages.
- Update `DesktopSessionManager` to merge these structured events into
  per-session state, persist recoverable summaries, and clear volatile runtime
  fields on startup like it already does for terminal/runtime state.

### Renderer Panes

Split the current large renderer surface into agent-aware panels while keeping
the existing workspace layout:

- Add an `Agents` pane beside Files, Diff, Editor, Terminal, Preview, and
  Settings.
- Agent catalog panel: filter by source, search by name/description, show MCP
  and tool readiness, and open details.
- Agent editor: edit frontmatter fields and prompt body for user/project agents.
  Built-in, managed, and plugin agents are read-only.
- Launch panel: create a new agent session or launch a subagent from the active
  session, with controls for model, permission mode, background, worktree, and
  remote when available.
- Tasks board: show foreground/background agents, local/remote/worktree status,
  progress, output file, result/error, and stop/read-output controls.
- Team panel: list teams and members, create/delete team, spawn teammate, send
  direct message, request shutdown, and show backend/mode metadata.
- Diagnostics panel: show missing MCP servers, required skills, hooks, memory
  state, and actionable setup links into existing Settings/MCP/Skills panes.

The UI should remain operational-tool focused: dense, scan-friendly, and
consistent with the current desktop shell rather than a landing-page layout.

## Implementation Phases

1. Documentation and type design
   - Finalize this document and add desktop-facing types for agent, task, team,
     diagnostics, and launch inputs.
   - Verification: `sed -n '1,240p' docs/agent-gui.md`.

2. Desktop main and IPC
   - Implement agent/team services, IPC channel validation, main handlers, and
     preload methods.
   - Verification: desktop IPC and service unit tests.

3. Runtime event parsing
   - Extend message mapping and session state merging for AgentTool, task, and
     team events.
   - Verification: mapper and session manager tests with synthetic stream-json
     events.

4. Agent management UI
   - Add catalog, details, editor, diagnostics, and launch form in the renderer.
   - Verification: renderer smoke flow can list agents, diagnose one, and launch
     a prompt into the active session.

5. Task and team UI
   - Add task board and team/swarm panel backed by structured session/team
     state.
   - Verification: smoke flow can show an async agent task and team member
     summary from mocked runtime events.

6. Packaging verification
   - Run focused desktop tests, runtime smoke, Electron smoke, and build.
   - Verification: `bun run desktop:test`, `bun run desktop:smoke-runtime`,
     `bun run desktop:smoke-electron`, and `bun run build`.

## Current Implementation Progress

The desktop skeleton now exposes the first agent GUI slice:

- Desktop main has an agent service for listing, saving, deleting, diagnosing,
  and launching user/project agents, plus local team-file summaries.
- User agents can be listed, saved, and deleted from the first-class Agents UI
  without an active project session. Project agents still require an active
  session/workspace and continue to route filesystem writes through workspace
  boundary validation.
- Agents Refresh also works without an active project session by reloading the
  built-in and user agent catalog; Teams refresh remains workspace-scoped and
  requires an active session.
- Command palette shortcuts follow the same split: agent catalog, custom
  agent, and new custom agent actions are available without a project session,
  while agent run, running task, and team workflows stay session-bound.
- Agent catalog listing now prefers the CLI `agents --json` boundary, so
  built-in, plugin, managed, flag, local, user, and project metadata are
  normalized from the same loader used by the runtime. The local markdown parser
  remains the fallback when the CLI command is unavailable and remains the
  source for editable prompt bodies.
- IPC/preload include agent catalog/edit/diagnose APIs, agent-session launch,
  subagent launch, team listing, team member listing, team creation, team
  messaging, graceful teammate shutdown requests, and team cleanup requests.
- Session state carries agent session settings, structured agent task updates,
  session-level tool-use summaries, session team summaries, retained runtime
  events, and the `agents` pane selection.
- Runtime execution still crosses the CLI stream-json boundary. Team and
  subagent actions are injected as structured prompts that ask the runtime to
  call `Agent`, `TaskStop`, `TaskOutput`, `SendMessage`, `TeamCreate`, or
  `TeamDelete` exactly once.
- Agent launch controls now distinguish main-session permission mode, which is
  passed to the CLI session config, from teammate mode used in delegated Agent
  tool prompts.
- Runtime capability gates are exposed through desktop config so private
  remote isolation controls are hidden unless the CLI runtime marks them
  available.
- Renderer has an `Agents` pane with searchable/source-filtered catalog,
  read-only selected-agent details, launch form, structured diagnostics for
  MCP, skills, tools, hooks, memory, and isolation readiness, user/project
  editor for model, permission mode,
  allowed/disallowed tools, skills, required MCP servers, memory, isolation,
  background, and prompt frontmatter, structured task board with
  read-output, direct output-file preview, stop/resume controls, and
  Team/Swarm controls.
- Team/Swarm summaries include team backend, mode, status/active state, and
  member color, mode, and status metadata when present in local team files.
- Permission modals retain the existing stream-json approval flow while
  surfacing agent/team context from runtime permission requests when available.
- Diagnostics include setup actions that jump from missing MCP server and skill
  findings into the existing Settings pane for remediation.
- Electron smoke coverage now opens the Agents pane, validates catalog
  rendering, runs diagnostics, launches a mocked background agent task, and
  verifies task metadata plus tool timeline rendering.
- Runtime event parsing now tracks pending Agent tool uses, merges later
  results by `tool_use_id`, and surfaces last tool activity, output previews,
  TeamCreate/TeamDelete coordination events, per-tool timelines,
  session-level tool-use summaries, token count,
  tool-use count, duration, worktree path, and remote session URL when those
  fields are present in stream-json events or task notifications.

Known v1 gaps remain: task observability is limited by what the runtime emits
over stream-json.

## Test Strategy

Unit coverage should follow existing desktop test boundaries:

- `desktop/tests/ipc.test.ts`: new channels and payload validation.
- `desktop/tests/messageMapper.test.ts`: AgentTool, team, task, permission, and
  task-notification event parsing.
- `desktop/tests/sessionManager.test.ts`: state transitions for agent launch,
  background task updates, permission waits, cancellation, runtime exit, and
  stored-session normalization.
- New agent service tests: source precedence, save/delete validation,
  diagnostics, and cache refresh.
- Electron smoke: create a session, open Agents pane, list agents, verify
  catalog search/source filtering, save a project agent with full editor
  metadata, run diagnostics, create an agent session with permission mode,
  launch an agent prompt, observe structured background task/tool timeline
  state from mocked runtime output, verify diagnostics setup navigation,
  Team/Swarm metadata rendering, and handle permission requests with
  agent/team context.

Build/type checks should use the project’s known working commands. Do not make
`bun run check` a blocker for this source snapshot unless the broader snapshot
type gaps are resolved.

## Limitations and Defaults

- The GUI does not execute agent logic directly. It routes execution through
  the CLI runtime and stream-json protocol.
- Remote agent launch, worktree isolation, teammate modes, and private features
  appear only when the existing runtime gates make them available.
- Built-in, managed, and plugin agents are read-only in the first GUI version.
- User/project agents are the only editable sources.
- Renderer state is a projection of runtime events; the CLI remains the source
  of truth for permissions, tool execution, task lifecycle, and team actions.
- Existing local stub limitations still apply. See `docs/stubs.md` for local
  browser, Computer Use, and source snapshot constraints.
