# Claude Code Desktop

The Electron main process owns local runtime access: Claude Code child
processes, workspace files, git, terminal PTYs, preview links, and native
navigation. The renderer talks to those capabilities only through the preload
IPC bridge.

`New Session` opens a small creation menu: Quick desktop workspace starts in
`~/.claude/desktop-workspace` without a picker, while Choose project folder is
the explicit directory-associated path for project-scoped sessions.

Chat, Agents, Teams, and Tasks are primary navigation surfaces. Agents, Teams,
and Tasks open full main pages rather than right-side workspace tabs. Teams
treats a team as a container of teammates and routes messages through the
existing team runtime tools. Team create/update, teammate spawn, and delete
also maintain project-scoped `.claude/teams/<name>/config.json` records so
refresh, selection, and lifecycle feedback are backed by durable desktop state
without leaking teams across workspaces. Tasks owns the scheduled-task lifecycle for both
global Claude Code schedules and project `.claude/scheduled_tasks.json`
schedules.

Settings is anchored in the left rail footer and opens as its own main page.
MCP, Skills, and Plugins are managed as card-style sections in the Settings
page, separate from the Files, Diff, Editor, Terminal, and Preview workspace
tabs. The Coding group links to the Tasks page instead of duplicating task
lifecycle forms inside Settings. Skills can be installed, created, inspected,
or removed at user scope under Claude home and project scope under the active
workspace `.claude/skills` folder.

Each session persists both its workspace pane and its primary navigation view,
so switching or restoring sessions keeps Chat, Agents, Teams, Tasks, and Settings
on the same user-facing surface instead of deriving that state from the pane
alone.

The session list collapse state is stored as a local renderer preference, so a
compact left rail stays compact across app restarts.

In packaged builds, the main window only allows generated HTML documents such as
`index.html` as top-level `file://` renderer entries. HTTP(S) links are opened
externally, and bundled JS/CSS/map/runtime asset URLs are blocked so a mis-click
or target navigation cannot replace the desktop shell with raw asset text.

## User-Facing Acceptance Checks

The Electron smoke test is the regression gate for the desktop GUI issues that
are most visible in normal use:

