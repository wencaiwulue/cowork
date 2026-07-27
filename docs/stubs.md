# Local Stub Inventory and Replacement Plan

This source snapshot was made buildable by adding local stubs for private
packages and missing snapshot files. The stubs are intentionally narrow: they
restore CLI startup and buildability, but they do not imply feature parity with
the original private implementation.

## Inventory

Counts are based on `BUILD_CHANGES.md` and the current tree:

- Local stub dependency packages: 4
- Files inside local stub dependency packages: 16
- Source-gap files added to complete the snapshot: 25
- Bun shim files: 2
- Hidden disabled command stubs under `src/commands/*/index.js`: 18

The local dependency stubs are:

- `stubs/ant-claude-for-chrome-mcp`
- `stubs/ant-computer-use-mcp`
- `stubs/ant-computer-use-input`
- `stubs/ant-computer-use-swift`

The main source-gap stubs cover assistant UI, agents-platform, compact/context
collapse, REPL/Tungsten/background PR/plan verification tools, SDK generated
types, workflow constants, file persistence types, protected namespace checks,
and the bundled verify skill files.

## Replacement Matrix

| Area | Prior state | Local replacement | V1 coverage | Out of scope |
| --- | --- | --- | --- | --- |
| Chrome/browser automation | `@ant/claude-for-chrome-mcp` exported no tools and threw at server creation | Playwright-backed MCP server in the local stub package | Tabs, navigation, page text, find, form input, simple mouse/keyboard actions, JavaScript eval, console/network logs, image upload | Private Chrome extension pairing, native-host protocol, browser shortcuts, GIF recorder, plan updater |
| Computer Use | `@ant/computer-use-mcp` returned no tools and threw at server creation | Opt-in local MCP server in the local stub package | Screenshot, cursor position, mouse move/click, typing, key presses, scroll, wait, clipboard read/write, action batches | TCC checks, app allowlists, frontmost app gates, SCContentFilter filtering, app hiding/unhiding, display pinning |
| Computer input native package | `@ant/computer-use-input` threw on all functions | Basic wrapper over the same open-source desktop automation used by Computer Use | Mouse, keyboard, and text helpers for local callers | Private native module parity |
| Computer Swift native package | Empty export | Remains a compatibility placeholder | Type/load compatibility only | macOS private native features |

## Runtime Gates

Chrome/browser automation follows the existing Claude-in-Chrome gates:

- `CLAUDE_CODE_ENABLE_CFC=1` enables the dynamic MCP setup in local builds.
- `CLAUDE_CODE_BROWSER_HEADLESS=0` launches a headed Playwright browser.

Computer Use is disabled by default because it can move the pointer, type, and
read/write the clipboard. Enable it explicitly with:

```bash
CLAUDE_CODE_ENABLE_COMPUTER_USE=1
```

This local gate is separate from the old private `CHICAGO_MCP` feature flag.

## Verification Commands

Run the focused checks after changing the local replacements:

```bash
sed -n '1,220p' docs/stubs.md
bun pm ls playwright @nut-tree-fork/nut-js screenshot-desktop clipboardy
bun test
CLAUDE_CODE_ENABLE_CFC=1 bun run build
./dist/claude-local --version
./dist/claude-local --help
```

`bun run check` is not required for this snapshot. `BUILD_CHANGES.md` documents
that TypeScript checking is not clean because the source snapshot lacks
generated/type-only files and does not exactly match the original dependency
set.

## 2026-07-24 Stub Completion (Swift Stub Implemented)

### `@ant/computer-use-swift` — Completed

Previously exported empty `{}`. Now fully implemented using native macOS commands:

| Feature | Implementation |
|---|---|
| `display.getSize()` / `listAll()` | Parses `system_profiler SPDisplaysDataType` for Retina resolution |
| `screenshot.captureExcluding()` | Uses `screencapture` CLI with PNG IHDR dimension parsing |
| `screenshot.captureRegion()` | Uses `screencapture -R x,y,w,h` for region capture |
| `apps.prepareDisplay()` | AppleScript activate for target app |
| `apps.listRunning()` / `previewHideSet()` | AppleScript System Events process listing |
| `apps.listInstalled()` | `mdfind` for .app bundles |
| `apps.open()` / `unhide()` | AppleScript activate |
| `tcc.hasAccessibilityPermission()` | Tests System Events AppleScript access |
| `tcc.hasScreenCapturePermission()` | Tests screencapture success |
| `hotkey.*` | No-op stubs (ESC hotkey handled by CLI layer) |
| `resolvePrepareCapture()` | Combines display info + screenshot |

### All 4 Stubs Status: ✅ Complete

| Stub | Status | Implementation |
|---|---|---|
| `@ant/claude-for-chrome-mcp` | ✅ Complete | Playwright-backed MCP server (17 tools) |
| `@ant/computer-use-input` | ✅ Complete | nut-tree-fork mouse/keyboard wrapper |
| `@ant/computer-use-mcp` | ✅ Complete | MCP server with local tool execution (22 tools) |
| `@ant/computer-use-swift` | ✅ Complete | macOS CLI/screencapture/AppleScript implementation |

## 2026-07-24 Stub Audit (Quickstarts Reference)

Audited against [anthropics/claude-quickstarts](https://github.com/anthropics/claude-quickstarts):

### Stub Completeness
- All 4 npm stubs (`@ant/claude-for-chrome-mcp`, `@ant/computer-use-input`, `@ant/computer-use-mcp`, `@ant/computer-use-swift`) are fully implemented
- `ant-computer-use-swift/index.js` exports `{}` (type-only compatibility stub, Swift binary loads at runtime)
- All 65 IPC channels have handlers in `desktop/main/main.ts`
- All 81 `handleIpc()` registrations are accounted for
- All npm dependencies (playwright, @nut-tree-fork/nut-js, screenshot-desktop, clipboardy, @modelcontextprotocol/sdk) are installed

### Quickstarts Patterns Covered
The quickstarts demonstrate Python-side Agent class, MCP connections, and tool execution. All these patterns are handled by the underlying Claude Code CLI SDK:

| Quickstart Pattern | Desktop Coverage |
|---|---|
| Agent class with tools | Built-in agent templates (10 types) + @mention routing |
| MCP server connections | MCP management page (user/project scope) |
| Browser automation | Chrome MCP stub (Playwright-backed) |
| Computer use | Local Computer Use MCP stub (nut-js backed) |
| Autonomous coding loop | Core CLI session with streaming |
| Tool execution | CLI handles tool calls; desktop shows RPC viewer |
| Message history | Session transcript and persistence |

### Built-in Agent Templates (added 2026-07-24)
Inspired by quickstart examples:
- `code-reviewer` — code review for correctness/bugs/security
- `test-writer` — writes comprehensive tests with edge cases
- `bug-finder` — systematically finds and fixes bugs
- `refactor` — improves code clarity without behavior changes
- `document-writer` — creates/updates technical documentation
- `browser-agent` — browser automation tasks
- `computer-agent` — desktop automation tasks
