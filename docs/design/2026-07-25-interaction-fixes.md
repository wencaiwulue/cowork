# Design Document: Interaction Fixes (P1 + P2 batch)

- **Date**: 2026-07-25
- **Author**: Architect
- **Status**: Draft
- **Related Issues/PRs**: `docs/design/2026-07-25-ui-audit-report.md`

---

## 1. Summary

This change addresses nine interaction and visual defects cataloged in the calibrated UI audit report. The work splits into two batches: **P1** fixes target coarse-grained loading state, error recovery, keyboard accessibility of context menus, session rename, command palette navigation, multi-session streaming indicators, and empty-state CTAs; **P2** fixes target CSS variable unification and the shared mention/slash popup trigger logic. No new features beyond the listed fixes are introduced.

---

## 2. Problem / Motivation

The desktop renderer (`desktop/renderer/src/App.tsx`, ~13.5k lines) currently uses a single `loadingLabel` string state to gate every async operation. Any operation — exporting diagnostics, refreshing MCP, sending a message — disables 100+ unrelated buttons, Monaco editor, and listbox `tabIndex` across the entire window. This produces a frozen-UI effect where unrelated actions are blocked.

The generic error banner (`{error && <div className="inline-error">{error}</div>}`) has no retry, no details, no auto-dismiss, and loses the stack trace in `runAction`'s catch — while `conversationNotice` (8s timeout) and `activeSession.lastError` (dismiss button) both have recovery mechanisms. Only the generic error is stuck.

Session right-click menus (`sessionMenu`, `sessionCreateMenu`) render as `role="menu"` with ArrowDown/ArrowUp/Enter/Escape key handling, but lack focus trapping: the menu container never receives focus, Tab escapes to the underlying UI, and ArrowDown only mutates `sessionMenuActiveIndex` without calling `.focus()` on the menu item. The existing `trapModalFocus` helper (`App.tsx:2308-2327`) is only wired into modal/permission/palette, not into these menus.

There is no F2 shortcut or command-palette command to rename the selected session. The `DesktopSession.title` field is derived from `cwd` at creation time (`desktop/main/sessionManager.ts:69`) and no `sessions:rename` IPC handler exists. Users cannot rename sessions at all from the renderer.

The command palette already contains navigation commands for Chat/Agents/Teams/Tasks/MCP/Skills/Settings (`App.tsx:3993-4050`), but they are interleaved with slash commands and all disabled under `!!loadingLabel`. They need a dedicated section and to remain usable during loading.

Multi-session streaming has no visual distinction in the sidebar: the `session-row` renders a `status-dot` with `session.activity` class but no animation when `session.activity === 'streaming'`.

Five empty states (agents, teams, teammates, project tasks, global tasks) render only icon + text with no call-to-action button, while the session empty state already has CTA buttons (`App.tsx:11116-11121`).

CSS uses two parallel variable naming systems: the new `--bg`/`--surface`/`--hairline`/`--muted` system and the legacy `--border`/`--bg-subtle`/`--bg-hover`/`--bg-selected`/`--text-muted`/`--accent-contrast` system. The legacy variables are already aliased to new-system values (`styles.css:4182-4189`), but both sets are still referenced throughout, making maintenance harder.

The mention (`@`) and slash (`/`) popups share a single `composerMenuItems` state and a single popup DOM node. The `composerTrigger` regex (`composerMenu.ts:20`: `/(?:^|\s)([@/])([^\s@/]*)$/`) excludes both `@` and `/` from the query, so typing `@agent/` breaks the mention match and produces no popup — the behavior is non-obvious.

---

## 3. Proposed Solution

### 3.1 P1-1: Split `loadingLabel` into per-action loading flags

#### 3.1.1 Survey of `setLoadingLabel` call sites

Direct `setLoadingLabel` calls outside `runAction`:

| Line | Call | Semantic group |
|---|---|---|
| 2120 | `setLoadingLabel(label)` inside `runAction` | Generic (wrapped actions) |
| 2130 | `setLoadingLabel(undefined)` in `runAction` finally | Generic (clear) |
| 7078 | `setLoadingLabel('Opening browser')` | preview/external-link |
| 7089 | `setLoadingLabel(undefined)` | preview/external-link clear |
| 7115 | `setLoadingLabel('Opening browser')` | preview/external-link |
| 7126 | `setLoadingLabel(undefined)` | preview/external-link clear |

`runAction(label, action)` is invoked at ~40 sites (`App.tsx:2447, 2565, 2583, 3021, 3377, 3831, 4398, 4644, 4670, 5272, 5334, 5367, 5409, 5468, 5484, 5535, 5609, 5660, 5724, 5760, 7041, 7143, 7193, 7725, 7798, 7859, 7892, 7951, 7986, 8218, 8544, 8917, 9108, 9122, 9286, 9461, 10150, ...`). Each label string falls into one of the following semantic groups:

| Group | Representative labels | `runAction` call sites |
|---|---|---|
| `workspace` | "Refreshing workspace", "Refreshing files", "Refreshing diff", "Opening file", "Saving file" | 2447, 3377, 3831, 4398, 5484, 5535, 5724, 5760 |
| `session` | "Creating session", "Closing session", "Cancelling turn", "Clearing desktop transcript view", "Opening session folder", "Sending message" | 4644, 4670, 5272, 5334, 5367, 5409, 5468 |
| `diagnostics` | "Exporting diagnostics", "Loading sessions" | 2583, 3021 |
| `config` | "Refreshing config", "Saving proxy settings" | 2565, 7143 |
| `mcp` | "Saving MCP server", "Removing MCP server", "Reading MCP server", "Reading project MCP server", "Approving/Rejecting project MCP server", "Enabling/Disabling MCP server", "Checking MCP" | 7725, 7798, 7859, 7892, 7951, 7986, 8218 |
| `agents` | "Refreshing agents", "Diagnosing agent", + agent task operations | 8544, 8917, 9108, 9122, 9286, 9461, 10150 |
| `preview` | "Opening preview", "Opening browser" (direct `setLoadingLabel` at 7078, 7115) | 7041, 7078, 7115 |
| `shell` | "Starting shell", "Stopping shell" | 5609, 5660 |

