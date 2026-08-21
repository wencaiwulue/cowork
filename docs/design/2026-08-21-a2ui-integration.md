# Design Document: A2UI Protocol Integration for Claude Code Desktop

- **Date**: 2026-08-21
- **Author**: Architect (agent)
- **Status**: Approved
- **Related Issues/PRs**: plan at `/root/.claude/plans/desktop-a2ui-serene-pelican.md`

---

## 1. Summary

Integrate the A2UI v0.9.1 protocol into Claude Code Desktop so that the desktop can (a) render rich interactive surfaces produced by MCP servers and (b) emit A2UI surfaces itself via a new built-in `RenderUI` tool, with bidirectional action return. All features ship behind a feature flag; Phase 1 is a read-only MCP host; Phase 2 closes the bidirectional loop via `RenderUI`.

---

## 2. Problem / Motivation

- **Current behavior**: When an MCP tool returns an `EmbeddedResource` with `mimeType: "application/a2ui+json"`, the resource handler in `src/services/mcp/client.ts` flattens the JSON into a plain-text string and feeds it into model context as `` `[Resource from <server> at <uri>] <raw JSON>` ``. The UI payload is never rendered and wastes prompt tokens.
- **Desired behavior**: A2UI payloads are intercepted before reaching the model, rendered as live React components inline in the chat transcript, and user interactions are returned to the originating agent as `tool_result` messages.
- **Business/user impact**: MCP servers and Claude itself can produce data-rich, interactive UIs (forms, dashboards, cards, modals) that appear directly in the conversation, dramatically improving the quality of tool-augmented workflows. The 18-component basic catalog covers cards, lists, forms, tabs, modals, markdown text, images, and media players — use cases that today require context-stuffing with raw text.

---

## 3. Proposed Solution

### 3.1 Overview

Reuse the official npm renderer packages (`@a2ui/react@0.10.2`, `@a2ui/web_core@0.10.6`, `@a2ui/markdown-it@0.1.1`) rather than hand-writing components. Intercept A2UI payloads at the CLI layer (inside `transformResultContent()`), tunnel them through the existing stream-json pipeline via `_meta['a2ui/messages']`, extract them in the main-process `messageMapper`, attach them to `DesktopMessage`, and render them in `App.tsx` using a per-session `A2uiSessionProcessor`.

### 3.2 Architecture / Flow

#### Phase 1 — MCP-originated read-only rendering

```
MCP Server
  └─ CallToolResult { EmbeddedResource { mimeType:"application/a2ui+json", text: JSON } }
        │
        ▼ src/services/mcp/client.ts  transformResultContent() case 'resource'
  isA2uiResource() guard → skip flatten → return fallback TextContent("[A2UI surface rendered]")
  callMCPTool() → stash parsed messages in result._meta['a2ui/messages']
        │
        ▼ src/Tool.ts  ToolResult.mcpMeta = { _meta: { 'a2ui/messages': [...] } }
        │
        ▼ src/utils/messages.ts  createUserMessage({ mcpMeta })
        │
        ▼ src/utils/queryHelpers.ts  normalizeMessage() case 'user'
  tool_use_result: { content: toolUseResult, _meta: { 'a2ui/messages': [...] } }
        │
        ▼ stream-json NDJSON line on CLI stdout
        │
        ▼ desktop/main/sessionManager.ts :414
  emit { type:'runtime-message', sessionId, message: raw }
        │
        ▼ desktop/main/messageMapper.ts  toDesktopMessages()
  type==='user' branch — BEFORE the containsToolResult() early-return:
    extractA2uiPayload(raw) → { a2uiMessages, a2uiToolUseId, a2uiSource }
    attach to DesktopMessage if non-empty
  type==='assistant' branch:
    extractRenderUiToolUse(raw) → { a2uiMessages, a2uiToolUseId }
        │
        ▼ ipcMain  runtime-message event → renderer via contextBridge
        │
        ▼ desktop/renderer/src/App.tsx
  on runtime-message: A2uiSessionProcessor.ingest(desktopMessage)
  per message <article>: a2uiSurfacesFor(message.id).map(surface => <A2uiSurfaceHost .../>)
```

#### Phase 2 — Bidirectional via RenderUI built-in tool

```
Claude calls RenderUI tool (shouldDefer:true, requiresUserInteraction:true)
  → tool suspends CLI turn (identical to AskUserQuestion)
  → assistant message with tool_use block extracted by extractRenderUiToolUse()
  → A2uiSessionProcessor.ingest() receives a2uiMessages from tool input
  → surface renders in transcript next to the assistant message
User clicks an interactive component (e.g. Button with action.event)
  → @a2ui/react fires actionCallback in A2uiSessionProcessor
  → sessions:submitA2uiAction IPC (sessionId, toolUseId, A2uiActionPayload)
  → main.ts handleIpc → sessionManager.submitA2uiAction()
  → sessionHost.submitA2uiAction() writes tool_result to CLI stdin
  → CLI turn resumes, model sees action context
```

#### Phase 3 — MCP action return path (DEFERRED, not implemented in Phase 1 or 2)

When the surface originated from an MCP tool call, A2UI spec requires actions to be returned as `a2ui_action` MCP tool calls to the originating server. This is a known Phase 1 gap (see Section 8). Two candidate mechanisms exist; neither is implemented until Phase 3.

