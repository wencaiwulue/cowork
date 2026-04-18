# SSE 流状态管理文档

## 1. 架构设计

### 1.1 核心数据结构

```typescript
// 流状态存储（全局，按 convoId 索引）
interface StreamState {
  status: 'connecting' | 'streaming' | 'done' | 'error';
  hasReceivedChunk: boolean;
  agentId?: string;
  agentName?: string;
}
const _streamStates = new Map<string, StreamState>();

// 流注册表（全局，管理 SSE 连接生命周期）
interface StreamEntry {
  abort: AbortController;
  listener: StreamListener | null;  // 当前活跃的 listener
  buffer: StreamEvent[];            // listener 缺席时缓存事件
  done: boolean;                    // fetch 已结束
}
const _registry = new Map<string, StreamEntry>();
```

### 1.2 设计原则

| 原则 | 说明 |
|------|------|
| **连接持久化** | 每个 convoId 对应一条 fetch POST 长连接，连接存在模块级 Map 里，完全脱离 React 生命周期 |
| **监听切换** | 切换 session 只是把 listener 换掉，fetch 连接继续在后台读取数据 |
| **用户控制** | 只有用户点 Stop 才会 abort 连接 |

---

## 2. 状态流转图

```
                    _startStream
                         │
                         ▼
               ┌──────────────────┐
               │   'connecting'   │ ◄──── 初始状态，连接建立中
               └────────┬─────────┘
                        │
            ┌───────────┼───────────┐
            ▼           │           ▼
    ┌─────────────┐     │    ┌───────────┐
    │收到 chunk   │     │    │  HTTP 错误 │
    └──────┬──────┘     │    └─────┬─────┘
           │            │          │
           ▼            │          ▼
   ┌────────────────┐   │   ┌───────────┐
   │  'streaming'   │   │   │  'error'  │
   │  hasReceivedChunk = true
   └────────┬───────┘   │   └───────────┘
            │           │
            │     ┌─────┴──────┐
            │     │  abort()   │
            │     └─────┬──────┘
            │           │
            ▼           ▼
        ┌──────────────────┐
        │     'done'       │
        └──────────────────┘
```

---

## 3. 核心函数说明

### 3.1 流生命周期管理

#### `_startStream(convoId, backendUrl, body)`
启动一个新的 SSE 长连接。

**流程：**
1. 检查 `_registry` 是否已有该 `convoId` 的连接，有则返回（避免重复创建）
2. 创建 `AbortController` 和 `StreamEntry`，存入 `_registry`
3. 初始化 `_streamStates[convoId] = { status: 'connecting', ... }`
4. 通过 `_emit` 发送 `stream_state` 事件（`connecting`）
5. 启动 fetch 请求，进入 SSE 读取循环

**关键代码：**
```typescript
// 第 91-95 行
_streamStates.set(convoId, { status: 'connecting', hasReceivedChunk: false, agentId, agentName });
_emit(entry, { type: 'stream_state', status: 'connecting', agentId, agentName } as any);
```

#### `registerListener(convoId, listener): () => void`
注册当前 session 的事件监听器。

**流程：**
1. 从 `_registry` 获取 `StreamEntry`
2. **关键修复**：从 `_streamStates` 获取当前状态，立即发送 `stream_state` 事件给 listener（解决切换 session 时状态丢失问题）
3. 回放 `buffer` 中积累的历史事件
4. 如果流已结束（`done=true`），发送 `stream_done` 并清理
5. 将 listener 赋值给 `entry.listener`
6. 返回取消注册函数（将 `entry.listener` 置为 null）

**关键代码：**
```typescript
// 第 199-205 行（修复后）
const streamState = _streamStates.get(convoId);
if (streamState && !entry.done) {
  try {
    listener({ type: 'stream_state', status: streamState.status, agentId: streamState.agentId, agentName: streamState.agentName } as any);
  } catch {}
}
```

#### `isStreamActive(convoId): boolean`
检查指定 `convoId` 的流是否处于活跃状态（连接存在且未结束）。

```typescript
return !!e && !e.done;
```

#### `stopStream(convoId)`
停止指定 `convoId` 的流连接。

```typescript
if (e) { e.abort.abort(); _registry.delete(convoId); }
```

### 3.2 事件处理

#### `_emit(entry, event)`
发送事件到当前 listener，并将非终止事件缓存到 buffer。

```typescript
if (event.type !== 'stream_done' && event.type !== 'error') {
  entry.buffer.push(event);
}
if (entry.listener) {
  try { entry.listener(event); } catch {}
}
```

#### `_parseSSEData(data): StreamEvent | null`
解析后端 SSE 数据为前端 `StreamEvent`。

---

## 4. React 组件集成

### 4.1 切换 Session 的 useEffect

```typescript
useEffect(() => {
  // 重置 UI 状态
  setTodos([]);
  setShowTodos(false);
  setToolExecutions([]);
  setShowToolExecutions(false);

  // 从全局 _streamStates 恢复 stream status
  const streamState = _streamStates.get(selectedTeamName);
  const active = isStreamActive(selectedTeamName);
  if (streamState) {
    setStreamStatus(streamState.status);
  } else {
    setStreamStatus(active ? 'streaming' : 'idle');
  }
  setIsOrchestrating(active || (streamState?.status === 'connecting' || streamState?.status === 'streaming'));

  // ... 加载历史消息

  // 注册监听器
  const unregister = registerListener(convoId, listener);
  return unregister;
}, [selectedTeamName, backendUrl]);
```

