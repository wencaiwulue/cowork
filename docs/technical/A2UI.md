# A2UI 协议接入技术说明

**最后更新**: 2026-08-21

> **行号说明**: 本文中的 `文件:行号` 引用均为撰写时快照。代码持续演进，请以符号名/函数名为准，行号仅供快速定位。所有行号均已用 `grep` 在撰写时复核。

**相关文档**: 完整设计决策见 `docs/design/2026-08-21-a2ui-integration.md`（英文，架构层决策）；本文面向开发者与接入方，讲机制与边界。

---

## 概述

A2UI 是 Google LLC 开发的开放标准协议（Apache-2.0），允许 AI agent 向客户端渲染器发送声明式 UI 描述，客户端完成布局、数据绑定与交互，再把用户操作以 `tool_result` 形式回传给 agent。

本项目接入协议版本 **v0.9.1**，使用 `@a2ui/react@0.10.2` + `@a2ui/web_core@0.10.6` + `@a2ui/markdown-it@0.1.1` 三个官方包。

### 为什么是 v0.9.1 而非 v1.0

`@a2ui/react` 目前仅导出 `./v0_8` 与 `./v0_9` 两条路径，没有 v1.0 入口；`@a2ui/web_core` 的 v0_9 schema 接受 `z.enum(['v0.9','v0.9.1'])` 两个版本字符串，后向兼容。采用 v0.9.1 既能覆盖全部 18 个 basic catalog 组件，又无需自行维护组件实现与数据绑定引擎——自写映射层的维护成本远高于跟随官方包升级。

### 依赖概览

| 包 | 版本 | 用途 |
|---|---|---|
| `@a2ui/react` | 0.10.2 | `basicCatalog`（18 个 React 组件）、`A2uiSurface`、`MarkdownContext` |
| `@a2ui/web_core` | 0.10.6 | `MessageProcessor`（状态机）、`SurfaceModel`、schema validation |
| `@a2ui/markdown-it` | 0.1.1 | `renderMarkdown`（body/default 变体的 Markdown 渲染） |

---

## Basic Catalog 组件清单

官方 basic catalog 包含 **18 个**用户可用组件，另有 1 个内部辅助件 `ChildList`（仅供 `Row`/`Column`/`List` 内部使用，不可在报文中直接引用）：

`AudioPlayer` `Button` `Card` `CheckBox` `ChoicePicker` `Column` `DateTimeInput`
`Divider` `Icon` `Image` `List` `Modal` `Row` `Slider` `Tabs` `Text` `TextField` `Video`

组件定义权威来源：`/data/a2ui/specification/v0_9_1/catalogs/basic/catalog.json`

---

## 两条入站路径

surface 报文通过两条路径进入系统，最终都以相同的 `DesktopMessage` 字段携带到渲染器。

```
MCP server ──► transformResultContent() ──► _meta['a2ui/messages'] ──┐
                                                                      ├──► DesktopMessage.a2uiMessages
Claude (RenderUI tool) ──► extractRenderUiToolUse() ──────────────────┘
```

### 路径一：MCP server 来源

MCP server 在 `tool_result` 中返回 `EmbeddedResource`，格式如下：

```json
{
  "type": "resource",
  "resource": {
    "uri": "a2ui://my-surface",
    "mimeType": "application/a2ui+json",
    "text": "[{ \"version\": \"v0.9.1\", \"createSurface\": { ... } }, ...]"
  }
}
```

**拦截点**: `src/services/mcp/client.ts`，函数 `transformResultContent()`（约第 2493 行）

- 检测条件：`isA2uiResource(resource)` — URI scheme 为 `a2ui://` 且 `mimeType` 为 `application/a2ui+json`
- 拦截行为：调用 `parseA2uiMessages(resource.text)` 解析 JSON；若解析成功，向模型返回一行摘要文本（例如 `[A2UI interface rendered: 3 message(s), surface foo]`），而非原始 JSON，**不消耗提示词 token**

**合并点**: 同文件 `callMCPTool()` 函数（约第 3066 行）

```typescript
// src/services/mcp/client.ts:3210-3243（撰写时行号）
// 扫描 result.content 中所有 EmbeddedResource，
// 将已解析的 A2UI 报文合并进 _meta['a2ui/messages']
if (a2uiMessages.length > 0) {
  mergedMeta = { ...mergedMeta, 'a2ui/messages': a2uiMessages }
}
```