#### 3.1.2 New state shape

Replace the single `loadingLabel: string` with a set of boolean flags plus an optional human-readable label retained for the pane-loading-status indicator:

```typescript
type LoadingScope =
  | 'workspace'
  | 'session'
  | 'diagnostics'
  | 'config'
  | 'mcp'
  | 'agents'
  | 'preview'
  | 'shell'

type LoadingState = {
  [K in LoadingScope]: { active: boolean; label?: string }
}
```

Implementation: keep a single `useState<Partial<Record<LoadingScope, string>>>` mapping scope → label (undefined means not loading). Derive booleans via `Boolean(loading[scope])`. A convenience `isLoading = (scope: LoadingScope) => Boolean(loading[scope])` accessor.

Keep `loadingLabel` as a derived value for the existing `pane-loading-status` indicator:
```typescript
const loadingLabel = useMemo(() => {
  const entries = Object.entries(loading)
  return entries.length ? entries[0][1] : undefined
}, [loading])
```
(This preserves the existing `{loadingLabel && <span className="pane-loading-status">...}` rendering at `App.tsx:12683, 12718, 12941, 13145` without change.)

#### 3.1.3 `runAction` wrapper update

```typescript
async function runAction<T>(
  scope: LoadingScope,
  label: string,
  action: () => Promise<T>,
): Promise<T | undefined> {
  setError(undefined)
  setLoading(prev => ({ ...prev, [scope]: label }))
  const errorTarget = activePane
  try {
    return await action()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    setError(message)
    setActivePaneError(errorTarget, message)
    return undefined
  } finally {
    setLoading(prev => {
      const next = { ...prev }
      delete next[scope]
      return next
    })
  }
}
```

Every existing `runAction('Label', fn)` call site is updated to `runAction('scope', 'Label', fn)` using the group mapping above. The two direct `setLoadingLabel('Opening browser')` call sites (7078, 7115) are migrated to `setLoading(prev => ({ ...prev, preview: 'Opening browser' }))`.

#### 3.1.4 `disabled` binding migration

Each `disabled={!!loadingLabel}` reference is rebound to the relevant scope flag. Guiding principle: a button is only disabled by the scope it belongs to or by a scope that structurally conflicts with it (e.g., session-closing blocks session-row clicks).

| Disabled location (representative) | New binding |
|---|---|
| Chat header buttons (Refresh workspace, Cancel turn, Clear view, Close session) at `App.tsx:11079-11101` | `isLoading('workspace') \|\| isLoading('session')` |
| Composer send button (`App.tsx:11455`) | `isLoading('session')` (only block while sending/closing) |
| Session row click / context menu button (`App.tsx:10929, 10948`) | `isLoading('session')` |
| `rail-section-toggle` sessions collapse (`App.tsx:10910`) | `isLoading('session')` |
| Monaco `readOnly` (`App.tsx:4564, 4589`) | `isLoading('workspace')` (only block file ops) |
| Listbox `tabIndex` (e.g., `workspacePaneTabState` at 6517) | `isLoading('workspace')` |
| Agents pane buttons (`App.tsx:12194-12265`) | `isLoading('agents') \|\| isLoading('session')` |
| Teams pane buttons (`App.tsx:12470-12649`) | `isLoading('agents') \|\| isLoading('session')` (team ops route through agent runtime) |
| MCP pane buttons (`App.tsx:12747-12909`) | `isLoading('mcp')` |
| Skills pane buttons (`App.tsx:12972-13058`) | `isLoading('mcp')` (skill install shares MCP runtime path) — or a separate `isLoading('config')` if preferred |
| Settings pane buttons (`App.tsx:12684, 12719, 12942, 13146`) | `isLoading('config')` |
| Diagnostics export (`App.tsx:13205`) | `isLoading('diagnostics')` |
| Proxy settings (`App.tsx:13232`) | `isLoading('config')` |
| Plugin buttons (`App.tsx:13253-13332`) | `isLoading('config')` |
| Command palette items (`App.tsx:3993-4050`) | Remove `disabled: !!loadingLabel` entirely — navigation commands should always be available; only disable slash commands via `isLoading('session')` |
| Confirm/permission modal buttons (`App.tsx:13440, 13447, 13503, 13506, 13509`) | Keep `isLoading('session')` (these are session-scoped) |
| Early-return guards in handlers (`if (loadingLabel) return` at 1929, 2223, 2445, 2451, 2560, 2579, ...) | Replace with `if (isLoading('relevant-scope')) return` per handler |

#### 3.1.5 `focusComposer` and effect dependencies

`focusComposer` (`App.tsx:2289-2306`) and the composer-focus effect at 2714-2716 currently depend on `loadingLabel`. Replace with `isLoading('session')` — the composer should be focusable during workspace refresh or MCP operations, just not during send/cancel/close.

### 3.2 P1-10 / P1-2: Generic error recovery (retry / details / auto-dismiss)

#### 3.2.1 New error state shape

Replace `const [error, setError] = useState<string>()` with:

```typescript
type AppError = {
  message: string
  stack?: string
  retryAction?: () => void
  createdAt: number
}
const [error, setError] = useState<AppError>()
```

#### 3.2.2 `runAction` catch preserves stack and retry closure

