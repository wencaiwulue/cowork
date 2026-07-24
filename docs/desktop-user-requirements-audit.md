# Claude Code Desktop User Requirements And Audit

This document consolidates the user's requests from the desktop implementation
thread into a requirements baseline, then audits the current repository state
against that baseline.

## Source Requests

The user asked for these outcomes across the thread:

1. Build a Claude Code Desktop app in `/Users/fengcaiwen/test/claude-code`,
   using the existing Claude Code CLI/runtime instead of embedding runtime logic
   in the renderer.
2. Match the broad Claude Code Desktop shape: sessions, sidebar, draggable
   workspace, chat, file editor, diff, terminal, preview, and permission review.
3. Move beyond an empty shell: every visible button and primary workflow should
   have real local behavior and clear feedback.
4. Support local project sessions, including a New Session flow that can be
   associated with a directory.
5. Make session switching, close, cancel, and send states understandable.
6. Make Files, Editor, Diff, Terminal, and Preview panes functional against the
   real local workspace.
7. Use a real xterm terminal rather than a fake pre/input terminal.
8. Keep Preview's Open action inside the embedded iframe, with a separate
   external-browser action.
9. Persist per-session UI state such as active pane, preview URL, terminal id,
   open file, and layout.
10. Show permission requests clearly and send Allow/Deny responses back to the
    runtime.
11. Make agent management understandable to a user.
12. Treat Teams as first-class team management, not "teammates" management; a
    team can contain multiple teammates.
13. Keep Settings fixed in the left rail footer instead of moving when sessions
    collapse.
14. Make `@` and `/` in the chat composer open resource and action menus.
15. Show tool calls and other runtime calls in the conversation so users can
    see what is happening.
16. Show the Todo list in the conversation.
17. Update relevant documentation and commit the work locally.

## Non-Goals And Assumptions From The Requests

- The first implementation targets local sessions only.
- Remote/Cowork/mobile Dispatch support is outside this MVP.
- The existing CLI/TUI behavior should remain intact.
- Electron main owns process, filesystem, terminal, git, and native access;
  the renderer only uses the typed preload bridge.
- The UI does not need to be a pixel-perfect clone of official Claude Desktop;
  the priority is a usable local MVP with Claude Desktop-inspired structure.
- Team member controls should not be faked: spawning a teammate uses the real
  Agent tool path, shutdown sends the runtime shutdown request, and member
  removal only removes the durable desktop team membership record.

## Requirement Audit

