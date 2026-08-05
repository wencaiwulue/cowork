# Claude Code Desktop MVP

This document tracks the local desktop MVP surface implemented under
`desktop/`. The desktop app keeps the CLI/TUI runtime intact: Electron main
owns local filesystem, process, git, terminal, settings, and runtime access,
while the renderer talks only through the typed preload IPC bridge.

## Runtime

- `desktop/main/sessionHost.ts` launches the local Claude Code runtime with
  stream-json input/output and uses the compiled `dist/claude-local` binary
  when available.
- Sessions persist desktop metadata separately from Claude transcript storage:
  title, cwd, status, messages, agent task state, and layout.
- Session layout also stores the active grouped Settings/Tasks section, so
  Codex-style Settings navigation returns to the last managed group for that
  session instead of resetting to General on every restore.
- Pending grouped-section scroll requests are cleared when there is no active
  session or when the focused session restores to Chat/Files-style panes, so a
  lifecycle jump from one session cannot later scroll a different session.
- The empty desktop state includes both a Quick session action, which starts in
  the dedicated `~/.kode/desktop-workspace` folder without opening a picker,
  and a Choose folder action for project-specific workspaces. The left rail New
  session button opens the same explicit choice instead of hiding folder
  association behind a generic plus button. Folder picker cancellation without
  an active session now points users back to Choose folder or Quick session;
  cancelling New session while a project is already open says "New session
  cancelled" so the header does not imply the active project disappeared.
- Switching to another valid session clears stale folder-picker cancellation
  status, so the active project header does not keep showing an old no-folder
  message.
- Switching sessions also clears project-scoped Tasks, MCP, Skills, Agents,
  Teams, selected MCP/Skill details, and diagnostics before the new workspace
  refresh starts, so old project rows cannot be acted on through the newly
  focused session.
- The same switch boundary clears project-scoped edit drafts, selected agents,
  team forms, agent launch/resume prompts, and composer team/agent targets,
  while preserving user-scoped Settings drafts.
- Project/local plugin install drafts are also reset at the session boundary,
  while user-scope plugin drafts are preserved. Plugin command output is cleared
  with the session boundary so stale project output is not shown for the next
  workspace.
- Session row switching uses a serialized focus queue: rapid repeated clicks on
  the same inactive session do not submit duplicate focus requests, and rapid
  alternating clicks keep the last clicked session active.
- Session row and menu Open folder actions use a per-session synchronous guard,
  so rapid repeated clicks do not send duplicate operating-system folder-open
  requests.
- Stale Session row and menu Open folder actions also report that the session is
  no longer available before touching the operating-system folder-open IPC, so a
  menu left open across session refreshes cannot silently no-op.
- Session rows and their management menu triggers are disabled while loading, so
  an active desktop action cannot be raced by switching or opening another
  session from the rail.
- Session row right-click and three-dot management triggers route through the
  shared `openSessionMenuForRow` handler before `openSessionMenu`, so both entry
  points preserve the same loading guard and menu positioning behavior.
- Session rail collapse routes through the named
  `handleSessionsCollapseClick` entrypoint before `toggleSessionsCollapsed` and
  is disabled while loading, so layout preference writes cannot race active
  desktop feedback or bypass the same handler guard used by other rail controls.
- Session row management menu actions expose disabled state and stay inert when
  an unrelated loading action starts while the menu is already open, including
  removal from the tab order and hover selection.
- New session and session-row action menus keep the keyboard-highlighted item
  synchronized with `aria-selected`, and their trigger buttons expose
  `aria-haspopup`, `aria-expanded`, and `aria-controls`, so their
  Arrow/Home/Enter behavior has the same visible and accessible selected state
  as the command palette and composer menus.
- New session and session-row action menus use semantic stable option ids for
  `aria-activedescendant`, so inserting or reordering menu items does not
  desynchronize keyboard focus from the referenced menu item.
- New session and session-row action menu hover selection routes through
  `highlightSessionCreateMenuItem` and `highlightSessionMenuItem`, so both
  menus expose disabled state and stay inert if a loading action starts while
  the menu is already open, including removal from the tab order.
- New session trigger clicks plus New session/session-row menu item hover and
  click events are wired through named handlers before reaching the shared menu
  actions, so future UI refactors cannot bypass the same loading guard path
  with inline JSX logic.
- Session menu keyboard handlers refresh with loading state, so Enter cannot
  submit a stale menu action after the pointer path has become disabled.
- Settings search and agent catalog search/filter controls disable and guard
  their change handlers while loading, so filtered navigation state cannot
  shift under an active desktop action.
- Settings back navigation follows the same loading guard as the primary rail,
  so the user cannot leave Settings mid-action through that alternate control.
- Runtime and Proxy Settings management entrypoints route through named
  Settings handlers and guard loading state before refreshing configuration,
  exporting diagnostics, or saving proxy settings.
- Proxy draft edit handlers also re-check loading state before changing runtime
  proxy enabled or URL values.
- Scheduled task and MCP metadata edit/create entrypoints guard loading state
  in their handlers as well as in the visible controls.
- Scheduled task edit and cancel buttons mirror those loading guards for both
  global and project task forms.
- Scheduled task runtime entrypoints guard loading state before saving,
  running, pausing/resuming, or removing global and project tasks.
- Settings Project Scheduled Tasks shortcut shows the project-session
  prerequisite and stays disabled without an active session, so it does not
  navigate to a session-bound task pane that cannot be used; stale shortcut
  clicks route through named Settings task handlers that report the missing
  project session in Settings instead of silently doing nothing.
- Skill edit entrypoints also guard loading state before reading files or
  mutating drafts, matching their disabled Settings controls.
- Skill draft edit handlers also re-check loading state before changing skill
  names, scopes, or contents.
- Skill runtime management entrypoints guard loading state before installing,
  inspecting, saving, or removing user/project skills.
- MCP runtime management entrypoints guard loading state before health checks,
  saving, inspecting, enabling/disabling, approving/rejecting, or removing
  user/project servers.
- Selected MCP detail cards expose direct Edit, Remove, and project Approve/Reject
  controls; project-scoped details show the active-session prerequisite and
  keep those controls disabled without a project session.
- Project MCP approval changes also refresh the selected detail card from the
  updated server list, so the visible approval state does not lag behind the
  list after Approve or Reject.
- Plugin management entrypoints guard loading state before selecting installed
  plugins, listing marketplace entries, or installing user/project/local
  plugins.
- Plugin draft edit handlers also re-check loading state before changing
  package names or install scopes.
- Teams selection and message-preparation entrypoints guard loading state in
  handlers and visible controls, so stale lifecycle shortcuts cannot retarget
  chat while another desktop action is active.
- Teams runtime and destructive entrypoints guard loading state before creating
  teams, spawning teammates, sending messages, requesting shutdown, removing
  members, or deleting team state.
- Teams draft edit handlers also re-check loading state before changing team
  metadata, teammate launch prompts, message recipients, or shutdown reasons.
- Teams draft fields also require an active project session before accepting
  edits, so session-bound team creation and messaging forms cannot be filled
  into an unusable state from the global no-session surface.
- Agents/Teams refresh entrypoints guard loading state before reloading agent
  catalogs and team lists.
- Agents selection and runtime launch/task entrypoints guard loading state
  before mutating selected-agent state or queueing runtime work.
- Agents catalog selection, selected-agent diagnose, Run/Edit shortcuts, and
  selected-session creation also report required-selection errors before
  mutating selected-agent state, drafts, layout, panes, or IPC when stale rows
  have no agent type.
- Agent launch form buttons mirror those runtime loading guards before creating
  agent-specific sessions or launching background tasks, and route through
  named launch handlers before reaching the shared session/task lifecycle
  actions.
- Agent session creation from the launch form reports an Agents-pane
  required-field error before queueing the desktop session create request, so
  stale create handlers cannot silently no-op when the agent type is missing.
- Agent session creation from a selected catalog card also reports an
  Agents-pane prerequisite error before queueing IPC, so stale selected-agent
  buttons cannot silently no-op after the selection disappears.
- Selected-agent Run preparation reports an Agents-pane prerequisite error
  before mutating the launch draft or navigating, so stale run buttons cannot
  silently no-op after the selected catalog entry disappears.
- Selected-agent Edit preparation reports an Agents-pane prerequisite error
  before mutating the editor draft or navigating, so stale edit buttons cannot
  silently no-op after the selected catalog entry disappears.
- Selected-agent Edit preparation also reports the missing project-session
  prerequisite before mutating the editor draft, while user agents remain
  editable without an active project session.
- Agent launch draft edit handlers also re-check active-session and loading
  state before changing task, teammate, team, isolation, or background-run draft
  values.
- Selected-agent detail action buttons route through named handlers before the
  shared diagnose, session creation, task preparation, edit/override, or delete
  lifecycle actions, so stale clicks keep the same prerequisite feedback as the
  visible disabled state.
- Agent task action buttons mirror runtime loading guards before reading,
  previewing, resuming, or stopping background agent tasks.
- Agent task resume prompts also require an active project session before
  accepting edits, so follow-up task text cannot be drafted into an unusable
  no-session Agents page.
- Agent editor save/delete entrypoints guard loading state before mutating
  custom agent definitions or opening destructive confirmations.
- Agent editor and task-resume draft edit handlers also re-check loading state
  before changing custom agent metadata or follow-up prompts.
- New session creation uses synchronous renderer and loading guards, so rapid
  repeated clicks or stale entrypoints cannot open multiple project pickers,
  create duplicate sessions, or start a session while another desktop action is
  active.
- Empty-state Quick session and Choose folder buttons also re-check loading
  state before starting session creation.
- Empty-state Quick session, Choose folder, and session rail focus actions now
  route through named lifecycle handlers, so disabled UI and stale click guards
  stay consistent with the header and menu entrypoints.
- File menu session creation uses the same synchronous main-process guard, so
  rapid menu or keyboard actions cannot open overlapping project pickers.
- Runtime stdout is parsed as NDJSON, mapped to visible chat messages and
  streaming text, and stderr is retained for user-visible failure states.
- Runtime user echoes are de-duplicated against optimistic composer messages,
  and turn `result` records update streaming state without rendering duplicate
  System chat bubbles.
- The chat composer submits on Enter, keeps Shift+Enter for newlines, and does
  not submit while IME composition is active.
- Composer sends snapshot the active session and ignore stale async TeamMessage
  or Agent task feedback after switching sessions, so an old send cannot show
  success in a newly focused conversation.
- Composer send handlers also report a conversation notice if the active
  session disappears before the send starts, so stale Enter/key events do not
  silently no-op when the textarea or Send button has just become disabled.
- Composer send handlers also report a local busy notice when Enter is pressed
  during an active Claude turn, matching the Agents/Teams/Tasks runtime guards
  instead of silently discarding the attempted send.
- The Electron smoke path verifies runtime stderr/exit failures appear as
  visible session errors instead of silent no-op sends.
- Electron smoke startup diagnostics are covered by a unit test so launch
  failures report the caller phase and window state instead of masking the
  underlying issue with diagnostics errors.
- Settings includes a user-triggered diagnostic export. The exported JSON keeps
  app/runtime versions, configuration paths, session status summaries, and
  renderer/runtime operational events, while avoiding full chat message bodies
  and redacting common secret forms.
- Diagnostic session summaries include the active Settings, Tasks, Agents, and
  Teams section ids, so support bundles can explain grouped navigation and
  first-class lifecycle page restore issues without exposing conversation text.
- Electron smoke classifies startup render failures where bundled JS/CSS asset
  text is shown as the page body, so raw-code white screens fail with a direct
  diagnostic instead of a generic shell timeout.
- Desktop top-level navigation uses the same app-shell policy in dev and
  packaged modes. Renderer entry URLs must point at the local HTML entry, and
  generated `assets/*.js` or `assets/*.css` files are blocked from replacing the
  desktop shell.
- Assistant text deltas and available thinking deltas are rendered separately
  in the conversation, so long-running responses show both live progress and
  any thinking content the runtime exposes.
- Streaming text/thinking mapping accepts both wrapped `stream_event`
  `content_block_delta` messages and direct `content_block_delta` messages, so
  desktop rendering is not tied to a single transport envelope.
- Thinking `content_block_start` events create immediate visible thinking
  feedback before the first delta arrives, while text block starts remain
  ignored because the SDK can repeat their content in later deltas.
- Redacted thinking block starts render a clear redacted-thinking placeholder
  instead of exposing the raw stream event in the chat timeline.
- Streamed `tool_use`, `server_tool_use`, and `mcp_tool_use` starts render as
  visible Tool messages, so the conversation shows tool activity as soon as the
  runtime announces it instead of appearing idle until a later result.
- Electron smoke now emits a streamed `tool_use` start from the fake runtime
  and verifies the chat timeline shows the immediate `Using Bash...` activity
  row before the turn finishes.
- The chat timeline also includes a compact Tool activity and Todos surface
  derived from the same session tool events, so tool calls and TodoWrite state
  remain visible even when the user is not on the Agents page.
- Empty Tool activity and Todos cards use the shared icon, title, and
  next-step treatment instead of collapsing to plain text placeholders.
- The chat header, command palette, and native File menu expose a guarded Clear
  desktop transcript view action. It clears the local desktop message list,
  tool activity, agent task timeline, runtime events, and stale runtime error
  for the session without closing the runtime host, deleting project files, or
  deleting Claude transcript storage.
- Chat header session actions keep their disabled active-session state, while
  Refresh workspace, Clear desktop transcript view, and Close session route
  stale clicks through lifecycle handlers so missing-session prerequisites
  surface as conversation notices instead of clickable no-ops.
- Refresh workspace, Cancel turn, Clear desktop transcript view, and Close
  session handlers also report a conversation notice if the active session
  disappears before the action starts.
- Final assistant SDK messages that include both thinking blocks and text are
  split into separate visible entries. The desktop does not synthesize thinking
  when the runtime only provides final text.
- If streamed thinking is followed by final assistant text without a final
  thinking block, the streamed thinking entry is marked complete instead of
  continuing to show a stale Streaming state.
- If the runtime exits during assistant or thinking streaming, the desktop
  marks the partial streamed message complete before showing the stopped or
  failed session state.
- `~/.kode/settings.json` environment values are applied to runtime children,
  and desktop proxy settings add `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY`
  variants when enabled.
- Main-process startup auditing covers every `ipcRenderer.invoke` channel
  exposed by the preload bridge, including read/inspect routes for MCP and
  Skills, so newly wired renderer controls cannot bypass the public IPC
  allowlist unnoticed.

## Workspace

- The Files pane reads the real workspace tree, shows a file count, supports
  directory expansion, refreshes externally changed files, and opens files in
  the Editor pane.
- Shared workspace directory validation rejects missing paths, files, and
  symlinked workspace roots before session creation or cwd-based workspace IPC
  can reach local runtime, Git, Terminal, MCP, Skills, Agents, Teams, Plugins,
  or scheduled-task state.
- File tree expanded directories are stored in the session layout and survive
  switching away from and back to the session.
- File tree expand/collapse persists expanded paths through the session that
  handled the row click, so stale row events cannot rewrite another workspace's
  expanded folder state.
- Files Refresh shows local busy/completion/error feedback inside the Files
  pane, so refreshing the tree is not only visible through other panes.
- Workspace refresh actions share a per-session synchronous guard, so rapid
  repeated Files, Diff, or header Refresh clicks do not duplicate tree/git
  refresh work.
- Files and Diff refresh buttons check that guard before entering the global
  loading wrapper, so repeated clicks cannot clear busy feedback while a
  refresh is still running.
- Workspace refresh keeps core Files and Diff data updating even when optional
  project metadata such as agents, teams, MCP, skills, or scheduled tasks fails.
- The chat-header workspace refresh action shows a local success status after a
  full reload and keeps the existing partial-refresh warning when optional
  project metadata fails.
- Chat-header Refresh, Cancel, and Close buttons also re-check loading state
  before refreshing the workspace, cancelling a turn, or closing the session.
- The Editor pane reads and saves files through guarded main-process workspace
  helpers, then refreshes git state. The pane shows inline open/save success
  and guarded failure states for binary, oversized, absolute-path, or
  out-of-workspace files. Editor read/write IPC accepts the relative file paths
  returned by the workspace tree, not absolute filesystem paths.
- Editor empty state shows a structured icon, title, and next step guidance so
  an unopened editor does not look like a blank or broken workspace.
- File tree rows are disabled without an active session and while desktop
  actions are loading, so folder expansion and file opening cannot race against
  active refresh/open/save feedback or become clickable no-ops without a focused
  workspace.
- The Files pane shows inline session guidance when no project session is
  active, so disabled Refresh and file-tree controls explain that browsing
  requires a selected workspace.
- Files Refresh and file-tree rows route stale button events through their
  handlers while keeping the visible disabled session/loading state; row
  handlers still re-check active session and loading state before expanding
  folders or opening files. Missing-session file opens and folder expansion now
  report Files pane errors instead of silently doing nothing.
- File-tree pointer selection now enters through `handleFileTreeEntryClick`,
  so folder expansion and file opening share one row-level guard path instead
  of duplicating navigation logic in JSX.
- Editor Save uses a synchronous renderer guard, so rapid repeated Save file
  clicks do not write the same buffer or refresh workspace state multiple times.
- The Editor Save toolbar button keeps its disabled session/file state but
  routes stale clicks through the save handler, so missing active session or
  active file prerequisites show inline Editor errors instead of silently
  doing nothing.