### 3.3 Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Protocol version | v0.9.1 using `./v0_9` API | Only version with a complete React renderer; v1.0 is RC and would require hand-writing all 18 components. `./v0_8` is excluded because it uses `all: revert` `@layer` reset that pollutes host styles. The `./v0_9` schema accepts both `v0.9` and `v0.9.1` per `server-to-client.ts:28`. |
| Renderer strategy | Reuse official npm `@a2ui/react@0.10.2` + `@a2ui/web_core@0.10.6` | All 18 basic catalog components are implemented, zero-specificity `:where()` styles, no Tailwind dependency, peerDep `react ^19.2.7` matches our React 19.2.7. |
| Iframe vs native React | Native React components | Desktop renderer is already React; no sandbox overhead; CSP already allows `'unsafe-inline'` styles which A2UI needs. Iframe would require origin gymnastics and break the existing styled context. |
| Transport through pipeline | Stash in `_meta['a2ui/messages']` | The `normalizeMessage()` case `'user'` path (`queryHelpers.ts:203-218`) already spreads `mcpMeta` fields into `tool_use_result`. No new cross-process protocol needed. |
| `_meta` key name | `a2ui/messages` | MCP `_meta` is a namespace-free extension point. A slash-delimited key follows the catalog ID convention used by the spec itself (`a2ui.org/specification/...`). The key never reaches the model (it travels only through the stream-json side-channel). |
| Emitter approach | Built-in `RenderUI` tool with zod input schema | Python SDK's free-text `<a2ui-json>` tag approach cannot suspend the turn for user interaction, is unreliable under streaming, and bypasses schema validation. A proper tool call: suspends the turn, validates input, enables `shouldDefer`/`requiresUserInteraction`, and reuses the proven `AskUserQuestion` flow. |
| Surface lifecycle anchor | `anchorMessageId` in `A2uiSessionProcessor` | Each `a2uiMessages` array arriving with a `DesktopMessage` is bound to that message's `id`. On session restore, `MessageProcessor` is rebuilt fresh and all stored `a2uiMessages` are replayed in message order. |
| Zod version conflict | `resolve.alias { zod → node_modules/zod/v3 }` in `desktop/vite.config.ts` | Root zod is 4.4.3; `@a2ui/*` requires `^3.25.76`. The v3 compat layer at `node_modules/zod/v3/index.js` is confirmed present. The desktop renderer bundle does not contain any `src/` code (which uses explicit `zod/v4`) so the alias is isolated and safe. |
| CSP Phase 1 | No change to `desktop/renderer/index.html` | Current CSP `img-src 'self' data:` blocks A2UI remote images; `default-src 'self'` blocks video/audio. Phase 1 surfaces are usable without media. Phase 4 will add a main-process media proxy. |
| Feature flag | Existing `feature()` / GrowthBook mechanism | Both CLI (`isEnabled()` on `RenderUI` tool) and renderer (`A2uiSessionProcessor` construction) guard behind a single flag. |
| Apache-2.0 compliance | `THIRD-PARTY-NOTICES.txt` for npm; retained headers + modification notice for vendored schemas | See Section 6.8 for specifics. |

---

## 4. Affected Files

### New Files

- `src/a2ui/protocol.ts` — `A2UI_MIME_TYPE`, `isA2uiResource()`, `parseA2uiMessages()`, A2UI message union type for v0.9.1
- `src/a2ui/validate.ts` — AJV-based validator adapted from `/data/a2ui/specification/v1_0/eval/src/validator.ts`, re-pointed to v0_9_1 schemas
- `src/a2ui/schemas/server_to_client.json` — vendored from `/data/a2ui/specification/v0_9_1/json/server_to_client.json` (Apache-2.0 header retained, modification noted)
- `src/a2ui/schemas/client_to_server.json` — vendored from `/data/a2ui/specification/v0_9_1/json/client_to_server.json`
- `src/a2ui/schemas/common_types.json` — vendored from `/data/a2ui/specification/v0_9_1/json/common_types.json`
- `src/a2ui/schemas/catalogs/basic/catalog.json` — vendored from `/data/a2ui/specification/v0_9_1/catalogs/basic/catalog.json`
- `src/a2ui/prompt.ts` — emitter prompt builder: `---BEGIN A2UI JSON SCHEMA---` block + `DEFAULT_WORKFLOW_RULES` (ported from Python SDK), catalog pruning by component names set
- `src/tools/RenderUITool/RenderUITool.ts` — built-in `RenderUI` tool definition
- `src/tools/RenderUITool/prompt.ts` — `RenderUI` system prompt fragment
- `desktop/renderer/src/a2ui/A2uiSessionProcessor.ts` — per-session `MessageProcessor` wrapper, surface lifecycle, `anchorMessageId` map
- `desktop/renderer/src/a2ui/A2uiSurfaceHost.tsx` — `<A2uiSurface>` wrapper with `MarkdownContext`, `ErrorBoundary`, and feature-flag guard
- `desktop/renderer/src/a2ui/extract.ts` — pure function: extract `a2uiMessages` from raw runtime-message (node-safe, testable without jsdom)
- `desktop/renderer/src/a2ui/themeBridge.ts` — inject `--a2ui-*` CSS variable overrides from `styles.css` tokens into the surface container element; also manage `a2ui-light`/`a2ui-dark` class on the container in sync with the app's dark-theme state
- `desktop/vitest.renderer.config.ts` — second vitest config with `environment: 'jsdom'` and the zod alias, for component and conformance tests
- `desktop/tests/renderer/a2uiConformance.test.tsx` — 43-fixture conformance loop
- `desktop/tests/renderer/A2uiSurfaceHost.test.tsx` — component unit tests
- `desktop/tests/a2uiIpcTypes.test.ts` — static assertion that new channels are in `desktopChannels`
- `desktop/tests/a2uiExtract.test.ts` — unit tests for `extract.ts` pure functions
- `THIRD-PARTY-NOTICES.txt` — Apache-2.0 attribution for `@a2ui/react`, `@a2ui/web_core`, `@a2ui/markdown-it`

### Modified Files

- `src/services/mcp/client.ts` — `transformResultContent()` `case 'resource'` gains A2UI guard before the `'text' in resource` flatten; `callMCPTool()` stashes `_meta['a2ui/messages']` on return
- `src/utils/messages/mappers.ts` — optional consistency fix: `toSDKMessages()` should merge `mcpMeta` for the bridge path (currently omitted; does not affect desktop but noted for completeness; mark as low-priority)
- `desktop/main/messageMapper.ts` — `toDesktopMessages()` `type==='user'` branch calls `extractA2uiPayload()` before the `containsToolResult()` early return; `type==='assistant'` branch calls `extractRenderUiToolUse()`
- `desktop/main/ipc.ts` — `desktopChannels` array gains `'sessions:submitA2uiAction'` and `'sessions:reportA2uiError'`; `validateIpcArgs` switch gains two cases; `DesktopMessage` gains three optional fields; two new payload types added
- `desktop/main/main.ts` — two new `handleIpc` registrations
- `desktop/main/sessionManager.ts` — `submitA2uiAction()` and `reportA2uiError()` methods
- `desktop/main/sessionHost.ts` — `submitA2uiAction()` and `reportA2uiError()` methods, plus the `SessionHost` type updated
- `desktop/preload/preload.ts` — two new `sessions` bridge methods
- `desktop/renderer/src/App.tsx` — ~20-line diff: import, one ref, one `useEffect` branch, one JSX block per message (all logic delegated to `A2uiSessionProcessor`)
- `desktop/vite.config.ts` — add `resolve.alias` section with zod v3 mapping
- `package.json` — add `@a2ui/react@0.10.2`, `@a2ui/web_core@0.10.6`, `@a2ui/markdown-it@0.1.1`, `markdown-it`; devDependencies add `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`