`_meta['a2ui/messages']` 随后通过 `ToolResult.mcpMeta` 字段传递。

### 路径二：Claude 自身来源（RenderUI 工具）

Claude 通过内置 `RenderUI` 工具发出 `tool_use` 消息：

```json
{
  "type": "tool_use",
  "name": "RenderUI",
  "id": "toolu_...",
  "input": {
    "messages": [
      { "version": "v0.9.1", "createSurface": { ... } },
      { "version": "v0.9.1", "updateComponents": { ... } }
    ]
  }
}
```

**提取点**: `desktop/main/messageMapper.ts`，函数 `extractRenderUiToolUse()`（第 84 行）

- 在 `message.type === 'assistant'` 分支中调用（第 379 行）
- 直接从 `tool_use.input.messages` 读取报文数组
- 设置 `a2uiSource: 'built-in'`，`a2uiToolUseId` 取自 `tool_use.id`

---

## 搭车通路：为什么没有新增跨进程协议

这是本次设计最值得记录的一点。MCP 路径的 A2UI 报文通过以下链路到达渲染器，**全程搭乘已有管道，没有新增任何 IPC 通道**：

```
callMCPTool()                    src/services/mcp/client.ts
    │  _meta['a2ui/messages'] 存入 mcpMeta._meta
    ▼
ToolResult.mcpMeta               src/Tool.ts:329
    │  { _meta: { 'a2ui/messages': [...] }, structuredContent?: ... }
    ▼
normalizeMessage()               src/utils/queryHelpers.ts:213（case 'user' 分支）
    │  tool_use_result: _.mcpMeta
    │    ? { content: _.toolUseResult, ..._.mcpMeta }
    │    : _.toolUseResult
    │  → tool_use_result._meta['a2ui/messages'] 展开进 stream-json
    ▼
stream-json (NDJSON over stdout)  进程边界
    ▼
sessionManager on('message')      desktop/main/sessionManager.ts:436
    │  emit({ type: 'runtime-message', ... })
    ▼
toDesktopMessages()               desktop/main/messageMapper.ts
    │  extractA2uiPayload() 从 raw.tool_use_result._meta 读取
    ▼
DesktopMessage.a2uiMessages       传到渲染器
```

`ToolResult.mcpMeta` 字段的类型定义（`src/Tool.ts:329`）：
```typescript
mcpMeta?: {
  _meta?: Record<string, unknown>
  structuredContent?: Record<string, unknown>
}
```

`normalizeMessage()` 的合并逻辑（`src/utils/queryHelpers.ts:213`，两处，`case 'user'` 与 `case 'progress'` 各一）：
```typescript
tool_use_result: _.mcpMeta
  ? { content: _.toolUseResult, ..._.mcpMeta }
  : _.toolUseResult
```

通过这个展开，`_meta['a2ui/messages']` 作为 `tool_use_result._meta` 的一部分随 stream-json 传输，不需要额外 IPC channel。

---

## 提取时机的关键陷阱

> **这是最容易在重构中被无声破坏的约束，务必显眼标注。**

`desktop/main/messageMapper.ts` 的 `toDesktopMessages()` 函数中，对 `message.type === 'user'` 的处理顺序如下（第 332-362 行）：

```typescript
// 正确顺序（当前代码）
if (message.type === 'user') {
  // ...
  // ① A2UI 检查必须先于 containsToolResult 的提前 return
  const a2uiPayload = extractA2uiPayload(raw)   // 第 339 行
  if (a2uiPayload !== null) {
    return [{ id, role: 'tool_output', text: '', timestamp: Date.now(), ...a2uiPayload, raw }]
  }
  if (containsToolResult(message.message)) return []  // 第 350 行
  // ...
}
```

**为什么顺序不能颠倒**：A2UI 报文到达时，外层消息是一条 `tool_result` 类型的 `user` 消息（因为 MCP 工具返回结果本质上就是 tool_result）。`containsToolResult()` 检测到 `tool_result` 内容块后会立即返回空数组，把整条消息丢弃，渲染器就永远收不到 `a2uiMessages`，surface 不会出现。