- Editor Open and Save handlers report inline errors when the active session or
  active file prerequisite disappears before the file action starts.
- Editor Open and Save snapshot the active session and ignore stale async read,
  write, error, and post-save workspace refresh results after switching
  sessions, so old workspace files cannot overwrite the newly focused editor.
- Editor Open persists the opened file and Editor pane layout, and clears failed
  opens, through the session that started the read action so late file reads do
  not rewrite the newly focused workspace layout.
- Editor session restore also clears missing or unreadable restored active files
  through the session being restored, so focus-time read failures cannot clear a
  different workspace's active file.
- Editor Save re-syncs the active Monaco model and clears the window-close dirty
  guard after workspace refresh completes, so a saved file does not remain
  marked Unsaved because of stale editor state.
- The Monaco Editor switches to read-only while desktop actions are loading, so
  users cannot change the visible buffer while Save/Open/Refresh feedback is in
  flight.
- Leaving the Editor pane through workspace tabs uses the same unsaved-change
  confirmation as opening another file, switching sessions, closing sessions,
  or closing the window.
- The shared unsaved-change confirmation uses a synchronous in-flight guard, so
  rapid pane/file/session/window navigation cannot stack duplicate discard
  prompts for the same dirty editor buffer.
- Editor dirty checks include the live Monaco model value as well as React
  editor state, so pane switching cannot miss unsaved edits during async
  editor/state synchronization.
- Confirming that workspace-tab prompt discards the in-memory editor buffer
  before switching panes, so hidden unsaved state does not linger in another
  pane.
- Restored sessions reload active Editor file contents, not only the saved
  active file path.
- If a restored active Editor file no longer exists, the desktop clears that
  stale active file, shows the editor empty state, and surfaces the read error.
- The Diff pane displays real `git status` and `git diff` output with a manual
  refresh action, toolbar busy feedback, and inline feedback for refreshing,
  clean, changed, and failed git states.
- Empty `git status` output now uses the shared structured workspace empty
  state, so a newly selected or clean project does not show a bare placeholder
  in the Diff pane.
- Refreshing Diff with no changes reports that the workspace was checked and
  is clean, instead of leaving a no-changes placeholder in the action status
  line.
- Diff file selection is disabled without an active session and while desktop
  actions are loading, so visible diff selection cannot race active refresh
  feedback or change stale git output without a focused project workspace.
- The Diff pane shows inline session guidance when no project session is active,
  so disabled Refresh and changed-file controls explain that git review belongs
  to a selected workspace.
- Diff Refresh and changed-file selection route stale button events through
  their handlers while keeping the visible disabled session/loading state, so
  missing-session diff file selection reports an inline Diff error instead of
  silently doing nothing.
- Changed-file row clicks now enter through `handleDiffFileClick`, matching
  the Files row model and keeping Diff selection guard logic outside JSX.
- Files and Diff refresh handlers report inline errors if the active session is
  gone before they start workspace refresh work.
- Restored Diff panes reload real git status and selected diff content, not
  only the saved active pane value.
- Files, Diff, Editor, Terminal, and Preview workspace tabs share the same
  active-state helper, so the visible active tab and `aria-pressed` state stay
  synchronized across pointer, menu, and keyboard pane switches.
- Workspace pane tabs route pointer selection through the named
  `handleWorkspacePaneClick` entrypoint before `selectWorkspacePane`, and are
  disabled and removed from the tab order while loading, so pane changes cannot
  race active workspace/editor/terminal/preview feedback or bypass the pane
  persistence handler.
- Workspace pane keyboard shortcuts and native View menu pane events also call
  `selectWorkspacePane`, so pointer, Cmd/Ctrl+Shift+1..5, and menu navigation
  share the same pane selection guard before reaching layout persistence.
  Command palette pane commands use the same selection guard, so searchable
  navigation cannot bypass the workspace pane loading and persistence path.
- Workspace pane changes snapshot the active session before any unsaved-editor
  confirmation and persist the pane layout through that session, so a delayed
  confirmation cannot rewrite the newly focused workspace's active pane.
- Files Refresh, Diff Refresh, Editor Save, Terminal Start/Stop, and Preview
  embedded/external toolbar buttons route through named click handlers before
  reaching their shared actions, so their loading/session/file/URL
  prerequisites cannot drift into inline JSX-only guards.
- The Terminal pane uses `node-pty` and xterm.js for shell create, input,
  resize, and kill, with inline running/exited/stopped state feedback.
- Terminal empty state shows a structured icon, title, and project-folder
  guidance instead of a sparse black terminal surface before the shell starts.
- The Terminal pane shows inline session guidance when no project session is
  active, so the disabled Start shell control explains why a shell cannot be
  started from the global no-session surface.
- Terminal Start/Stop actions use a synchronous renderer guard so rapid clicks
  cannot create multiple PTYs or race shell shutdown; Electron smoke verifies
  both rapid Start and rapid Stop from the visible toolbar.
- Terminal Start shell and Stop toolbar buttons keep their disabled
  session/terminal state but route stale clicks directly through the lifecycle
  handlers, so missing active session prerequisites show inline Terminal
  errors instead of silently doing nothing.
- Terminal Start/Stop handlers report an inline Terminal error when their
  active session is gone instead of silently ignoring stale lifecycle actions.
- Terminal Start/Stop snapshot the active session and ignore stale create,
  failure, kill, status, and layout updates after switching sessions, so a
  shell from one project cannot attach to another project's workspace pane.
- Terminal Start/Stop persist terminal id and active Terminal pane layout
  through the session that started the lifecycle action, keeping late shell
  create/stop results from rewriting the newly focused workspace layout.
- Terminal write, resize, and stop requests for missing terminal ids reject
  instead of silently no-oping, so stale toolbar or xterm actions can surface
  inline failure feedback. Empty terminal ids are rejected by IPC validation
  before reaching the terminal manager.
- The Preview pane updates the embedded iframe for `http://` and `https://`
  URLs, shows inline pending/success/error URL state, and keeps a separate
  external-browser action.
- Preview URLs are stored per session; switching sessions restores each
  session's own preview input, iframe, and status instead of reusing stale
  preview state from another project.
- Preview open and external-browser actions snapshot the active session and URL,
  then ignore stale async success or error feedback after switching sessions, so
  an old preview request cannot overwrite the newly focused workspace status.
- Embedded Preview open also persists the committed URL and active Preview pane
  layout through the session that started the action, so a late iframe update
  cannot rewrite the newly focused workspace's preview layout.
- The Preview external-browser action shows inline opening/success/error
  feedback, explicitly notes the embedded preview is unchanged, and smoke
  verifies it calls the main-process browser opener with the current preview
  URL.
- Preview open actions use a synchronous in-flight guard, so rapid repeated
  clicks cannot submit duplicate embedded preview URL updates or open multiple
  external browser windows before disabled state renders.
- Preview embedded and external toolbar buttons keep their disabled
  session/URL state but route stale clicks through the preview handlers, so
  missing active session or invalid URL prerequisites show inline Preview
  errors instead of silently doing nothing.
- Assistant markdown links route through `handleInlineMarkdownLinkClick` before
  calling the controlled `openExternalLink` IPC path, so chat links do not
  rely on default browser navigation and keep the same active-session and URL
  validation feedback as toolbar browser actions.
- The Preview URL field is disabled while a desktop action is loading, so
  embedded and external preview actions cannot race against visible URL edits.
- Preview URL editing and both preview open actions also require an active
  session in their handlers and disabled state, so the workspace cannot accept
  preview changes that have no focused project session to persist against.
- The Preview pane shows inline session guidance when no project session is
  active, so disabled URL and Open controls explain that preview state belongs
  to a selected workspace session.
- The Preview URL edit handler routes input through `handlePreviewUrlChange`,
  reports an inline error if the active session disappears, then re-checks
  loading state before changing the pending URL or inline preview status.

## Settings And Extensions

- Settings opens as a first-class main page from the left rail footer instead
  of sharing the right workspace pane with Files, Diff, Editor, Terminal, and
  Preview.
- Settings uses an internal sidebar like the Codex settings layout, with Back
  to app, Search settings, and Personal, Integrations, and Coding groups.
- Settings search reports match counts, hides empty groups, shows a no-results
  state, supports Enter to open the highlighted match with a first-match
  fallback, Escape to clear the query, and ArrowUp/ArrowDown plus Home/End to
  cycle or jump through matching sections. Settings search keyboard navigation
  stays inert while the desktop is loading, matching disabled page controls.
- Command palette custom slash commands are also disabled while a desktop
  action is loading, so a busy runtime cannot leave the composer half-staged
  from a command that could not fully navigate.
- Settings shows redacted global and local Claude settings, user/project MCP
  servers, skills, plugins, and scheduled tasks.
- MCP and Skills are separate Settings drawers, while Plugins and scheduled
  task controls stay in the grouped Settings sidebar.
- The Settings toolbar Refresh action shows busy feedback while loading,
  refreshes user configuration without requiring a session, and also reloads
  active workspace management resources when a project session is selected.
- Settings Refresh uses a synchronous renderer guard, so rapid repeated Refresh
  clicks do not submit duplicate configuration reads.
- Proxy settings validate enabled proxy URLs in the renderer before submit, so
  invalid or empty enabled proxy configuration cannot be saved silently.
- Proxy saving uses a synchronous renderer guard, so rapid repeated Save clicks
  do not submit duplicate proxy configuration writes.
- Proxy Save routes stale button clicks through the save handler, so the current
  URL validity prerequisite surfaces as Settings feedback instead of being
  silently swallowed after the visible disabled state changes.
- MCP management supports add/update/remove for user and project `.kode.mcp.json`
  files, user MCP Enable/Disable state through `disabledMcpServers`, project
  MCP Approve/Reject lifecycle state in `.kode/settings.local.json`, plus a
  guarded project MCP health check through the CLI.
- MCP health output uses a structured Settings empty state when the CLI returns
  no stdout or stderr, so a completed health check still leaves visible result
  feedback instead of a bare placeholder.
- User and project MCP servers can be inspected directly from Settings.
  Inspect reads the selected server through guarded main-process IPC and shows
  its source path, redacted URL/arguments, and redacted raw config in a read-only
  details panel.
- User and project MCP rows are exposed as selectable listbox options, with the
  inspected or edited server reflected as the active management row. Clicking a
  row or pressing Enter/Space through `handleMcpServerRowKeyDown` while it is
  focused loads that server into the MCP edit form, while row action buttons
  stop pointer and keyboard bubbling so Inspect/Remove do not also trigger row
  selection.
- MCP and Skill listbox option identifiers and render keys use trimmed server
  names, skill paths, and skill names, so keyboard navigation, ARIA selected
  state, restored Settings detail selections, and React row reconciliation share
  the same canonical management identity.
- The selected MCP server identity is stored in session layout by name and
  source path. Restoring a session re-reads the selected user or project MCP
  detail through the main-process IPC path instead of storing raw config in the
  session file.
- Project MCP inspect results are ignored if the active session changes while
  the read is in flight, so stale project details cannot repopulate Settings
  after switching workspaces.
- Project MCP Approve/Reject and health-check results are also ignored if the
  active session changes while the IPC call is in flight, so one workspace
  cannot overwrite another workspace's MCP list, health output, or status.
- Removing a user or project MCP server also clears that server's saved
  Enable/Disable or Approve/Reject lifecycle state, so re-adding the same name
  starts from the current server definition rather than stale status.
- Removing a missing user or project MCP server is rejected with a visible
  not-found error instead of rewriting config and reporting false success.
- User MCP Enable/Disable and project MCP Approve/Reject also require the
  target server to still exist, so stale rows cannot create orphaned
  `disabledMcpServers`, `enabledMcpjsonServers`, or `disabledMcpjsonServers`
  state.
- Settings MCP, Skills, and Plugins lists use structured empty states for
  configured and no-session project guidance, so integration management does
  not collapse to bare placeholder text.
- Project-scoped MCP and Skill management rows expose disabled semantics and
  are removed from keyboard focus when no session is active, so stale project
  rows cannot silently no-op or move forms into an unsavable project state.
  Project MCP Edit follows the same disabled contract as Inspect, Approve,
  Reject, and Remove.
- Project MCP Inspect and Approve/Reject also report the missing session
  prerequisite in Settings before creating an action key or calling workspace
  IPC, so stale row handlers do not fail without feedback.
- Project MCP row and selected-detail Inspect/Edit/Remove click handlers route
  directly through their Settings handlers instead of wrapping inline `if`
  blocks around the button click, so stale action events receive the same
  missing-session or required-selection error path while disabled semantics and
  keyboard focus guards remain intact. Approve/Reject actions follow the same
  direct handler-routing contract.
- Selected MCP and Skill detail Edit/Remove buttons route through named detail
  click handlers before reaching the shared edit/remove actions, so direct
  management from the detail card cannot drift into inline JSX-only loading or
  project-session guards.
- User and project MCP Inspect, Edit, Remove, Enable/Disable, and
  Approve/Reject handlers also report a required-selection error before
  creating action keys, opening confirmation, or calling MCP IPC when a stale
  row has no server name.
- User and project MCP Inspect, Edit, Remove, Enable/Disable, and
  Approve/Reject handlers trim the server name before action keys,
  confirmation text, IPC payloads, edit drafts, selected-detail cleanup, and
  local feedback, so whitespace in MCP metadata cannot target or preserve the
  wrong server identity.
- User and project Skill Inspect, Edit, and Remove handlers trim the skill name
  before action keys, confirmation text, IPC payloads, edit drafts,
  selected-detail cleanup, and local feedback, so whitespace in Skill metadata
  cannot target or preserve the wrong skill identity.
- Restored Settings MCP and Skill detail selections also trim saved and listed
  names before matching active rows or re-reading details over IPC, so persisted
  layout state survives whitespace in integration metadata without duplicating
  stale detail reads.
- Skill and MCP save/update flows trim the previous `editingName` before
  building duplicate-action keys or removing renamed entries, so edits with
  whitespace in the original metadata do not leave stale configuration behind.
- Selected Skill details expose detail-level Edit and Remove actions; project
  skill details keep both actions disabled if the active project session
  disappears before the details panel is cleared.
- Selected Skill detail actions derive project scope from the selected skill's
  trimmed name and path together, so detail-level Edit and Remove stay aligned
  with the active user/project row identity instead of relying on path-only
  matches.
- Selected Skill detail state also tracks the inspected scope in memory.
  Restored, inspected, and saved details set that scope, and deletion clears
  the detail only when the removed skill belongs to the same user/project
  scope, so cross-scope Skill rows cannot discard or mutate the wrong details
  panel.
- The selected MCP and Skill scopes are also persisted in session layout and
  included in diagnostics. Restoring a session uses the saved scope to choose
  the user or project read path, while old layout records without a scope still
  fall back to the previous user-then-project behavior and then repopulate the
  scoped state.
- MCP save actions use per-scope synchronous guards, so rapid repeated Add or
  Update clicks do not duplicate configuration writes.
- MCP remove actions use per-scope synchronous guards around confirmation and
  removal, so rapid repeated Remove clicks cannot submit duplicate destructive
  writes.
- Project MCP Remove also re-checks active session before opening the
  destructive confirmation dialog, so stale handlers match the disabled UI
  state and report the session requirement inline.
- Project MCP Save and Remove actions snapshot the active session and ignore
  stale async results after switching sessions, so settings feedback and form
  state cannot be overwritten by a previous workspace. They re-check the active
  session again after the global config refresh completes and before refreshing
  project workspace state, so a slow config reload cannot show success or
  refresh git/files for the wrong workspace.
- User and project MCP Inspect, Save, and Remove actions persist selected MCP
  layout identity through the session that started the async action, so
  managing user or project MCP settings during a session switch cannot rewrite
  the newly focused workspace's selected MCP detail.
- Project MCP approval actions also re-check the active session after workspace
  refresh completes, so Approve/Reject cannot report success for a workspace
  that is no longer focused.
- Project MCP Approve/Reject routes stale row and detail clicks through
  `approveProjectMcpServer`, `rejectProjectMcpServer`, and
  `handleSelectedMcpDetailApprovalClick`; non-project detail selections and
  already approved/rejected servers surface Settings feedback instead of
  silently no-oping or re-writing the same approval state.
- User MCP Enable/Disable updates the selected detail card from the returned
  server list before refreshing settings, and row toggles route through
  `toggleUserMcpServer`, so the details panel immediately reflects the enabled
  state changed from a row action.
- Skill remove actions use per-scope synchronous guards around confirmation and
  removal, so rapid repeated Remove clicks cannot open duplicate destructive
  confirmations or submit duplicate deletes.
- Removing a missing user or project Skill is rejected with a visible not-found
  error instead of silently succeeding or leaking a low-level filesystem error.
- Removing a user or project MCP server only clears the edit form for the same
  scope, so same-name MCP servers in the other scope do not lose in-progress
  edits.
- MCP removal also clears the selected detail card only when the removed server
  matches the selected detail's scope and source path, so deleting a same-name
  server from another scope does not discard the active inspection panel.
- Saving a new or edited MCP server selects the saved server returned by the
  settings IPC, refreshes the selected detail card, and persists the selected
  layout identity, so Add or Update leaves Inspect/Edit/Remove and
  Approve/Reject ready for the server that was just saved.