| User expectation | Smoke evidence |
| --- | --- |
| Assistant replies render and stream in the chat timeline after sending a prompt. | `renderedAssistant`, `streamedAssistant`, `thinkingStreamStateLabels` |
| Runtime user echoes, tool results, and turn results do not duplicate visible chat messages. | `duplicateChatMessagesSuppressed`, `agentToolResultsHiddenFromChat` |
| Plain Enter sends the composer message; Shift+Enter and IME composition do not submit. | `enterSendsMessage` plus `desktop/tests/composerKeys.test.ts` |
| Settings lives in the left rail footer, not mixed with the primary session list. | `settingsInLeftFooter` |
| Settings has its own sidebar with search and Personal, Integrations, and Coding groups; integration lists use structured empty states, and diagnostics export plus refresh work from both Settings and the command palette. | `settingsSidebarNavigation`, `settingsSearchFiltering`, `settingsDiagnosticsExport`, `settingsDiagnosticsRedaction`, `commandPaletteSettingsDiagnosticsExport`, `commandPaletteSettingsDiagnosticsRedaction`, `commandPaletteSettingsRefresh`, `commandPaletteSettingsRefreshGuard`, `settingsMcpSkillsInlineSections`, `settingsMcpEmptyState`, `settingsSkillsEmptyState`, `settingsPluginEmptyState` |
| Proxy settings validate input, guard repeated saves, and pass runtime proxy environment into sessions. | `proxyFormValidation`, `rapidProxySaveGuard`, `proxyRuntimeEnv` |
| Plugin settings run real list/install commands with form feedback, scope validation, and rapid action guards. | `pluginCommands`, `pluginFormFeedback`, `pluginScopeValidation`, `rapidPluginActionGuard` |
| User and project MCP servers can be added, inspected, edited, approved/enabled, checked, and removed directly from Settings. | `mcpManagement`, `userMcpInspect`, `userMcpEnableDisable`, `projectMcpManagement`, `projectMcpInspect`, `projectMcpApprovalLifecycle`, `mcpHealthCheck` |
| User and project Skills can be installed, inspected, and removed directly from Settings. | `localSkillInstall`, `localSkillInspect`, `localSkillRemove`, `projectSkillInstall`, `projectSkillInspect`, `projectSkillRemove`, `settingsSkillsEmptyState` |
| Chat, Agents, Teams, and Tasks are first-class primary navigation entries/pages. | `firstClassLeftNavigation`, `agentsFirstClassPage`, `teamsFirstClassPage`, `teamsFirstClassManagement`, `teamsManagementVisualEvidence`, `teamBroadcastMessageAction`, `teamMemberMessageAction`, `teamMemberShutdownAction`, `teamDeleteFeedback`, `rapidTeamDeleteGuard`, `tasksFirstClassPage` |
| Selecting an agent exposes direct actions for diagnosis, new agent sessions, task preparation, and editable/project overrides. | `selectedAgentActionRow`, `selectedAgentVisualEvidence`, `selectedAgentNewSessionAction`, `selectedAgentPrepareTaskAction`, `selectedAgentOverrideAction` |
| Scheduled tasks are managed from a dedicated Tasks page with project/global lifecycle actions, structured empty states, form validation, and Settings jump entries. | `scheduledTaskManagement`, `projectScheduledTaskManagement`, `projectScheduledTaskEmptyState`, `scheduledTaskFormValidation`, `scheduledTaskRunNowFeedback`, `scheduledTaskRemoveFeedback`, `rapidScheduledTaskRemoveGuard`, `scheduledTaskPausedRunNowGuard`, `projectScheduledTaskRunNow`, `projectScheduledTaskRemoveFeedback`, `rapidProjectScheduledTaskRemoveGuard`, `tasksFirstClassPage` |
| The composer can route messages to the current session, a team, or a specific agent, and `@`/`/` open resource/action menus. | `composerTeamTargetRouting`, `composerAgentTargetRouting`, `composerResourceMenu`, `composerActionMenu` |
| The conversation exposes runtime tool calls and TodoWrite todos in a visible activity surface. | `conversationToolActivityPanel`, `visibleTodoList` |
| Claude runtime failures surface as chat/session errors without being mixed into terminal output. | `runtimeFailureVisible` plus `desktop/tests/runtimeErrorPresentation.test.ts` |
| Sessions expose row-level management actions for focus, opening the folder, closing, and guarded repeated close/cancel clicks. | `sessionRowManagementMenu`, `sessionRowOpenFolderAction`, `rapidCloseSessionGuard`, `rapidCancelGuard` |
| Sessions can collapse, show a stable count, and restore the collapsed preference after restart. | `collapsibleSessions`, `collapsedSessionCountVisible`, `sessionRailCollapseRestored` |
| Starting a new session does not force a directory picker; choosing a folder remains an explicit menu action. | `quickSessionEntry`, `railQuickSessionEntry`, `menuSessionAction`, `menuOpenFolderAction` |
| Workspace panes keep useful empty/error states and restore safely after restarts. | `editorEmptyStateGuidance`, `terminalEmptyStateGuidance`, `terminalFailureVisible`, `restoredSession`, `restoredMissingEditorRecovery` |
| Files, Terminal, and Preview guard rapid or invalid actions while keeping visible feedback. | `rapidFilesRefreshGuard`, `fileTreeExpandedPathPersistence`, `restartedTerminal`, `rejectedInvalidPreview`, `previewRapidExternalGuard` |

For visual review, run the smoke test with `DESKTOP_SMOKE_SCREENSHOT_DIR` set and
inspect the generated Chat, Settings, narrow Settings, Agents, selected-agent,
Teams, Terminal, and Preview screenshots.
