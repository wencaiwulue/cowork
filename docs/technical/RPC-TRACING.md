# RPC 活动追踪技术实现

**最后更新**: 2026-07-26 (周末)

---

## 概述

实现对 Claude Code runtime 所有 JSON-RPC 消息的完整捕获和可视化，用于调试、审计和理解 agent 执行步骤。

## 数据捕获点

### 1. 入站消息 (Incoming)

位置: `desktop/main/sessionManager.ts:385`

```typescript
host.on('message', async raw => {
  // 所有stdout NDJSON消息都会触发
  this.emit({ type: 'runtime-message', sessionId: session.id, message: raw })
  // ... 后续处理
})
```

覆盖的消息类型：
- `stream_event` - 所有流式事件（content_block_start/delta/stop, message_start/delta/stop）
- `system`, `system_init` - 系统消息
- `permission_request` - 权限请求
- `agent_task_update` - Agent 任务状态更新
- `assistant`, `user`, `tool` - 完整消息
- `result` - 最终结果
- `tool_result` - 工具执行结果

### 2. 出站消息 (Outgoing)

位置: `desktop/main/sessionManager.ts:250`

```typescript
async send(sessionId: string, text: string): Promise<void> {
  // ...
  this.emit({ type: 'runtime-message', sessionId, message: { 
    type: 'outgoing:user-send', 
    text, 
    timestamp: Date.now() 
  }})
  host.sendMessage(text)
}
```

覆盖所有用户输入、agent命令、team消息，因为它们全部通过此方法发送。

### 3. Stderr 输出

位置: `desktop/main/sessionManager.ts:435`

```typescript
host.on('stderr', message => {
  const text = String(message)
  stderr.push(text)
  if (text.trim()) {
    this.emit({ type: 'runtime-message', sessionId, message: { 
      type: 'runtime:stderr', 
      text, 
      timestamp: Date.now() 
    }})
  }
})
```

## 消息解析 (`extractRpcMessageInfo`)

位置: `desktop/renderer/src/App.tsx:~1137`

解析器处理以下类型：

| 消息类型 | 提取字段 |
|---------|---------|
| `stream_event: content_block_start: tool_use` | toolName, isToolUse标记 |
| `stream_event: content_block_delta: text_delta` | content文本片段 |
| `stream_event: content_block_delta: input_json_delta` | 工具输入进行中 |
| `stream_event: content_block_delta: thinking_delta` | thinking内容 |
| `stream_event: message_delta/stop` | stop reason, 完成标记 |
| `permission_request` | toolName, 权限描述 |
| `agent_task_update` | taskId, status, agentType |
| `assistant/user/tool` | content数组解析 (text/thinking/tool_use) |
| `outgoing:user-send` | 用户发送文本 |
| `runtime:stderr` | stderr输出文本 |

## UI 组件

位置: Agents 页面 → Activity 标签 (`id="agents-activity"`)

### 布局
```
┌─────────────────────────────────────────────────────────┐
│ [All(123)] [Tools] [Messages] [System]  ☐Auto-scroll   │
│ [Copy] [Export] [Clear]                                 │
├───────────────────────────┬─────────────────────────────┤
│ ↓ 12:53:01  stream_event  │ Message Details             │
│ ↑ 12:53:00  outgoing:send │ 2026-07-24 12:53:01         │
│ ↓ 12:52:58  stream_event  ├─────────────────────────────┤
│ ↓ 12:52:55  tool: Bash    │ Type: stream_event          │
│                           │ Direction: incoming          │
│                           ├─────────────────────────────┤
│                           │ Tool call: Bash             │
│                           ├─────────────────────────────┤
│                           │ {                           │
│                           │   "type": "stream_event",   │
│                           │   "event": {...}            │
│                           │ }                           │
└───────────────────────────┴─────────────────────────────┘
```

### 样式
- 入站消息: ↓ 绿色箭头背景
- 出站消息: ↑ 蓝色箭头背景  
- 工具事件: accent颜色高亮
- Thinking块: 黄色左边框
- Raw JSON: 深色主题语法区域

### 功能
- 实时追加，可选自动滚动到底部
- 按当前活跃session过滤
- 过滤器标签页切换
- 点击复制raw JSON
- 导出全部为JSON文件下载
- 最多保留2000条消息