- Restored MCP and Skill detail cards are also cleared when their persisted
  user/project row disappears from the refreshed Settings lists, including the
  saved session layout identity even if no detail card is currently mounted, so
  Settings cannot keep restoring or showing a stale inspection record after
  external configuration changes.
- Restored MCP and Skill detail identities are also cleared when the saved
  layout contains only half of the identity, such as a name without its source
  path or a path without its name, so Settings cannot keep carrying an
  unresolvable detail selection after partial layout writes or old metadata.
- New MCP draft actions clear the selected MCP detail and its persisted layout
  identity through the session that opened the draft before showing add
  feedback, so adding a server cannot leave Settings focused on a stale
  inspected MCP record or rewrite another workspace after a session switch.
- MCP and scheduled task forms keep add/update buttons disabled until required
  fields are present, scheduled tasks have valid 5-field cron schedules, and
  project-scope actions have an active session.
- MCP Check keeps its disabled active-session state but routes stale clicks
  through the health handler, so missing-session prerequisites surface as
  Settings errors instead of silently doing nothing. MCP Add/Update keeps its
  disabled draft-prerequisite state but routes stale clicks through
  the save handler, so invalid scope, transport, remote URL, or missing
  project-session prerequisites surface as Settings errors instead of silent
  no-ops.
- Skill and MCP Save actions validate their draft scopes before building action
  keys or choosing user/project storage, so stale or corrupted drafts cannot
  fall through to user-level writes. Skill Save keeps its disabled
  draft-prerequisite state but routes stale clicks through `saveSkillDraft`, so
  missing drafts, invalid scopes, missing name or contents, or missing
  project-session prerequisites surface as Settings errors instead of silent
  no-ops.
- MCP Save also validates the transport mode, remote type, and remote URL
  before resolving storage or queueing IPC, so stale or corrupted transport
  drafts cannot be saved as an unintended or endpoint-less remote server.
- Loading an existing remote MCP server into the edit draft preserves its URL,
  so opening a remote server and saving it again does not erase the transport
  endpoint.
- Plugin List and Install actions also validate the selected scope before
  resolving a command cwd or queueing IPC, so stale or corrupted plugin drafts
  cannot fall through to the user plugin scope. List and Install keep their
  disabled scope/package-prerequisite states but route stale clicks through
  their Settings handlers, so invalid scopes, missing project/local sessions,
  and missing plugin package input surface as Settings errors instead of silent
  no-ops.
- Project MCP Add/Update also reports the missing-session prerequisite in
  Settings before creating an action key or entering the shared async action
  wrapper, so stale save events do not show only generic loading/error feedback.
- Project-scoped MCP draft content fields also become inert when the active
  project session is missing, with disabled state and change handlers checking
  the same session prerequisite. The scope control remains available so users
  can switch a blocked draft back to user scope without starting over.
- MCP and scheduled task draft fields are disabled during active desktop
  loading, so a save or refresh cannot complete against an older draft while
  the visible form has already changed.
- MCP draft edit handlers also re-check loading state before changing user or
  project MCP server drafts.
- Scheduled task draft edit handlers also re-check loading state before
  changing global or project task drafts.
- Settings navigation rows are marked disabled and removed from the tab order
  while loading, so pointer navigation cannot race active settings refreshes.
- Settings sidebar Back and grouped navigation row clicks route through named
  Settings navigation handlers, so Codex-style grouped navigation shares the
  same loading guard path as search and keyboard navigation.
- Settings task shortcut buttons are disabled while loading, so Settings cannot
  jump into Scheduled Tasks during active refresh or save feedback.
- MCP server rows and their Edit actions stay disabled while Settings is
  loading, and project MCP rows also require an active session for focusability;
  stale project row events route through the edit handler and report the missing
  session instead of silently no-oping or rewriting the MCP draft during
  workspace switching.
- MCP form Check, Save, Cancel, row select, Inspect, Edit, and Remove shortcuts
  route through named Settings handlers before reaching MCP mutation or inspect
  functions, so stale user/project row clicks reuse the same loading,
  validation, active-session, and destructive confirmation feedback paths as
  the visible Settings controls.
- The MCP edit handler also re-checks active session for project scope before
  writing the draft and reports the missing session prerequisite in Settings,
  while user MCP edits remain available without a project session.
- MCP edit and cancel buttons also re-check active loading state in their click
  handlers before mutating the draft, matching their disabled UI state.
- `scheduledTaskManagement` and `scheduledTaskFormValidation` confirm scheduled
  task forms are real lifecycle controls with validation feedback. Global and
  project scheduled task Add actions use synchronous guards and are covered by
  `rapidScheduledTaskSaveGuard` and `rapidProjectScheduledTaskSaveGuard`, so
  the same draft does not submit duplicate add/update IPC calls or persist
  duplicate tasks.
- Scheduled task saves that include an existing id must match an existing
  global or project task; stale edit drafts are rejected with not-found errors
  instead of creating a new task under an old id.
- Global scheduled task Save, Remove, and Pause/Resume actions persist selected
  task layout through the session that started the action, so switching
  sessions during the async task lifecycle cannot rewrite the newly focused
  session's selected global task.
- Project scheduled task Save, Remove, and Pause/Resume actions use the same
  origin-session layout binding after workspace IPC completes, so project task
  follow-up state stays attached to the workspace that started the lifecycle.
- Global and project scheduled task Run now actions also persist the selected
  task layout through the session that queued the prompt, keeping follow-up
  actions attached to the originating workspace when users switch sessions mid
  queue.
- Restored global/project scheduled-task selections are cleared through the
  session being restored when the saved task no longer exists, so delayed task
  list refreshes cannot clear another workspace's selected task layout.
- Skill installation copies local skill folders into user or project
  `.kode/skills` locations after verifying `SKILL.md`.
- Project skill listing and installation verify the workspace `.kode/skills`
  target is not a symlink before reading or copying, so a project cannot expose
  or redirect skill files outside the selected workspace.
- User and project skill install buttons surface cancellation feedback when the
  folder picker is dismissed without selecting a skill.
- User and project skill install actions use synchronous guards so rapid
  repeated clicks cannot open overlapping folder pickers.
- Successful user and project skill installs select the installed skill detail
  returned by IPC and persist its layout identity, so Settings immediately
  exposes Inspect/Edit/Remove follow-up actions for the new skill.
- User and project Skill Install, Inspect, Edit, Save, and Remove actions
  persist selected Skill layout identity through the session that started the
  async action, so managing user-level Skills during a session switch cannot
  rewrite the newly focused workspace's selected Skill detail.
- User and project skills can also be created or edited directly in Settings.
  The Skill editor writes `SKILL.md` through guarded main-process IPC, refreshes
  the rendered skill details, and records save feedback. Rapid Save clicks are
  guarded so one draft cannot submit duplicate write IPC calls.
- Project skill New and Install buttons keep their disabled active-session
  state but route stale clicks through the Settings handlers, so missing
  workspace prerequisites surface as Settings errors instead of silently doing
  nothing. Skill editor Save still re-checks the active session and draft
  validity prerequisites inside its click handler so stale Settings events
  cannot save an invalid skill draft after visible state changes.
- Skill editor Save also reports a Settings-pane required-field error before
  building a save action when the active skill draft is missing.
- Project skill draft fields also become inert when the active project session
  is missing, with both disabled state and change handlers checking the same
  session prerequisite so stale project drafts cannot keep accepting edits that
  cannot be saved.
- Skill editor fields and Plugin install fields are disabled during active
  desktop loading, and Skill draft create/cancel handlers are inert while
  loading, so Settings writes cannot race against visible draft edits.
- Skill draft, cancel, row edit, and selected-detail edit buttons also re-check
  loading state in their click handlers before mutating the active draft.
- Skill New, Install, Save, Cancel, row select, Inspect, Edit, and Remove
  shortcuts route through named Settings handlers before reaching Skill IPC or
  draft mutation functions, so stale user/project row clicks reuse the same
  loading, validation, active-session, and destructive confirmation feedback
  paths as the visible Settings controls.
- New user/project Skill draft actions clear the selected Skill detail and its
  persisted layout identity through the session that opened the draft before
  showing create feedback, so a restored Settings session cannot repopulate an
  old Skill detail over a new draft or rewrite another workspace after a
  session switch.
- Selected skill detail Edit also re-checks the project-skill active-session
  prerequisite, so stale detail panels cannot open a project skill draft after
  the workspace session disappears.
- Global and project scheduled task Save buttons re-check their draft validity
  prerequisites in click handlers, so stale form events cannot submit invalid
  schedules after the visible disabled state changes.
- Project scheduled task Save also reports the missing session prerequisite
  before validating the draft or building a workspace write action, so stale
  project task forms do not silently fail on no-session pages.
- Project skill Install and Remove actions ignore stale async results after a
  session switch, so a folder picker or delete from one workspace cannot
  repopulate the next workspace's skill list or status. They also re-check the
  active session after workspace refresh before reporting success. Project skill
  Save follows the same stale-session checks before updating the project skill
  list or reporting success.
- User and project skills can be inspected directly from Settings. Inspect reads
  the selected `SKILL.md` through guarded main-process IPC and shows the skill
  name, path, description, and full file contents in a read-only details panel.
- User and project skill rows are exposed as selectable listbox options, with
  the inspected skill reflected as the active management row. Clicking a skill
  row or pressing Enter/Space through `handleSkillRowKeyDown` while it is
  focused reads the skill details, while row action buttons stop pointer and
  keyboard bubbling so Remove does not also trigger a background inspect.
- Skill rows stay disabled while Settings is loading, and project skill rows
  also require an active session for focusability. Project skill row selection
  and row action handlers route through Inspect/Edit/Remove handlers that
  re-check the active session, so stale inspect requests cannot overwrite the
  selected skill detail during refresh or workspace switching, and stale edit
  requests report the missing session prerequisite instead of silently failing.
- Project Skill row Inspect/Edit/Remove buttons and selected-detail
  Edit/Remove action click handlers route directly through their Settings
  handlers instead of reusing the row disabled predicate or wrapping inline
  `if` blocks around the button click, so stale action events receive visible
  Settings errors for missing session or skill-name prerequisites while the
  disabled controls still communicate the no-session prerequisite.
- User and project skill Inspect, Edit, and Remove handlers also report a
  required-selection error before building action keys, opening confirmation, or
  calling skill IPC when a stale row or detail panel has no skill name.
- Project skill Remove also reports the missing session prerequisite in
  Settings before opening any destructive confirmation, so stale row handlers
  do not silently no-op after the project session disappears.
- The selected Skill identity is stored in session layout by name and path.
  Restoring a session re-reads the selected user or project `SKILL.md` through
  guarded IPC, so the detail drawer survives reload without persisting file
  contents in desktop session metadata.
- Selected Skill details use a structured empty state when `SKILL.md` does not
  declare a description, so the detail drawer stays informative without a bare
  placeholder sentence.
- Project skill inspect results are ignored if the active session changes while
  the read is in flight, so old workspace skill contents cannot reappear after
  switching projects.
- Project skill installation shows inline session guidance while no project
  session is selected.
- Plugin project/local scope actions are disabled without an active session, so
  scope-specific commands do not silently no-op.
- Project/local Plugin package edits also become inert without an active
  session, while the scope control remains available so users can switch a
  blocked draft back to user scope without losing the form context.
- Plugin management shells out to the existing Claude Code plugin commands.
- Installed plugin rows are exposed as selectable listbox options, with the
  current plugin package draft reflected as the active row when it matches an
  installed plugin.
- Selecting an installed plugin row copies its package id and scope back into
  the plugin form from pointer or Enter/Space through
  `handlePluginRowClick` and `handlePluginRowKeyDown`, so follow-up plugin
  actions stay anchored to that entry.
- Installed plugin row selection trims package ids before active-row matching,
  form writes, missing-id checks, and selection feedback, so copied or restored
  plugin entries with surrounding whitespace behave like the canonical package.
- Installed plugin active-row matching also includes the normalized install
  scope, so same-package user, project, and local installs do not all appear
  selected at once.
- Installed plugin active-row matching now also tracks the selected row's full
  installed identity, including scope and install path/version, so duplicate
  same-scope package entries do not all appear selected after editing one row.
- Installed plugin rows also use the normalized scope plus canonical package id
  for listbox option ids and render keys, keeping accessibility state and row
  reconciliation aligned with selection behavior.
- Installed plugin row selection persists the selected plugin identity in the
  session layout and restores the install form from that identity when the
  session is focused again, so Settings plugin management keeps the same
  lifecycle continuity as MCP, Skills, Agents, Teams, and scheduled tasks.
- Installed plugin row selection, plugin package/scope draft edits, refreshed
  plugin-list stale cleanup, and successful selected-plugin removal write that
  plugin identity through the session that triggered the action when one is
  active. Later session focus cannot resurrect a stale installed plugin
  selection over the user's new draft, and quick workspace switches cannot
  rewrite another workspace's plugin selection.
- Project/local installed plugin rows expose disabled semantics and leave the
  keyboard order when no session is active, and the row selection handler
  re-checks that state before mutating the form, so stale rows cannot move the
  form into a project/local scope that cannot run.
- Installed plugin row selection also reports a required-selection error before
  mutating the install form when a stale row has no plugin id.
- Installed plugin rows also expose a guarded Remove action that confirms the
  destructive operation, shells out to `claude plugin uninstall --scope`, and
  refreshes desktop config while preserving project/local stale-session guards.
- Project/local plugin removal clears the persisted selected-plugin identity
  through the origin session id before refreshing config, so a session switch
  during deletion cannot clear the newly focused workspace's plugin selection.
- Project/local plugin row Update, Enable/Disable, and Remove handlers also
  report a Settings error when the active session disappears before the stale
  row event runs, so these direct management actions do not silently no-op.
- Installed plugin row action click handlers (`handlePluginUpdateClick`,
  `handlePluginToggleClick`, and `handlePluginUninstallClick`) stop
  row-selection bubbling and route directly through the Update, Enable/Disable,
  and Remove lifecycle handlers instead of wrapping inline `if` blocks around
  the button click, so stale project/local action events receive the same
  Settings error path as native and command-palette plugin actions.
- Installed plugin rows expose direct Enable/Disable actions. The actions shell
  out to `claude plugin enable|disable --scope`, reuse the guarded plugin
  command pipeline, refresh desktop config on success, re-select the refreshed
  plugin row, and keep project/local stale-session checks before writing
  Settings feedback.
- Installed plugin rows also expose direct Update actions. Update shells out to
  `claude plugin update --scope`, reports stdout/stderr in the plugin command
  output panel, refreshes desktop config on success, re-selects the refreshed
  plugin row, and shares the same project/local session guard as the other
  plugin row actions.
- Installed plugin config now includes explicit `enabled` state when
  `enabledPlugins` declares the plugin in the applicable Claude settings file,
  so Settings can show disabled plugins without guessing from install metadata.
- Installed plugin row actions stop both pointer and keyboard event bubbling, so
  using Remove does not also select the row or rewrite the install draft.
- Installed plugin rows also stay disabled while Settings is loading, so
  refreshes or plugin commands cannot race visible plugin draft changes.
- Plugin List and Install actions use synchronous guards so rapid repeated
  clicks do not run duplicate plugin CLI commands.
- Plugin List and Install buttons route through named Settings click handlers,
  which re-check loading state before delegating to the scope/session and draft
  prerequisite checks, so stale Settings events cannot run a project/local
  plugin command without an active workspace or install an empty package.
- Plugin Install trims the package draft before constructing the command key,
  invoking plugin IPC, and reporting success, so pasted package names with
  surrounding whitespace do not reach the CLI.
- Plugin install IPC rejects empty, option-like, whitespace, and control
  character package names, so Settings cannot accidentally pass CLI flags as
  plugin targets.
- Project/local Plugin List and Install actions snapshot the active session and
  ignore stale async results after switching sessions, so plugin output,
  drafts, and Settings status cannot be overwritten by the previous workspace.
- User, project, and local Plugin Install, Update, and Enable/Disable actions
  write refreshed selection state back to the session that started the command,
  so plugin row selection cannot leak into the workspace the user switched to
  while the command was running.
- Project/local Plugin List and Remove also re-check the origin session after
  desktop config refresh before writing Settings status, so late command
  completion cannot overwrite feedback in a newly focused workspace.
- User, project, and local Plugin Remove actions clear persisted plugin
  selection through the session that started the destructive command, so late
  removals cannot clear the newly focused workspace's plugin selection.
- Plugin install forms keep the successfully installed package and scope
  selected after installs, then re-select the refreshed installed plugin row so
  users can continue enable/update/remove follow-up actions without losing
  context. Failed installs keep the attempted package name for correction.
- Refreshed plugin lists clear the selected installed plugin identity and reset
  the plugin install draft when that selected plugin disappears, so Settings
  cannot keep highlighting or editing a stale plugin row after external
  changes. The cleanup only runs once a refreshed plugin list is available, so
  loading or unavailable settings data does not discard the current plugin
  selection prematurely.
- Plugin command output uses the same Settings empty-state pattern when a list
  or install command completes without stdout/stderr, so an empty CLI response
  still leaves visible success or failure feedback instead of a bare placeholder.
- Global scheduled tasks are stored in `~/.kode/scheduled_tasks.json`; project
  scheduled tasks are stored in `.kode/scheduled_tasks.json`. Enabled cron
  tasks can be run manually and are also fired by the desktop scheduler;
  `globalScheduledTaskRunNow`, `automaticGlobalScheduler`, and
  `automaticProjectScheduler` confirm both manual and automatic scheduler paths.