### Deleted Files

None.

---

## 5. Interface / API Changes

### 5.1 Function Signatures

#### `src/a2ui/protocol.ts`

```typescript
export const A2UI_MIME_TYPE = 'application/a2ui+json' as const

/** A2UI v0.9.1 wire-format message union (agent→renderer). */
export type A2uiMessage =
  | { version: 'v0.9' | 'v0.9.1'; createSurface: CreateSurface }
  | { version: 'v0.9' | 'v0.9.1'; updateComponents: UpdateComponents }
  | { version: 'v0.9' | 'v0.9.1'; updateDataModel: UpdateDataModel }
  | { version: 'v0.9' | 'v0.9.1'; deleteSurface: DeleteSurface }

export interface CreateSurface {
  surfaceId: string
  catalogId: string
  theme?: Record<string, unknown>
  sendDataModel?: boolean
}

export interface UpdateComponents {
  surfaceId: string
  components: A2uiComponent[]
}

export interface UpdateDataModel {
  surfaceId: string
  path?: string  // JSON Pointer; omitted means '/'
  value?: unknown // omitted = delete the key at path
}

export interface DeleteSurface {
  surfaceId: string
}

export interface A2uiComponent {
  id: string
  component?: string
  [key: string]: unknown
}

/** A2UI v0.9.1 client→agent action payload (all five fields required). */
export interface A2uiActionPayload {
  version: 'v0.9' | 'v0.9.1'
  action: {
    name: string
    surfaceId: string
    sourceComponentId: string
    timestamp: string  // ISO 8601
    context: Record<string, unknown>
  }
}

/** A2UI v0.9.1 client→agent error payload. */
export interface A2uiErrorPayload {
  version: 'v0.9' | 'v0.9.1'
  error: {
    code: string
    surfaceId: string
    message: string
    path?: string  // JSON Pointer, required when code === 'VALIDATION_FAILED'
  }
}

/**
 * Returns true if the MCP resource content is an A2UI payload.
 * Checks both mimeType and uri scheme.
 */
export function isA2uiResource(resource: {
  uri?: string
  mimeType?: string
}): boolean

/**
 * Parses the text field of an A2UI EmbeddedResource.
 * Returns the parsed message array, or null if text is not valid JSON or not an array.
 */
export function parseA2uiMessages(text: string): A2uiMessage[] | null
```

#### `src/a2ui/prompt.ts`

```typescript
/**
 * Returns the ---BEGIN A2UI JSON SCHEMA--- block used in RenderUI tool prompt.
 * Accepts optional componentNames to prune the catalog to only the listed components.
 */
export function buildA2uiSchemaBlock(componentNames?: string[]): string

/**
 * Returns the DEFAULT_WORKFLOW_RULES string (ported from Python SDK).
 * These are injected as a system message fragment when RenderUI is enabled.
 */
export function getA2uiWorkflowRules(): string
```

#### `desktop/renderer/src/a2ui/extract.ts`

```typescript
/**
 * Extracts A2UI messages from a raw runtime-message (user role, tool_result case).
 * Pure function — no React, no side effects, safe in node test environment.
 *
 * Returns null if the message does not carry an a2ui/messages payload.
 */
export function extractA2uiFromToolResult(raw: unknown): {
  a2uiMessages: A2uiMessage[]
  a2uiToolUseId: string
  a2uiSource: 'mcp'
} | null

/**
 * Extracts A2UI messages from a RenderUI tool_use block in an assistant message.
 * Returns null if the message is not an assistant message with a RenderUI tool_use.
 */
export function extractA2uiFromRenderUiToolUse(raw: unknown): {
  a2uiMessages: A2uiMessage[]
  a2uiToolUseId: string
  a2uiSource: 'built-in'
} | null
```

#### `desktop/renderer/src/a2ui/A2uiSessionProcessor.ts`

```typescript
import type { SurfaceModel } from '@a2ui/web_core/v0_9'
import type { ReactComponentImplementation } from '@a2ui/react/v0_9'

export interface AnchoredSurface {
  surface: SurfaceModel<ReactComponentImplementation>
  anchorMessageId: string  // DesktopMessage.id that owns this surface
  toolUseId: string        // for routing actions back to the right tool_result
  source: 'mcp' | 'built-in'
}

export class A2uiSessionProcessor {
  /**
   * Creates a new processor for a session.
   * actionCallback is called when the user interacts with a surface component.
   */
  constructor(
    sessionId: string,
    actionCallback: (toolUseId: string, payload: A2uiActionPayload) => void,
    errorCallback: (toolUseId: string, payload: A2uiErrorPayload) => void,
  )

  /**
   * Ingests a DesktopMessage that may carry a2uiMessages.
   * Calls processor.processMessages() and registers created surfaces
   * under anchorMessageId = message.id.
   */
  ingest(message: DesktopMessage): void

  /**
   * Returns all surfaces anchored to a given message id,
   * in creation order. Returns [] if none.
   */
  getSurfacesForMessage(messageId: string): AnchoredSurface[]

  /**
   * Rebuilds the processor from a snapshot of all messages in a session
   * (for session restore / transcript replay).
   * Calls ingest() on each message in order.
   */
  replay(messages: DesktopMessage[]): void

  /**
   * Disposes all surfaces and clears state.
   * Must be called on session switch to prevent memory leak.
   */
  dispose(): void
}
```

#### `desktop/renderer/src/a2ui/A2uiSurfaceHost.tsx`

