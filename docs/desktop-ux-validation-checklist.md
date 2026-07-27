# Claude Code Desktop UX Validation Checklist

Use this checklist for every desktop release candidate before production
approval. Attach the completed checklist to the release notes.

## Release Candidate

- Version: `[DESKTOP_RELEASE_VERSION]`
- Commit: `[git commit SHA]`
- Artifact evidence: `[desktop/release/release-evidence.json link]`
- Screenshot artifact: `[desktop/release/ux-screenshots artifact link]`
- Validator: `[name, role, YYYY-MM-DD]`
- Representative user: `[name or role, YYYY-MM-DD]`
- Representative user validation: `[observed, facilitator, YYYY-MM-DD]`

The representative user validation records that a target user or role completed
the manual task script with a facilitator observing the release candidate.

## Screenshot Review

Review the packaged smoke screenshots from `desktop/release/ux-screenshots`.
Record `pass`, `fail`, or `n/a` for each area and file issues for failures.
Every screenshot row must be `pass` or `n/a` before release approval.
The completed evidence must explicitly review `chat-streaming.png`,
`settings.png`, `settings-narrow.png`, `settings-mcp.png`,
`settings-skills.png`, `command-palette.png`, `agents.png`,
`agents-selected.png`, `tasks.png`, `teams.png`,
`composer-actions.png`, `permission-modal.png`, `files.png`, `editor.png`,
`diff.png`,
`before-unsaved-files-pane-switch.png`,
`unsaved-files-pane-switch-dialog.png`, `before-unsaved-diff-pane-switch.png`,
`unsaved-diff-pane-switch-dialog.png`,
`after-unsaved-diff-pane-switch-keep-editing.png`, `terminal.png`, and
`preview.png` in the Screenshot Review table Evidence cells; prose notes do
not count as screenshot review evidence.

| Area | Evidence | Result | Notes |
| --- | --- | --- | --- |
| Chat streaming and tool activity | `chat-streaming.png` | `[pass/fail/n/a]` | `[notes]` |
| Settings desktop layout | `settings.png` | `[pass/fail/n/a]` | `[notes]` |
| Settings narrow layout | `settings-narrow.png` | `[pass/fail/n/a]` | `[notes]` |
| MCP management | `settings-mcp.png` | `[pass/fail/n/a]` | `[notes]` |
| Skills management | `settings-skills.png` | `[pass/fail/n/a]` | `[notes]` |
| Command Palette | `command-palette.png` | `[pass/fail/n/a]` | `[notes]` |
| Agents management | `agents.png` | `[pass/fail/n/a]` | `[notes]` |
| Selected agent actions | `agents-selected.png` | `[pass/fail/n/a]` | `[notes]` |
| Scheduled tasks management | `tasks.png` | `[pass/fail/n/a]` | `[notes]` |
| Teams management | `teams.png` | `[pass/fail/n/a]` | `[notes]` |
| Composer actions menu | `composer-actions.png` | `[pass/fail/n/a]` | `[notes]` |
| Permission review modal | `permission-modal.png` | `[pass/fail/n/a]` | `[notes]` |
| Files browser | `files.png` | `[pass/fail/n/a]` | `[notes]` |
| Editor | `editor.png` | `[pass/fail/n/a]` | `[notes]` |
| Diff viewer | `diff.png` | `[pass/fail/n/a]` | `[notes]` |
| Files/editor unsaved guard | `before-unsaved-files-pane-switch.png`, `unsaved-files-pane-switch-dialog.png`, `before-unsaved-diff-pane-switch.png`, `unsaved-diff-pane-switch-dialog.png`, `after-unsaved-diff-pane-switch-keep-editing.png` | `[pass/fail/n/a]` | `[notes]` |
| Terminal | `terminal.png` | `[pass/fail/n/a]` | `[notes]` |
| Preview | `preview.png` | `[pass/fail/n/a]` | `[notes]` |

## Manual Task Script

Run these tasks against the packaged release candidate, not the Vite dev app.
Use a temporary project with a small Git repository.
Every required manual task row below must be present and `pass` before release
approval.

| Task | Expected result | Result | Notes |
| --- | --- | --- | --- |
| Create a new local session from the session rail. | Session appears, focuses, and status is visible. | `[pass/fail]` | `[notes]` |
| Send a short prompt and wait for streaming output. | Chat shows streaming assistant output without duplicate echoed messages. | `[pass/fail]` | `[notes]` |
| Trigger a permission request and choose allow, then deny on a second request. | Permission modal is understandable and both decisions reach the runtime. | `[pass/fail]` | `[notes]` |
| Open Files, expand a folder, edit a text file, save, and refresh Diff. | Editor saves the file and Diff shows the Git change. | `[pass/fail]` | `[notes]` |
| Start Terminal, run `pwd` and `git status`, then stop/restart it. | xterm renders output, resize remains stable, restart works. | `[pass/fail]` | `[notes]` |
| Open Preview with a local URL and then open externally. | iframe updates in app and external open is explicit. | `[pass/fail]` | `[notes]` |
| Open Agents, launch an agent task, and inspect running task feedback. | Agent management, launch validation, and task action feedback are clear. | `[pass/fail]` | `[notes]` |
| Open Teams and route a composer message to a teammate or team. | Target routing is clear and team/agent state is not confused. | `[pass/fail]` | `[notes]` |
| Use Command Palette and native View menu navigation. | Cmd/Ctrl+K opens searchable commands; View menu page/pane actions switch pages and persist pane layout. | `[pass/fail]` | `[notes]` |
| Use native Help menu support actions. | Help menu Command Palette opens the searchable command palette. Help menu Refresh Settings reports refreshed configuration. Help menu Export Diagnostics writes a redacted bundle. | `[pass/fail]` | `[notes]` |
| Use Command Palette lifecycle create commands. | New custom agent, New team, New global scheduled task, and New project scheduled task open clean drafts with visible status. | `[pass/fail]` | `[notes]` |
| Use Command Palette Settings management commands. | Settings sections, Add MCP, Check MCP, user/project Skill drafts, user/project skill install cancellation, plugin listing, diagnostics, and refresh provide visible feedback. | `[pass/fail]` | `[notes]` |
| Inspect MCP and Skills details from Settings. | User/project MCP details and user/project Skill contents render with redacted, readonly details. | `[pass/fail]` | `[notes]` |
| Use `@` resources and `/` actions from the composer. | Menus are discoverable, keyboard focus is usable, selected target is visible, and a project custom slash command can be selected. | `[pass/fail]` | `[notes]` |
| Use `/` composer lifecycle and Settings shortcuts. | `/new-custom` and `/add-mcp` route to clean drafts with visible page status. | `[pass/fail]` | `[notes]` |
| Export diagnostics from Settings. | A redacted diagnostic bundle is produced and no secret values are visible in summaries. | `[pass/fail]` | `[notes]` |

## Approval

- Blocking issues filed: `[none]`
- Non-blocking follow-ups: `[links or none]`
- Known limitations accepted: `[yes, approver]`
- UX release approval: `[approved/rejected, approver, YYYY-MM-DD]`