| ID | Requirement | Current status | Evidence | Gap / next action |
| --- | --- | --- | --- | --- |
| R1 | Electron + React desktop app exists under `desktop/` and uses the local CLI/runtime from main process. | Satisfied | `desktop/main/sessionHost.ts` is documented as launching local Claude Code stream-json runtime; `desktop/README.md` states Electron main owns runtime access. | None for MVP. |
| R2 | Sessions/sidebar/chat/workspace layout exist with draggable workspace sizing. | Satisfied | Electron smoke reports `firstClassLeftNavigation`, `nativeNavigationMenuActions`, `nativeHelpSupportMenuActions`, `primaryNavKeyboardShortcuts`, `workspacePaneKeyboardShortcuts`, `commandPaletteNavigation`, `commandPaletteMenuAction`, `commandPaletteUnavailableFeedback`, `commandPaletteLifecycleNavigation`, `commandPaletteSettingsManagement`, `commandPaletteMcpHealthCheck`, `pointerWorkspaceResize`, and `pointerWorkspaceResizeSingleCommit`; workspace pane tab switching also verifies visible active state and `aria-pressed` stay synchronized. | None for MVP. |
| R3 | Buttons are not empty shell controls; primary workflows produce behavior and feedback. | Satisfied for covered MVP workflows | Electron smoke covers session creation, send/cancel, permissions, files, editor, diff, terminal, preview, settings, agents, teams, scheduled task empty states, global scheduled task Pause/Resume/Remove, project scheduled task Pause/Resume/Remove, active Tasks Project/Global jumpbar restore, selected scheduled task draft restore, restored selected MCP/Skill details, user MCP Inspect/Enable/Disable/Remove/Health check, project MCP Inspect/Approve/Reject/Remove/Health check, user/project Skill install/inspect/save/remove, command palette MCP health check, command palette project Skill install cancellation, command palette user/project Skill draft creation, and guards for rapid clicks; restored Agents, Teams, Tasks, and Settings detail states expose lifecycle selections through visible state plus layout-backed identifiers; `renderedAssistant`, `streamedAssistant`, `indexedStreamMessageCoalescing`, `thinkingStreamStateLabels`, `runtimeFailureVisible`, `deepLinkedSession`, `workspaceRefreshFeedback`, `staleSessionStatusCleared`, `chatCopyFeedback`, and `chatMarkdownExternalLink` verify chat/runtime/session feedback is visible rather than a no-op, including assistant Markdown links opening through the validated external-browser IPC path; `settingsGui`, `rapidSettingsRefreshGuard`, `selectedSettingsDetailStateRestored`, `proxyFormValidation`, `rapidProxySaveGuard`, `proxyRuntimeEnv`, `pluginCommands`, `rapidPluginActionGuard`, `pluginFormFeedback`, `pluginScopeValidation`, `projectPluginRowsDisabledNoSession`, `settingsMcpEmptyState`, `settingsSkillsEmptyState`, `settingsPluginEmptyState`, `tasksFirstClassPage`, `tasksSectionRestored`, `selectedScheduledTaskStateRestored`, `scheduledTaskManagement`, `scheduledTaskFormValidation`, `scheduledTaskDeleteClearsDraft`, `rapidScheduledTaskSaveGuard`, `rapidScheduledRunNowGuard`, `scheduledRunNowTurnBusyGuard`, `globalScheduledTaskRunNow`, `automaticGlobalScheduler`, `projectScheduledTaskEmptyState`, `projectScheduledTaskDeleteClearsDraft`, `rapidProjectScheduledTaskSaveGuard`, `automaticProjectScheduler`, `scheduledTaskPauseResume`, `scheduledTaskPausedRunNowGuard`, `scheduledTaskRemoveFeedback`, `rapidScheduledTaskPauseResumeGuard`, `rapidScheduledTaskRemoveGuard`, `projectScheduledTaskPauseResume`, `projectScheduledTaskRemoveFeedback`, `rapidProjectScheduledPauseResumeGuard`, `rapidProjectScheduledTaskRemoveGuard`, `rapidProjectScheduledRunNowGuard`, `userMcpInspect`, `rapidMcpInspectGuard`, `userMcpEnableDisable`, `rapidMcpSaveGuard`, `rapidMcpRemoveGuard`, `mcpCrossScopeEditIsolation`, `mcpProjectScopeValidation`, `mcpHealthCheck`, `rapidMcpHealthCheckGuard`, `projectMcpManagement`, `projectMcpInspect`, `projectMcpApprovalLifecycle`, `localSkillInspect`, `localSkillSave`, `rapidSkillInspectGuard`, `rapidSkillSaveGuard`, `skillInstallCancelFeedback`, `rapidSkillInstallGuard`, `projectSkillSessionGuidance`, `projectSkillInspect`, `projectSkillSave`, `commandPaletteMcpHealthCheck`, `commandPaletteProjectSkillInstall`, `commandPaletteSkillDraftShortcuts`, and `rapidSkillRemoveGuard` verify Settings/Tasks guidance and lifecycle actions. `desktop/tests/config.test.ts`, `desktop/tests/workspaceTasks.test.ts`, `desktop/tests/ipc.test.ts`, and `desktop/tests/mainNavigationWiring.test.ts` also cover Settings MCP/skill inspection and save through real IPC contracts and renderer buttons, plus not-found rejection for missing Skill, MCP, scheduled-task lifecycle targets, id-bound scheduled-task updates, plugin install package validation, and MCP state changes such as user Enable/Disable or project Approve/Reject. | Continue adding smoke coverage whenever new buttons or workflow states are added. |
| R4 | New Session can start a quick workspace or associate with a selected directory. | Satisfied | `desktop/README.md` documents the New Session menu; smoke reports `quickSessionEntry`, `railQuickSessionEntry`, `menuSessionAction`, `menuOpenFolderAction`, `sessionCreateMenuKeyboardNavigation`, `rapidMenuSessionCreateGuard`, `sessionCreateCancelFeedback`, and `rapidSessionCreateGuard`; the keyboard-highlighted New Session menu item exposes `aria-selected` in sync with the visible active state. | None for MVP. |
| R5 | Session switching, close, cancel, clear-view, and send states are understandable and guarded. | Satisfied | Smoke reports `rapidSessionFocusGuard`, `rapidSessionFocusLastClickWins`, `closeSessionConfirmation`, `cancelRoundTrip`, `cancelTurnFeedback`, `rapidCancelGuard`, `rapidCloseSessionGuard`, `rapidSendGuard`, `visibleActivityState`, `runtimeFailureVisible`, `workspaceRefreshFeedback`, `staleSessionStatusCleared`, `restoredSession`, `closedSession`, and `sessionMenuKeyboardNavigation`; session-row action menus expose keyboard-selected actions through both visible active state and `aria-selected`. `desktop/tests/sessionManager.test.ts`, `desktop/tests/ipc.test.ts`, and `desktop/tests/mainNavigationWiring.test.ts` cover the guarded Clear desktop transcript view lifecycle from manager persistence through IPC, renderer entrypoints, and native File menu routing without closing the runtime host or claiming to delete Claude transcript storage. | None for MVP. |
| R6 | Files pane supports real tree browsing, directory expansion, and opening files. | Satisfied | `docs/desktop-mvp.md` documents real workspace tree behavior; smoke reports `fileTreeExpandedPathPersistence`, `filesRefreshFeedback`, `rapidFilesRefreshGuard`, and file editing workflows. | None for MVP. |
| R7 | Editor reads and saves real files, then refreshes git state. | Satisfied | Smoke reports `editedFile`, `rapidFileSaveGuard`, `editorEmptyStateGuidance`, `restoredEditorContent`, and `restoredMissingEditorRecovery`; `desktop/tests/mainNavigationWiring.test.ts` also verifies save re-clears dirty state after workspace refresh completes. | None for MVP. |
| R8 | Diff shows real git status/diff and supports refresh. | Satisfied | Smoke reports `renderedDiff`, `restoredDiffContent`, `rapidDiffRefreshGuard`, and restored diff coverage. | None for MVP. |
| R9 | Terminal uses xterm + PTY with input, output, resize, and kill. | Satisfied | Smoke reports `renderedTerminal`, `terminalMode: "pty"`, `terminalEmptyStateGuidance`, `terminalFailureVisible`, `restartedTerminal`, `resizedTerminal`, `terminalRapidStartGuard`, `terminalRapidStopGuard`, and `terminalCloseRaceSafe`. | None for MVP. |
| R10 | Preview Open updates the embedded iframe; external browser is separate. | Satisfied | Smoke reports `previewExternalOpen`, `previewSessionIsolation`, `rejectedInvalidPreview`, `previewRapidExternalGuard`, `previewRapidOpenGuard`, and `previewOpenActionIcon`. | None for MVP. |
| R11 | Permission review shows tool context and sends Allow/Deny back to runtime. | Satisfied | Smoke reports `permissionRoundTrip`, `queuedPermissionRoundTrip`, `permissionDenyRoundTrip`, and `rapidPermissionDecisionGuard`. | None for MVP. |
| R12 | Agent management is understandable. | Satisfied for MVP | UI groups agent work into Agent management, Available agents, Selected agent, Run agent, Custom agents, and Running tasks. The selected-agent summary now exposes direct Diagnose, New session, Prepare task, and Edit/Override actions; selecting an agent marks the catalog card with both visible active state and `aria-current`; smoke reports `agentsSectionRestored`, `agentGui`, `agentLaunchValidation`, `agentDiagnosticSettingsJump`, `agentDiagnosticActionIcons`, `selectedAgentActionRow`, `selectedAgentVisualEvidence`, `selectedAgentStateRestored`, `selectedAgentNewSessionAction`, `selectedAgentPrepareTaskAction`, `selectedAgentOverrideAction`, `agentTaskActionIcons`, `agentTaskActionFeedback`, `rapidAgentTaskActionGuard`, `agentEditorNewFeedback`, `rapidAgentSaveGuard`, `agentTeammateStatusIsolated`, `agentLaunchTurnBusyGuard`, `rapidAgentLaunchGuard`, `rapidAgentsRefreshGuard`, `agentDeleteFeedback`, `rapidAgentTaskStopGuard`, and `rapidAgentDeleteGuard`; `desktop/tests/agents.test.ts` covers missing user/project agent delete rejection so destructive agent controls cannot report success for absent files. | Continue representative-user validation for product copy, but the MVP no longer leaves the selected-agent next step implicit. |
| R13 | Teams are first-class and can represent multiple teammates. | Satisfied for MVP | UI label is Teams; Teams persists as `activePane: "teams"`, renders in its own `.teams-pane`, and owns its local status feedback; `desktop/main/agents.ts` creates, updates, lists, removes members from, and deletes durable project-scoped `.claude/teams/<name>/config.json` records, and teammate spawn upserts member rows after the Agent runtime request is queued; team cards show member rows; selecting a team marks its card with both visible active state and `aria-current` and persists `selectedTeamName` in session layout; teammate spawn goes through the Agent tool runtime path with `team_name`/`name`/`mode`; team cards expose direct Message all, teammate Message, graceful Shutdown, and local Remove actions; smoke reports `teamsFirstClassPage`, `teamsFirstClassManagement`, `selectedTeamCurrentState`, `selectedTeamStateRestored`, `teamSelectActionIcon`, `teamsManagementVisualEvidence`, `teamPrimaryViewRestored`, `teamSelectFeedback`, `teamBroadcastMessageAction`, `teamMemberMessageAction`, `teamSpawnTeammateAction`, `teamMemberShutdownAction`, `teamMemberRemoveAction`, `teamDeleteDisabledState`, `teamDeleteFeedback`, `rapidTeamDeleteGuard`, `rapidTeamActionGuard`, `rapidTeamMemberShutdownGuard`, `rapidTeamMemberRemoveGuard`, and `teamActionFeedback`; `desktop/tests/agents.test.ts` covers team record create/update/member remove/delete lifecycle, missing local/project team delete rejection, workspace isolation, symlinked team directory rejection, and path traversal rejection. | Runtime force-kill is intentionally not exposed; use Shutdown for live agents and Remove for local membership cleanup. |
| R14 | Settings stays fixed in the left rail footer when sessions collapse and uses grouped Codex-style settings navigation. | Satisfied | CSS pins `.rail-footer` with `margin-top: auto`; Settings has grouped sidebar navigation with searchable match counts, no-results feedback, and keyboard search navigation; the native Settings menu routes General, Proxy, MCP Servers, Skills, Plugins, Check MCP Health, Skill install, Plugin list/install, Refresh Settings, and Export Diagnostics through the same grouped Settings handlers, with Cmd/Ctrl+, on General and visible feedback for project-scoped menu actions that need an active session; the active grouped Settings/Tasks section and selected MCP/Skill detail identities are persisted in session layout and restored by Electron smoke; Settings also shows pane error feedback, refresh feedback, edit success feedback, edit cancel feedback, and an explicit cancel icon; Skills management includes install, inspect, save, and remove actions for user/project scopes; smoke reports `settingsGui`, `settingsInLeftFooter`, `groupedSettingsNavigation`, `settingsSidebarNavigation`, `settingsSectionRestored`, `selectedSettingsDetailStateRestored`, `settingsSearchFiltering`, `settingsDiagnosticsExport`, `settingsDiagnosticsRedaction`, `rapidDiagnosticsExportGuard`, `settingsPaneErrorFeedback`, `settingsRefreshFeedback`, `rapidSettingsRefreshGuard`, `settingsEditFeedback`, `settingsEditCancelFeedback`, `settingsEditCancelIcon`, `proxyFormValidation`, `rapidProxySaveGuard`, `proxyRuntimeEnv`, `pluginCommands`, `rapidPluginActionGuard`, `pluginFormFeedback`, `pluginScopeValidation`, `projectPluginRowsDisabledNoSession`, `settingsMcpEmptyState`, `settingsSkillsEmptyState`, `settingsPluginEmptyState`, `localSkillInspect`, `localSkillSave`, `projectSkillInspect`, `projectSkillSave`, `collapsibleSessions`, `collapsedSessionCountVisible`, and `sessionRailCollapseRestored`. | None for MVP. |
| R15 | `@` opens resource suggestions in the composer. | Satisfied | Composer menu is backed by files, teams, agents, skills, and MCP servers; smoke reports `composerResourceMenu`, `composerSkillResourceMenu`, `composerMcpResourceMenu`, and `composerMenuKeyboardNavigation`. | Additional resource types can be added later as backing sources become reliable. |
| R16 | `/` opens action suggestions in the composer and global commands expose Codex-style navigation. | Satisfied | Composer action menu inserts prompts or runs local pane actions plus first-class lifecycle and Settings management shortcuts for custom agents, teams, scheduled task drafts, MCP, Skills, Plugins, and Settings refresh, including `/new-user-skill` and `/new-project-skill` for clean Skill drafts; project custom slash commands from `.claude/commands` are also listed in the composer menu and smoke-select `/project:desktop-smoke` into the focused composer; command palette exposes pages, workspace panes, agent/team/task lifecycle sections, direct create actions for custom agents, teams, global scheduled tasks, project scheduled tasks, user/project Skills, grouped Settings sections, direct MCP/Skills/Plugins management actions, diagnostic export, settings refresh, and unavailable commands with visible prerequisite reasons; the native File menu routes New Custom Agent, New Team, New Global Scheduled Task, New Project Scheduled Task, Add MCP Server, New User Skill, and New Project Skill through the same renderer lifecycle actions; the native Agents menu routes Overview, Available Agents, Run Agent, Custom Agents, Running Agent Tasks, New Custom Agent, and Refresh Agents through renderer Agents actions; the native Teams menu routes Team Management, New Team, and Refresh Teams through renderer Teams actions; the native Tasks menu routes Project Scheduled Tasks, Global Scheduled Tasks, New Project Scheduled Task, New Global Scheduled Task, and Refresh Tasks through renderer Tasks actions; the native MCP menu routes MCP Servers, Add MCP Server, and Check MCP Health through renderer MCP actions; the native Skills menu routes Skills, New User Skill, New Project Skill, Install User Skill, and Install Project Skill through renderer Skills actions; the native Plugins menu routes Plugins, List Plugins, Install Plugin, and Refresh Plugins through renderer Plugins actions; the native Settings menu routes grouped Settings sections, MCP health, Skill install, Plugin list/install, refresh, and diagnostic export through renderer Settings actions; the native Help menu routes Command Palette, Refresh Settings, and Export Diagnostics through the same renderer actions while keeping Claude Code Docs as the external documentation link; smoke reports `composerActionMenu`, `composerCustomSlashCommand`, `composerMenuKeyboardNavigation`, `composerLifecycleActionShortcuts`, `composerSettingsActionShortcuts`, `commandPaletteNavigation`, `commandPaletteUnavailableFeedback`, `commandPaletteLifecycleNavigation`, `commandPaletteLifecycleCreateShortcuts`, `commandPaletteMcpHealthCheck`, `commandPaletteProjectSkillInstall`, `commandPaletteSkillDraftShortcuts`, `commandPaletteSettingsManagement`, `commandPaletteSettingsDiagnosticsExport`, `commandPaletteSettingsDiagnosticsRedaction`, `commandPaletteSettingsRefresh`, and `commandPaletteSettingsRefreshGuard`, while `desktop/tests/mainNavigationWiring.test.ts` locks the Settings section, diagnostic export, settings refresh, first-class lifecycle create command routes, native File menu lifecycle routes, native grouped Agents/Teams menu routes, native grouped Tasks menu routes, native MCP/Skills management menu routes, native Plugins management menu routes, native grouped Settings menu routes, native Help support menu routes, native Settings management routes with project-scope feedback, direct MCP/Skills/Plugins management command routes, composer lifecycle/Settings shortcuts, custom slash command composer smoke evidence, command palette custom slash command loading guards, and smoke evidence for Settings management command execution. | Add more slash actions as product scope grows. |
| R17 | Conversation shows tool calls / runtime calls. | Satisfied | Chat renders streamed tool-use messages and a Tool activity panel; smoke reports `streamedToolActivity` and `conversationToolActivityPanel`. | None for MVP. |
| R18 | Conversation shows Todo list. | Satisfied | TodoWrite input is rendered in the Todos card; smoke reports `visibleTodoList`. | Todo updates currently derive from tool events/messages; richer status history can be added if runtime exposes a stronger Todo model. |
| R19 | Per-session UI state persists. | Satisfied | Smoke reports restored sessions for editor, diff, preview, grouped Settings section, selected MCP/Skill detail cards, Agents lifecycle section, selected agent state, grouped Tasks section, selected scheduled task drafts, selected team state, session rail collapse, and primary view restoration; stored legacy task sections are migrated from grouped Settings state into dedicated task layout state. | None for MVP. |
| R20 | Documentation is updated and work is committed locally. | Satisfied | `desktop/README.md`, `docs/desktop-mvp.md`, `docs/desktop-production-readiness.md`, and this audit document record the current behavior and release posture; the local release-hardening commits include publish-time checksum and release-evidence verification before GitHub Release creation. | Keep this audit current when desktop workflow or release-gate behavior changes. |