```typescript
export interface A2uiSurfaceHostProps {
  anchored: AnchoredSurface
  /** If true, render a collapsed placeholder (e.g. for deleted surfaces on replay). */
  phantom?: boolean
}

export const A2uiSurfaceHost: React.FC<A2uiSurfaceHostProps>
```

#### `desktop/renderer/src/a2ui/themeBridge.ts`

```typescript
/**
 * Applies --a2ui-* CSS variable overrides to a container element,
 * reading computed values of Claude Code Desktop's --* tokens.
 * Called once after mount and again when the app's dark-theme state changes.
 */
export function applyA2uiTheme(container: HTMLElement): void

/**
 * Applies or removes the `a2ui-dark` / `a2ui-light` class on a container element
 * to match the app's current dark-theme selection.
 *
 * Our app selects dark theme via a `data-theme="dark"` attribute on the document
 * root (set by the theme toggle, persisted to localStorage). A2UI selects its
 * color-scheme via `a2ui-dark` / `a2ui-light` classes; without one of these the
 * default theme is `color-scheme: light dark` (OS preference). Overriding CSS
 * variables alone is insufficient because `color-scheme` controls `light-dark()`
 * resolution and native form-control rendering (TextField, CheckBox, Slider,
 * DateTimeInput). This function must be called: (1) once after the surface
 * container mounts, and (2) whenever the app's `data-theme` attribute changes
 * (e.g. via a MutationObserver on `document.documentElement`).
 *
 * Implementation: if `document.documentElement.dataset.theme === 'dark'`, add
 * `a2ui-dark` and remove `a2ui-light` on the container; otherwise add `a2ui-light`
 * and remove `a2ui-dark`.
 */
export function applyA2uiThemeClass(container: HTMLElement): void
```

### 5.2 Data Structures

#### Updated `DesktopMessage` (in `desktop/main/ipc.ts`)

```typescript
export type DesktopMessage = {
  id: string
  role: 'user' | 'assistant' | 'thinking' | 'system' | 'tool' | 'tool_output'
  text: string
  timestamp: number
  streaming?: boolean
  raw?: unknown
  attachments?: DesktopAttachment[]
  question?: DesktopQuestion
  // New fields for A2UI:
  a2uiMessages?: A2uiMessage[]         // parsed payload from _meta['a2ui/messages']
  a2uiToolUseId?: string               // tool_use_id to write tool_result back to
  a2uiSource?: 'mcp' | 'built-in'     // 'mcp' = from MCP EmbeddedResource, 'built-in' = from RenderUI tool
}
```

#### New IPC payload types (in `desktop/main/ipc.ts`)

```typescript
export type A2uiSubmitActionInput = {
  toolUseId: string
  action: {
    name: string
    surfaceId: string
    sourceComponentId: string
    timestamp: string
    context: Record<string, unknown>
  }
}

export type A2uiReportErrorInput = {
  toolUseId: string
  error: {
    code: string
    surfaceId: string
    message: string
    path?: string
  }
}
```

#### `RenderUI` tool input schema (zod, in `src/tools/RenderUITool/RenderUITool.ts`)

```typescript
import { z } from 'zod/v4'

const RenderUiInputSchema = z.object({
  messages: z.array(z.unknown()).min(1).describe(
    'Array of A2UI v0.9.1 messages (createSurface + updateComponents + optional updateDataModel). ' +
    'The root component MUST be the first element in the components list. ' +
    'Parents must precede children.'
  ),
})

type RenderUiInput = z.infer<typeof RenderUiInputSchema>
```

The `messages` field is `z.array(z.unknown())` at the zod level because deep A2UI schema validation is delegated to the AJV-based `src/a2ui/validate.ts`. This avoids generating an enormous zod schema from the catalog JSON and prevents the model from seeing redundant validation errors.

#### `RenderUI` tool result (written back to CLI stdin by `sessionHost.submitA2uiAction()`)

```typescript
// Mirrors the pattern of host.answerQuestion() in sessionHost.ts:285-306
{
  type: 'user',
  message: {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: toolUseId,     // the RenderUI tool_use_id
        content: JSON.stringify({   // serialized A2uiActionPayload
          version: 'v0.9.1',
          action: {
            name: string,
            surfaceId: string,
            sourceComponentId: string,
            timestamp: string,      // ISO 8601, generated at click time
            context: Record<string, unknown>,
          }
        }),
      },
    ],
  },
  parent_tool_use_id: null,
  session_id: sessionId,
}
```

### 5.3 IPC Channel Signatures

#### New channels added to `desktopChannels` array

```typescript
// desktop/main/ipc.ts — append to desktopChannels
'sessions:submitA2uiAction',
'sessions:reportA2uiError',
```

#### `validateIpcArgs` new cases

```typescript
case 'sessions:submitA2uiAction': {
  expectArity(channel, args, 2)
  return [
    expectStringArg(channel, args, 0, 'sessionId'),
    args[1], // A2uiSubmitActionInput — structural validation done in handler
  ]
}
case 'sessions:reportA2uiError': {
  expectArity(channel, args, 2)
  return [
    expectStringArg(channel, args, 0, 'sessionId'),
    args[1], // A2uiReportErrorInput
  ]
}
```

#### `handleIpc` registrations in `desktop/main/main.ts`

```typescript
handleIpc('sessions:submitA2uiAction',
  (sessionId: string, input: A2uiSubmitActionInput) =>
    sessionManager.submitA2uiAction(sessionId, input),
)
handleIpc('sessions:reportA2uiError',
  (sessionId: string, input: A2uiReportErrorInput) =>
    sessionManager.reportA2uiError(sessionId, input),
)
```

#### `SessionManager` new methods (in `desktop/main/sessionManager.ts`)

```typescript
async submitA2uiAction(
  sessionId: string,
  input: A2uiSubmitActionInput,
): Promise<void>

async reportA2uiError(
  sessionId: string,
  input: A2uiReportErrorInput,
): Promise<void>
```

#### `SessionHost` new methods and type update (in `desktop/main/sessionHost.ts`)

```typescript
// Appended to SessionHost interface:
submitA2uiAction(toolUseId: string, action: A2uiSubmitActionInput['action']): void
reportA2uiError(toolUseId: string, error: A2uiReportErrorInput['error']): void

// Implementation in createSessionHost() — mirrors answerQuestion() pattern:
host.submitA2uiAction = (toolUseId, action) => {
  writeJsonLine(child, {
    type: 'user',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: JSON.stringify({ version: 'v0.9.1', action }),
      }],
    },
    parent_tool_use_id: null,
    session_id: options.sessionId,
  })
}
```