- User-level first-class pages remain stable when no project session is active:
  Settings, Agents catalog/custom agents, and Global scheduled tasks are not
  forced back to Chat by the no-session cleanup path. The primary Tasks entry
  opens Global scheduled tasks without a project session and Project scheduled
  tasks when a workspace session is selected, while project data and project
  drafts are still cleared when the active session disappears.
- Tasks actions that resolve the current task section, including native Refresh
  Tasks, also fall back to Global scheduled tasks when no project session is
  active, so menu-driven task refreshes do not jump into a project-only view.
- Restored global scheduled task drafts normalize the persisted task id before
  matching the task list, so session restore and session switching use the same
  selected-task identity and do not briefly clear a valid draft because of
  whitespace in saved layout state.
- Restored global and project scheduled task drafts also resync from the latest
  task list whenever that list changes, even when the selected task id is
  unchanged, so external edits or scheduler refreshes do not leave stale form
  contents visible.
- If a persisted global or project scheduled task selection no longer exists
  after task lists load, the Tasks page clears both the selected layout id and
  the matching edit draft, so deleted tasks do not leave stale editable forms
  behind.
- Saving a global or project scheduled task selects the saved task returned by
  the runtime, keeps the edit form bound to its generated id, and persists the
  selected-task layout so Run now, Pause/Resume, Remove, and later edits can
  act on the task immediately after creation or update.
- Global scheduled task Save keeps the visible disabled validation state but
  routes stale clicks through the save handler, so invalid schedule or missing
  prompt races show scheduled-task feedback instead of silently doing nothing.
- Session-bound native lifecycle actions also stop at visible guidance without
  creating misleading drafts: New Team and New Project Scheduled Task report
  that a project session is required when invoked from menus or shortcuts before
  a workspace is selected.
- Project scheduled task Pause/Resume keeps Claude Code's native
  `.kode/scheduled_tasks.json` schema unchanged. Paused tasks move to the
  desktop sidecar `.kode/scheduled_tasks.paused.json`; Resume moves them back
  into the active native task file.
- Project scheduled task Pause/Resume actions use the same synchronous guard as
  other task lifecycle actions, so rapid repeated clicks submit one pause or
  resume operation.
- Project scheduled task Pause/Resume also reloads the updated task into the
  project task draft and persists its selected layout id, so the Tasks page
  remains focused on the lifecycle item that just changed.
- Global scheduled task Pause/Resume uses explicit `tasks:pause` and
  `tasks:resume` IPC lifecycle actions, matching project scheduled task
  lifecycle management instead of rewriting task payloads through Save.
- Global scheduled task Pause/Resume also reports a required-selection error
  before updating task state when a stale row event has no task id.
- Global scheduled task Pause/Resume trims the row task id before building the
  pending-action key, update payload, edit-draft match, and success feedback, so
  whitespace in stored task metadata cannot split lifecycle targets.
- Global scheduled task Pause/Resume also reloads the updated task into the
  global task draft and persists its selected layout id, matching the project
  scheduled task lifecycle behavior.
- Project scheduled task Pause/Resume also reports a required-selection error
  before updating task state when a stale project row event has no task id.
- Project scheduled task Save, Remove, and Pause/Resume actions snapshot the
  active session and ignore stale async results after a session switch, so task
  rows and lifecycle statuses cannot be repopulated from the previous
  workspace. They re-check the active session after workspace refresh before
  reporting lifecycle success.
- Global and project scheduled task option identifiers encode task ids before
  wiring them to ARIA selection state, so user-authored ids with separators or
  spaces do not break list navigation.
- Those option identifiers and list row render keys use trimmed task ids, so
  keyboard selection, restored layout state, and React row reconciliation share
  the same canonical task identity.
- Global and project scheduled task Run now actions show local queued status,
  send one prompt into the active session even under rapid repeated clicks, and
  are covered by `rapidScheduledRunNowGuard` and
  `rapidProjectScheduledRunNowGuard`.
- Global and project scheduled task Run now actions snapshot the active session
  and ignore stale send feedback after a session switch, so a task queued in one
  conversation cannot report success in a newly focused Tasks page.
- Global and project scheduled task Run now actions also reload the queued task
  into the matching edit draft and persist its selected layout id before success
  feedback, so Pause/Resume, Remove, or later edits stay on the task that just
  ran.
- Global and project scheduled task Run now also report the missing session
  prerequisite before checking runtime busy/enabled state or sending the prompt,
  so stale task rows do not silently fail after the project session disappears.
- Global and project scheduled task Run now also report a required-selection
  error before checking runtime busy/enabled state or sending the prompt when a
  stale task row event has no task id.
- Global and project scheduled task Run now also require a task prompt before
  sending, so stale or corrupted task rows cannot submit an empty Claude request.
- Global scheduled task Run now trims the row task id and prompt before building
  the pending-action key and queuing the runtime request, so whitespace in
  stored task metadata cannot split duplicate-run guards or send padded prompts.
- Project scheduled task Run now trims the row task id and prompt before
  building the session-bound pending-action key and queuing the workspace
  runtime request, matching global scheduled task Run now normalization.
- Scheduled task save, remove, pause/resume, and Run now actions snapshot
  whether they were launched from Tasks or Settings, then return async feedback
  to that origin surface so lifecycle results do not appear on a page the user
  navigated to later.
- Global and project scheduled task Run now actions stay disabled while the
  active Claude turn is sending, streaming, or waiting for permission, matching
  the composer Send guard instead of queuing prompts into a busy turn;
  `scheduledRunNowTurnBusyGuard` confirms this busy-turn boundary.
- Global and project scheduled task Run now actions stay disabled for paused
  tasks, so Pause remains a lifecycle boundary for both automatic and manual
  scheduled task execution.
- Their Run now click handlers also re-check the enabled state, runtime
  availability, and loading state. Global Run now routes stale clicks through
  the runtime handler while preserving the visible disabled state, so missing
  sessions, paused tasks, and busy turns show scheduled-task feedback instead
  of silently doing nothing after disabled state changes.
- Project scheduled task row Edit, Pause/Resume, Run now, and Remove buttons
  route stale clicks through the same lifecycle handlers as row selection and
  command-palette actions, so missing sessions, missing task ids, paused tasks,
  and busy turns surface scheduled-task feedback while the disabled controls
  still communicate unavailable actions.
- Removing a global or project scheduled task that is currently being edited
  clears the edit form and returns the Add button to its disabled empty state;
  `scheduledTaskDeleteClearsDraft` and
  `projectScheduledTaskDeleteClearsDraft` cover both scopes.
- Global and project scheduled task Remove actions show local success feedback
  and use per-task pending guards from confirmation through deletion, so rapid
  repeated clicks do not open duplicate destructive confirmations or submit
  duplicate deletes.
- Global scheduled task Remove also reports a required-selection error before
  opening a destructive confirmation when a stale row event has no task id.
- Global scheduled task Remove trims the row task id before building the
  destructive confirmation, pending-action key, IPC delete request, edit-draft
  cleanup, and success feedback, so whitespace in stored task metadata cannot
  create mismatched removal targets.
- Project scheduled task Remove also reports the missing session prerequisite
  before opening a destructive confirmation, so stale project rows do not
  silently no-op or ask for confirmation after the project session disappears.
- Project scheduled task Remove also reports a required-selection error before
  opening a destructive confirmation when a stale project row has no task id.
- Project scheduled task Remove trims the row task id before building the
  destructive confirmation, pending-action key, workspace delete request,
  edit-draft cleanup, and success feedback, matching global task removal target
  normalization.
- Removing, pausing, or resuming a missing scheduled task is rejected with a
  visible not-found error instead of reporting a lifecycle success for an absent
  task.
- Project scheduled task Pause/Resume also reports the missing session
  prerequisite before calculating the next lifecycle state or calling workspace
  IPC, so stale project rows do not silently fail after session state is
  cleared.
- Project scheduled task Pause/Resume trims the row task id before building the
  pending-action key, workspace pause/resume request, and success feedback, so
  whitespace in stored project task metadata cannot split the lifecycle target.
- Global Pause/Resume uses the same id-bound update path, so stale rows cannot
  recreate a removed task when toggling enabled state.
- Project scheduled task empty states use the same structured icon, title, and
  next-step guidance pattern as the rest of the desktop workspace, including
  after the last project task is removed.
- The Tasks page Project/Global jumpbar routes through named task section
  handlers and uses the same section-opening path as command-palette lifecycle
  actions, so switching scheduled-task sections shows local status feedback and
  marks the active Project/Global section instead of silently scrolling.
- Project and global scheduled task rows are exposed as selectable listbox
  options, with the currently edited task reflected as the selected lifecycle
  row for keyboard and assistive workflows. Clicking a task row or pressing
  Enter/Space while it is focused loads the task into the edit form through
  `handleProjectScheduledTaskRowKeyDown` or `handleScheduledTaskRowKeyDown`,
  while row action buttons stop pointer and keyboard bubbling so Pause/Run/Remove
  do not also select the row.
- Scheduled task rows and their Edit buttons become disabled while a desktop
  action is loading, so lifecycle work cannot silently switch the edit draft or
  keyboard focus through a stale row.
- Global and project scheduled task Save, Cancel edit, row select, Edit,
  Pause/Resume, Run now, and Remove shortcuts route through named lifecycle
  handlers before reaching the task mutation functions, so stale row clicks
  reuse the same loading, validation, session, runtime, and destructive
  confirmation feedback paths as the first-class Tasks page forms.
- Global and project scheduled task edit handlers also report a
  required-selection error before mutating edit drafts or selected-task layout
  when stale rows have no task id.
- Global and project scheduled task Edit, Cancel edit, and New draft actions
  persist selected-task layout through the session that opened the draft, while
  Global scheduled task drafts still work without an active project session.
  This keeps synchronous task form changes from rewriting another workspace
  after session focus changes.
- Global scheduled task Edit trims the row task id before writing the draft,
  selected layout identity, and editing feedback, so whitespace in stored task
  metadata cannot persist a mismatched selected task.
- Project scheduled task Edit trims the row task id before writing the draft,
  selected layout identity, and editing feedback, matching global scheduled
  task edit normalization.
- Global and project scheduled task selected rows and restored drafts compare
  task ids after trimming whitespace, so persisted layout selections continue
  to highlight and reload the intended task after config refreshes.
- If a persisted global or project scheduled-task selection no longer exists
  after task lists load, the restore path clears that layout id instead of
  retrying a stale selection on every focus or refresh.
- Project scheduled task rows still show disabled state and leave the keyboard
  order without an active project session, while row selection and row-level
  Edit, Pause/Resume, Run now, and Remove events route through their lifecycle
  handlers. The controls keep their disabled session state, but stale events now
  surface the existing Tasks error instead of silently doing nothing after
  session state is cleared.
- The project scheduled task edit handler also re-checks the active session
  before writing the edit draft or selected task layout, so direct stale events
  cannot restore project task state on the no-session Tasks page and report the
  missing session prerequisite in the active Tasks or Settings surface.
- Agents, Teams, and Tasks pane jumpbars expose the active section through both
  the visible active style and `aria-current`/`aria-pressed`, so restored
  first-class lifecycle pages have the same navigable state model as the
  primary rail and grouped Settings sidebar.

## Agents And Teams

- The Agents page lists active/all agents through `claude agents --json` when
  available, with filesystem fallback for user and project agents.
- With no active project session, the Agents catalog empty state points users to
  Refresh for built-in and user agents instead of requiring a project session.
- Agents shows source counts that distinguish built-in read-only agents from
  editable user/project custom agents.
- The selected agent catalog card exposes both the visible active style and
  `aria-current`, so the available-agent list has a semantic current item after
  users choose an agent. Clicking an agent row or pressing Enter/Space while it
  is focused selects the agent through `handleAgentCatalogRowKeyDown`, while
  row action buttons stop pointer and keyboard bubbling so Diagnose does not
  also trigger a second row selection.
- Agent catalog row clicks plus Select and Diagnose buttons route through named
  Agents handlers and mirror the same loading guard. Diagnose keeps its
  disabled session state but stale clicks still flow through the
  selection/diagnose path, so missing project-session prerequisites surface as
  Agents-pane errors instead of silently doing nothing.
- Agent catalog selection trims the agent type before storing selected identity,
  active-row state, launch drafts, editor drafts, layout, and feedback text, so
  malformed catalog rows with surrounding whitespace do not leak into later
  agent lifecycle commands. Diagnostics also include the selected agent type and
  source so support bundles can reconstruct which Agents page card was active.
- Agent catalog selection persists selected agent identity through the session
  that was active when the row was selected, while still allowing user-level
  selection without a project session, so late selection persistence cannot
  rewrite a newly focused workspace.
- After an Agents list refresh succeeds, a persisted selected agent type that
  no longer exists clears the selected-agent state, launch draft target, and
  session layout, and moves any composer target for that agent back to the
  session, so restored Agents pages do not keep acting on stale catalog
  entries.
- If the persisted selected agent source disappears but the same agent type is
  still available from another source, the refresh normalizes the selected
  source, launch draft target, composer target, and session layout to that
  fallback agent instead of leaving the restored Agents page pointed at a
  non-existent override.
- Session restore gives a persisted selected team priority in the composer, but
  when no team is selected it restores the composer target to the persisted
  selected agent so reopening an Agents-focused session keeps sending to that
  agent instead of silently falling back to the session.
- Agent catalog search supports ArrowUp/ArrowDown, Home/End, and Enter. Enter
  selects the highlighted agent, falling back to the first visible result after
  filtering so the search box never silently ignores a filtered match. The same
  keyboard path stays inert while the desktop is loading, matching the disabled
  catalog rows.
- Agent catalog and Team list option identifiers encode user/project-provided
  source, agent type, and team name segments before wiring them to ARIA
  selection state, so names with spaces or separators do not break navigation.
- Agent catalog option identifiers and render keys use the trimmed agent type,
  so restored selected-agent state, keyboard navigation, accessibility state,
  and React row reconciliation all follow the same canonical identity.
- User and project agents can be created, edited, diagnosed, and deleted from
  the GUI.
- Starting a new agent draft clears the persisted selected-agent identity and
  moves an agent-targeted composer back to the session, matching Team draft
  creation so draft setup cannot keep sending prompts to the previously
  selected agent.
- Agent editor New, Save, and Delete buttons route through named Agents
  handlers. Save keeps its disabled draft-prerequisite state but validates
  project-session, agent type, when-to-use, and prompt fields inside
  `saveAgentDraft`, while Delete routes stale clicks through
  `deleteSelectedAgent` so missing project-session or selected-agent
  prerequisites surface as Agents-pane errors before any confirmation prompt
  opens.
- Selected user custom agents can be loaded into the editor without an active
  project session, while project overrides and runtime actions still require a
  session.
- Selected-agent card deletion uses the selected card's source rather than the
  editor draft source for its session prerequisite, so a stale project draft
  cannot block deleting an editable user agent without an active project
  session.
- Project agent List/Diagnose/Save/Delete verifies `.kode/agents` and target
  markdown files stay inside the selected workspace and rejects symlinked agent
  directories, so agent management cannot read, write, or remove files outside
  the project.
- Agent editor Save/Delete actions use synchronous guards, and Delete is guarded
  before confirmation opens, so rapid repeated clicks cannot duplicate
  filesystem writes, destructive confirmations, or delete requests before
  disabled state renders.
- Agent editor Save/Delete buttons also mirror their source/session, required
  field, and deletable-draft prerequisites inside click handlers, so stale
  editor events cannot save invalid drafts or open delete confirmation after
  the visible disabled state changes.
- Agent editor Delete also reports an Agents-pane prerequisite error before
  opening confirmation when the draft no longer has an agent type.
- Deleting a missing user or project agent is rejected with a visible not-found
  error instead of creating project agent directories or reporting false
  success.
- Agent diagnostics jump directly to the relevant Settings MCP or Skills
  section through named setup handlers when required setup is missing. The
  shortcuts are disabled while loading, so readiness checks cannot rewrite
  Settings drafts or navigate during lifecycle feedback.
- Agents, Teams, and Scheduled Tasks jumpbar buttons are marked disabled and
  removed from the tab order while loading, so section changes cannot race
  lifecycle refresh or save feedback.
- Agents/Teams Refresh routes stale toolbar clicks through the refresh handler;
  Teams-page active-session prerequisites surface as Teams-pane errors while
  the Agents page can still refresh user agents without a project session.
- Agents/Teams pane toolbar Refresh and section jumpbar buttons now route
  through named lifecycle handlers, so loading guards, persisted section
  updates, and Teams session prerequisites stay consistent with the first-class
  page commands.
- Newly saved user/project agents remain selected and immediately deletable
  even when the CLI catalog does not echo them back in the same refresh.
- Built-in/read-only agents show an editor note and keep destructive actions
  disabled unless the selected agent is an editable user/project agent.
- Project agent Save/Delete handlers report an Agents-pane error when the
  project session is gone, while user custom agents remain manageable without
  an active project session.
- Agent launch forms disable task launch until an agent type, description, and
  prompt are present, with inline guidance before runtime submission.
- Agent launch IPC validation and prompt building also require the selected
  agent type, so stale or external launch calls cannot queue a generic Agent
  task that bypasses the first-class Agents page prerequisites.