## Current Overall Assessment

The current implementation satisfies the local Claude Code Desktop MVP shape and
the concrete workflow requirements that have smoke coverage. Teams now has an
independent page/pane state, persists project-scoped team records, can display multiple
teammates, spawn a new teammate through the existing Agent runtime path, route
messages to one teammate or all members, request graceful shutdown, and remove
stale membership records from the local team config. Runtime force-kill is not
exposed because the runtime only provides a graceful shutdown path.

The requirements with the strongest evidence are those covered by
`desktop/scripts/smoke-electron.mjs` and `desktop/scripts/smoke-packaged.mjs`.
Qualitative UX requirements, especially "agent management is understandable,"
are covered by structural smoke checks plus screenshot-backed selected-agent
and team-management states. Representative-user review is still useful for
copy quality, but the MVP evidence no longer depends on manual discovery of
whether those states exist.

## Verification Commands And Results

Fresh verification used for the latest local audit:

```sh
npx vite build --config desktop/vite.config.ts
bun run check
bun run desktop:test
bun test desktop/tests/buildScripts.test.ts
bun run desktop:build-main
DESKTOP_RELEASE_VERSION=1.0.0 \
  CSC_NAME='Developer ID Application: Anthropic PBC (ABCDE12345)' \
  APPLE_KEYCHAIN_PROFILE=desktop-notary-profile \
  DESKTOP_UX_VALIDATION_EVIDENCE_PATH=desktop/release/ux-validation-evidence.md \
  bun run desktop:prod-check
DESKTOP_SMOKE_PROGRESS=1 bun run desktop:smoke-electron
DESKTOP_SMOKE_PROGRESS=1 bun run desktop:smoke-packaged
```