#### Preload bridge additions (in `desktop/preload/preload.ts`)

```typescript
// Under the sessions: namespace, after answerQuestion:
submitA2uiAction: (sessionId: string, input: A2uiSubmitActionInput) =>
  ipcRenderer.invoke('sessions:submitA2uiAction', sessionId, input) as Promise<void>,
reportA2uiError: (sessionId: string, input: A2uiReportErrorInput) =>
  ipcRenderer.invoke('sessions:reportA2uiError', sessionId, input) as Promise<void>,
```

### 5.4 Config / Environment Variables

- `CLAUDE_CODE_FEATURE_A2UI` (or equivalent GrowthBook key) — feature flag controlling `RenderUI.isEnabled()` and `A2uiSessionProcessor` construction. Default: `false`.
- No new environment variables are required for Phase 1 rendering; the MCP path activates automatically when the flag is on and a qualifying EmbeddedResource is detected.

### 5.5 `vite.config.ts` changes

```typescript
import path from 'node:path'

export default {
  root: path.resolve(__dirname, 'renderer'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
  resolve: {
    alias: {
      // @a2ui/* packages require zod ^3.25.76; root zod is 4.4.3.
      // The v3 compat layer is confirmed at node_modules/zod/v3/index.js.
      // Desktop renderer bundle does not include any src/ code that uses zod/v4,
      // so this alias is safe and isolated.
      zod: path.resolve(__dirname, '../node_modules/zod/v3'),
    },
  },
}
```

---

## 6. Testing Plan

### 6.1 Unit Tests — Node environment (`desktop/vitest.config.ts`, `include: ['desktop/tests/**/*.test.ts']`)

**`desktop/tests/a2uiExtract.test.ts`** — pure-function tests for `extract.ts`:
- [ ] `extractA2uiFromToolResult` returns null for non-user messages
- [ ] `extractA2uiFromToolResult` returns null for user messages without tool_result blocks
- [ ] `extractA2uiFromToolResult` returns null when `_meta['a2ui/messages']` is absent
- [ ] `extractA2uiFromToolResult` returns parsed `a2uiMessages`, `a2uiToolUseId`, `a2uiSource:'mcp'` for a valid fixture
- [ ] `extractA2uiFromRenderUiToolUse` returns null for non-assistant messages
- [ ] `extractA2uiFromRenderUiToolUse` returns null for assistant messages without RenderUI tool_use
- [ ] `extractA2uiFromRenderUiToolUse` returns parsed messages and toolUseId for a valid RenderUI block
- [ ] `parseA2uiMessages` returns null for non-array JSON
- [ ] `parseA2uiMessages` returns null for invalid JSON string
- [ ] `parseA2uiMessages` returns array for valid fixture text

Run: `bun run desktop:test`

**`desktop/tests/a2uiIpcTypes.test.ts`** — static source-analysis assertions (mirrors existing test style using `readFileSync` + `toContain`):
- [ ] `desktopChannels` array contains `'sessions:submitA2uiAction'`
- [ ] `desktopChannels` array contains `'sessions:reportA2uiError'`
- [ ] `validateIpcArgs` switch contains cases for both channels
- [ ] `DesktopMessage` type contains `a2uiMessages?`, `a2uiToolUseId?`, `a2uiSource?`

Run: `bun run desktop:test`

### 6.2 Integration Tests — Renderer environment (`desktop/vitest.renderer.config.ts`, `environment: 'jsdom'`)

Config file `desktop/vitest.renderer.config.ts`:
```typescript
import path from 'node:path'
export default {
  test: {
    environment: 'jsdom',
    include: ['desktop/tests/renderer/**/*.test.tsx'],
    setupFiles: ['desktop/tests/renderer/setup.ts'],
  },
  resolve: {
    alias: {
      zod: path.resolve(__dirname, '../node_modules/zod/v3'),
    },
  },
}
```

Run: `bun run vitest --config desktop/vitest.renderer.config.ts run`

**`desktop/tests/renderer/A2uiSurfaceHost.test.tsx`**:
- [ ] `<A2uiSurfaceHost>` renders a surface created by `MessageProcessor.processMessages()` with fixture `00_simple-text.json`
- [ ] `<A2uiSurfaceHost>` renders no `[Loading ...]` placeholder after a complete fixture (root component present)
- [ ] `<A2uiSurfaceHost>` renders an error boundary on `MessageProcessor` `A2uiStateError` (bad catalogId)
- [ ] Action callback is invoked when a Button with `action.event` is clicked (using `00_interactive-button.json`)
- [ ] `phantom=true` prop renders a collapsed placeholder instead of live surface
- [ ] (jsdom) `applyA2uiThemeClass` adds `a2ui-dark` class to container when `document.documentElement.dataset.theme` is `'dark'`, and `a2ui-light` otherwise; re-invoking after toggling the attribute reflects the new state

**`desktop/tests/renderer/A2uiSessionProcessor.test.tsx`**:
- [ ] `ingest()` with a message carrying `a2uiMessages` creates a surface and maps it to `anchorMessageId`
- [ ] `getSurfacesForMessage()` returns empty array for unknown messageId
- [ ] `replay()` produces same surface state as sequential `ingest()` calls
- [ ] `dispose()` clears all surface references
- [ ] Phantom-surface hazard: after `replay()` of a transcript that lacks `deleteSurface`, surface is marked phantom (not live) and renders `phantom=true` variant (see Section 7 risk table)

**`desktop/tests/renderer/a2uiConformance.test.tsx`** — 43-fixture conformance loop:
```typescript
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FIXTURES_DIR = resolve('/data/a2ui/specification/v0_9_1/catalogs/basic/examples')

describe.skipIf(!existsSync(FIXTURES_DIR))(
  'A2UI v0.9.1 conformance fixtures',
  () => {
    const fixtures = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'))
    it.each(fixtures)('%s: MessageProcessor + A2uiSurface renders without error', async (filename) => {
      // Load fixture, call processor.processMessages(), render <A2uiSurface>,
      // assert no [Loading ...] placeholders remain, no red "Unknown component" divs appear.
    })
  }
)
```