`extractA2uiPayload()` 检查的是 `raw.tool_use_result._meta['a2ui/messages']`（第 261-298 行），这比 `containsToolResult()` 检查的 `message.content[*].type === 'tool_result'` 更精确，先做它才能保留 A2UI 消息。

---

## 渲染层：四个模块

渲染层代码位于 `desktop/renderer/src/a2ui/`，包含四个模块：

### 1. `extract.ts` — 纯提取工具

从 `DesktopMessage` 读取 `a2uiMessages`、`a2uiToolUseId`、`a2uiSource` 三个字段，返回结构化对象或 `null`。无 React/DOM 依赖，可在 Node 测试环境运行。

```typescript
export function extractA2uiFromMessage(message: DesktopMessage): {
  a2uiMessages: unknown[]
  a2uiToolUseId: string
  a2uiSource: 'mcp' | 'built-in'
} | null
```

### 2. `A2uiSessionProcessor.ts` — 会话级状态机

每个 session 维护独立的 `MessageProcessor`（来自 `@a2ui/web_core/v0_9`）。核心职责：

- **懒创建**：`getOrCreate(sessionId)` 首次调用时新建 `MessageProcessor`
- **锚定**：surface 创建时通过 `pendingAnchor` 绑定到触发它的 `DesktopMessage.id`（`anchorMessageId`）
- **幂等防重放**：每条消息的 `message.id` 存入 `processedMessageIds: Set<string>`，重复调用 `ingest()` 时跳过
- **动作路由**：`built-in` 来源的 action 经 `window.claudeDesktop.sessions.submitA2uiAction()` 回传；`mcp` 来源仅打印 `console.warn`（Phase 3 未决）

`AnchoredSurface` 数据结构：
```typescript
interface AnchoredSurface {
  surface: SurfaceModel<ReactComponentImplementation>
  anchorMessageId: string   // surface 显示在哪条消息旁
  toolUseId: string          // action 回传用的 tool_use_id
  source: 'mcp' | 'built-in'
}
```

**锚定机制**：`processMessages()` 期间若 `MessageProcessor` 触发 `onSurfaceCreated`，此时 `state.pendingAnchor` 已设置好，回调直接把 `anchorMessageId` 写入 `surfaces` Map。`processMessages()` 返回后 `pendingAnchor` 置 null，下一条消息重新设置。

**重放幂等**：会话从磁盘恢复时，`replay(sessionId, messages)` 全量重放历史消息；`processedMessageIds` Set 防止同一条消息的 A2UI 报文被重复喂给 `MessageProcessor`，避免产生重复 surface（幽灵 surface）。

### 3. `A2uiSurfaceHost.tsx` — 单个 surface 渲染容器

包装 `<A2uiSurface>`（来自 `@a2ui/react/v0_9`），职责：
- 通过 `MarkdownContext.Provider` 注入 `@a2ui/markdown-it` 渲染器
- 包裹 `SurfaceErrorBoundary`：单个 surface 崩溃显示错误卡片，不影响其他 surface 和整个渲染器
- `useEffect` 挂载时调用 `initThemeBridge(containerRef.current)` 同步主题

`phantom` prop：当 surface 已被 `deleteSurface` 消息删除但历史消息仍在视图中时，显示 `[Surface no longer active]` 占位符而非报错。

### 4. `themeBridge.ts` — 主题同步

见下节"主题桥"。

---

## 主题桥

### 为什么只覆盖 base 变量

`/data/a2ui/renderers/web_core/src/v0_9/basic_catalog/styles/default.ts` 定义了 A2UI 的默认 CSS token 层级：