```typescript
async function runAction<T>(
  scope: LoadingScope,
  label: string,
  action: () => Promise<T>,
): Promise<T | undefined> {
  setError(undefined)
  setLoading(prev => ({ ...prev, [scope]: label }))
  const errorTarget = activePane
  try {
    return await action()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    const stack = cause instanceof Error ? cause.stack : undefined
    setError({
      message,
      stack,
      retryAction: () => { void runAction(scope, label, action) },
      createdAt: Date.now(),
    })
    setActivePaneError(errorTarget, message)
    return undefined
  } finally {
    setLoading(prev => { const next = { ...prev }; delete next[scope]; return next })
  }
}
```

Direct `setError(message)` call sites outside `runAction` (e.g., `App.tsx:2146, 2169, 2703, 3138, 3176, 4990, 5004, 5021, 5029, 5563, 5584, 7030, 7035, 7066, 7071, 7086, 7103, 7108, 7123`) are wrapped into `setError({ message, createdAt: Date.now() })` with no `retryAction`/`stack`.

#### 3.2.3 Banner JSX

Replace `{error && <div className="inline-error">{error}</div>}` at `App.tsx:11068`:

```jsx
{error && (
  <div className="inline-error dismissible-error" role="alert">
    <span>{error.message}</span>
    <div className="error-actions">
      {error.retryAction && (
        <button
          className="error-retry"
          onClick={() => { const fn = error.retryAction; setError(undefined); fn?.() }}
          aria-label="Retry action"
        >
          <Icon name="refresh" width={14} height={14} />Retry
        </button>
      )}
      <button
        className="error-details-toggle"
        onClick={() => setErrorDetailsOpen(prev => !prev)}
        aria-expanded={errorDetailsOpen}
        aria-label="Toggle error details"
        disabled={!error.stack}
      >
        <Icon name="chevron-down" width={14} height={14} />Details
      </button>
      <button
        className="error-dismiss"
        onClick={() => setError(undefined)}
        aria-label="Dismiss error"
      >
        <Icon name="x" width={14} height={14} />
      </button>
    </div>
    {errorDetailsOpen && error.stack && (
      <pre className="error-stack">{error.stack}</pre>
    )}
  </div>
)}
```

New state: `const [errorDetailsOpen, setErrorDetailsOpen] = useState(false)`. Reset to `false` whenever `setError` is called with a new error (handle in the setter wrapper or via effect on `error?.createdAt`).

#### 3.2.4 Auto-dismiss timer

Add a timeout effect mirroring `conversationNotice`:

```typescript
useEffect(() => {
  if (!error) return
  const timer = window.setTimeout(() => {
    setError(undefined)
  }, 8000)
  return () => window.clearTimeout(timer)
}, [error])
```

Safety: the timer is keyed on `error` object identity. Calling `setError` with a new error resets the timer. Calling `setError(undefined)` (e.g., by `runAction` entry) clears it. If a new `runAction` starts while the old error is still showing, `setError(undefined)` at the top of `runAction` clears the old error and its timer.

`activeSession.lastError` dismiss mechanism (`App.tsx:11060-11066`) is left untouched — it is session-scoped and already has its own dismiss button.

### 3.3 P1-11 / P1-9: Session context menu focus trap and keyboard navigation

#### 3.3.1 Extract `trapMenuFocus` utility

Create a new helper alongside `trapModalFocus` (`App.tsx:2308`):

```typescript
function trapMenuFocus(
  event: KeyboardEvent,
  menu: HTMLElement | null,
  itemSelector: string,
): void {
  if (!menu) return
  if (event.key === 'Tab') {
    event.preventDefault()
    const items = [...menu.querySelectorAll<HTMLElement>(itemSelector)]
      .filter(el => el.offsetParent !== null)
    if (!items.length) return
    const active = document.activeElement
    const currentIndex = items.findIndex(el => el === active)
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? items.length - 1 : currentIndex - 1)
      : (currentIndex >= items.length - 1 ? 0 : currentIndex + 1)
    items[nextIndex]?.focus()
    return
  }
}
```

#### 3.3.2 Open-menu focus

When `sessionMenu` or `sessionCreateMenu` opens, focus the first menu item. Add refs:

```typescript
const sessionMenuRef = useRef<HTMLDivElement>(null)
const sessionCreateMenuRef = useRef<HTMLDivElement>(null)
const sessionMenuReturnFocusRef = useRef<HTMLElement | null>(null)
```

In `openSessionMenu` and `openSessionCreateMenu`, call `captureReturnFocus(sessionMenuReturnFocusRef)` before setting state, then in a `useEffect` keyed on `sessionMenu`/`sessionCreateMenu` being truthy:

```typescript
useEffect(() => {
  if (!sessionMenu) return
  const menu = sessionMenuRef.current
  if (!menu) return
  const firstItem = menu.querySelector<HTMLElement>('button[role="menuitem"]')
  requestAnimationFrame(() => firstItem?.focus())
}, [sessionMenu])
```

Same pattern for `sessionCreateMenu`.

#### 3.3.3 Keyboard handler update

Extend the existing keyboard handler (`App.tsx:2722-2789`) to:
1. Call `trapMenuFocus(event, menuRef.current, 'button[role="menuitem"]')` for `Tab`.
2. For `ArrowDown`/`ArrowUp`: after updating `sessionMenuActiveIndex`/`sessionCreateMenuActiveIndex`, call `document.getElementById(itemId)?.focus()` so the menu item actually receives focus (not just `aria-activedescendant`).
3. For `Escape`: after `closeMenu()`, call `restoreFocus(sessionMenuReturnFocusRef)`.
4. For `Enter`: existing `runSessionMenuAction` / `runSessionCreateMenuAction` behavior stays.
5. For `Enter` on a focused menu item: the existing `onClick` handler on each `<button>` fires; no extra handler needed since `Enter` on a focused button triggers click.

