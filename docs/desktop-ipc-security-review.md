# Claude Code Desktop IPC Security Review

Use this checklist when adding or changing any Electron IPC channel. The
renderer must not gain direct Node, filesystem, process, shell, terminal, git,
MCP, plugin, skill, agent, team, or scheduled-task access outside the typed
preload bridge.

## Non-Negotiable Boundaries

- `desktop/main/ipc.ts` is the single IPC channel allowlist. Add every renderer
  callable channel to `desktopChannels`.
- `validateIpcArgs` must validate arity and payload shape before main-process
  handlers receive arguments.
- `desktop/preload/preload.ts` exposes typed wrapper methods only; do not expose
  `ipcRenderer`, `require`, `process`, filesystem APIs, shell APIs, or other
  Node globals to the renderer.
- `nodeIntegration: false`, `contextIsolation: true`, and the renderer CSP must
  remain production gates.

## Privileged Channel Checklist

For each new or changed privileged channel, verify the matching controls:

- Filesystem and workspace channels: resolve the workspace with
  `assertWorkspaceDirectory` or `workspaceCwd` before touching disk. File writes
  to project configuration must use `assertWorkspaceFileTarget` and must reject
  symlink targets.
- Process, plugin, MCP, agent, team, scheduled-task, git, and terminal channels:
  validate all user-provided strings, ids, modes, scope values, and dimensions
  in `validateIpcArgs`; keep subprocess creation and PTY access in the main
  process.
- User MCP Enable/Disable uses `mcp:setEnabled`, validates the server name and
  boolean state, and updates only `disabledMcpServers` in the user
  `settings.json` while leaving the `.mcp.json` server definition intact.
- Project scheduled task Pause/Resume uses `workspaceTasks:pause` and
  `workspaceTasks:resume`, validates workspace cwd plus task id, and moves task
  records only between `.claude/scheduled_tasks.json` and
  `.claude/scheduled_tasks.paused.json` after `assertWorkspaceFileTarget`
  rejects symlink targets.
- Project MCP approval uses `workspaceMcp:setApproval`, which validates the
  workspace cwd, server name, and boolean decision before writing only the
  current workspace's `.claude/settings.local.json` through
  `assertWorkspaceFileTarget`.
- Team member removal uses `teams:removeMember`, validates the session id,
  team name, and member name, then resolves the stored session cwd before
  updating only the selected workspace's `.claude/teams/<name>/config.json`.
  Runtime shutdown remains a separate `teams:shutdown` request.
- Terminal channels: create terminals only from a validated workspace cwd,
  resize with bounded numeric columns/rows, and kill/write only by terminal id.
- External navigation and shell channels: validate every `shell.openExternal`
  input with the shared HTTP(S) URL policy before opening it. Use `shell.openPath`
  only after workspace directory validation.
- Clipboard and diagnostics channels: keep payloads text-only, redact secrets in
  exported diagnostics, and avoid writing diagnostics without a user action.
- Permission channels: responses must reference an existing session and
  permission request id, and must use the explicit allow/deny response shape.

## Review Steps

1. Add or update unit tests in `desktop/tests/ipc.test.ts` for valid payloads,
   invalid payloads, unknown channels, and arity failures.
2. Add smoke coverage when the channel backs a visible button, menu action, or
   lifecycle workflow.
3. Update `docs/desktop-mvp.md` or the relevant release documentation when the
   channel changes user-visible behavior or production posture.
4. Run `bun run check`, `bun run desktop:test`, and the relevant Electron or
   packaged smoke command before release.

## Release Gate

`bun run desktop:prod-check` must continue to report the
`ipc-security-review` gate as passing by proving this checklist exists and
mentions the IPC allowlist, payload validation, workspace boundary validation,
external URL validation, terminal/process ownership, and release verification
steps.