```
--a2ui-color-surface     = color-mix(in oklab, var(--a2ui-color-background) 85-95%, white)
--a2ui-color-primary-light   = color-mix(in oklab, var(--a2ui-color-primary) 85%, white)
--a2ui-color-primary-dark    = color-mix(in oklab, var(--a2ui-color-primary) 85%, black)
--a2ui-color-primary-hover   = light-dark(var(--a2ui-color-primary-dark), var(--a2ui-color-primary-light))

--a2ui-spacing-xs  = calc(--a2ui-spacing-s / 2)
--a2ui-spacing-s   = calc(--a2ui-spacing-m / 2)
--a2ui-spacing-m   = var(--a2ui-grid-base)        ← 基准值
--a2ui-spacing-l   = calc(--a2ui-spacing-m * 2)
--a2ui-spacing-xl  = calc(--a2ui-spacing-l * 2)

--a2ui-font-size-xs = calc(--a2ui-font-size-s / --a2ui-font-scale)
--a2ui-font-size-s  = calc(--a2ui-font-size-m / --a2ui-font-scale)
--a2ui-font-size-m  = var(--a2ui-font-size)       ← 基准值
--a2ui-font-size-l  = calc(--a2ui-font-size-m * --a2ui-font-scale)
--a2ui-font-size-xl = calc(--a2ui-font-size-l * --a2ui-font-scale)
```

`-light`/`-dark`/`-hover` 后缀变量是 `color-mix()` 派生值，`--a2ui-spacing-*` 是 `calc()` 派生值——覆盖这些派生变量会破坏整个派生链。`themeBridge.ts` 的 `applyA2uiTheme()` 只覆盖 base 变量（`--a2ui-color-background`、`--a2ui-color-primary`、`--a2ui-color-secondary`、`--a2ui-color-border`、`--a2ui-border-radius`、`--a2ui-font-size-{xs,s,m,l,xl}`、`--a2ui-text-caption-color`、`--a2ui-text-color-text`），派生值自动更新。

字体尺寸覆盖使用 Desktop 自己的固定 px token（`--text-xs`/`--text-sm`/`--text-base`/`--text-lg`/`--text-xl`），而非改写 `--a2ui-font-size` + `--a2ui-font-scale` 组合——因为后者会因 `--a2ui-font-scale` 计算产生小数 px 值，与周围聊天字型不匹配。

### 为什么必须同步 `a2ui-dark`/`a2ui-light` class

A2UI 的默认 CSS 在 `:where(:root)` 上设置 `color-scheme: light dark`，在 `.a2ui-dark` 上设置 `color-scheme: dark`，在 `.a2ui-light` 上设置 `color-scheme: light`。

**只改 CSS 变量不够**，原因有二：

1. **`light-dark()` 解析依赖 `color-scheme`**：`--a2ui-color-background: light-dark(#eee, #111)` 等 token 的实际值由 `color-scheme` 决定，不由 CSS 变量直接控制。若 Desktop 强制 dark 模式但 OS 是 light，不加 `a2ui-dark` class 则 `light-dark()` 解析为浅色。

2. **原生控件外观**：`TextField`（`<input>`）、`CheckBox`（`<input type=checkbox>`）、`Slider`（`<input type=range>`）、`DateTimeInput`（`<input type=date*>`）的浏览器原生外观跟随 `color-scheme` 属性。没有正确的 `color-scheme`，这些控件在 dark 模式下仍显示浅色系统主题。

同步逻辑位于 `themeBridge.ts`：
- `initThemeBridge(container)` 在组件挂载时立即调用一次 `applyA2uiTheme()` 和 `applyA2uiThemeClass()`
- 随后注册 `MutationObserver` 监听 `document.documentElement` 的 `data-theme` 属性变化
- 每次 `data-theme` 从 `'dark'` ↔ `''` 切换时，同步 `a2ui-dark`/`a2ui-light` class
- `useEffect` 返回 `observer.disconnect`，组件卸载时自动清理

---

## 回传闭环（RenderUI 工具）

`RenderUI` 工具采用与 `AskUserQuestionTool` 完全相同的挂起机制，这不是新发明，而是照抄既有模式：

```
Claude 发出 RenderUI tool_use
        │
        ▼ shouldDefer: true     → CLI 回合暂停，不立即执行
        │ requiresUserInteraction() → true → 非交互环境自动跳过此工具
        │
用户在 surface 上操作
        │
        ▼ A2uiSessionProcessor 的 action callback
          → window.claudeDesktop.sessions.submitA2uiAction(sessionId, { toolUseId, action })
        │
        ▼ sessions:submitA2uiAction IPC channel (desktop/main/main.ts:673)
          → sessionManager.submitA2uiAction()
          → host.submitA2uiAction()
        │
        ▼ sessionHost.ts:310  writeJsonLine(child, {
            type: 'user',
            message: {
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: toolUseId,
                content: JSON.stringify({ version: 'v0.9.1', action })
              }]
            }
          })
        │ 向 CLI stdin 写入 tool_result → 放行被挂起的回合
        ▼
Claude 收到 action 内容，继续执行
```