#### 3.3.4 Menu JSX updates

Add `ref={sessionMenuRef}` / `ref={sessionCreateMenuRef}` to the menu container `<div>`s at `App.tsx:10967, 11002`. Change `aria-disabled` / `tabIndex` on items from `aria-disabled={!!loadingLabel}` / `tabIndex={loadingLabel ? -1 : 0}` to `tabIndex={0}` (all items are always focusable; roving tabindex is handled by the trap).

### 3.4 P1-12 / P1-4: F2 rename session + command palette "Rename session"

#### 3.4.1 New IPC handler: `sessions:rename`

Add to `desktop/main/main.ts` IPC registration list (line 527-540) and handler (after line 636):

```typescript
handleIpc('sessions:rename', (sessionId: string, title: string) =>
  sessionManager.renameSession(sessionId, title))
```

Add to `desktop/main/sessionManager.ts`:

```typescript
renameSession(sessionId: string, title: string): DesktopSession {
  const session = this.sessions.get(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)
  const trimmed = title.trim()
  if (!trimmed) throw new Error('Title must not be empty')
  session.title = trimmed
  session.updatedAt = Date.now()
  this.emit('change', { sessions: this.list() })
  return this.toDesktopSession(session)
}
```

Add to `desktop/preload/preload.ts` sessions API (after line 110):

```typescript
rename: (sessionId: string, title: string) =>
  ipcRenderer.invoke('sessions:rename', sessionId, title) as Promise<DesktopSession>,
```

Add `'sessions:rename'` to the IPC whitelist in `desktop/main/main.ts` (line ~540).

#### 3.4.2 Renderer rename state

```typescript
const [renamingSessionId, setRenamingSessionId] = useState<string>()
const [renameValue, setRenameValue] = useState('')
const renameInputRef = useRef<HTMLInputElement>(null)
```

#### 3.4.3 Enter rename mode

```typescript
function startRenameSession(sessionId: string): void {
  if (isLoading('session')) return
  const session = sessions.find(s => s.id === sessionId)
  if (!session) return
  setRenamingSessionId(sessionId)
  setRenameValue(session.title)
  requestAnimationFrame(() => renameInputRef.current?.select())
}

function commitRenameSession(): void {
  const id = renamingSessionId
  if (!id) return
  const title = renameValue.trim()
  setRenamingSessionId(undefined)
  setRenameValue('')
  if (!title) return
  const current = sessionsRef.current.find(s => s.id === id)
  if (current && current.title === title) return
  void runAction('session', 'Renaming session', async () => {
    const updated = await window.claudeDesktop.sessions.rename(id, title)
    mergeSession(updated)
  })
}

function cancelRenameSession(): void {
  setRenamingSessionId(undefined)
  setRenameValue('')
}
```

#### 3.4.4 F2 keyboard handler

Add to the global `keydown` effect (the one at `App.tsx:6328` that checks `confirmRequest || pendingPermission || ...`):

```typescript
if (event.key === 'F2' && activeSessionId && !renamingSessionId) {
  event.preventDefault()
  startRenameSession(activeSessionId)
  return
}
```

#### 3.4.5 Command palette item

Insert into `commandPaletteItems` (`App.tsx:3972`), after the slash commands and before the navigation commands:

```typescript
{
  id: 'session:rename',
  label: 'Rename session',
  detail: 'Rename the current session title',
  icon: 'edit',
  disabled: !activeSession || isLoading('session'),
  disabledReason: !activeSession ? 'Select a session first.' : undefined,
  run: () => activeSession && startRenameSession(activeSession.id),
},
```

#### 3.4.6 Session row JSX: inline rename input

In the session row rendering (`App.tsx:10922-10950`), when `renamingSessionId === session.id`, replace the `<strong>{session.title}</strong>` with an `<input>`:

```jsx
{renamingSessionId === session.id ? (
  <input
    ref={renameInputRef}
    className="session-rename-input"
    value={renameValue}
    onChange={e => setRenameValue(e.target.value)}
    onKeyDown={e => {
      if (e.key === 'Enter') { e.preventDefault(); commitRenameSession() }
      if (e.key === 'Escape') { e.preventDefault(); cancelRenameSession() }
    }}
    onBlur={commitRenameSession}
    aria-label="Rename session"
  />
) : (
  <strong>{session.title}</strong>
)}
```

Also add `onDoubleClick` on the session row shell to trigger `startRenameSession(session.id)`.

### 3.5 P1-5: Command palette navigation commands (calibration + enhancement)

**Calibration note**: Navigation commands for Chat/Agents/Teams/Tasks/MCP/Skills/Settings **already exist** at `App.tsx:3993-4050`. The audit report's claim that the palette is "primarily file/slash commands" is inaccurate. However, improvements are still warranted:

1. **Add a divider** between slash commands and navigation commands. Insert `{ divider: true, label: 'Navigate' }` (if `CommandPaletteItem` supports dividers) or group them under a `'Navigate'` group label before the first `primary:*` item.
2. **Remove `disabled: !!loadingLabel`** from all navigation command items. Navigation should always be available — switching panes does not depend on any loading scope.
3. **Add shortcut hints** in the `detail` field (e.g., `detail: 'Open the conversation (⌘1)'`).
4. **Add "Rename session"** command (see 3.4.5 above) in a `'Session'` group.

If `CommandPaletteItem` does not support dividers, add an optional `group?: string` field to `CommandPaletteItem` type and render group headers in the palette list.

### 3.6 P1-6: Multi-session streaming indicator

#### 3.6.1 Session row class

