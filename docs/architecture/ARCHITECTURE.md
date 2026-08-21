# 架构设计文档

**最后更新**: 2026-08-21

---

## 系统架构概览

```
┌─────────────────────────────────────────────────────────┐
│                     Electron 架构                        │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────┐         IPC          ┌──────────────┐ │
│  │  Renderer    │ ◄──────────────────► │    Main      │ │
│  │  (React)     │   contextBridge      │  (Node.js)   │ │
│  │              │                      │              │ │
│  │  - UI 层     │                      │  - 会话管理  │ │
│  │  - 状态管理  │                      │  - 进程宿主  │ │
│  │  - 事件处理  │                      │  - CLI 桥接  │ │
│  └──────────────┘                      └──────┬───────┘ │
│                                                │         │
└────────────────────────────────────────────────┼─────────┘
                                                 │
                                                 ▼
                                    ┌─────────────────────┐
                                    │   Claude CLI 进程    │
                                    │   (子进程 stdio)     │
                                    └─────────────────────┘
```

## 模块划分

### Main Process (`desktop/main/`)

| 文件 | 职责 |
|------|------|
| `main.ts` | Electron 入口，窗口管理，生命周期 |
| `ipc.ts` | IPC 类型定义，参数验证，handler 注册 |
| `sessionManager.ts` | 会话生命周期，消息路由，状态持久化 |
| `sessionHost.ts` | CLI 子进程管理，stdio 通信 |
| `messageMapper.ts` | 原始 NDJSON 消息转 DesktopMessage；提取 A2UI payload（`a2uiMessages`/`a2uiToolUseId`/`a2uiSource`） |
| `config.ts` | 配置读写，MCP/Skills 管理 |
| `agents.ts` | Agent 发现、诊断、launch 逻辑 |
| `navigation.ts` | 导航事件分发 |

### Renderer Process (`desktop/renderer/src/`)

| 文件/目录 | 职责 |
|-----------|------|
| `App.tsx` | 根组件，状态管理，全部UI渲染 |
| `main.tsx` | React 入口 |
| `styles.css` | 全局样式，CSS token 定义 |
| `composerKeys.ts` | Composer 键盘快捷键定义 |
| `composerMenu.ts` | @ 提及 / 斜杠命令菜单逻辑 |
| `editorDirty.ts` | 编辑器未保存状态追踪 |
| `runtimeErrorPresentation.ts` | 运行时错误格式化展示 |
| `a2ui/` | A2UI 声明式界面渲染模块（4个文件，见下） |

#### `a2ui/` 子目录

| 文件 | 职责 |
|------|------|
| `A2uiSessionProcessor.ts` | 每会话 surface 生命周期管理，`anchorMessageId` 映射，session restore replay |
| `A2uiSurfaceHost.tsx` | `<A2uiSurface>` React 封装，含 `MarkdownContext`、`ErrorBoundary` 和 feature flag 守卫 |
| `extract.ts` | 纯函数：从原始 runtime-message 提取 `a2uiMessages`；无 React 依赖，可在 node 测试环境运行 |
| `themeBridge.ts` | Desktop CSS token → `--a2ui-*` 变量映射；管理容器元素的 `a2ui-dark`/`a2ui-light` class，与 app 深色模式保持同步 |

### 核心数据流

```
Claude CLI stdout (NDJSON)
    ↓
sessionHost 'message' 事件
    ↓
sessionManager 处理 + emit 'runtime-message'
    ↓
messageMapper.toDesktopMessages():
  - user 分支: extractA2uiPayload() → a2uiMessages/a2uiToolUseId/a2uiSource
  - assistant 分支: extractRenderUiToolUse() → a2uiMessages/a2uiToolUseId
    ↓
IPC 推送到 renderer
    ↓
React 状态更新:
  - rpcMessages[] (活动追踪)
  - messages[] (聊天记录)
  - agentTasks[] (任务状态)
    ↓
A2uiSessionProcessor.ingest(message):          ← A2UI surface 提取与挂载
  per message <article>:
    a2uiSurfacesFor(message.id) → <A2uiSurfaceHost>  ← A2UI surface 渲染
    ↓
用户点击 surface 组件:
  actionCallback → sessions:submitA2uiAction IPC
  → sessionHost 写 tool_result 到 CLI stdin    ← action 双向回传
    ↓
UI 渲染
```

### RPC 活动追踪架构

```
┌─────────────────────────────────────────┐
│         消息捕获层                       │
├─────────────────────────────────────────┤
│  Incoming: host.on('message')           │
│  Outgoing: sessionManager.send()        │
│  Stderr: host.on('stderr')              │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│         解析层 (extractRpcMessageInfo)  │
├─────────────────────────────────────────┤
│  - 类型识别 (stream_event, tool_use...) │
│  - 内容提取 (text, thinking, tool name) │
│  - 工具调用标记                          │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│         状态层                           │
├─────────────────────────────────────────┤
│  rpcMessages: RpcMessage[] (最多2000条) │
│  - id, timestamp, direction, type       │
│  - raw, parsed (结构化信息)              │
└───────────────┬─────────────────────────┘
                ↓
┌─────────────────────────────────────────┐
│         UI层                             │
├─────────────────────────────────────────┤
│  - Timeline (时间线)                    │
│  - Filters (过滤器)                     │
│  - Detail Panel (详情 + raw JSON)       │
│  - Export/Copy/Auto-scroll              │
└─────────────────────────────────────────┘
```

## 状态管理

使用 React useState + useRef 模式：
- 页面导航状态: `primaryNavView`, `activePane`
- 各 pane 独立 section 状态: `*ActiveSection`
- 各 pane 独立 status: `*Status`
- 表单草稿状态: `*Draft`
- RPC 活动: `rpcMessages`, 按session过滤

## IPC 协议扩展

新增 pane 类型支持：
```typescript
type PaneId = 
  | 'files' | 'diff' | 'editor' | 'terminal' | 'preview'
  | 'settings' | 'tasks' | 'teams' | 'agents'
  | 'mcp' | 'skills'  // 新增

type PrimaryView = 
  | 'chat' | 'agents' | 'teams' | 'tasks' 
  | 'mcp' | 'skills' | 'settings'  // 新增
```

新增 A2UI 双向通道（`desktop/main/ipc.ts`）：

```typescript
// desktopChannels 中新增两条
'sessions:submitA2uiAction'  // 用户与 surface 交互后，将 A2uiActionPayload 写回 CLI stdin
'sessions:reportA2uiError'   // surface 渲染失败时上报 A2uiErrorPayload，不中断会话
```

`DesktopMessage` 新增三个可选字段：

```typescript
a2uiMessages?: A2uiMessage[]        // 从 _meta['a2ui/messages'] 解析出的 surface 描述
a2uiToolUseId?: string              // 关联的 tool_use_id，用于写回 tool_result
a2uiSource?: 'mcp' | 'built-in'    // 来源：MCP EmbeddedResource 或 RenderUI 内置工具
```