对比 `AskUserQuestionTool`（`src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx`）：
- `shouldDefer: true`（第 113 行）
- `requiresUserInteraction(): true`（第 155 行）
- desktop 通过 `host.answerQuestion()`（`sessionHost.ts:287`）写 `tool_result` 回传

`RenderUI` 的 `submitA2uiAction` 与 `answerQuestion` 结构一致，区别只在 `tool_result.content` 的 JSON 格式：A2UI 用 `{ version: 'v0.9.1', action: { name, surfaceId, sourceComponentId, timestamp, context } }`。

---

## 使用说明

### MCP server 如何发送 A2UI

MCP server 在工具返回值的 `content` 数组中放入一个 `EmbeddedResource`：

```python
# Python 示例，参考 /data/a2ui/samples/community/mcp/a2ui-over-mcp-recipe/server.py
return types.CallToolResult(
    content=[
        types.TextContent(type="text", text="这里是给模型看的文字说明"),
        types.EmbeddedResource(
            type="resource",
            resource=types.TextResourceContents(
                uri="a2ui://my-surface",       # URI scheme 必须是 a2ui://
                mimeType="application/a2ui+json",  # 必须精确匹配
                text=json.dumps(a2ui_messages),    # A2UI 报文数组序列化为字符串
            ),
        ),
    ]
)
```

`a2ui_messages` 是一个 JSON 数组，最小可用示例：

```json
[
  {
    "version": "v0.9.1",
    "createSurface": {
      "surfaceId": "my-surface",
      "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
    }
  },
  {
    "version": "v0.9.1",
    "updateComponents": {
      "surfaceId": "my-surface",
      "components": [
        { "id": "root", "component": "Text", "text": "Hello, A2UI!", "variant": "h1" }
      ]
    }
  }
]
```

MCP 路径**无需任何构建开关**，只要服务器按此格式返回，Desktop 就会渲染 surface。

### 怎么开启 RenderUI 工具

`RenderUI` 工具的 `isEnabled()` 需同时满足两个条件（`src/tools/RenderUITool/RenderUITool.ts:76-83`）：

```typescript
isEnabled(): boolean {
  if (!feature('A2UI_RENDER_UI')) return false           // 构建开关
  const entrypoint = Function('return process.env')()
    .CLAUDE_CODE_ENTRYPOINT as string | undefined
  if (entrypoint !== 'claude-desktop') return false     // 运行时检测
  return true
}
```

- `feature('A2UI_RENDER_UI')` 是 Bun bundle 时的构建开关，**默认 OFF**
- `CLAUDE_CODE_ENTRYPOINT=claude-desktop` 由 Desktop 启动时设置；CLI/SDK/channels 环境下此变量不存在

因此 `RenderUI` 工具**在 CLI、SDK、channels 等非 Desktop 环境中始终禁用**，不会误触发。MCP 路径不受此限制。

### 报文写法要点

1. **组件用扁平邻接表**：所有组件平铺在 `updateComponents.components` 数组中，父子关系通过 `children: ["child-id-1", "child-id-2"]` 引用表达，不是嵌套对象。

2. **`id: "root"` 必须最先**：`MessageProcessor` 要求 component id 为 `"root"` 的组件最先出现在 `components` 数组中。

3. **父先于子**：`components` 数组中父组件必须在子组件之前，否则流式渲染会出现 `[Loading ...]` 占位符。

4. **动态值用 JSON Pointer 绑定**：
   ```json
   { "id": "label", "component": "Text", "text": { "path": "/username" } }
   ```
   `path` 字段是 RFC 6901 JSON Pointer，值来自同 surface 的 data model。

5. **`updateDataModel` 是按 JSON Pointer 的 upsert**：
   ```json
   {
     "version": "v0.9.1",
     "updateDataModel": {
       "surfaceId": "my-surface",
       "path": "/username",
       "value": "Alice"
     }
   }
   ```
   `path` 省略时等同于 `/`（覆盖整个 data model）；`value` 省略时删除该路径的值。