In the session row rendering (`App.tsx:10929`), change:

```jsx
className={`session-row ${session.id === activeSessionId ? 'active' : ''}`}
```

to:

```jsx
className={`session-row ${session.id === activeSessionId ? 'active' : ''} ${session.activity === 'streaming' ? 'streaming' : ''}`}
```

#### 3.6.2 CSS animation

Add to `desktop/renderer/src/styles.css`:

```css
.session-row.streaming {
  box-shadow: inset 3px 0 0 0 var(--accent);
  animation: session-streaming-pulse 1.8s ease-in-out infinite;
}

@keyframes session-streaming-pulse {
  0%, 100% { background: transparent; }
  50% { background: color-mix(in srgb, var(--accent) 6%, transparent); }
}

[data-theme="dark"] .session-row.streaming {
  box-shadow: inset 3px 0 0 0 var(--accent);
  animation: session-streaming-pulse-dark 1.8s ease-in-out infinite;
}

@keyframes session-streaming-pulse-dark {
  0%, 100% { background: transparent; }
  50% { background: color-mix(in srgb, var(--accent) 12%, transparent); }
}
```

The existing `.status-dot.streaming` class on the status dot already exists (it gets `session.activity` applied at `App.tsx:10931`). Verify the status dot already pulses; if not, add a similar pulse animation to `.status-dot.streaming`.

### 3.7 P1-13: Empty-state CTAs

Add a primary action button to each of the five empty states, matching the session empty-state CTA pattern (`App.tsx:11116-11121`).

| Empty state | Location | CTA button |
|---|---|---|
| Agents — "No agents loaded" | `App.tsx:11872-11876` | `<button className="tool-button" onClick={handleRefreshAgentsClick}><Icon name="refresh" />Refresh agents</button>` (existing `handleRefreshAgentsClick` calls `runAction('agents', 'Refreshing agents', ...)`) |
| Teams — "No teams found" | `App.tsx:12656-12660` | `<button className="tool-button" onClick={startNewTeamDraft}><Icon name="plus" />Create team</button>` (existing `startNewTeamDraft` at `App.tsx:1928`) |
| Teammates — "No teammates reported" | `App.tsx:12635-12639` | No CTA (teammates depend on a selected team; adding a CTA here would be misleading). Instead, add a hint: `<span>Select or create a team first, then spawn a teammate.</span>` |
| Project tasks — "No project scheduled tasks" | `App.tsx:10635-10639` | `<button className="tool-button" onClick={() => startNewProjectTaskDraft()}><Icon name="plus" />Add task</button>` (wire to existing task-creation draft handler or add one) |
| Global tasks — "No global scheduled tasks" | `App.tsx:10742-10746` | `<button className="tool-button" onClick={() => startNewGlobalTaskDraft()}><Icon name="plus" />Add task</button>` |

JSX pattern for each:

```jsx
<div className="workarea-empty settings-empty-state">
  <Icon name="bot" />
  <strong>No agents loaded</strong>
  <span>Refresh to load built-in and user agents.</span>
  <div className="empty-actions">
    <button className="tool-button" onClick={handleRefreshAgentsClick} disabled={isLoading('agents')}>
      <Icon name="refresh" />Refresh agents
    </button>
  </div>
</div>
```

If `startNewProjectTaskDraft` / `startNewGlobalTaskDraft` do not exist, they must be added as thin wrappers that set the relevant task draft state (same pattern as `startNewTeamDraft`).

### 3.8 P2-1: CSS color palette unification

#### 3.8.1 Decision: keep the new system, alias the old

The new system (`--bg`, `--surface`, `--surface-2`, `--surface-3`, `--text`, `--muted`, `--hairline`, `--accent`, `--accent-strong`, `--blue`, `--green`, `--red`) is the canonical set. The legacy variables (`--border`, `--bg-subtle`, `--bg-hover`, `--bg-selected`, `--text-muted`, `--accent-contrast`) are already aliased at `styles.css:4182-4189`:

```css
:root {
  --border: #d7d0c4;
  --bg-subtle: #f0ede7;
  --bg-hover: #eee9e1;
  --bg-selected: #e8e2d8;
  --text-muted: #70685d;
  --accent-contrast: #fff;
}
[data-theme="dark"] {
  --border: var(--hairline);
  --bg-subtle: var(--surface-2);
  --bg-hover: var(--surface-3);
  --bg-selected: var(--surface-3);
  --text-muted: var(--muted);
  --accent-contrast: #fff;
}
```

#### 3.8.2 Migration strategy

**Phase 1 (this batch)**: Search-and-replace all references to legacy variables with their canonical equivalents:

