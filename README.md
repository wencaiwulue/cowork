<div align="center">

# Synapse Desktop

**Production-ready Claude Code Desktop UI with full agent visibility**

[![Electron](https://img.shields.io/badge/Electron-33+-47848F?logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18+-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)]()

[中文文档](./README.zh-CN.md) | [Documentation](./docs/README.md)

---

</div>

## ✨ Features

### 🎯 First-Class Navigation (⌘1-⌘7)

| View | Shortcut | Purpose |
|------|----------|---------|
| **Chat** | ⌘1 | Multi-session conversations with full composer support |
| **Agents** | ⌘2 | Agent catalog, launching, custom agent creation, task monitoring |
| **Teams** | ⌘3 | Team management, teammate lifecycle control, group messaging |
| **Tasks** | ⌘4 | Project and global scheduled task management |
| **MCP** | ⌘5 | Model Context Protocol servers, health checks, scope management |
| **Skills** | ⌘6 | Skill installation, creation, user/project scope management |
| **Settings** | ⌘7 | Grouped configuration, plugins, diagnostics |

### 🔍 Complete JSON-RPC Activity Tracking

- **Full visibility**: Every single JSON-RPC message captured (incoming + outgoing)
- **Real-time timeline**: Stream events, tool calls, thinking blocks, permission requests all visible
- **Bidirectional**: See both ↓ incoming runtime events and ↑ outgoing user commands
- **Structured inspection**: Parsed metadata (tool names, content, thinking) plus raw JSON payload
- **Filters**: All / Tools / Messages / System tabs
- **Export**: Download full activity log as JSON for debugging
- **Auto-scroll**: Follow new messages as they arrive in real-time

### 🎨 Codex-style UI

- Clean, minimal sidebar navigation
- Persistent session list with status indicators
- Split-pane detail views
- Command palette (⌘K) for quick actions
- Grouped settings page matching Codex layout conventions

### 🧩 A2UI Declarative Surfaces

- **Declarative UI from MCP or Claude**: MCP servers and Claude itself can send A2UI v0.9.1 message payloads; the desktop renders them as live React components inline in the chat transcript using the official `@a2ui/react` renderer
- **Full 18-component basic catalog**: cards, lists, forms, tabs, modals, markdown text, images, and media players are all covered by the upstream renderer without hand-writing any component code
- **Bidirectional interaction**: user clicks and form submissions on `RenderUI`-originated surfaces are routed back to the model as `tool_result` messages, resuming the deferred turn
- **Default off**: the `RenderUI` built-in tool requires the `A2UI_RENDER_UI` build flag and `CLAUDE_CODE_ENTRYPOINT=claude-desktop`; it is invisible in CLI and SDK contexts
- **Current boundaries**: MCP-originated surface interactions are not yet returned to the originating server (Phase-3 gap); remote images and media are blocked by the existing CSP; end-to-end validation in a live Electron window is pending a renderer build fix

## 🚀 Getting Started

### Prerequisites

- **Bun** 1.3+ ([install](https://bun.sh))
- **Node.js** 22+
- **macOS** 12+ (primary target; Windows/Linux via Electron)

### Quick Start

```bash
# Clone the repository
git clone git@github.com:wencaiwulue/synapse.git
cd synapse

# Install dependencies (includes @a2ui/react, @a2ui/web_core, @a2ui/markdown-it)
bun install

# Start desktop in development mode (with hot reload)
bun run desktop:dev

# Build production bundles
bun run desktop:build
```

### NPM Scripts

| Command | Description |
|---------|-------------|
| `bun run desktop:dev` | Start Vite dev server + Electron with HMR |
| `bun run desktop:build` | Build main, preload, and renderer for production |
| `bun run desktop:check` | TypeScript type check + full build |
| `bun run desktop:test` | Run desktop test suite |
| `bun run desktop:test-renderer` | Run jsdom-based renderer + A2UI conformance tests |
| `bun run wcommit "msg"` | Weekend-timestamp commit and push (see below) |

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────┐
│                 Electron Application                 │
├──────────────────────┬───────────────────────────────┤
│  Renderer (React)    │  Main (Node.js)               │
│                      │                               │
│  • UI Components     │  • Session Manager            │
│  • State Management  │  • CLI Process Host           │
│  • RPC Activity UI   │  • IPC Router + Validation    │
│  • Timeline Viewer   │  • MCP/Skills/Config Service  │
└──────────────────────┴───────────────────────────────┘
                         │ stdio / NDJSON
                         ▼
              ┌─────────────────────────┐
              │  Claude Code CLI        │
              │  (Agent Runtime)        │
              └─────────────────────────┘
```

See [Architecture Docs](./docs/architecture/ARCHITECTURE.md) for details.

## 📁 Project Structure

```
synapse/
├── desktop/
│   ├── main/           # Electron main process
│   │   ├── ipc.ts      # IPC types and handlers
│   │   ├── sessionManager.ts
│   │   ├── messageMapper.ts
│   │   └── ...
│   ├── renderer/       # React UI
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── a2ui/       # A2UI renderer modules
│   │       └── styles.css
│   ├── preload/        # contextBridge
│   └── scripts/        # Build/dev scripts
├── src/                # CLI source
├── docs/               # Documentation
└── scripts/            # Repo scripts (weekend-commit, etc.)
```

## 📊 RPC Activity Viewer

Navigate to **Agents (⌘2) → Activity** tab to access the full JSON-RPC inspector.

**What gets captured:**

| Direction | Type | Examples |
|-----------|------|----------|
| ↓ Incoming | stream_event | content_block_start/stop/delta, message_delta, message_stop |
| ↓ Incoming | tool_use | Bash, Read, Write, Edit, MCP tools (with full input JSON) |
| ↓ Incoming | thinking | Entire model thinking blocks |
| ↓ Incoming | permission_request | Tool permission prompts |
| ↓ Incoming | agent_task_update | Agent task lifecycle: pending → running → completed/failed |
| ↓ Incoming | system, result | System messages, final results |
| ↓ Incoming | runtime:stderr | All stderr output from Claude runtime |
| ↑ Outgoing | user-send | User chat messages |
| ↑ Outgoing | agent:launch | Agent task launch requests |
| ↑ Outgoing | team:send | Team/group messages |

Each entry can be clicked to reveal:
- Metadata (timestamp, type, session, direction)
- Parsed content (tool name, text, thinking)
- **Full raw JSON-RPC payload** in syntax-highlighted viewer

## 🤝 Contributing

1. Create feature branches from `master`
2. Ensure TypeScript compiles: `bun run check`
3. Update documentation under `docs/` for any new feature
4. Commit using weekend timestamps: `bun run wcommit "feat: description"`

## 📝 License

MIT

---

<div align="center">
<sub>Built on Claude Code by Anthropic</sub>
</div>