---

## 当前边界（能力限制）

以下限制必须明确，避免文档读起来比实际能力强。

### 1. MCP 来源的 surface 交互尚未回传（Phase 3 未决）

`A2uiSessionProcessor.ts` 的 action callback 中，`source === 'mcp'` 时只打印 `console.warn`，动作**不会**回传到 MCP server：

```typescript
} else if (anchored.source === 'mcp') {
  // Phase 3 gap: MCP-originated surfaces cannot route actions back yet.
  console.warn(`[A2UI Phase-3 gap] Action received on MCP-originated surface "${surfaceId}" ...`)
}
```

待解决的设计问题（Phase 3）：是通过合成 Claude 回合中继动作，还是 main 进程维护独立 MCP 客户端连接直连服务器。

### 2. CSP 限制媒体资源（Phase 4 未决）

`desktop/renderer/index.html` 的 CSP 头（第 7 行）：

```
img-src 'self' data:
```

- `Image` 组件：只允许 `self`（本地文件）和 `data:` URI，**远程图片 URL 会被拦截**
- `Video` 组件、`AudioPlayer` 组件：均受 `default-src 'self'` 约束，**远程媒体会被拦截**

Phase 4 计划放开特定远程来源，但目前未实现。使用这些组件时应提前告知接入方。

### 3. 未在真实 Electron 环境端到端验证

由于现有 monaco worker 故障导致 `npx vite build --config desktop/vite.config.ts` 失败，该功能**未在真实 Electron 中完整跑通**。目前的正确性保证来自：

- Node 环境单元测试（`desktop:test`）：884 passed
- jsdom 环境渲染测试（`desktop:test-renderer`）：84 passed（含 43 fixture 一致性测试）

---

## 测试与验证

### 两个 Vitest 配置

| 配置文件 | 运行命令 | 环境 | 覆盖范围 |
|---|---|---|---|
| `desktop/vitest.config.ts` | `npm run desktop:test` | Node | `desktop/tests/**/*.test.ts`：静态类型检查、消息映射、IPC 协议、sessionHost 行为 |
| `desktop/vitest.renderer.config.ts` | `npm run desktop:test-renderer` | jsdom | `desktop/tests/renderer/**/*.test.tsx`：React 组件渲染、`A2uiSessionProcessor`、`themeBridge`、43 fixture 一致性 |

Node 配置不设 React 插件，纯粹测试 main process 逻辑；jsdom 配置用 `@vitejs/plugin-react` 启用 JSX 转换。两套配置都不设 zod alias——`@a2ui/*` 包自带嵌套的 `zod@3.x`，npm 就近解析规则自动处理 zod v3（给 `@a2ui/*`）与 zod v4（给项目根代码）的共存。

### 43 fixture 一致性测试断言内容

测试文件：`desktop/tests/renderer/a2uiConformance.test.tsx`

**每个 fixture 经过 5 层断言**，不只是"不报错"：

| 断言 | 内容 |
|---|---|
| Assertion 1 | `container.innerHTML` 非空 |
| Assertion 2 | `textContent` 不含 `"[Loading "` 子串（`@a2ui/react` 的加载占位符，表示组件引用了不存在的子组件） |
| Assertion 3 | `textContent` 不含 `"Unknown component: "` 子串（catalog 中不存在该组件类型的回退） |
| Assertion 4 | DOM 元素数量 ≥ max(唯一组件数, 2)（排除完全退化的渲染器：一个组件只产一个 div） |
| Assertion 5 | fixture 中所有静态文本字面量必须出现在 `textContent` 中 |

Assertion 5 的豁免策略（`FIXTURE_EXPECTED_STRINGS` 表，共 43 条）：
- 18 个 fixture 豁免（空数组），原因是其所有文本字段均为 `{"path": "..."}` 数据绑定，或 Text 组件全部使用 `body`/`default` variant（经过 `@a2ui/markdown-it` 处理后 DOM 结构不再是原始字符串）
- 1 个特例（`31_incremental-dashboard.json`）：仅断言最终存活的 `"System Dashboard"` 字面量；初始的 `"Loading analytics..."` 等因被后续 `updateComponents` 消息覆盖而从组件树移除，断言它们会误报
- 剩余 24 个 fixture 执行完整的文本字面量断言