All 43 fixtures must pass. Fixtures of note (hardest cases): `31_incremental-dashboard.json`, `32_advanced-form-validator.json`, `34_child-list-template.json`, `36_modal.json`.

### 6.3 Build Verification

These steps are mandatory before any PR merge, not just at release:

```bash
bun run check                     # CLI-side tsc --noEmit (must pass, 0 regressions)
bun run desktop:check             # three builds + vite renderer build (must pass)
bun run desktop:test              # ~120 existing node-env tests (must pass, 0 regressions)
bun run vitest --config desktop/vitest.renderer.config.ts run  # new renderer tests
bun run desktop:smoke-electron    # end-to-end smoke test
```

**Bundle zod verification step** (mandatory, not just assertion): After `bun run desktop:check`, inspect `desktop/dist/renderer/assets/`:

```bash
# Confirm zod v3 is in the bundle and zod v4 is NOT:
grep -r '"z.ZodString"' desktop/dist/renderer/assets/ | head -3  # should be absent (v4)
grep -r '"ZodString"' desktop/dist/renderer/assets/ | head -3    # v3 name, should be present
```

Alternatively, build with `--reporter verbose` and confirm no chunk contains both `zod/v4` and `zod/v3` imports. If the symptom `z.string is not a function` appears in the renderer console, activate the Vite plugin fallback (see Risk R1).

### 6.4 Manual Verification Steps

**Phase 1 manual test** (MCP read-only rendering):
1. Configure `samples/community/mcp/a2ui-over-mcp-recipe/server.py` as a user MCP server in Claude Code Desktop.
2. Open a new session and prompt: "Show me a recipe card using the MCP recipe tool."
3. Verify: A2UI surface renders inline in the assistant message. Console shows no zod conflict errors.
4. Verify: Raw A2UI JSON does not appear in the chat transcript (not dumped as text).
5. Verify: The fallback `[A2UI surface rendered]` text appears in the model's context (not the raw JSON).

**Phase 2 manual test** (RenderUI bidirectional):
1. Enable the feature flag.
2. Prompt: "Create a button labeled 'Click me' using RenderUI."
3. Verify: Button renders in the transcript.
4. Click the button.
5. Verify: Next model turn references the action (e.g., "I see you clicked the button.").

**Theme tracking manual test** (both phases):
1. Render any A2UI surface in light mode. Inspect the surface container element in DevTools: it must have class `a2ui-light` and must NOT have `a2ui-dark`.
2. Toggle to dark mode (the app sets `data-theme="dark"` on `document.documentElement`). Without reloading, verify the surface container now has class `a2ui-dark` and no longer has `a2ui-light`.
3. In both modes, open a surface that includes a `TextField`, `CheckBox`, `Slider`, and `DateTimeInput` component. Verify that native form-control chrome (input backgrounds, checkbox tick, range track, date picker) matches the expected light or dark rendering — not a mix of both.

### 6.5 Edge Cases

- `MessageProcessor.processMessages()` throws `A2uiStateError` if `createSurface` is called for an already-existing `surfaceId`. `A2uiSurfaceHost` must catch via ErrorBoundary and display a non-fatal error state.
- Partial batch: `updateComponents` arrives before `createSurface` for the same `surfaceId` — `MessageProcessor` throws; `ErrorBoundary` handles.
- `RenderUI` input with malformed `messages` (fails AJV validation): tool validation rejects with descriptive error before `shouldDefer` suspends the turn; session is not orphaned.
- Session switch mid-render: `dispose()` must be called before switching; new session gets a fresh `A2uiSessionProcessor`. Unsent IPC actions for the old session must be dropped silently.
- Transcript replay with missing `deleteSurface`: addressed by the phantom-surface mechanism (see Section 7).

---

## 7. Risks & Alternatives

### Risks

| ID | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| R1 | **Zod alias failure** — bun resolves `@a2ui/*`'s `zod` peer to root zod v4 despite the Vite alias, producing `z.string is not a function` at runtime | Renderer crashes for all A2UI surfaces | Medium | Confirmed `node_modules/zod/v3/index.js` exists. Fallback: write a targeted Vite plugin that rewrites `zod` imports only when the importer path contains `node_modules/@a2ui`. Bundle verification step in §6.3 catches this before release. |
| R2 | **`@a2ui/react` v0.9.x abandonment** — package is unmaintained or breaking changes ship to `@a2ui/react@0.10.x` | Components stop working; may need vendor | Low | Pin exact versions `0.10.2` / `0.10.6` / `0.1.1`. Lock file prevents drift. If package is abandoned, vendoring the React renderer source (~2k LOC) is the fallback, at estimated 1-week cost. |
| R3 | **Phantom surfaces on transcript replay** — a `createSurface` event is in the transcript but the corresponding `deleteSurface` is absent (server crashed, or session ended mid-flow). On replay, the surface appears with stale state. | Incorrect / misleading UI on session restore | Medium | `A2uiSessionProcessor.replay()` tracks whether a `deleteSurface` was received for each surface created. Surfaces without a matching delete that are older than the last completed result message are flagged as `phantom:true` and rendered as collapsed placeholders (e.g., "[Surface no longer active]"). Test in `desktop/tests/renderer/A2uiSessionProcessor.test.tsx`. |
| R4 | **RenderUI token cost** — injecting the full basic catalog schema (server_to_client + catalog) adds ~4k-8k tokens per session that includes `RenderUI` in the system prompt | Higher per-turn cost for all RenderUI-enabled sessions | Medium | Two mitigations: (a) `isEnabled()` returns false when flag is off, so cost is zero by default; (b) `buildA2uiSchemaBlock(componentNames?)` in `src/a2ui/prompt.ts` accepts an optional component allowlist — callers can prune to 5-6 components, reducing injection to ~1k tokens. Document in `RenderUITool/prompt.ts`. |
| R5 | **App.tsx monolith fragility** — `App.tsx` is 14,064 lines; any diff risks conflicting with unrelated in-flight changes | Merge conflicts, accidental regressions | High | Hard constraint: App.tsx diff must fit in ~20 reviewable lines. All state, subscriptions, and rendering logic live in `A2uiSessionProcessor` and `A2uiSurfaceHost`. The App.tsx change is a single `useRef`, a single `useEffect` branch, and one JSX expression per message `<article>`. |
| R6 | **CSP widening as a security decision** — Phase 4 will need `img-src *` or equivalent to allow A2UI `Image` remote URLs. This allows any MCP server to render arbitrary remote images in the desktop's renderer process. | Potential SSRF surface, information leakage to external hosts | High | Phase 1 and 2 do not widen CSP. Phase 4 design doc must explicitly evaluate the main-process media proxy approach (new `sessions:fetchA2uiMedia` IPC channel, URL allowlist, return data-URI) as the primary option before widening CSP. CSP widening requires a separate security review. |
| R7 | **Phase 1 MCP-action gap** — MCP spec requires user actions on MCP-originated surfaces to be delivered as `a2ui_action` tool calls to the originating MCP server. Phase 1 surfaces are read-only; Phase 2 `RenderUI` surfaces are bidirectional, but MCP surfaces remain read-only until Phase 3. | MCP server interactive UIs cannot receive user input | High (for interactive MCP UIs) | Explicitly documented. MCP server developers must be informed that Phase 1 produces read-only rendering. If interactive MCP surfaces are required before Phase 3, the integration timeline must be re-evaluated. Phase 3 design doc must choose between: (a) synthetic user turn that causes the CLI to call `a2ui_action` tool on the server, or (b) a separate MCP client registry in the main process. |

