# 架构设计文档

**最后更新**: 2026-07-26 (周末)

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
| `messageMapper.ts` | 原始 NDJSON 消息转 DesktopMessage |
| `config.ts` | 配置读写，MCP/Skills 管理 |
| `agents.ts` | Agent 发现、诊断、launch 逻辑 |
| `navigation.ts` | 导航事件分发 |

### Renderer Process (`desktop/renderer/src/`)

| 文件 | 职责 |
|------|------|
| `App.tsx` | 根组件，状态管理，全部UI渲染 |
| `main.tsx` | React 入口 |
| `styles.css` | 全局样式 |

### 核心数据流

```
Claude CLI stdout (NDJSON)
    ↓
sessionHost 'message' 事件
    ↓
sessionManager 处理 + emit 'runtime-message'
    ↓
IPC 推送到 renderer
    ↓
React 状态更新:
  - rpcMessages[] (活动追踪)
  - messages[] (聊天记录)
  - agentTasks[] (任务状态)
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