`36_modal.json` 还配置了 `FIXTURE_MIN_ELEMENTS_OVERRIDE: { '36_modal.json': 4 }`，因为 `Modal` 组件初始 `isOpen=false` 时内容不渲染，DOM 元素数会低于唯一组件数的默认阈值。

---

## 数据流全图

```
MCP server                    CLI process                     Renderer process
──────────                    ───────────                     ────────────────
EmbeddedResource          transformResultContent()
  uri: a2ui://...      →    isA2uiResource()          →  [摘要文本给模型，不占 token]
  mimeType:                 parseA2uiMessages()
  application/a2ui+json     → _meta['a2ui/messages']
                            → ToolResult.mcpMeta
                            → normalizeMessage()
                            → tool_use_result._meta
                            → stream-json (NDJSON stdout)
                            → sessionManager on('message')  → runtime-message event
                            → toDesktopMessages()
                            → extractA2uiPayload()          → DesktopMessage
                                                               .a2uiMessages
                                                               .a2uiToolUseId
                                                               .a2uiSource='mcp'
                                                            → A2uiSessionProcessor
                                                               .ingest()
                                                            → MessageProcessor
                                                               .processMessages()
                                                            → onSurfaceCreated
                                                            → AnchoredSurface
                                                            → A2uiSurfaceHost
                                                               渲染在 anchorMessageId 位置

Claude (RenderUI)             extractRenderUiToolUse()
  tool_use: RenderUI       →   (messageMapper.ts:84)
  input.messages: [...]    →  DesktopMessage
                               .a2uiSource='built-in'       → 同上路径 →
                                                               A2uiSessionProcessor
                                                               动作回传:
                                                            ← submitA2uiAction IPC
                            ← sessionHost.ts:310
                            ← writeJsonLine(tool_result)
                            ← Claude stdin 放行挂起回合
```

---

## 文件索引

| 文件 | 职责 |
|---|---|
| `src/a2ui/protocol.ts` | A2UI wire-format 类型定义、`isA2uiResource()`、`parseA2uiMessages()` |
| `src/tools/RenderUITool/RenderUITool.ts` | `RenderUI` 内置工具（`shouldDefer`、`isEnabled` 双重门控） |
| `src/services/mcp/client.ts` | `transformResultContent()`（拦截）、`callMCPTool()`（合并 `_meta`） |
| `src/Tool.ts` | `ToolResult.mcpMeta` 类型定义 |
| `src/utils/queryHelpers.ts` | `normalizeMessage()`（展开 `mcpMeta` 进 `tool_use_result`） |
| `desktop/main/messageMapper.ts` | `extractA2uiPayload()`、`extractRenderUiToolUse()`、`containsToolResult()` |
| `desktop/main/ipc.ts` | `DesktopMessage` 类型（含 `a2uiMessages`/`a2uiToolUseId`/`a2uiSource`） |
| `desktop/main/sessionHost.ts` | `host.submitA2uiAction()`、`host.reportA2uiError()` |
| `desktop/main/sessionManager.ts` | `submitA2uiAction()`、`reportA2uiError()` IPC handler |
| `desktop/main/main.ts` | IPC channel 注册（`sessions:submitA2uiAction`、`sessions:reportA2uiError`） |
| `desktop/renderer/src/a2ui/extract.ts` | `extractA2uiFromMessage()`（渲染侧提取） |
| `desktop/renderer/src/a2ui/A2uiSessionProcessor.ts` | 会话级状态机、锚定、幂等防重放、动作路由 |
| `desktop/renderer/src/a2ui/A2uiSurfaceHost.tsx` | React 渲染容器、`ErrorBoundary`、`MarkdownContext` |
| `desktop/renderer/src/a2ui/themeBridge.ts` | CSS 变量同步、`a2ui-dark`/`a2ui-light` class 管理 |
| `desktop/renderer/index.html` | CSP 头（媒体限制的根源） |
| `desktop/vitest.config.ts` | Node 测试配置 |
| `desktop/vitest.renderer.config.ts` | jsdom 测试配置（含 A2UI conformance） |
| `desktop/tests/renderer/a2uiConformance.test.tsx` | 43 fixture 一致性测试（5 层断言） |