### Alternatives Considered

1. **Iframe sandbox per surface**: Would require `frame-src 'self'`, custom postMessage protocol for actions, and either same-origin document serving or relaxed CSP. Rejected: added complexity with no benefit given we already run React; style injection is more complex; action latency increases.

2. **Vendor all A2UI source** (copy into repo): Would remove the npm dependency and the zod conflict. Rejected: 4 packages × ~500 LOC each; diverges from upstream immediately; Apache-2.0 `NOTICE` requirements become more complex; update path is painful.

3. **Use `@a2ui/react ./v0_8` API**: Rejected explicitly because `v0_8` uses `all: revert` inside a `@layer` CSS reset that pollutes global host styles with browser-default property resets.

4. **Inject A2UI schema as free text in system prompt** (Python SDK approach): Rejected because it cannot suspend the turn for user interaction, is unreliable under streaming, and provides no validation hook. The tool approach is strictly superior for an interactive use case.

5. **Use A2UI v1.0** (RC): No npm renderer exists for v1.0 yet. Would require hand-writing 18+ components and a data-binding engine. Rejected as out-of-scope until v1.0 ships with a React renderer.

---

## 8. Open Questions

1. **Phase 3 mechanism choice**: When a user interacts with an MCP-originated surface, two implementation paths exist for delivering the action back to the originating server:
   - *Option A (Synthetic turn relay)*: Main process writes a synthetic user turn into the CLI stdin that contains a text prompt instructing the model to call `a2ui_action` on the appropriate MCP server, with the action payload injected. Pro: reuses all existing CLI-side MCP call machinery. Con: burns an LLM turn on routing; model could re-interpret the action.
   - *Option B (Main-process MCP client registry)*: Main process maintains a reference to `ConnectedMCPServer` instances (currently only held by the CLI process) and calls `a2ui_action` directly on the server, bypassing the CLI turn. Pro: zero LLM cost; correct per-spec. Con: requires exposing MCP client handles across the process boundary; significant architecture change.
   - **Current leaning**: Option B for accuracy and cost, but requires a separate design doc. Blocked on Phase 3 scope decision.

2. **MCP initialization capability negotiation**: The A2UI over MCP spec (Section "Catalog Negotiation / Option A") recommends declaring `a2ui.clientCapabilities` during MCP session initialization so stateful servers can tailor their responses. Currently, `src/services/mcp/client.ts` does not inject A2UI capability into the MCP `initialize` params. Should this be added in Phase 1 or Phase 2?
   - **Current leaning**: Add in Phase 1 for spec compliance. Implementation: inject `capabilities.a2ui` into the `initialize` params in the MCP client with `supportedCatalogIds: ['https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json']`. Requires reading exactly where the initialize call is made in `src/services/mcp/client.ts`.

3. **`src/utils/messages/mappers.ts:143-145` consistency fix**: `toSDKMessages()` in the bridge path does not merge `mcpMeta`. This means A2UI payloads sourced from the bridge remote path are silently discarded. This does not affect the desktop (which uses the `queryHelpers.ts` path), but would affect any future remote-session consumer.
   - **Current leaning**: Fix as a low-priority follow-up in the same PR, if the diff is small (estimated ~5 lines). Marked optional in Section 4.

4. **`--a2ui-*` variable enumeration**: The `themeBridge.ts` mapping table below lists variables confirmed by reading the shipped component source. However, component-level variables like `--a2ui-button-background`, `--a2ui-card-border`, etc. have their own fallback chain (e.g., `var(--a2ui-button-background, var(--a2ui-color-primary, #007bff))`). A complete authoritative list of "root" theme variables that need overriding (vs. component-specific overrides) requires running the renderer and inspecting computed styles against both light and dark modes.
   - **Current leaning**: Implement the mappings in the table below in Phase 1; enumerate remaining component-level overrides as a Phase 1 follow-up implementation task.

**Theming bridge mapping table** (confirmed from `/data/a2ui/renderers/react/src/v0_9/catalog/basic/components/*.tsx` source):

**color-scheme class requirement**: A2UI's default theme sets `color-scheme: light dark` on `:root`, meaning it follows the OS preference. To force light or dark to match the app's own setting, the A2UI container element must carry the class `a2ui-light` or `a2ui-dark` (A2UI applies `color-scheme: light` or `color-scheme: dark` respectively to these classes). Our app selects its theme via `data-theme="dark"` on `document.documentElement` (set in `desktop/renderer/src/styles.css` line 3834; the light theme is the `:root` default at line 1). `themeBridge.ts` must call `applyA2uiThemeClass()` both on initial mount and whenever the `data-theme` attribute changes (via a `MutationObserver`). Overriding CSS colour variables alone is insufficient because `color-scheme` controls `light-dark()` resolution in all A2UI token values and also controls native form-control rendering in `TextField`, `CheckBox`, `Slider`, and `DateTimeInput`.