- Agent launch draft fields also require an active project session before
  accepting edits, so session-bound runtime launch forms cannot be filled into
  an unusable state from the global no-session surface.
- The disabled Agent launch form shows inline session guidance, so the Run
  section explains why project-bound launch controls are inert when no project
  session is active.
- Agent launch, editor, and task-resume draft fields are disabled during active
  desktop loading, and New Agent draft clearing is inert while loading, so
  runtime launches and agent saves cannot race against visible draft edits.
- The New Agent editor button also re-checks loading state before clearing the
  current draft.
- Agent session creation and task launch use synchronous guards so rapid
  repeated clicks do not create duplicate agent sessions or launch prompts.
- Agent launch form buttons also re-check active-session, selected agent type,
  and task-launch prerequisites in their click handlers, so stale form events
  cannot create an agent session or queue a task after the visible disabled
  state changes.
- The Run agent New agent session button keeps its disabled session/type state
  but routes stale clicks through the create-session handler, so missing
  session or agent-type prerequisites surface as Agents-pane errors instead of
  silently doing nothing. The Launch task button keeps its disabled
  task-prerequisite state but routes stale clicks through `launchAgentTask`, so
  missing session, busy-turn, agent-type, description, and prompt prerequisites
  surface as Agents-pane feedback instead of silent no-ops.
- Selected Agent Diagnose, New session, Prepare task, and Edit/Override
  controls keep their disabled active-session/editability state but route stale
  clicks directly through their runtime or editor handlers, so missing
  project-session or selected-agent prerequisites surface as Agents-pane errors
  instead of silently doing nothing.
- Stale selected-agent Diagnose events and direct diagnose-by-type calls report
  an Agents-pane error when the project session is gone instead of silently
  ignoring the diagnostic request.
- Stale selected-agent Diagnose events also report an Agents-pane prerequisite
  error when the selected agent identity is gone before diagnostic IPC starts.
- Stale agent-session creation events from either the Run form or selected
  agent card report an Agents-pane error when the project session is gone
  instead of silently ignoring the create request.
- Stale selected-agent Prepare task events now report an Agents-pane error when
  the project session is gone instead of silently ignoring the click.
- Selected agent runtime actions show inline session guidance when no project
  session is active, so disabled Diagnose, New session, and Prepare task
  controls explain their missing prerequisite from the selected-agent card.
- Selected Agent Edit/Override keeps its disabled editable-agent state but
  routes stale clicks through the edit handler, which mirrors the prerequisite
  checks so stale selected-agent controls report Agents-pane errors instead of
  loading an unsavable project override after the active workspace disappears.
- Selected Agent Delete keeps its disabled deletable-agent state but routes
  stale clicks through the delete handler, so missing project sessions or stale
  selected-agent identities surface as Agents-pane errors before confirmation.
- Agent session creation, task launch, output preview/read, stop, and resume
  actions snapshot the active session and ignore stale async results after
  switching sessions, so old runtime responses cannot switch focus, clear
  prompts, or overwrite Agents status in the newly focused workspace.
- Agent task output preview/read, stop, and resume handlers report an
  Agents-pane error when their active session is gone instead of silently
  ignoring stale runtime controls.
- Agent task output preview/read, stop, and resume handlers also report an
  Agents-pane required-selection error before busy, prompt, or IPC work when a
  stale task control has no task id.
- Agent task output preview/read, stop, and resume handlers trim task ids
  before runtime action keys, IPC payloads, local preview updates, and success
  feedback, so whitespace in task metadata cannot queue or update the wrong
  task identity.
- Agent task output preview/read, stop, and resume handlers also persist the
  selected task id before success feedback, so follow-up task controls and
  support diagnostics stay focused on the task that was just managed.
- The Agents Running tasks list reflects that selected task id with
  `aria-selected` and the shared selected-row treatment, so restored or
  recently managed task context is visible before the next lifecycle action.
- When the selected Agent task disappears from the current session task list,
  the persisted selected task id is cleared through that session, so restores
  and diagnostics do not keep pointing at a stale runtime item and delayed task
  list refreshes cannot clear another workspace's selected task layout.
- Agent task Resume also reports an Agents-pane required-field error before
  busy/runtime guards when the follow-up prompt is empty.
- The Agents Running tasks section uses the shared icon, title, and next-step
  empty-state treatment when no structured task events have been seen.
- Agent task launches, agent task runtime controls, and team runtime controls
  stay disabled while the active Claude turn is sending, streaming, or waiting
  for permission, so the Agents pane cannot queue overlapping runtime prompts.
- Agent sessions and background agent task actions are routed through the
  existing runtime by sending structured prompts for Agent, TaskOutput,
  TaskStop, SendMessage, TeamCreate, and TeamDelete tools.
- The chat composer can route a prompt to the active Claude session, send a
  team message, or launch a task for a selected agent from the same input area.
- Typing `@` in the chat composer opens a resource menu backed by the current
  file tree, teams, agent catalog, installed skills, and configured MCP
  servers; typing `/` opens action shortcuts that either insert concrete prompts
  or execute safe local pane actions.
- The `/` menu also discovers user and project custom slash commands from
  `~/.kode/commands/**/*.md` and `.kode/commands/**/*.md`, showing them as
  `/user:name` or `/project:group:name` entries. Symlinked command files and
  directories are skipped before anything is exposed to the renderer. Command
  path segments must be made from letters, numbers, `.`, `_`, or `-`; entries
  with whitespace, control characters, or delimiter characters are skipped.
- Workflow markdown files are also loaded as prompt commands from
  `~/.kode/workflows/**/*.md` and `.kode/workflows/**/*.md`. Project
  workflows sort before user workflows, nested directories become colon
  namespaces such as `/review:security`, frontmatter descriptions,
  `argument-hint`, `arguments`, and `allowed-tools` are preserved, and command
  execution substitutes `$ARGUMENTS` or declared named arguments into the
  markdown prompt body.
- The desktop composer `/` menu and command palette include those workflow
  prompts alongside custom slash commands. Workflow entries keep their
  Claude-style slash text without a user/project prefix, show Workflow scope
  metadata when no description is present, and use kind/scope/name option ids
  internally so same-named user and project workflows do not collide in
  keyboard navigation.
- Workflow prompt-command loading is not tied to the legacy
  `WORKFLOW_SCRIPTS` local command gate, so entries shown in the desktop menus
  resolve through the normal slash-command runtime even when the separate
  `/workflows` management command is not compiled in.
- When project and user workflows produce the same slash name, the project
  workflow shadows the user workflow in both the runtime command list and the
  desktop composer/command-palette menus, so the UI only shows entries that can
  be executed unambiguously.
- The `/` action menu also exposes first-class lifecycle and settings shortcuts:
  New custom agent, New team, global/project scheduled task drafts, Add MCP,
  user/project skill install, plugin listing, and Settings refresh route through
  the same page sections and handlers as the command palette.
- Workspace-scoped composer actions stay visible while prerequisites are not
  satisfied, but show a disabled reason and remain inert for both pointer and
  keyboard selection until the active session and current loading state allow
  them to run. When the desktop is already processing another action, every
  open composer menu option is marked unavailable with the active loading reason
  so stale pointer or keyboard selection cannot mutate the prompt.
- Composer menu pointer selection routes through
  `handleComposerMenuItemMouseDown`, so the prevent-default behavior and
  disabled/loading guard stay with the same menu-selection path as keyboard
  activation.
- Composer team/agent target selectors are disabled and guarded while loading,
  and route changes through named target handlers, so an active send or
  lifecycle action cannot silently retarget the next message.
- Composer Send keeps its disabled session/input/busy state but routes pointer
  clicks through `handleComposerSendClick` before the message handler, so a
  missing active session surfaces as a conversation notice instead of silently
  doing nothing.
- Composer `@` and `/` menus keep a selected option with synchronized
  `aria-selected` and `aria-activedescendant` state. The focused textarea also
  advertises the popup listbox through `aria-controls`, `aria-expanded`, and
  the same active descendant target. `handleComposerKeyDown` keeps
  ArrowUp/ArrowDown/Home/End keyboard movement, Enter selection, Escape trigger
  closing, and ordinary composer submission on the same guarded textarea path.
- Composer `@` and `/` menus show a compact structured empty state when the
  current query has no matches instead of collapsing to a bare text row.
- The command palette uses the same structured no-match treatment with an icon,
  title, and next-step hint instead of a single placeholder line.
- Command palette search input changes route through
  `handleCommandPaletteQueryChange`, so loading guards and status clearing stay
  on the same focused search path as command execution.
- Settings search keeps the live result count in its status row and shows a
  structured no-match state in the navigation list when every grouped setting
  is filtered out.
- Settings search input changes route through `handleSettingsSearchChange`, so
  loading guards stay on the same focused navigation path as keyboard movement.
- Agent catalog query and source filter edits route through focused handlers,
  so the Agents page keeps loading guards beside row selection and diagnostics
  actions instead of scattering state mutation in the JSX.
- Agent launch draft edits route through dedicated handlers, keeping session
  and loading guards centralized for the first-class Agents run form.
- Agent editor draft edits route through dedicated handlers, so custom agent
  lifecycle fields keep validation and loading guards out of inline JSX.
- Agent task resume prompt edits route through `handleAgentTaskPromptChange`,
  keeping the no-session guard on the same lifecycle path as Stop and Resume.
- Team draft edits route through dedicated handlers, so the first-class Teams
  page keeps session and loading guards outside inline form mutation.
- Project and global scheduled task draft edits route through dedicated
  handlers, keeping task lifecycle form guards out of inline JSX mutation.
- Proxy draft edits route through dedicated handlers, keeping grouped Settings
  configuration guards out of inline JSX mutation.
- Skill editor name, scope, and contents edits route through dedicated handlers,
  so direct Skills management keeps loading and project-session guards outside
  the JSX field bodies.
- Plugin package and install-scope edits route through dedicated handlers, so
  direct Plugins management clears stale selection and applies session guards
  from one focused path.
- MCP draft name, scope, and transport mode edits route through dedicated
  handlers, keeping direct MCP management guards out of the JSX field bodies.
- MCP command, argument, remote transport type, and remote URL edits now use
  the same dedicated-handler pattern so project-session and loading guards stay
  centralized across all MCP draft fields.
- Composer menu option identifiers encode the item id instead of using row
  indexes, so resource/action active-descendant targets stay stable when
  filtering, disabled states, or menu contents change.
- Composer resource insertion uses the latest textarea value and consumes
  existing separator whitespace, so clicking a suggestion cannot duplicate
  spaces or replace text based on a stale trigger.
- Selected project skill details show inline session guidance when the project
  session is missing, so disabled Edit controls explain why project skill
  contents cannot be modified from the global Settings surface.
- Session creation and session row management menus keep the same selected-item
  keyboard behavior, so the sidebar can be operated without pointer-only menu
  actions.
- Agent task state, output previews, team summaries, and agent/team permission
  context are surfaced in the desktop session state.
- Agent task actions for reading output, previewing output files, resuming a
  task, and stopping a task show local result feedback; previewed output is
  rendered inline and successful resume clears the follow-up prompt.
- The follow-up prompt field is disabled without an active project session, so
  Resume text stays tied to a runnable session instead of the global no-session
  Agents surface.
  `agentTaskActionIcons` and `agentTaskActionFeedback` confirm those actions
  are visible icon controls with local status.
- Agent task controls use per-session, per-task synchronous action guards so
  rapid repeated Read output, Resume, or Stop clicks do not duplicate runtime
  requests; `rapidAgentTaskActionGuard` covers repeated task actions.
- Agent task row actions mirror their disabled prerequisites inside the click
  handlers for runtime-bound Read output, Resume, and Stop actions; Read
  output, Resume, and Stop keep their disabled runtime state, and Preview file
  keeps the disabled session/output-file state. Each row button routes through
  a named handler so stale clicks surface missing sessions, busy turns, stale
  task ids, or missing resume prompts as Agents-pane errors instead of silent
  no-ops.
- Agent catalog refresh surfaces CLI `failedFiles` as a partial workspace
  warning instead of silently hiding broken agent definitions.
- Agents Refresh uses a synchronous renderer guard, so rapid repeated Refresh
  clicks do not duplicate agent/team refresh work.
- Agents/Teams Refresh snapshots whether it was launched from Agents or Teams
  before async IPC starts, then reports completion to that origin page so a
  refresh started in Teams cannot later write success feedback into Agents.
- Generic async action failures snapshot the active workspace pane before the
  action starts, then route pane-level error feedback to that origin pane so
  navigation during the action cannot surface the failure on an unrelated pane.
- Agent diagnostics use per-session/agent synchronous guards, so rapid repeated
  Diagnose clicks do not duplicate readiness checks or overwrite diagnostics
  feedback out of order. `agentDiagnosticActionIcons` confirms diagnostic
  actions are exposed as proper controls.
- Agents Refresh, Diagnose, Save, and Delete snapshot the active session and
  ignore stale async results after switching sessions, so one workspace cannot
  overwrite another workspace's agent list, diagnostics, editor draft, or
  lifecycle status.
- Agent Save also persists the saved agent identity into session layout after
  the renderer selection updates, so the Agents page can restore the newly
  saved user/project custom agent after a session switch or restart.
- Agent Save/Delete and task Read/Preview/Stop/Resume actions persist selected
  agent or task layout through the session that started the async action, so
  switching sessions mid-action cannot rewrite the newly focused workspace's
  selected agent or task context.
- The selected-agent summary exposes the next lifecycle actions directly:
  diagnose readiness, create a dedicated agent session, prefill the task runner,
  load the custom-agent editor as an editable agent or project override, or
  delete editable user/project agents without first loading them into the editor.
- Deleting the selected agent also moves any composer target for that agent to
  the available same-type fallback agent or back to the session before reporting
  success, so follow-up prompts cannot keep targeting a deleted custom agent.
- Team management is a first-class primary page labelled Teams. A team is
  presented as a container with visible teammate rows; selecting a teammate
  fills the real TeamMessage recipient path.
- Team cards with no reported teammates use the shared structured empty-state
  treatment, so an empty team still shows the next useful action instead of a
  bare placeholder line.
- The selected team card exposes both the visible active style and
  `aria-current`, so team selection is discoverable to assistive navigation and
  consistent with the selected agent catalog state.
- The Teams list is exposed as a selectable listbox with one option per team,
  so the same selected team state is available to keyboard and assistive
  workflows. Clicking a team row or pressing Enter/Space while it is focused
  selects the team through `handleTeamRowKeyDown`, while teammate rows and team
  action buttons stop pointer and keyboard bubbling so member/message/shutdown
  controls do not also trigger row selection.
- Team cards expose direct Message all and Delete team actions. Delete can run
  from the selected card target without first copying that team into the draft
  form, while still using the shared confirmation, duplicate-submit guard,
  runtime IPC, team refresh, and selected-team layout cleanup. Card deletion
  only clears the Team draft when that draft targets the deleted team, so
  editing a different team is not interrupted. It also only clears the saved
  selected-team layout when the deleted team was the selected team, and moves
  the composer to the persisted selected agent or session before reporting
  success so follow-up prompts cannot keep targeting a deleted team.
- Team selection trims the team name before updating the selected-card state,
  action draft, chat target, session layout, and Teams feedback, so malformed
  team rows with surrounding whitespace do not leak into later team lifecycle
  commands.
- After a Teams list refresh succeeds, a persisted selected team that no longer
  exists clears the action draft and session layout, then moves the composer
  from that stale team to the persisted selected agent when one exists or back
  to the session otherwise, so restored Teams pages do not keep targeting stale
  team state while preserving the Agents page target.
- Team creation selects the newly created team in the action draft, resets the
  message recipient to `*`, updates the composer team target, and persists the
  selected-team layout before reporting success, so follow-up team messages use
  the team that was just created.
- Teams form Create, Spawn teammate, Send, Shutdown, and Delete keep their
  disabled runtime/destructive state, and stale form clicks route through named
  form handlers before reaching `createTeam`, `spawnTeamTeammate`,
  `sendTeamMessage`, `requestTeamShutdown`, or `deleteTeam`, so missing
  sessions, busy turns, incomplete fields, or destructive prerequisites surface
  as Teams-pane feedback instead of silent no-ops.
- Team member Shutdown icon buttons keep their disabled runtime state, but
  stale row clicks route through `requestTeamMemberShutdown`, which normalizes
  the row team, teammate, and reason before reusing `requestTeamShutdown` so
  member-scoped shutdown errors use the same Teams-pane feedback path as the
  form action.
- Teams row and member shortcuts route through named row handlers before
  selecting teams, preparing teammate or broadcast messages, requesting member
  shutdown, removing members, or deleting teams, so stale card clicks reuse the
  same Teams-pane prerequisite and destructive confirmation paths as the form
  actions.
- Starting a new Team draft clears the persisted selected-team layout and moves
  the composer back to the session target before showing the ready status, so a
  clean team form cannot keep acting on the previously selected team.
- Team listbox option ids and render keys also use the trimmed team name, so
  accessibility state and row reconciliation follow the same canonical identity
  as selection and messaging.
- Team teammate-message and broadcast shortcuts also trim team and teammate
  names before updating the action draft, chat target, and Teams feedback, so
  row-level messaging shortcuts stay aligned with the normalized selected team.