The release-hardening pass completed `bun run check`, `bun run desktop:test`,
`bun test desktop/tests/buildScripts.test.ts`, `bun run desktop:build-main`,
`npx vite build --config desktop/vite.config.ts`, and the production readiness
check above with exit code 0. The latest local continuation pass also completed
the publish-time release-evidence verification hardening checks: downloaded
release evidence must match the normalized release version, must not be
`preflight-only`, must record passing `verify-release` and
`final-verify-release` steps, and must include passing app/DMG Gatekeeper and
notarization checks before draft GitHub Release creation. It must also match the
current GitHub Actions repository, ref, event, commit, run id, and run attempt
plus the exact run URL before creating the draft Release. The publish job also
recomputes downloaded `SHA256SUMS`, release notes, UX validation evidence, and
packaged smoke screenshot size/SHA-256 metadata, and compares them with
`release-evidence.json` before creating the draft Release, then attaches the verified
packaged smoke screenshots as a `ux-screenshots.zip` GitHub Release attachment
alongside the signed artifacts and release evidence. After upload, the publish
job queries the draft GitHub Release and verifies the tag/name, draft
state, duplicate asset names, and required asset names before the release run
can pass; it then downloads the draft assets and compares names, sizes, and
SHA-256 hashes against the verified local files, publishes
`published-release-evidence.json` through the
`desktop:write-published-release-evidence` package script, and verifies that
evidence file downloads unchanged through `desktop:verify-published-release`
with valid schema, release metadata, CI
ref/event/commit/run URL metadata, generated timestamp, and asset hash entries.
The final `desktop:production-gate` job then runs against the restored signed
artifacts and downloaded draft GitHub Release assets before
`publish-public-release` undrafts the verified Release and checks the final
public asset set. It now writes and uploads retained
`production-gate-evidence.json` with ordered gate step results, CI source
metadata including ref name, ref type, event name, commit, overall pass/fail
status, and validation through `desktop:verify-production-gate-evidence`, whose
default package script rejects any release version, repository, ref, event,
commit, run id, run attempt, or run URL mismatch between the production gate and
published-release evidence. The public release job downloads that retained
published evidence before uploading `production-gate-evidence.json` to the
GitHub Release, verifies the downloaded Actions artifact against it first,
downloads the uploaded Release asset back for size/SHA-256 comparison, then runs
`desktop:write-public-release-evidence` and `desktop:verify-public-release`
before uploading retained `public-release-evidence.json` with the final public
Release state, sorted asset names including `production-gate-evidence.json`,
public asset size/URL metadata, repository, ref name, ref type, event name,
commit, run id, run attempt, and run URL. It also downloads the final public
asset set after undrafting and compares expected names, sizes, and SHA-256
hashes against retained release evidence inputs. The default
`desktop:verify-public-release` package script also binds that public evidence
to `public-release-input/production-gate-evidence.json` and
`public-release-input/published-evidence/published-release-evidence.json`, so
the retained public release evidence cannot pass without matching the final
production gate source metadata, the stable published Release identity, and the
public sizes of assets already verified in the published evidence.
The latest local continuation pass completed both Electron and packaged smoke
commands with exit code 0 after making the smoke shutdown path deterministic:
the Electron smoke runner now destroys smoke windows from the main process
before quitting, so restore and deep-link checks no longer depend on a SIGKILL
cleanup race. The packaged smoke run also verified the archived UX screenshot
set required by `desktop/scripts/smoke-packaged.mjs`. The packaged build
emitted the existing local code-signing warning because local non-release builds
disable Developer ID signing and notarization; the packaged smoke test still
completed successfully. A real production release remains blocked until release
CI runs with a production version, Developer ID signing, Apple notarization
credentials, completed UX validation evidence bound to the same release
version/commit with observed representative user validation, and signed
artifact verification.