| Legacy variable | Canonical replacement |
|---|---|
| `var(--border)` | `var(--hairline)` |
| `var(--bg-subtle)` | `var(--surface-2)` |
| `var(--bg-hover)` | `var(--surface-3)` |
| `var(--bg-selected)` | `var(--surface-3)` |
| `var(--text-muted)` | `var(--muted)` |
| `var(--accent-contrast)` | `#fff` (literal, since it's constant) or define `--accent-contrast: #fff` as a permanent token |

**Phase 2**: Remove the legacy variable definitions at `styles.css:4182-4189` once no references remain.

**Phase 3 (optional, future)**: Rename `--accent-contrast` to `--on-accent` for clarity if it is retained as a token.

#### 3.8.3 Risk mitigation

- Run a grep before removal to confirm zero remaining references.
- Keep the alias block for one release cycle as a safety net, then remove.
- Test both light and dark themes after replacement.

### 3.9 P2-14: Mention / slash popup shared `composerMenuItems`

#### 3.9.1 Root cause

The `composerTrigger` regex (`composerMenu.ts:20`):

```
/(?:^|\s)([@/])([^\s@/]*)$/
```

The query character class `[^\s@/]` excludes both `@` and `/`. So typing `@agent/` causes the regex to stop matching at the `/`, and no trigger is returned — the mention popup disappears and no slash popup appears.

#### 3.9.2 Proposed behavior

When the user is in mention mode (`@`) and types `/`:
- **Option A (recommended)**: The `/` is treated as part of the mention query (allow `/` in mention queries). This lets users type `@skill:name` or `@mcp:name` without losing the popup. To implement: change the regex to `/(?:^|\s)([@/])([^\s@]*?)$/` (remove `/` from the exclusion). The slash command trigger is still possible when `/` appears at the start of a token.
- **Option B**: When `/` is typed while in `@` mode, close the mention popup and do not open a slash popup (the `/` is inserted as literal text). This is simpler but less useful.
- **Option C**: Split into separate `mentionItems` and `slashItems` states. More complex, no clear user benefit over Option A.

**Chosen: Option A.** Update the regex in `composerMenu.ts:14-32`:

```typescript
export function composerTrigger(
  input: string,
  cursor: number,
): ComposerTrigger | undefined {
  const boundedCursor = Math.max(0, Math.min(cursor, input.length))
  const before = input.slice(0, boundedCursor)
  // Allow `/` in mention queries (for @skill:name, @mcp:name, @filepath/path)
  // but still treat `/` as a trigger when preceded by start or whitespace.
  const match = /(?:^|\s)([@/])([^\s@]*)$/.exec(before)
  if (!match || match.index === undefined) return undefined
  const triggerChar = match[1] as '@' | '/'
  const leadingSpace = match[0].startsWith(' ') ? 1 : 0
  const start = match.index + leadingSpace
  const query = match[2] ?? ''
  return { kind: triggerChar, query, start, end: boundedCursor }
}
```

The only change is `[^\s@/]` → `[^\s@]` in the regex. This means:
- `@agent` → mention popup (unchanged)
- `/command` → slash popup (unchanged)
- `@agent/something` → mention popup with query `agent/something` (fixed — previously no popup)
- `text /command` → slash popup (unchanged, `/` is preceded by space)

#### 3.9.3 Visual feedback for trigger kind

The popup already switches its `aria-label` based on `currentComposerTrigger.kind` (`App.tsx:11358`). No additional visual change needed — the popup header already shows `@` or `/` at `App.tsx:11367`.

#### 3.9.4 Keep single `composerMenuItems` state

Splitting into `mentionItems` / `slashItems` is unnecessary because only one trigger can be active at a time (the regex matches at most one trigger at the cursor position). The single `composerMenuItems` with `currentComposerTrigger.kind` branch is sufficient.

### 3.10 Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Loading state shape | Single `Record<LoadingScope, string>` | Simpler than multiple `useState` booleans; preserves label text; easy to clear per-scope |
| Error retry mechanism | Store closure in error state | Avoids reconstructing the action at the banner; closure captures scope+label+action |
| Error auto-dismiss | 8s timeout (matching `conversationNotice` error) | Consistency; user can dismiss earlier; retry resets the timer |
| Session menu focus trap | New `trapMenuFocus` (Tab-only) vs reuse `trapModalFocus` | `trapModalFocus` handles Tab but menu items also need ArrowDown→focus; separate function is cleaner |
| F2 rename IPC | New `sessions:rename` IPC + `sessionManager.renameSession` | `title` is a top-level field, not part of `layout`; cannot use existing `updateLayout` |
| Composer trigger regex | Remove `/` from exclusion `[^\s@]` | Enables `@skill:name` / `@mcp:name` / `@filepath` without breaking `/command` |
| CSS palette migration | Replace legacy vars with canonical, keep alias block one release | Safety net for missed references |
| Empty-state CTA for teammates | No CTA button, only hint | Teammates depend on a selected team; a CTA would be misleading |

---

## 4. Affected Files

### New Files

- None (all changes are in existing files)

### Modified Files

| File | Changes | Approximate line ranges |
|---|---|---|
| `desktop/renderer/src/App.tsx` | Replace `loadingLabel` state with `loading` record + `isLoading()`; update `runAction` signature; rebind ~100 `disabled` checks; update error state to `AppError`; add error banner retry/details/dismiss/auto-dismiss; add `trapMenuFocus`; wire session menu focus trap + return focus; add rename state + F2 handler + command palette item + session-row inline input; add streaming class to session row; add CTA buttons to 4 empty states; remove `disabled: !!loadingLabel` from command palette nav items; add navigation command divider/group | 1918-1920 (state), 2118-2132 (runAction), 2235-2327 (focus utils), 2722-2789 (menu key handler), 3581-3625 (composerMenuItems deps), 3972-4050 (command palette items), 4564-4610 (Monaco readOnly), 6328-6339 (global keydown), 6437-6525 (listbox tabIndex), 10635-10639 (project tasks empty), 10742-10746 (global tasks empty), 10922-10950 (session row), 11001-11044 (session menu JSX), 10966-11000 (session create menu JSX), 11060-11068 (error banner), 11863-11876 (agents empty), 12635-12660 (teammates + teams empty) |
| `desktop/renderer/src/composerMenu.ts` | Update `composerTrigger` regex: `[^\s@/]` → `[^\s@]` | Line 20 |
| `desktop/renderer/src/styles.css` | Add `.session-row.streaming` animation + `.error-actions` / `.error-stack` / `.error-retry` / `.error-details-toggle` / `.session-rename-input` styles; verify legacy var removal post-migration | New rules near session-row styles (~L1090+); error banner styles near `.inline-error`; legacy var block at 4182-4189 (remove in phase 2) |
| `desktop/main/main.ts` | Add `'sessions:rename'` to IPC whitelist + `handleIpc('sessions:rename', ...)` | ~L540, ~L636 |
| `desktop/main/sessionManager.ts` | Add `renameSession(sessionId, title)` method | After line 69 |
| `desktop/preload/preload.ts` | Add `rename: (sessionId, title) => ipcRenderer.invoke('sessions:rename', ...)` to `sessions` object | After line 110 |

### Deleted Files

- None

---

## 5. Interface / API Changes

### 5.1 Function Signatures

```typescript
// desktop/renderer/src/App.tsx

// Changed: runAction now takes a LoadingScope as first argument
async function runAction<T>(
  scope: LoadingScope,
  label: string,
  action: () => Promise<T>,
): Promise<T | undefined>

// New: per-scope loading check
function isLoading(scope: LoadingScope): boolean

// New: error state shape
type AppError = {
  message: string
  stack?: string
  retryAction?: () => void
  createdAt: number
}

// New: menu focus trap
function trapMenuFocus(
  event: KeyboardEvent,
  menu: HTMLElement | null,
  itemSelector: string,
): void

// New: session rename
function startRenameSession(sessionId: string): void
function commitRenameSession(): void
function cancelRenameSession(): void
```

```typescript
// desktop/renderer/src/composerMenu.ts

// Changed: regex updated (no signature change)
export function composerTrigger(
  input: string,
  cursor: number,
): ComposerTrigger | undefined
// Regex: /(?:^|\s)([@/])([^\s@]*)$/  (was: [^\s@/])
```

```typescript
// desktop/main/sessionManager.ts

// New
renameSession(sessionId: string, title: string): DesktopSession
```

```typescript
// desktop/preload/preload.ts

// New: added to sessions object
rename: (sessionId: string, title: string) =>
  ipcRenderer.invoke('sessions:rename', sessionId, title) as Promise<DesktopSession>
```

### 5.2 Data Structures

```typescript
type LoadingScope =
  | 'workspace'
  | 'session'
  | 'diagnostics'
  | 'config'
  | 'mcp'
  | 'agents'
  | 'preview'
  | 'shell'

// loading state: Partial<Record<LoadingScope, string>> (scope → label, absent = not loading)

type AppError = {
  message: string
  stack?: string
  retryAction?: () => void
  createdAt: number
}
```

### 5.3 IPC Endpoints

| Method | Channel | Request | Response |
|---|---|---|---|
| `sessions:rename` | `ipcRenderer.invoke('sessions:rename', sessionId, title)` | `{ sessionId: string, title: string }` | `DesktopSession` |

### 5.4 Config / Environment Variables

- None

---

## 6. Testing Plan

### 6.1 P1-1: loadingLabel split

**Manual:**
1. Start a workspace refresh (`⌘R` or Refresh workspace button). While loading, verify the composer send button is NOT disabled (type and send a message).
2. Start an MCP health check. While loading, verify the Agents pane buttons are still clickable.
3. Start a diagnostics export. While loading, verify the Monaco editor is NOT read-only.
4. Close a session. While closing, verify the Settings pane is still fully interactive.
5. Verify the `pane-loading-status` indicator still shows the correct label during each operation.

**Automatable (future):**
- Component test: render App with `loading = { mcp: 'Checking MCP' }`. Assert that MCP pane buttons have `disabled=true` and agents pane buttons have `disabled=false`.

### 6.2 P1-10 / P1-2: Error recovery

**Manual:**
1. Trigger an error (e.g., save proxy settings with invalid values). Verify the error banner appears with Retry, Details, and Dismiss buttons.
2. Click "Details" — verify the stack trace `<pre>` expands.
3. Click "Retry" — verify the original action re-runs.
4. Wait 8 seconds without interaction — verify the banner auto-dismisses.
5. Start a new `runAction` while an error is showing — verify the old error clears immediately.

**Automatable:**
- Unit test: `runAction` catch path produces `AppError` with `message`, `stack`, and `retryAction` defined.
- Unit test: auto-dismiss timer fires after 8000ms.

### 6.3 P1-11 / P1-9: Session menu focus trap

**Manual:**
1. Right-click a session row. Verify focus moves to the first menu item ("Focus session").
2. Press Tab — verify focus cycles to the next menu item, not to the underlying UI.
3. Press Shift+Tab — verify focus cycles backward.
4. Press ArrowDown — verify focus moves to the next item (not just `aria-activedescendant` change).
5. Press Escape — verify the menu closes and focus returns to the session row's "Manage" button.
6. Press Enter — verify the selected action runs.
7. Repeat all steps for `sessionCreateMenu` (the "+" new-session menu).

**Automatable:**
- DOM test: after opening `sessionMenu`, assert `document.activeElement` is a `button[role="menuitem"]` inside the menu container.

### 6.4 P1-12 / P1-4: F2 rename

**Manual:**
1. Select a session. Press F2 — verify the session title becomes an editable input with the current title selected.
2. Type a new name, press Enter — verify the title updates in the sidebar and chat header.
3. Press F2 again, type a new name, press Escape — verify the title reverts.
4. Press F2, type a new name, click elsewhere (blur) — verify the rename commits.
5. Double-click a session row — verify it enters rename mode.
6. Open command palette (`⌘K`), type "rename" — verify "Rename session" appears. Select it — verify it enters rename mode for the current session.
7. Try renaming to an empty string — verify it is rejected (title unchanged).

**Automatable:**
- IPC test: `sessions:rename` with empty title throws.
- IPC test: `sessions:rename` with valid title returns updated `DesktopSession`.

### 6.5 P1-5: Command palette navigation

**Manual:**
1. Open command palette (`⌘K`). Verify navigation commands (Chat, Agents, Teams, Tasks, MCP, Skills, Settings) appear in a distinct group, separated from slash commands.
2. Start a workspace refresh. While loading, open the palette and verify navigation commands are NOT disabled.
3. Select "Agents" — verify the primary nav switches to the Agents pane.
4. Verify slash commands are still disabled during `session` loading.

### 6.6 P1-6: Multi-session streaming

**Manual:**
1. Start a message in session A (streaming begins). While streaming, verify session A's row in the sidebar has the `streaming` class and shows a pulsing animation / accent border.
2. Switch to session B and start streaming. Verify both A and B rows show the streaming indicator.
3. When streaming completes, verify the animation stops.

**Automatable:**
- CSS test: `.session-row.streaming` has `animation` property set.

### 6.7 P1-13: Empty-state CTAs

**Manual:**
1. Clear all agents (or use a fresh workspace with no user agents). Navigate to Agents pane — verify "Refresh agents" CTA button appears and clicking it triggers the refresh.
2. Navigate to Teams pane with no teams — verify "Create team" CTA button appears and clicking it starts a new team draft.
3. Navigate to Tasks pane — verify "Add task" CTA appears for both project and global task sections.
4. Verify the teammates empty state shows the hint text (no CTA button).

### 6.8 P2-1: Color palette unification

**Manual:**
1. Search `styles.css` for `var(--border)`, `var(--bg-subtle)`, `var(--bg-hover)`, `var(--bg-selected)`, `var(--text-muted)`, `var(--accent-contrast)` — verify zero references remain after migration.
2. Toggle light/dark theme — verify all surfaces, borders, and text colors are unchanged.

**Automatable:**
- Grep test: `grep -c 'var(--border)\|var(--bg-subtle)\|var(--bg-hover)\|var(--bg-selected)\|var(--text-muted)\|var(--accent-contrast)' styles.css` returns 0 (after phase 2 removal).

### 6.9 P2-14: Mention / slash popup

**Manual:**
1. Type `@` in the composer — verify the mention popup appears.
2. Type `@agent` — verify the popup filters agents.
3. Type `@agent/` — verify the popup stays open (previously it would disappear).
4. Type `/` at the start of a new line — verify the slash command popup appears.
5. Type `text @` — verify mention popup appears after space.
6. Type `text /` — verify slash popup appears after space.

**Automatable:**
- Unit test: `composerTrigger('@agent/something', 16)` returns `{ kind: '@', query: 'agent/something', ... }`.
- Unit test: `composerTrigger('/command', 8)` returns `{ kind: '/', query: 'command', ... }`.

---

## 7. Risks & Alternatives

### Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `loadingLabel` split misses a `disabled` binding, causing a button to remain permanently enabled/disabled | UI inconsistency or double-submit | Full grep audit before/after; QA agent independently tests each pane during loading |
| `runAction` signature change (`label` → `scope, label`) breaks a call site not in the survey | Compile error or runtime error | TypeScript compiler catches missing args; grep for `runAction(` to verify all sites updated |
| Error `retryAction` closure captures stale state | Retry runs with old session/config | Closure captures `scope`, `label`, `action` from the `runAction` call frame; action itself references current refs (e.g., `activeSession` via `sessionsRef.current`) |
| Session menu focus trap interferes with global keydown handler at `App.tsx:6328` | Key events double-handled | Global handler checks `sessionMenu \|\| sessionCreateMenu` and returns early; menu keydown handler at 2722 is separate |
| `sessions:rename` IPC not in whitelist | Rename fails silently in production | Add to whitelist array at `main.ts:527-540`; test in packaged build |
| CSS variable replacement introduces subtle color differences in dark theme | Visual regression | Legacy aliases already map to identical values; verify with before/after screenshot diff |
| `composerTrigger` regex change `[^\s@/]` → `[^\s@]` allows unexpected characters in slash queries | Slash popup shows for `/command with spaces` | The regex still requires the trigger char after whitespace/start; the query cannot contain spaces (`[^\s@]` still excludes whitespace) |

### Alternatives Considered

1. **Multiple `useState<boolean>` for loading (one per scope)**: Rejected because it loses the human-readable label text needed for `pane-loading-status`. A record preserves both the flag and the label in one state update.
2. **Error retry via action ID lookup instead of closure**: Rejected because it requires a registry of retryable actions and is more complex than capturing the closure directly.
3. **Reuse `trapModalFocus` for session menus**: Rejected because `trapModalFocus` only handles Tab, while menus also need ArrowDown to move focus (not just `aria-activedescendant`). A separate `trapMenuFocus` is cleaner.
4. **Add `title` to `DesktopSessionLayoutPatch`**: Rejected because `title` is a top-level session field, not a layout field. A dedicated `sessions:rename` IPC is semantically correct.
5. **Split `composerMenuItems` into `mentionItems` + `slashItems`**: Rejected because only one trigger can be active at a time; the regex fix is simpler and sufficient.
6. **Remove legacy CSS variables immediately**: Rejected; keep alias block for one release cycle as a safety net against missed references.

---

## 8. Open Questions

- [ ] Should the error auto-dismiss timer be paused when the "Details" panel is expanded (user is reading the stack)? → Recommended: yes, pause while `errorDetailsOpen` is true.
- [ ] Should the `isLoading('workspace')` flag also disable the composer send button (to prevent sending while workspace is refreshing)? → Recommended: no, sending a message does not depend on workspace state.
- [ ] Should the session rename input support validation (e.g., max length, disallowed characters)? → Recommended: cap at 120 characters; no character restrictions.
- [ ] For P1-5, does `CommandPaletteItem` support a `group` field or dividers, or does the type need to be extended? → Needs verification during implementation; if not supported, add `group?: string` to the type.