- Teams persists as its own `activePane: "teams"` layout state instead of
  piggybacking on the Agents pane. Stored legacy layouts with
  `activePane: "agents"` plus Teams/Teammates primary view are normalized to the
  Teams pane on restore.
- Teams also persists `teamsActiveSection` independently from
  `agentsActiveSection`, so first-class Teams navigation can restore and update
  its lifecycle section without mutating the Agents page state.
- Teams consumes pending pane-section navigation when the first-class page
  mounts, matching Agents, so command palette and composer shortcuts land on
  the requested lifecycle section instead of only switching the primary page.
- Teams keeps a dedicated local status channel in the Teams pane, so team
  selection, refresh, create, message, teammate spawn, shutdown, member remove, and delete
  feedback is not reported through the Agents pane.
- Stale Teams create, message, teammate spawn, shutdown, member remove, and
  delete controls report a Teams-pane error when their active session is gone
  instead of silently ignoring the lifecycle request.
- Teams rows keep their disabled state and keyboard removal without an active
  session, while stale row selection, teammate inline selection, and
  teammate/broadcast message preparation handlers report through the Teams pane
  before mutating drafts or composer routing.
- Team create/update writes a durable project-scoped
  `.kode/teams/<name>/config.json` record with desktop backend metadata,
  active status, and a configured lead member when a lead agent type is
  provided. Teammate spawn upserts a member row into that same workspace record
  after the Agent runtime request is queued. Member remove deletes stale local
  membership rows from the same workspace config without pretending to stop a
  running agent, and team delete removes the local record after the runtime
  delete request is queued. Deleting a missing local or project team record is
  rejected with a visible not-found error instead of reporting false success.
  Team reads and writes
  reject symlinked workspace team directories so project team state cannot
  escape the selected workspace.
- Team cards include direct Message all and teammate Message actions that select
  the team target, fill `*` or that teammate as the recipient, and focus the
  TeamMessage composer before the existing Send action writes to the runtime;
  `teamSelectActionIcon` confirms the team selection action is exposed as a
  proper icon control.
- Team card selection, teammate recipient selection, and Message all shortcuts
  stay disabled without an active session or while a desktop action is loading.
  Row selection and teammate recipient selection route through Teams handlers
  that guard session/loading before mutating drafts, while row action buttons
  also route stale clicks through their Teams handlers so missing prerequisites
  surface as pane errors instead of silently doing nothing.
- Team card selection, teammate recipient selection, and Message all shortcuts
  also trim row-level team and teammate names and report required-selection
  errors before mutating drafts or chat targets when stale rows have no team or
  teammate name.
- Teams can spawn a teammate through the existing Agent runtime path by sending
  an Agent tool prompt with `team_name`, teammate `name`, optional `mode`, and
  the teammate task prompt; this avoids inventing a separate unsupported member
  mutation API.
- Teammate rows expose a direct shutdown action that uses the existing
  TeamShutdown runtime path for that member, so member lifecycle controls live
  on the member row instead of only in the Teams form.
- Teammate shutdown trims team, teammate, and reason fields before building
  the runtime action key, IPC payload, and success feedback, so form and row
  shortcuts target the same normalized teammate identity.
- Teammate rows also expose a confirmed Remove action that updates the durable
  local team config and refreshes the visible member list.
- Teammate row Shutdown and Remove shortcuts keep their disabled state, and
  Remove routes stale clicks through the confirmed remove handler so missing
  session or teammate prerequisites surface as Teams-pane errors instead of
  silently doing nothing.
- Teammate row Message and Remove icon buttons also route stale clicks directly
  through the Teams message-preparation and member-removal handlers, so missing
  active session, team, or teammate prerequisites are reported in the Teams pane
  instead of being swallowed by inline button guards.
- Team create, teammate spawn, teammate message, shutdown request, confirmed member
  remove, and team delete actions show local result feedback in the Teams pane;
  message, teammate spawn, and shutdown inputs clear after successful sends.
- Team create, teammate spawn, teammate message, shutdown request, confirmed
  member remove, and selected-team delete actions persist selected team layout
  through the session that started the async lifecycle action, so switching
  sessions mid-action cannot rewrite the newly focused workspace's team target.
- Team selection, teammate selection, message preparation, broadcast
  preparation, and New team draft clearing also persist selected team layout
  through the session that triggered the synchronous action, so quick Teams page
  navigation cannot rewrite another workspace's team target.
- Successful team message sends keep the normalized team and recipient selected,
  move the composer to that team target, and persist the selected team layout so
  the next message or lifecycle action continues in the same team context.
- Successful teammate spawn also selects the target team, points the Teams
  recipient at the new teammate, moves the composer to that team target, and
  persists the selected team layout so follow-up message or shutdown actions can
  continue without reselecting the team.
- Successful teammate shutdown requests keep the normalized team and teammate
  selected, move the composer to that team target, and persist the selected team
  layout so follow-up status checks or member actions stay on the same team.
- Removing a teammate keeps the normalized team selected, moves the composer to
  that team target, clears the removed teammate only when it was the current
  recipient, and persists the selected team layout for follow-up member actions.
- Team and teammate recipient selections persist both the selected team and the
  selected recipient (`*` or a teammate name) in session layout, restore that
  Teams form context after session switches, and include the recipient in
  diagnostics so Teams lifecycle state is auditable.
- Team list refresh also validates the restored recipient against the selected
  team's current member list; if that teammate disappears, the Teams form and
  layout fall back to `*` while keeping the team selected.
- Teams draft fields are disabled during active desktop loading, so team
  runtime requests cannot race against visible form edits.
- The disabled Teams form shows inline session guidance, so the first-class
  Teams page explains why project-bound team controls are inert when no project
  session is active.
- Teams Create and Delete buttons keep their disabled session/name state but
  route stale clicks through the Teams handlers, so missing session or team
  name prerequisites surface as pane errors instead of silently doing nothing.
- Team card Select, Message all, and Delete team buttons keep their disabled
  session state but route stale clicks directly through the Teams selection,
  broadcast, and delete handlers, so missing session or team-name prerequisites
  surface as pane errors while the card controls still communicate unavailable
  actions.
  Spawn, Send, and Shutdown still re-check runtime-queue and required draft
  prerequisites inside click handlers, so stale form events cannot queue
  invalid runtime work after the visible disabled state changes.
- Team message send also reports a Teams-pane required-field error before
  checking runtime busy state or queueing IPC, so stale Send events cannot look
  like a no-op when team, recipient, or message fields are missing.
- Team create also reports a Teams-pane required-field error before queueing
  local lifecycle work, so stale create handlers cannot silently no-op when the
  team name is missing.
- Teammate spawn also reports a Teams-pane required-field error before checking
  runtime busy state or queueing the launch, so stale spawn handlers cannot
  silently no-op when team, teammate, or prompt fields are missing.
- Teammate shutdown also reports a Teams-pane required-field error before
  checking runtime busy state or queueing the request, so stale shutdown
  handlers cannot silently no-op when team or teammate fields are missing.
- Team delete also reports a Teams-pane required-field error before opening the
  destructive confirmation, so stale delete handlers cannot silently no-op when
  no team is selected.
- Teams delete preload and IPC validation also require a concrete team name, so
  renderer, preload, and main process lifecycle boundaries all reject empty
  destructive team deletion requests before filesystem mutation.
- Team member remove also reports a Teams-pane required-field error before
  opening the destructive confirmation, so stale member rows cannot silently
  no-op when the team or teammate name is missing.
- Team member remove trims row-level team and teammate names before building
  the destructive confirmation, duplicate-action key, IPC payload, draft
  cleanup, and success feedback, so whitespace in stored metadata cannot create
  mismatched removal targets.
- Team member removal validates teammate names before IPC reaches the local
  team store, rejecting empty names and path separators consistently with team
  names.
- Team runtime controls use per-session/team synchronous guards so rapid
  repeated Send or Shutdown clicks do not duplicate runtime requests.
- Team Create, Spawn, and Delete snapshot the active session and ignore stale
  async results after switching sessions, including after the follow-up Teams
  list refresh, so teammate rows and status feedback cannot be repopulated from
  the previous workspace.
- Team Send and Shutdown also snapshot the active session and ignore stale
  async results after switching sessions, so message/shutdown drafts and status
  feedback cannot be cleared by an old workspace request.
- Team Delete is guarded before confirmation opens, so rapid repeated delete
  clicks cannot open duplicate destructive confirmations or submit duplicate
  cleanup requests.
- Successful team deletion clears the Teams form so the destructive delete
  action is no longer armed for a removed team.
- Team delete stays disabled until a team name is selected or entered, so an
  empty Teams form cannot open a destructive confirmation.

## Production UI Pass

- Chat auto-scrolls as streaming output arrives.
- The conversation timeline shows inline running state for sending, streaming,
  waiting for permission, and cancelling turns.
- The composer uses a synchronous send guard so rapid repeated Send clicks only
  submit one user message while the runtime turn starts.
- The composer Send handler also re-checks active session, turn busy state, and
  non-empty input with visible conversation notices before entering the send
  path; the button remains disabled for unavailable states and routes stale
  clicks through the same handler.
- The composer input edit handler routes textarea changes through
  `handleComposerInputChange` and re-checks loading state before changing the
  draft text or resource-menu selection.
- Cancelling a turn leaves a visible completion notice in the conversation
  status area after the runtime receives the interrupt.
- The Cancel turn handler re-checks active session, permission response, and
  cancellable-turn availability with visible conversation notices; header and
  permission-dialog buttons remain disabled for unavailable states and route
  stale clicks through the same handler.
- Chat header Refresh workspace, Cancel turn, Clear desktop transcript view,
  and Close session buttons route through named lifecycle click handlers, so
  inline JSX guards cannot drift from the shared action precondition checks.
- Cancelling a turn snapshots the active session and ignores stale async cancel
  results after switching sessions, so old permission cleanup and completion
  notices cannot clear prompts or status in the newly focused conversation.
- Cancelling a turn also marks any in-flight streamed assistant or thinking
  message complete before adding the cancellation notice, so partial output
  does not remain visually stuck in Streaming state.
- Turn cancellation uses a synchronous in-flight guard, so rapid repeated
  Cancel turn clicks only send one interrupt and one cancellation notice.
- The conversation timeline exposes polite live updates and busy state while
  Claude is streaming or waiting for permission.
- Streaming assistant and thinking deltas render as explicit live messages with
  Streaming/Complete labels so users can tell whether visible reasoning is
  still updating or finished.
- The File menu `New Session...` and `Open Project Folder...` actions are
  covered by smoke verification: they open the project picker path, create a
  session, update the visible session rail, and can close the created session
  cleanly.
- New session cancellation is covered by Electron smoke while a session is
  active, so a dismissed folder picker does not look like a no-op.
- Closing a desktop session uses the desktop confirmation modal; cancelling the
  dialog preserves the active session, and confirming removes it from persisted
  desktop session metadata.
- Assistant and thinking messages render common Markdown structures as React
  nodes, including headings, lists, code blocks, inline code, and http links,
  without injecting raw HTML into the renderer.
- Assistant Markdown http links prevent default renderer navigation and open
  through the validated external-browser IPC path with conversation-level
  opening, success, and error feedback; Electron smoke records this as
  `chatMarkdownExternalLink`.
- Chat messages and Markdown code blocks expose fixed-size copy controls backed
  by a validated main-process clipboard IPC channel.
- Chat and code copy controls switch to a visible success check state after a
  clipboard write, so copy actions have immediate UI feedback.
- Electron smoke verifies rapid repeated Send clicks do not duplicate user
  messages before the disabled state renders.
- Long streamed assistant/tool text wraps inside chat bubbles, and Electron
  smoke verifies the conversation timeline has no horizontal overflow.
- Repeated Settings and Agents actions use lucide icon+text buttons for common
  edit, run, select, diagnose, create, and destructive controls.
- Toolbar and action buttons use a fixed compact type size with 16px glyphs, so
  pane controls do not inherit oversized title typography.
- Settings actions that call main-process work disable during global loading
  states so save, refresh, and skill install requests cannot be double-submitted.
- Settings and Agents toolbars mirror active loading text and expose `aria-busy`
  on their panes so right-side operations have local progress feedback.
- The chat-header workspace refresh action is covered by Electron smoke for
  both partial failure warnings and successful completion feedback.
- The Files pane Refresh action is covered by Electron smoke for local
  refreshing and completion status while externally changed files appear.
- Settings, Agents, Preview, Editor, Diff, and Terminal actions surface
  uncaught failures in the active pane status area, so right-side controls do
  not fail only through the global chat header error.
- Settings shows a local result status after configuration actions such as
  proxy save, MCP changes, scheduled task changes, plugin commands, and skill
  installs.
- Proxy form validation is covered by Electron smoke for disabled Save and
  inline guidance before a valid proxy can be saved.
- MCP project-scope validation is covered by Electron smoke for disabled Add
  MCP and inline guidance when no session is selected.
- Project-scoped MCP and Skills destructive actions stay disabled without an
  active project session, matching the install and approval controls instead
  of falling through to a late main-process error.
- Scheduled task form validation is covered by Electron smoke for disabled
  save buttons and inline guidance on missing or malformed cron schedules.
- Global scheduled tasks expose Pause/Resume directly in the Tasks page list;
  Electron smoke verifies the action updates visible state, disables Run now
  while paused, and persists `enabled=false` / `enabled=true` in
  `scheduled_tasks.json`.
- Global scheduled task Pause/Resume actions use the same synchronous guard as
  project task lifecycle actions, so rapid repeated clicks submit one pause or
  resume update.
- Project scheduled tasks expose Pause/Resume directly in the Tasks page list;
  Electron smoke verifies the visible paused/enabled state, disabled Run now
  behavior for paused tasks, and movement between active native tasks and the
  `.kode/scheduled_tasks.paused.json` sidecar.
- Skill install smoke covers both user and project picker cancellation feedback
  in addition to successful local/project installs.
- Project skill session guidance is covered by Electron smoke while no active
  session is selected.
- Plugin command smoke verifies command output rendering plus success/failure
  form behavior for install retries.
- Plugin scope validation is covered by Electron smoke for disabled project
  installs and inline guidance when no session is selected.
- Settings Refresh is covered by Electron smoke for both busy and completion
  feedback so toolbar reloads do not feel like silent no-ops.
- Settings edit actions for MCP servers and scheduled tasks show local status
  when they populate an edit form, so edit buttons do not feel like no-ops.
- Settings Cancel edit actions for MCP servers and scheduled tasks clear the
  form and show local status, so cancellation has visible feedback.
- MCP same-name user/project removal is covered by Electron smoke to keep
  cross-scope edit state isolated.
- User MCP Enable/Disable is covered by Electron smoke for visible status,
  button label changes, and `disabledMcpServers` persistence in
  `settings.json`.
- User and project MCP Inspect are covered by Electron smoke for visible
  details panels, source `.kode.mcp.json` paths, commands, and arguments.
- MCP health checks are covered by Electron smoke for rapid repeated clicks, so
  duplicate CLI checks are not launched before disabled state renders.
- MCP edit cancellation stays disabled during active desktop loading so save
  and refresh requests cannot race against draft clearing.
- Project MCP approval lifecycle is covered by Electron smoke: Approve/Reject
  updates the visible status and persists `enabledMcpjsonServers` /
  `disabledMcpjsonServers` in `.kode/settings.local.json`.
- Scheduled task removal while editing is covered by Electron smoke for both
  global and project tasks, including cleared inputs and disabled Add buttons.
- Scheduled task edit cancellation stays disabled during active desktop loading
  so task save/remove requests cannot race against draft clearing.
- Project scheduled task empty states are covered by Electron smoke before
  adding a task and after removing the final project task.
- Agents shows a local result status after catalog selection, diagnostics,
  agent saves, task launches, team refreshes, and related agent operations.
- Agent launch validation is covered by Electron smoke for disabled task launch
  and inline guidance when the agent type is missing.
- Agents editor New clears the selected draft, renderer selection, and the
  persisted selected-agent layout through the session that opened the new draft
  before showing local status, so a new draft cannot be overwritten by a
  restored old selection or rewrite another workspace after a session switch;
  `agentEditorNewFeedback` confirms that status path.
- Agent editor Save uses `rapidAgentSaveGuard` so repeated saves do not persist
  duplicate edits, and `agentTeammateStatusIsolated` confirms teammate status
  does not leak into agent lifecycle feedback.
- Agents editor Delete is covered by Electron smoke for cancel and confirm
  paths, including persisted agent file removal and form reset after deletion.
- Chat, Agents, and Teams are first-class left navigation entries instead
  of being hidden among workspace tool tabs. Agents, Teams, and Settings
  open as main pages, while the workspace tabs stay focused on Files, Diff,
  Editor, Terminal, and Preview.
- Primary navigation entries are disabled and removed from the tab order while
  loading, so page changes cannot race active lifecycle or settings feedback.
- Primary navigation button clicks route through the named
  `handlePrimaryNavClick` entrypoint before `selectPrimaryNavView` and
  `openPrimaryView`, so Chat, Agents, Teams, Tasks, and Settings share one
  guarded pointer path. Native primary navigation events, Cmd/Ctrl+1..5
  shortcuts, Cmd/Ctrl+, Settings, and command-palette primary navigation
  commands also call `selectPrimaryNavView` before reaching the underlying page
  router.
- Session rows expose a three-dot/right-click management menu for focusing,
  opening the project folder through a dedicated workspace IPC, and closing the
  session.