**Base vs derived variables**: The A2UI default stylesheet (`default.ts`) distinguishes two categories. Implementation should override only base variables; derived variables should be left alone so their derivation expressions keep working:

- *Base variables (override these)*: `--a2ui-color-background`, `--a2ui-color-primary`, `--a2ui-color-secondary`, `--a2ui-color-border`, `--a2ui-grid-base`, `--a2ui-font-size`, `--a2ui-font-scale`, `--a2ui-border-radius`.
- *Derived variables (do not override directly)*: `--a2ui-color-surface` (computed as `color-mix()` off `--a2ui-color-background`); the `--a2ui-color-primary-light`, `-dark`, `-hover` and `--a2ui-color-secondary-light`, `-dark`, `-hover` families (each a `computeColorVariant()` expression off the base); `--a2ui-border` (shorthand `1px solid var(--a2ui-color-border)`); the full `--a2ui-spacing-xs/s/m/l/xl` family (all derived from `--a2ui-grid-base` via `calc()`); and the full `--a2ui-font-size-xs/s/m/l/xl/2xl` family (each a `calc()` off `--a2ui-font-size` and `--a2ui-font-scale`).

**Font-size override decision**: The current mapping table overrides `--a2ui-font-size-m/s/xs/l/xl` individually with Desktop's fixed px tokens (`13px`, `12px`, `10px`, `15px`, `18px`). This matches Desktop's design system exactly but discards A2UI's modular scale (the `calc()` derivation from `--a2ui-font-size` and `--a2ui-font-scale`). The implementation **must** use the individual px overrides rather than setting `--a2ui-font-size` to `13px` and relying on the scale. Reason: the scale would produce `13px * 1.2 = 15.6px` for `l` (vs our `15px` token) and `10.83px` for `s` (vs our `12px` token), neither of which matches Desktop's type ramp. Exact pixel alignment with the surrounding chat UI is more important here than preserving scale purity, and the surface is a contained element not a full-page typography system. The table below is consistent with this decision and overrides only the five mapped font-size steps.

**Unit mismatch**: A2UI's default values use `rem` (`--a2ui-border-radius: 0.25rem`, `--a2ui-grid-base: 0.5rem`). Desktop tokens are in `px`. This is fine for every overridden variable because we replace the rem value with our own px value directly. However, any A2UI variable that is NOT listed in the mapping table below will keep its rem-based default and may look slightly inconsistent against adjacent px-based UI (e.g. spacing inside an unmapped component at `0.25rem` grid vs our `4px` grid will match exactly only if the root font-size is `16px`, which is the browser default but not guaranteed if the user has changed it). Flag this as a known cosmetic gap; it is addressed when those variables are added to the mapping table during the Phase 1 follow-up enumeration.

The following `--a2ui-*` variables have confirmed fallback defaults in the component source and should be overridden by `themeBridge.ts` to match Desktop's visual language:

| `--a2ui-*` variable | Maps to Desktop token | Notes |
|---|---|---|
| `--a2ui-color-surface` | `var(--surface)` | `#fffdfa` light; derived in A2UI default but safe to override directly here because we supply the full value |
| `--a2ui-color-on-surface` | `var(--text)` | `#211f1b` light |
| `--a2ui-color-primary` | `var(--accent)` | `#c86f45` light; base variable — `-light`/`-dark`/`-hover` variants will be auto-derived |
| `--a2ui-color-primary-hover` | `var(--accent-strong)` | `#a95735` light; explicit override so hover matches Desktop accent-strong rather than the generic `computeColorVariant` result |
| `--a2ui-color-secondary` | `var(--surface-2)` | `#eee9e1` light; base variable |
| `--a2ui-color-on-secondary` | `var(--text)` | |
| `--a2ui-color-border` | `var(--hairline)` | `#d7d0c4` light; base variable — `--a2ui-border` shorthand will use this automatically |
| `--a2ui-border-radius` | `var(--radius-sm)` | `4px` (A2UI default is `0.25rem`; overriding with px is safe, see unit-mismatch note above) |
| `--a2ui-font-size-m` | `var(--text-base)` | `13px`; individual override per font-size decision above |
| `--a2ui-font-size-s` | `var(--text-sm)` | `12px` |
| `--a2ui-font-size-xs` | `var(--text-xs)` | `10px` |
| `--a2ui-font-size-l` | `var(--text-lg)` | `15px` |
| `--a2ui-font-size-xl` | `var(--text-xl)` | `18px` |
| `--a2ui-text-caption-color` | `var(--muted)` | `#70685d` light |
| `--a2ui-text-color-text` | `var(--text)` | |

Variables such as `--a2ui-button-background`, `--a2ui-card-background`, `--a2ui-textfield-border`, `--a2ui-modal-overlay-color`, and all component-specific spacing/padding variables are NOT yet mapped. The defaults in the component source (e.g., `var(--a2ui-color-primary, #007bff)`) will apply until mapped. Enumerating these is a Phase 1 implementation task to be completed after the renderer is running and inspected in both light and dark modes.

**Apache-2.0 compliance steps** (all phases):

- `THIRD-PARTY-NOTICES.txt` must contain attribution for `@a2ui/react@0.10.2` (Copyright 2024 Google LLC, Apache-2.0), `@a2ui/web_core@0.10.6` (same), and `@a2ui/markdown-it@0.1.1` (same). The `NOTICE` file bundled in each npm package must be reproduced per Apache-2.0 §4(b)(c).
- Vendored JSON schemas in `src/a2ui/schemas/` must retain the original `Copyright 2024 Google LLC` header comment (added as a `$comment` or equivalent) and state the modification: "Vendored from a2ui specification v0_9_1 for use with AJV validation in Claude Code CLI. No structural changes."
- The AJV validator in `src/a2ui/validate.ts` is adapted from `/data/a2ui/specification/v1_0/eval/src/validator.ts`. That file carries the Apache-2.0 header. The adapted file must retain the copyright header and state: "Adapted from a2ui/specification/v1_0/eval/src/validator.ts. Changes: re-pointed schema URIs from v1.0 to v0_9_1; removed v1.0-only message types (callRendererFunction, agentFunctionResponse)."
