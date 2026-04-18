# SSE Stream Status 需求文档

## 概述
实现基于 SSE (Server-Sent Events) 连接状态的实时指示器，用于显示 agent/team 对话的处理状态。

## 功能需求

### 1. Stream 状态定义
系统需要维护以下状态：

| 状态 | 说明 | UI 显示 |
|------|------|---------|
| `idle` | 空闲，无活跃 SSE 连接 | 不显示 |
| `connecting` | SSE 连接已建立，等待第一个 token | "Connecting..." + 动画 |
| `streaming` | 已收到第一个 token，正在输出内容 | "Thinking..." + 动画 |
| `done` | SSE 连接正常结束 | 不显示 |
| `error` | SSE 连接出错 | 显示错误状态 |

### 2. 状态流转

```
                    ┌─────────┐
           ┌───────►│  idle   │◄─────────────────┐
           │        └────┬────┘                  │
           │             │ sendMessage()        │
           │             ▼                      │
           │        ┌─────────┐   first token   │
           │        │connecting│──────────────►│streaming│
           │        └────┬────┘                 └────┬────┘
           │             │                         │
           │             │ connection            │ stream
           │             │ closed                │ done
           │             ▼                       ▼
           │        ┌─────────┐              ┌─────────┐
           └───────│  error  │              │  done   │
                    └─────────┘              └────┬────┘
                                                  │
                                                  └────► idle
```

### 3. UI 展示需求

#### 3.1 Thinking Indicator
- 位置：消息列表底部
- 样式：与 agent message 一致的卡片样式
- 内容：
  - Avatar: 当前 agent/team 的头像
  - 名称: agent/team 名称
  - 状态文字 + 动画点 (● ● ●)

#### 3.2 Error 状态展示
- 位置：消息列表底部或独立提示
- 样式：红色边框/背景的错误卡片
- 内容：
  - 错误图标
  - 简短错误描述
  - 可选：重试按钮

### 4. Session 切换行为

#### 4.1 切换到其他 session
- SSE 连接保持后台运行
- 状态保存在全局 Map 中
- 当前 session 的 UI 状态被保留

#### 4.2 切换回原 session
- 从全局 Map 恢复 stream status
- 如果 SSE 仍在连接：
  - `connecting` → 显示 "Connecting..."
  - `streaming` → 显示 "Thinking..."
- 如果 SSE 已结束：
  - 状态设为 `idle`，不显示 indicator

### 5. 边界情况

#### 5.1 网络中断
- SSE 连接断开
- 状态转为 `error`
- UI 显示错误提示

#### 5.2 快速切换 session
- 确保不会重复创建 SSE 连接
- 使用 registry 防止重复启动 stream

#### 5.3 页面刷新
- SSE 连接丢失（符合预期）
- 页面重新加载后从服务器获取历史消息
- 正在进行的对话需要用户重新发起

## 技术实现

### 数据结构
```typescript
// Stream 状态
interface StreamState {
  status: 'connecting' | 'streaming' | 'done' | 'error';
  hasReceivedChunk: boolean;
  agentId?: string;
  agentName?: string;
}

// 全局状态存储
const _streamStates = new Map<string, StreamState>();
```

### API
```typescript
// 获取指定 conversation 的 stream 状态
export function getStreamState(convoId: string): StreamState | undefined;

// 检查是否处于 connecting 状态
export function isStreamConnecting(convoId: string): boolean;
```

## 验收标准

- [ ] 发送消息后正确显示 "Connecting..."
- [ ] 收到第一个 token 后转为 "Thinking..."
- [ ] 流结束后 indicator 消失
- [ ] 切换 session 后返回能恢复正确的状态
- [ ] 网络错误时显示 error 状态
- [ ] 停止按钮能正确终止 stream