- The session list has an explicit Sessions disclosure control, so long session
  rails can be collapsed while keeping primary navigation and Settings visible.
- Agents and Settings are full-height scroll panes with sticky toolbars so long
  catalogs and configuration forms remain navigable.
- Long desktop surfaces use stable scrollbar gutters and shared scrollbar
  colors, so Settings, Agents, chat, and session lists do not show abrupt
  native scrollbars or shift content when scrolling appears.
- Files, Diff, Editor, Terminal, and Preview empty states use structured icon,
  title, and next-step guidance instead of sparse one-line placeholders.
- Diagnostics include the current active file, terminal id, and preview URL from
  session layout so support bundles can reconstruct Editor, Terminal, and
  Preview restore context without message bodies.
- Diagnostics also include the saved sidebar width, workspace ratio, and file
  tree expanded-path count, so layout restore issues are debuggable without
  exporting the full expanded path list.
- The Diff file list uses the same structured empty state treatment, so an
  unchanged workspace shows a clear icon, title, and refresh guidance before
  any files appear.
- Agents and Settings include sticky section jumpbars for long panes, so users
  can move directly to MCP, Plugins, Teams, and other dense configuration
  groups without manual scrolling. Settings jumpbar entries are grouped into
  Runtime, Extensions, and Automation clusters.
- Settings and Agents jumpbars wrap into multiple rows in narrow panes instead
  of clipping labels or exposing horizontal scrollbars.
- Agent diagnostic Settings jump actions are covered by smoke verification for
  both pane switching and target-section scrolling.
- Electron smoke scrolls Settings and Agents to their final sections to verify
  bottom content remains reachable in constrained windows.
- Settings and Agents forms use responsive grid rows so dense controls collapse
  instead of overflowing in narrow workspace panes.
- The chat header and composer use container-aware wrapping so the project path,
  input, and Send control remain readable when the workspace is squeezed.
- Smoke coverage includes long workspace filenames and narrow Settings/Agents
  panes to catch horizontal overflow before it reaches users.
- Narrow Settings and Agents smoke verifies section jumpbars do not introduce
  horizontal overflow or clipped navigation chips.
- Settings and Agents jumpbars align their sticky offset with the actual pane
  toolbar height, and smoke verifies the jumpbar does not overlap the toolbar
  when panes are narrow.
- Jumpbar smoke also verifies clicked section targets land below the sticky
  jumpbar instead of being scrolled underneath it.
- Files smoke verifies expanded directory state survives session switching, so
  the workspace tree does not reset during normal multi-session use.
- Terminal smoke verifies rapid Start shell clicks create only one terminal
  session before the shell can be stopped.
- Electron smoke verifies restored sessions reopen the active Editor file and
  display its saved contents after app restart.
- Electron smoke verifies restored missing Editor files are cleared from the
  session layout and reported in the Editor pane instead of leaving stale state.
- Electron smoke verifies restored Diff panes render the changed file list,
  toolbar count, and diff lines after app restart.
- The desktop window supports 900px-wide split-screen use and a 720px compact
  Settings smoke pass; the chat/workspace grid uses CSS pane minimums so narrow
  media rules are not bypassed by inline layout state.
- Buttons use one icon system with fixed-size SVG icons, stable control
  dimensions, hover/focus states, and wrapping action rows for dense panes.
- Smoke verifies copied chat/code buttons render a success icon, not just a
  silent clipboard side effect.
- Electron smoke verifies visible design-system buttons do not clip labels and
  icon-only controls keep their 32px square footprint.
- Icon-only controls, including compact workspace pane tabs, expose matching
  `aria-label`/native titles plus custom hover/focus tooltip text, and Electron
  smoke verifies the tooltip metadata is present for compact controls.
- Tooltips on top chrome and workspace pane tabs open downward so labels are not
  clipped by the window edge.
- Agent task action buttons use the same icon+text treatment for reading
  output, previewing files, resuming tasks, and stopping tasks; smoke verifies
  the task action row is not text-only.
- Agent task action buttons are covered by Electron smoke for visible
  feedback, output preview rendering, resume prompt clearing, and stop status.
- Agent diagnostic jump actions, team selection, and permission decision
  buttons use the same icon+text treatment, with smoke coverage for the
  interactive paths.
- Team selection fills the team action form and shows a local Teams status
  message, so selecting an existing team has visible feedback.
- Team action buttons for create, spawn teammate, send, shutdown, member remove, and delete
  are covered by Electron smoke so they cannot regress into no-feedback
  controls.
- Team delete disabled-state smoke verifies destructive team actions cannot be
  triggered from an empty form.
- Team delete cleanup smoke verifies the Teams form is cleared after a
  successful delete.
- The Preview toolbar uses icon+text for the embedded Open action and an
  icon-only external-browser action, with smoke coverage for both controls.
- Preview smoke verifies rapid repeated external-browser clicks are collapsed
  into one main-process browser open request.
- Preview session isolation is covered by Electron smoke with two sessions that
  hold different embedded preview URLs.
- Settings edit-mode controls such as MCP and scheduled task Cancel edit also
  use icon+text treatment, and smoke verifies the edit cancellation paths are
  not text-only.
- Confirmation dialogs use the same icon+text treatment for cancel and confirm
  actions, including destructive confirmations.
- Confirmation dialog Cancel and Confirm buttons route through
  `resolveConfirmationModal`, so both pointer entrypoints preserve the same
  loading guard and focus-restore behavior as Escape dismissal.
- Disabled primary/destructive buttons use neutral surfaces instead of the
  active accent color, so unavailable actions do not read as the main next step.
- Workspace tabs collapse to equal-width icon buttons in narrow panes so the
  active tab state does not resize or shift the toolbar.
- Active sessions, workspace tabs, and file-tree directory expansion expose
  machine-readable ARIA state for keyboard and assistive workflows.
- Project/global scheduled task lists, Teams, MCP, Skills, and Plugins
  listboxes expose `aria-activedescendant` only when their selected row still
  exists in the current list, keeping restored or edited selection state tied
  to a real stable option id.
- Selectable listbox rows share Codex-style keyboard navigation: Enter/Space
  selects the focused row, ArrowUp/ArrowDown cycle through available rows, and
  Home/End jump to the first or last available row while skipping disabled
  project-scoped entries.
- Grouped Settings search exposes a combobox tied to the settings navigation
  listbox, with grouped options and the active section tracked for keyboard
  and assistive workflows.
- The Agents catalog search exposes the same combobox-to-listbox relationship
  and tracks the selected agent card as the active option, including direct
  pointer and Enter/Space row selection. ArrowUp/ArrowDown plus Home/End in the
  search field cycle or jump through filtered agents, and Enter re-selects the
  active descendant. Escape clears the current agent search query without
  leaving the Agents page. Filtered and unloaded catalog states use the shared
  icon, title, and next-step empty-state treatment.
- The Teams management list exposes selectable options for each team and keeps
  the selected team state machine-readable. Empty team lists use the shared
  icon, title, and next-step empty-state treatment.
- MCP and Skills management lists expose selectable rows for direct settings
  management, including user and project scoped entries.
- Installed Plugins use the same selectable list pattern as the other Settings
  integrations.
- Global desktop shortcuts mirror the rail and workspace tabs:
  Cmd/Ctrl+1..5 opens Chat, Agents, Teams, Tasks, and Settings, while
  Cmd/Ctrl+Shift+1..5 switches Files, Diff, Editor, Terminal, and Preview.
- Cmd/Ctrl+K opens a command palette with searchable navigation and workspace
  actions, roving keyboard selection, disabled unavailable commands with
  visible in-palette reasons, and direct actions for pages, panes, agent
  lifecycle sections, team management, scheduled task sections,
  New custom agent, New team, New scheduled task, New project scheduled task,
  General/Proxy/MCP/Skills/Plugins settings, Add MCP, Check MCP, skill
  creation, skill installs, plugin list/install actions, settings refresh,
  diagnostic export, discovered user/project slash commands, session creation,
  and refresh.
  The palette search input exposes combobox state, controls the command
  listbox, and tracks the active option for assistive workflows.
  The same search input is disabled and guarded while loading, so an active
  desktop action cannot clear palette status or reshuffle command results.
  Command execution also re-checks loading state, so stale click or Enter
  events cannot run a command after a desktop action has started.
  Command option identifiers encode command ids before wiring them to
  `aria-activedescendant`, so user/project slash command names cannot break the
  active option relationship.
  When custom slash commands or project-scoped actions are unavailable, the
  palette keeps keyboard focus on the first enabled command so Enter does not
  default to a disabled action.
  Disabled command options remain visible with their reason, but are removed
  from the tab order and cannot become the active command through hover.
- Release UX validation requires manually exercising the command palette and
  native View menu navigation so these Codex-style entrypoints are covered
  before production approval, not only by smoke automation.
- The native View menu exposes the same command palette action with the
  Cmd/Ctrl+K accelerator, so the entrypoint works through the desktop menu as
  well as renderer keyboard handling.
- The native View menu also mirrors page and workspace-pane navigation:
  Chat/Agents/Teams/Tasks/Settings use Cmd/Ctrl+1..5, and
  Files/Diff/Editor/Terminal/Preview use Cmd/Ctrl+Shift+1..5.
- The native File menu also exposes high-frequency lifecycle and Settings
  management entrypoints for New Custom Agent, New Team, New Global Scheduled
  Task, New Project Scheduled Task, Add MCP Server, New User Skill, and New
  Project Skill. These entries send renderer lifecycle events and reuse the
  same guarded page/section actions as the command palette and composer menu.
- The native Agents menu mirrors the first-class Agents page lifecycle:
  Overview, Available Agents, Run Agent, Custom Agents, Running Agent Tasks,
  New Custom Agent, and Refresh Agents. The native Teams menu mirrors Team
  Management, New Team, and Refresh Teams. These entries send renderer
  Agents/Teams actions and reuse the same guarded section, draft, and refresh
  handlers as the in-app lifecycle panes.
- The native Tasks menu mirrors first-class scheduled-task lifecycle controls:
  Project Scheduled Tasks, Global Scheduled Tasks, New Project Scheduled Task,
  New Global Scheduled Task, and Refresh Tasks. These entries send renderer
  Tasks actions and reuse the same guarded Tasks page handlers as the in-app
  jumpbar and task toolbar.
- The native MCP and Skills menus expose direct management entrypoints for the
  Settings-backed integrations: MCP Servers, Add MCP Server, Check MCP Health,
  Skills, New User Skill, New Project Skill, Install User Skill, and Install
  Project Skill. These entries send renderer MCP/Skills actions and reuse the
  same guarded Settings panes and management functions as the in-app controls.
- The native Plugins menu mirrors the Plugins Settings surface with Plugins,
  List Plugins, Install Plugin, and Refresh Plugins actions. These entries send
  renderer Plugins actions and reuse the same guarded plugin list, install, and
  configuration refresh handlers as the in-app controls.
- The native Settings menu mirrors the grouped Settings sidebar for General,
  Proxy, MCP Servers, Skills, and Plugins, and also exposes Check MCP Health,
  Install User Skill, Install Project Skill, List Plugins, Install Plugin,
  Refresh Settings, and Export Diagnostics. General uses the same Cmd/Ctrl+,
  shortcut as the renderer Settings shortcut. Each item sends a renderer
  Settings action and reuses the same guarded grouped Settings handlers as the
  in-app Settings UI; project-scoped menu actions that need an active session
  show Settings-pane feedback instead of silently doing nothing.
- The native Help menu keeps support and recovery entrypoints close to the OS
  menu bar: Command Palette, Refresh Settings, Export Diagnostics, and Claude
  Code Docs. The app-local entries reuse the same renderer command palette and
  Settings actions as the in-app controls.
- First-class page navigation from the rail, command palette, native View menu,
  and renderer shortcuts shares the same loading guard, so Chat/Agents/Teams/
  Tasks/Settings cannot change while a desktop action is still active.
- Settings, Agents, Teams, and Tasks section navigation uses the same loading
  guard before changing active sections or writing section status, including
  command palette lifecycle shortcuts.
- Workspace pane navigation from tabs, command palette, native View menu, and
  renderer shortcuts shares the same loading guard, so these entrypoints cannot
  switch panes while an active desktop action is still reporting progress.
- Source-level navigation wiring tests keep the native View menu accelerators,
  renderer shortcuts, and primary page/workspace pane targets aligned so these
  Codex-style entrypoints cannot drift independently during refactors.
- Electron smoke creates enough concurrent sessions to overflow the left rail,
  then verifies older sessions remain reachable by scrolling.
- Electron smoke waits for active sessions by persisted session id instead of
  title text so similarly prefixed temporary workspaces cannot skew screenshots.
- Editor, Diff, Terminal, and Preview work areas expose named regions so
  embedded Monaco, xterm, diff, and iframe surfaces are discoverable.
- Terminal startup failures render inside the Terminal pane and keep the shell
  placeholder visible instead of leaving the control stuck in a starting state.
- Main-process event delivery drops late terminal/runtime events after the
  BrowserWindow is destroyed so closing a shell-heavy session does not crash.
- Packaged windows load the renderer with Electron `loadFile()`; renderer entry
  validation rejects non-HTML file entries and JS/CSS/map/runtime resources, and
  smoke verifies the main frame renders the desktop shell instead of an asset.
- The workspace resize separator supports pointer drag and keyboard resizing
  with visible focus state plus ARIA value metadata; Electron smoke verifies
  both keyboard and pointer resizing persist to session layout.
- Workspace resizing is disabled and removed from the tab order while loading,
  so active desktop actions cannot race layout writes from drag or keyboard
  resize events.
- Workspace resize handlers also report a conversation notice if the active
  session disappears before pointer or keyboard resize starts.
- Pointer resizing updates the UI locally while dragging and persists only the
  final ratio on pointer release, avoiding layout-write floods and stale
  out-of-order resize commits.
- Keyboard resizing also persists the workspace ratio through the session that
  received the resize event, matching pointer resize isolation across
  concurrent sessions.
- IPC payload validation rejects extra arguments on fixed-shape channels, so
  malformed renderer calls cannot silently pass unused data to main handlers.
- Destructive actions and unsaved editor navigation use a desktop-styled
  confirmation modal instead of native browser confirm prompts.
- Header Close session is covered by Electron smoke for both cancel and confirm
  paths, so accidental session removal cannot happen without an explicit
  desktop confirmation; rapid repeated confirm clicks collapse to one close
  request.
- Close session uses a per-session pending guard before unsaved-change and
  destructive confirmations open, so rapid repeated close actions cannot stack
  duplicate confirmation dialogs for the same session.
- App/window close requests with unsaved editor changes use the same
  desktop-styled confirmation modal, with the window-unload guard kept as a
  fallback so close attempts cannot silently drop in-memory edits.
- Window close handling uses a synchronous in-flight guard before opening the
  unsaved editor confirmation, so repeated app-close events cannot stack
  duplicate destructive confirmation dialogs.
- Dense Settings and Agents form controls expose explicit accessible names, and
  confirmation dialogs can be dismissed with Escape.
- Confirmation and permission dialogs move keyboard focus into the dialog and
  keep Tab navigation inside it; confirmation and permission flows restore focus
  to the previous control when they close.
- Confirmation dialogs disable and guard Cancel, Confirm, and Escape resolution
  while loading, so stale modal events cannot resolve a destructive prompt after
  another desktop action has started.
- Confirmation resolution also checks that a pending resolver still exists
  before clearing modal state or restoring focus, so duplicate stale events
  after the first decision cannot re-settle the same prompt.
- Modal dialogs stay constrained to the viewport and scroll internally when
  permission metadata or file paths are long.
- Confirmation and permission modal action bars stay pinned to the bottom of the
  scrolling dialog, so Allow/Deny/Cancel controls remain reachable while long
  review payloads scroll.
- A top-level renderer error boundary shows a recoverable desktop error screen
  instead of leaving the app as a blank window after render failures.
- The stylesheet respects reduced-motion preferences by disabling transitions.
- Permission dialogs expose Cancel turn alongside Allow/Deny, so a blocked
  permission prompt does not hide the only way to interrupt an active turn.
- Permission Cancel turn routes through `handlePermissionCancelTurnClick` and
  then the shared cancellation handler, so cancel availability and in-flight
  permission response state are re-checked before interrupting the runtime.
- Permission Allow/Deny buttons show an inline sending state and are disabled
  while a response or global desktop action is in flight to avoid duplicate or
  stale decisions.
- Permission decisions also use a synchronous in-flight guard, so rapid
  repeated Allow/Deny clicks only write one response to the runtime; Electron
  smoke covers rapid repeated Allow.
- Permission Allow/Deny click handlers route through
  `handlePermissionResponseClick` and mirror the in-flight responding state, so
  stale modal events cannot re-enter the response path while a decision is
  already being sent.
- Permission response failures are written back to the original request id
  instead of the current queue head, so queued permission prompts cannot show an
  error from another Allow/Deny attempt if the queue changes while IPC is in
  flight.
- Multiple simultaneous permission requests keep the session activity in
  `waiting_permission` until the last request is resolved, so the chat status
  does not resume early while another queued permission still needs review.
- Streamed text or thinking deltas that arrive while a permission request is
  still pending also preserve `waiting_permission`, so runtime progress cannot
  hide a blocked permission decision.
- Permission dialogs render tool input as structured key/value rows, show a
  structured empty state when no tool arguments are present, then show labeled
  permission suggestions and the raw request payload for deeper review.