### 4.2 listener 中的状态处理

```typescript
const listener: StreamListener = (event) => {
  // ... 其他事件处理

  if (event.type === 'stream_state') {
    setStreamStatus(event.status);
  } else if (event.type === 'stream_done') {
    setIsOrchestrating(false);
    setStreamStatus('done');
  } else if (event.type === 'error') {
    setIsOrchestrating(false);
    setStreamStatus('error');
  }
};
```

---

## 5. 关键修复历史

### 修复 1：切换 session 时状态丢失

**问题**：`connecting` 状态在切换 session 后丢失，因为 listener 注册时已经错过了 `connecting` 事件的发送时机。

**修复**：在 `registerListener` 中，先检查 `_streamStates` 并立即发送当前的 `stream_state` 事件给新注册的 listener。

```typescript
// registerListener 函数中
const streamState = _streamStates.get(convoId);
if (streamState && !entry.done) {
  try {
    listener({ type: 'stream_state', status: streamState.status, ... } as any);
  } catch {}
}
```

### 修复 2：切换 session 后状态显示错误

**问题**：切换 session 时，`useEffect` 只根据 `isStreamActive` 简单设置 `streaming` 或 `idle`，没有考虑 `connecting`、`error` 等状态。

**修复**：在 `useEffect` 中从 `_streamStates` 恢复正确的状态：

```typescript
const streamState = _streamStates.get(selectedTeamName);
if (streamState) {
  setStreamStatus(streamState.status);
} else {
  setStreamStatus(active ? 'streaming' : 'idle');
}
```

---

## 6. 时序图

### 6.1 启动流并接收数据

```
┌──────────┐     ┌─────────────┐     ┌─────────────┐     ┌──────────┐
│   UI     │     │ _startStream │     │   _registry  │     │  Backend │
└────┬─────┘     └──────┬──────┘     └──────┬──────┘     └────┬─────┘
     │                  │                    │                  │
     │  1. start stream │                    │                  │
     │─────────────────>│                    │                  │
     │                  │  2. create entry   │                  │
     │                  │  _registry.set()   │                  │
     │                  │───────────────────>│                  │
     │                  │                    │                  │
     │                  │  3. _streamStates    │                  │
     │                  │     [convoId] =    │                  │
     │                  │     {connecting}   │                  │
     │                  │                    │                  │
     │                  │  4. _emit()         │                  │
     │                  │  stream_state:     │                  │
     │                  │     connecting     │                  │
     │                  │                    │                  │
     │                  │  5. fetch()        │                    │
     │                  │──────────────────────────────────────>│
     │                  │                    │                  │
     │                  │                    │  6. SSE chunks    │
     │                  │<──────────────────────────────────────│
     │                  │                    │                  │
     │                  │  7. _emit()        │                    │
     │                  │  stream_state:     │                    │
     │                  │    streaming       │                    │
     │                  │                    │                  │
     │  8. update UI   │                    │                    │
     │<─────────────────│                    │                    │
```

### 6.2 切换 Session

```
┌──────────┐     ┌─────────────┐     ┌─────────────┐
│ SessionA │     │  _registry   │     │  SessionB  │
│  (old)   │     │  [convoId]   │     │   (new)    │
└────┬─────┘     └──────┬──────┘     └────┬───────┘
     │                  │                  │
     │  1. 用户切换 Session              │
     │─────────────────────────────────>│
     │                  │                  │
     │  2. 注销 old listener             │
     │  unregister()   │                  │
     │────────────────>│                  │
     │                  │                  │
     │  3. 注册 new listener             │
     │                  │ registerListener()│
     │                  │<─────────────────│
     │                  │                  │
     │                  │  4. 从 _streamStates
     │                  │     恢复状态      │
     │                  │  stream_state   │
     │                  │  发送给 new      │
     │                  │  listener        │
     │                  │────────────────>│
     │                  │                  │
     │                  │  5. 回放 buffer  │
     │                  │  中积累的事件    │
     │                  │────────────────>│
     │                  │                  │
     │                  │                  │
     │  6. fetch 连接    │                  │
     │     一直在后台    │                  │
     │     运行，不受    │                  │
     │     session 切换  │                  │
     │     影响          │                  │
     │◄─────────────────│                  │
```

---

## 7. 注意事项

### 7.1 状态持久化

- `_streamStates` 和 `_registry` 都是模块级全局变量，不随 React 组件卸载而销毁
- 切换 session 时，stream 连接和状态都会保留
- 只有以下情况会清理状态：
  - 用户点击 Stop 按钮
  - 收到 `stream_done` 事件
  - 发生错误

### 7.2 内存管理

- 每个 convoId 只会创建一条 SSE 连接
- Buffer 会持续增长直到被消费（切换到对应 session）
- 流结束后会自动清理 registry 和 streamStates

### 7.3 并发安全

- 同一时间一个 convoId 只有一个活跃的 listener
- 通过 `registerListener` 的原子操作保证 listener 切换的线程安全