- Cancelling a turn clears pending permission prompts for that session to avoid
  stale Allow/Deny decisions after an interrupt.
- Electron smoke verifies Cancel turn reaches the runtime and surfaces a
  visible `Turn cancelled.` completion notice.
- Electron smoke verifies rapid repeated Cancel turn clicks do not duplicate
  cancellation requests or system notices.

## Verification

Run these from the repository root:

```bash
bun run desktop:test
bun run desktop:smoke-runtime
bun run desktop:smoke-electron
bun run desktop:build
bun run desktop:smoke-packaged
```

For visual audit evidence, capture smoke screenshots with:

```bash
DESKTOP_SMOKE_SCREENSHOT_DIR=/tmp/claude-desktop-audit \
  DESKTOP_SMOKE_PROGRESS=1 bun run desktop:smoke-electron
```

The screenshot set includes chat streaming, Settings, narrow Settings, MCP
management, Skills management, Command Palette, Agents, selected-agent actions,
scheduled tasks, Teams, composer actions, permission review, Files, Editor,
Diff, Terminal, and Preview states so visual regressions can be inspected
alongside the functional smoke assertions.

The smoke summary also acts as the user-facing acceptance checklist for the
desktop shell. In particular, the following fields must remain true before
claiming the GUI handles the core desktop workflows:

Release CI captures the final `desktop:smoke-electron` JSON summary in the
`smoke-electron` step of `desktop/release/release-evidence.json`. Required
desktop feature flags such as first-class Settings, Agents, Teams, scheduled
tasks, MCP management, skill installation, and command/composer shortcuts must
be recorded as true, and `terminalMode` must be recorded as `pty`;
`desktop:verify-release` fails release evidence that omits or falsifies those
requirements.

- `duplicateChatMessagesSuppressed` and `agentToolResultsHiddenFromChat`
  confirm runtime echoes, tool results, and turn results do not duplicate the
  chat timeline.
- `enterSendsMessage` confirms the composer sends on plain Enter.
- `commandPaletteUnavailableFeedback` confirms disabled command-palette actions
  stay visible, show the missing prerequisite directly in the command row, and
  explain the same reason again when activated instead of silently doing
  nothing.
- `desktop/tests/mainNavigationWiring.test.ts` confirms the global command
  palette exposes grouped General and Proxy settings commands plus diagnostic
  export and settings refresh, and routes those actions through Settings
  General so cancellation or success feedback is visible on the active page.
  The same wiring test locks Settings refresh to the existing loading guard and
  `Refreshed configuration.` completion status so the command cannot regress
  into a silent no-op.
- The same wiring test confirms command palette create actions for custom
  agents, teams, global scheduled tasks, and project scheduled tasks route to
  their first-class pages with clean drafts instead of leaving those lifecycle
  starts buried behind manual navigation.
- The same wiring test confirms custom slash commands appear in the command
  palette and stage `/<name>` in the chat composer, so users can launch them
  from Cmd/Ctrl+K without manually typing the slash trigger first.
- `commandPaletteLifecycleCreateShortcuts` confirms Electron smoke executes
  those command palette create actions through the real UI and verifies the
  destination page, clean draft, and visible lifecycle status for each one.
  `commandPaletteSkillDraftShortcuts` confirms the command palette also opens
  clean user/project Skill drafts with visible Settings feedback.
- MCP, Skills, and Plugins management actions are also exposed in the command
  palette. The wiring test locks Add MCP to a clean MCP draft, Check MCP to the
  existing health check, skill creation to clean user/project Skill drafts,
  skill installs to the existing folder-picker flows, direct user/project skill
  inspection buttons to Settings, and plugin list/install actions to the
  Settings Plugins form.
- The same wiring test locks `/` composer action shortcuts for lifecycle and
  Settings management entrypoints, so the composer cannot regress to prompt-only
  actions while the command palette remains functional.
- The `/` composer action menu remains available before a project session is
  selected for user/global management entrypoints such as New custom agent, Add
  MCP server, New user skill, New global scheduled task, and Refresh settings.
  Workspace, Team, project task, project Skill, terminal, diff, and custom
  project slash-command actions stay session-bound and render with disabled
  reasons instead of disappearing silently.
- `desktop/tests/customCommands.test.ts` confirms user/project markdown slash
  commands are named with Claude-style `/user:` and `/project:` prefixes, use
  frontmatter or heading descriptions, and skip symlinked or unsafe command
  name entries.
- `composerCustomSlashCommand`, `composerLifecycleActionShortcuts`, and
  `composerSettingsActionShortcuts` confirm Electron smoke exposes a project
  `.kode/commands` slash command through the real composer menu, selects
  `/project:desktop-smoke` back into the focused composer, executes
  `/new-custom`, `/add-mcp`, `/new-user-skill`, and `/new-project-skill`,
  verifies the destination page, and checks the visible clean draft/status
  feedback.
- `renderedAssistant`, `streamedAssistant`, `indexedStreamMessageCoalescing`,
  and `thinkingStreamStateLabels` confirm chat output renders from real stream
  events without duplicate indexed messages and with visible thinking state
  labels. `runtimeFailureVisible`, `visibleActivityState`, `rapidSendGuard`,
  `rapidCancelGuard`, `cancelRoundTrip`, `cancelTurnFeedback`,
  `rapidCloseSessionGuard`, `closeSessionConfirmation`, `deepLinkedSession`,
  `workspaceRefreshFeedback`, `staleSessionStatusCleared`, and
  `chatCopyFeedback` confirm failed runtime output, session actions, refresh,
  deep links, and copy feedback are visible and guarded.
- `rapidMenuSessionCreateGuard`, `sessionCreateCancelFeedback`,
  `rapidSessionCreateGuard`, `restoredSession`, and `closedSession` confirm
  menu and rail session creation, cancellation, restoration, and close flows are
  stateful and guarded.
- `filesRefreshFeedback`, `rapidFilesRefreshGuard`, `editorEmptyStateGuidance`,
  `restoredDiffContent`, `terminalEmptyStateGuidance`,
  `terminalFailureVisible`, `restartedTerminal`, `rejectedInvalidPreview`, and
  `previewRapidExternalGuard` confirm workspace refresh, empty states, restored
  diff content, terminal failure/restart, invalid preview URLs, and external
  preview opens have visible feedback.
- `commandPaletteSettingsManagement` confirms Electron smoke exercises the
  Settings management commands through the real command palette, including Add
  MCP draft preparation, Check MCP health output, Install user skill
  cancellation feedback, Install project skill cancellation feedback,
  user/project Skill draft preparation, and List plugins output/status.
  `commandPaletteSettingsDiagnosticsExport` and
  `commandPaletteSettingsDiagnosticsRedaction` confirm the command palette
  Export diagnostics path writes a redacted support bundle. `rapidDiagnosticsExportGuard`
  confirms repeated Settings Export diagnostics clicks open one save dialog and
  submit one diagnostics IPC.
  `commandPaletteSettingsRefresh` and `commandPaletteSettingsRefreshGuard`
  confirm the command palette Refresh settings path reloads configuration with
  visible feedback and guards repeated execution.
- The production readiness check requires the user-requested desktop UX scope to
  cite the same smoke evidence, including command palette Skill drafts,
  composer team/agent target routing, hidden agent tool-result noise, selected
  Team state, Team deletion draft cleanup, paused scheduled-task Run now guards,
  scheduled-task Run now feedback, project scheduled-task empty state, and
  project scheduled-task Pause/Resume/Run now coverage.
- `settingsGui`, `rapidSettingsRefreshGuard`, `proxyFormValidation`,
  `rapidProxySaveGuard`, `proxyRuntimeEnv`, `pluginCommands`,
  `rapidPluginActionGuard`, `pluginFormFeedback`, `pluginScopeValidation`, and
  `projectPluginRowsDisabledNoSession`
  confirm Settings, Proxy, and Plugin controls validate input, call real
  handlers, guard repeated actions, show visible feedback, and keep stale
  project/local installed Plugin rows inert when no session is active.
- `mcpManagement`, `projectMcpManagement`, `localSkillInstall`,
  `localSkillSave`, `projectSkillInstall`, and `projectSkillSave` confirm MCP
  servers and Skills can be managed from the desktop Settings surface across
  user and project scopes. `rapidMcpSaveGuard`, `rapidMcpRemoveGuard`,
  `rapidSkillInstallGuard`, `rapidSkillSaveGuard`, and
  `rapidSkillRemoveGuard` confirm MCP/Skill save, install, and removal guards
  repeated clicks. `mcpCrossScopeEditIsolation`,
  `mcpProjectScopeValidation`, `mcpHealthCheck`, and
  `rapidMcpHealthCheckGuard` confirm MCP edits stay isolated by scope, project
  actions require an active project scope, and health checks run with guarded
  feedback. `skillInstallCancelFeedback`, `projectSkillSessionGuidance`, and
  `projectSettingsRowsDisabledNoSession` confirm skill install cancellation,
  project skill guidance, and no-session project MCP/Skill row disabled
  semantics are visible.
  `localSkillInspect`, `projectSkillInspect`, `rapidSkillInspectGuard`, and
  `rapidMcpInspectGuard` confirm Electron smoke clicks Inspect for both scopes,
  verifies the rendered details, and proves repeated Inspect clicks do not
  submit duplicate read IPCs; `desktop/tests/config.test.ts`,
  `desktop/tests/ipc.test.ts`, and `desktop/tests/mainNavigationWiring.test.ts`
  also cover Settings skill inspection, including user/project reads and
  workspace path validation.
- `agentGui`, `agentLaunchValidation`, `agentDiagnosticSettingsJump`,
  `selectedAgentActionRow`, `selectedAgentVisualEvidence`,
  `selectedAgentStateRestored`, `selectedAgentNewSessionAction`,
  `selectedAgentPrepareTaskAction`, `selectedAgentOverrideAction`,
  `agentLaunchTurnBusyGuard`,
  `rapidAgentLaunchGuard`, `rapidAgentsRefreshGuard`, `agentDeleteFeedback`,
  `rapidAgentDeleteGuard`,
  `teamsFirstClassManagement`, `selectedTeamStateRestored`,
  `teamBroadcastMessageAction`,
  `teamMemberMessageAction`, `teamSpawnTeammateAction`,
  `teamMemberShutdownAction`, `teamMemberRemoveAction`, `teamActionFeedback`,
  `rapidTeamActionGuard`,
  `rapidTeamMemberShutdownGuard`, `rapidTeamMemberRemoveGuard`, `teamDeleteDisabledState`,
  `teamDeleteFeedback`, `rapidTeamDeleteGuard`, `teamDeleteClearsDraft`,
  `selectedScheduledTaskStateRestored`, `scheduledTaskPauseResume`,
  `scheduledTaskRunNowFeedback`,
  `scheduledTaskRemoveFeedback`, `rapidScheduledTaskRemoveGuard`,
  `projectScheduledTaskManagement`, `projectScheduledTaskPauseResume`,
  `projectScheduledTaskRunNow`, `projectScheduledTaskRemoveFeedback`,
  `rapidProjectScheduledTaskRemoveGuard`, `userMcpInspect`, `userMcpEnableDisable`,
  `rapidMcpInspectGuard`, `rapidMcpRemoveGuard`,
  `projectMcpInspect`, `projectMcpApprovalLifecycle`, `localSkillRemove`, and
  `projectSkillRemove`, plus `rapidSkillInspectGuard` and
  `rapidSkillRemoveGuard`, confirm the first-class Agents, Teams, Tasks, MCP, and
  Skills surfaces exercise lifecycle actions, not only static page rendering.
- `settingsInLeftFooter`, `settingsFirstClassPage`,
  `settingsSidebarNavigation`, `settingsSearchFiltering`,
  `settingsDiagnosticsExport`, `settingsDiagnosticsRedaction`,
  `settingsPaneErrorFeedback`, `settingsRefreshFeedback`,
  `settingsEditFeedback`, `settingsEditCancelFeedback`,
  `settingsEditCancelIcon`, `settingsMcpEmptyState`,
  `settingsSkillsEmptyState`, `settingsPluginEmptyState`, and
  `settingsMcpSkillsInlineSections` confirm Settings is in the left footer, opens as
  its own main page, uses the grouped settings sidebar, supports settings
  search, exposes diagnostics export/redaction, shows refresh/edit/cancel/error
  feedback, shows empty states, and keeps MCP/Skills in drawers. Empty plugin
  install failures report that the command failed without error output instead
  of surfacing raw placeholder copy in the Settings status line.
  Settings section navigation persists the active grouped section through the
  session that triggered it when one is selected, while no-session Settings
  browsing remains local to the renderer.
  `settingsSectionRestored` confirms the active grouped Settings/Tasks section
  survives session restore, and `selectedSettingsDetailStateRestored` plus
  `selectedPluginIdentity` wiring confirm selected MCP, Skill, and Plugin
  management state is restored from session layout and included in diagnostics.
- `firstClassLeftNavigation`, `agentsFirstClassPage`, `teamsFirstClassPage`,
  and `tasksFirstClassPage` confirm Chat, Agents, Teams, and Tasks are primary
  navigation surfaces. `agentsSectionRestored` confirms Agents returns to its
  saved lifecycle section, `teamsSectionRestored` confirms Teams restores its
  grouped section/jumpbar state, `selectedTeamStateRestored` confirms the
  selected team card and draft survive session restore, and
  `tasksSectionRestored` plus `selectedScheduledTaskStateRestored` confirm the
  active Project/Global scheduled-task section, selected task rows, and edit
  drafts survive session restore through dedicated task layout state instead of
  reusing grouped Settings state.
- `accessiblePrimaryNavigation`, `nativeNavigationMenuActions`,
  `nativeHelpSupportMenuActions`,
  `primaryNavKeyboardShortcuts`, `workspacePaneKeyboardShortcuts`,
  `commandPaletteNavigation`, `commandPaletteMenuAction`,
  `commandPaletteUnavailableFeedback`, and `commandPaletteLifecycleNavigation`
  confirm primary navigation, native menu entries, workspace pane shortcuts,
  keyboard shortcuts, and command palette behavior follow Codex-style
  interaction paths with visible feedback.
- `composerResourceMenu`, `composerSkillResourceMenu`,
  `composerMcpResourceMenu`, `composerMenuKeyboardNavigation`,
  `composerActionMenu`, and `composerCustomSlashCommand` confirm the composer
  exposes Codex-style resource, built-in action, and project custom slash
  command menus rather than remaining a plain prompt box. The navigation wiring
  test also locks disabled composer action reasons, inert selection, and
  `aria-disabled` state.
- `visibleActivityState`, `rapidSendGuard`, `cancelRoundTrip`,
  `cancelTurnFeedback`, `closeSessionConfirmation`,
  `sessionMenuKeyboardNavigation`, `permissionRoundTrip`,
  `queuedPermissionRoundTrip`, `permissionDenyRoundTrip`,
  `rapidPermissionDecisionGuard`, `editedFile`, `rapidFileSaveGuard`,
  `restoredEditorContent`, `renderedDiff`, `rapidDiffRefreshGuard`,
  `renderedTerminal`, `resizedTerminal`, `terminalRapidStartGuard`,
  `terminalRapidStopGuard`, `terminalCloseRaceSafe`, `previewExternalOpen`,
  `previewSessionIsolation`, `previewRapidOpenGuard`, and
  `previewOpenActionIcon` confirm the core local desktop workflows have real
  guarded behavior across chat turns, cancellation, permission review, files,
  editor, diff, terminal, and preview.
- `conversationNoHorizontalOverflow`, `buttonLayoutStable`,
  `toolbarButtonTypographyStable`, `iconOnlyTooltips`,
  `polishedScrollableSurfaces`, `workareaEmptyStateGuidance`,
  `compactSettingsLayout`, `paneJumpbarsNoHorizontalOverflow`,
  `sessionRailScrollable`, `permissionDecisionActionIcons`, and
  `confirmationActionIcons` confirm the desktop meets release-level UI quality
  expectations for dense Codex-style panes, stable controls, scrollable rails,
  readable text, icon affordances, and no horizontal overflow.
- `selectedAgentVisualEvidence`, `selectedTeamCurrentState`, and
  `teamsManagementVisualEvidence` confirm the smoke run reached
  screenshot-backed selected-agent and team-management states, including a
  selected team card with semantic current state, after structural action-row
  checks passed.
- `composerTeamTargetRouting` and `composerAgentTargetRouting` confirm composer
  target routing reaches the team and agent IPC paths.
- `sessionRowManagementMenu` and `sessionRowOpenFolderAction` confirm session
  rows have working management actions.
- `collapsibleSessions`, `collapsedSessionCountVisible`, and
  `sessionRailCollapseRestored` confirm the session rail can collapse and
  restore.
- `quickSessionEntry`, `railQuickSessionEntry`, `menuSessionAction`, and
  `menuOpenFolderAction` confirm new sessions do not force a directory picker
  while explicit folder selection remains available.

For manual inspection:

```bash
bun run desktop:dev
```

The dev renderer is served from the local Vite URL printed by
`desktop/scripts/dev.mjs`. The dev launcher resolves the Electron executable
from the installed `electron` package instead of relying on a shell `electron`
binary. A quick non-zero Electron exit is reported as a startup failure, while
a quick zero exit is treated as a single-instance handoff to an already running
Claude Code Desktop window.
