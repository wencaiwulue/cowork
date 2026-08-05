# `.kode.mcp.json` 与 MCP 配置参考

> 对照源: `src/services/mcp/types.ts`(`ConfigScopeSchema`、`TransportSchema`、各 `McpXxxServerConfigSchema`);MCP 输出 token 截断见 `src/utils/mcpValidation.ts`。
> **本文件手工维护,以源码为准。**

---

## 一、文件位置

`.kode.mcp.json` 是 MCP 服务器配置文件,根据 scope 不同存储在不同位置:

| Scope | 文件 / 来源 | 持久化 | 说明 |
|---|---|---|---|
| `project` | `$PROJECT/.kode.mcp.json`(checked-in) | 是 | 项目级共享,需用户 approve/reject |
| `user` | `~/.kode.json` 的 `mcpServers` 字段 | 是 | 用户级全局 MCP server |
| `local` | `$PROJECT/.kode.mcp.json`(同 project 文件,但 server 配置的 scope 字段可为 local) | 是 | 项目级私有 |
| `dynamic` | 运行时通过 SDK `--mcp-config` 注入 | 否 | 会话级动态配置 |
| `enterprise` | `<managed>/managed-mcp.json` | 是 | 企业级托管(管理员) |
| `claudeai` | claude.ai 远程 connector | 是 | claude.ai 集成的 MCP connector |
| `managed` | managed settings 内联的 mcpServers | 是 | 策略级 |

> 文件 schema 顶层结构:`McpJsonConfigSchema = { mcpServers: Record<string, McpServerConfigSchema> }`(`types.ts:171-175`)。
> scope 枚举来源:`ConfigScopeSchema`(`types.ts:10-19`):`local | user | project | dynamic | enterprise | claudeai | managed`。

---

## 二、Transport 类型完整表

`McpServerConfigSchema`(`types.ts:124-135`)是一个 union,由以下各 transport schema 组成。

### 2.1 `stdio`

来源:`McpStdioServerConfigSchema`(`types.ts:28-35`)。

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `type` | string literal | — | `"stdio"`(可省略,向后兼容) | transport 类型 | 否 | | |
| `command` | string | — | 非空字符串 | 要执行的命令 | 是 | | `"npx"` |
| `args` | string[] | `[]`(由 `.default([])` 提供) | 字符串数组 | 命令参数 | 否 | | `["-y","@modelcontextprotocol/server-git"]` |
| `env` | Record&lt;string,string&gt; | — | env 名 → 值 | 给子进程注入的环境变量 | 否 | | |

示例:
```json
{
  "mcpServers": {
    "git": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-git"]
    }
  }
}
```

### 2.2 `sse`

来源:`McpSSEServerConfigSchema`(`types.ts:58-66`)。

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `type` | string literal | — | `"sse"` | transport 类型 | 是 | | |
| `url` | string | — | 任意 URL | SSE 端点 URL | 是 | | |
| `headers` | Record&lt;string,string&gt; | — | header 名 → 值 | 自定义请求头 | 否 | | |
| `headersHelper` | string | — | 脚本路径 | 输出 headers 的脚本(输出会被解析为 JSON) | 否 | | |
| `oauth` | object | — | 见下 OAuth | OAuth 配置 | 否 | | |

### 2.3 `sse-ide`

来源:`McpSSEIDEServerConfigSchema`(`types.ts:69-76`)。**内部专用**(IDE 扩展)。

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `type` | string literal | — | `"sse-ide"` | transport 类型 | 是 | | 内部 |
| `url` | string | — | URL | IDE SSE 端点 | 是 | | 内部 |
| `ideName` | string | — | IDE 名称 | IDE 标识 | 是 | | 内部 |
| `ideRunningInWindows` | boolean | — | bool | IDE 是否在 Windows 上运行 | 否 | | 内部 |

### 2.4 `ws-ide`

来源:`McpWebSocketIDEServerConfigSchema`(`types.ts:79-88`)。**注意:`ws-ide` 不在 `TransportSchema` 基础枚举中**,仅作为 per-schema 变体存在于 `McpServerConfigSchema` union。

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `type` | string literal | — | `"ws-ide"` | transport 类型 | 是 | | 内部 |
| `url` | string | — | URL | WebSocket IDE 端点 | 是 | | 内部 |
| `ideName` | string | — | IDE 名称 | IDE 标识 | 是 | | 内部 |
| `authToken` | string | — | token | 鉴权 token | 否 | | 内部 |
| `ideRunningInWindows` | boolean | — | bool | IDE 是否在 Windows 上运行 | 否 | | 内部 |

### 2.5 `http`

来源:`McpHTTPServerConfigSchema`(`types.ts:89-97`)。

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `type` | string literal | — | `"http"` | transport 类型 | 是 | | |
| `url` | string | — | URL | HTTP 端点 | 是 | | |
| `headers` | Record&lt;string,string&gt; | — | header → 值 | 自定义请求头 | 否 | | |
| `headersHelper` | string | — | 脚本路径 | 输出 headers 的脚本 | 否 | | |
| `oauth` | object | — | 见下 OAuth | OAuth 配置 | 否 | | |

### 2.6 `ws`

来源:`McpWebSocketServerConfigSchema`(`types.ts:99-106`)。

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `type` | string literal | — | `"ws"` | transport 类型 | 是 | | |
| `url` | string | — | URL | WebSocket 端点 | 是 | | |
| `headers` | Record&lt;string,string&gt; | — | header → 值 | 自定义请求头 | 否 | | |
| `headersHelper` | string | — | 脚本路径 | 输出 headers 的脚本 | 否 | | |

### 2.7 `sdk`

来源:`McpSdkServerConfigSchema`(`types.ts:108-113`)。

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `type` | string literal | — | `"sdk"` | transport 类型 | 是 | | |
| `name` | string | — | SDK server 名 | 内嵌 SDK server 名 | 是 | | |

### 2.8 `claudeai-proxy`

来源:`McpClaudeAIProxyServerConfigSchema`(`types.ts:116-122`)。

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `type` | string literal | — | `"claudeai-proxy"` | transport 类型 | 是 | | |
| `url` | string | — | URL | 代理端点 | 是 | | |
| `id` | string | — | connector ID | claude.ai connector 标识 | 是 | | |

---

## 三、Transport 枚举说明

`TransportSchema`(`types.ts:23-26`)基础枚举:

```
stdio | sse | sse-ide | http | ws | sdk
```

注意:
- `claudeai-proxy` **不在** `TransportSchema` 基础枚举中,但 `McpClaudeAIProxyServerConfigSchema` 是 `McpServerConfigSchema` union 的一员(以 `type: "claudeai-proxy"` literal 区分)。
- `ws-ide` 同样 **不在** 基础枚举中,仅作为 union 中的 per-schema 变体存在。

故实际可用 transport(按 union):`stdio | sse | sse-ide | ws-ide | http | ws | sdk | claudeai-proxy`(共 8 种)。

---

## 四、OAuth 子配置

由 `McpOAuthConfigSchema`(`types.ts:43-56`)定义,被 `sse`/`http` transport 复用:

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `clientId` | string | — | OAuth client ID | MCP server 的 AS client ID | 否 | | |
| `callbackPort` | number(int >0) | — | 正整数 | OIDC 回调端口 | 否 | | |
| `authServerMetadataUrl` | string | — | https URL(必须以 `https://` 开头) | AS 元数据 URL | 否 | | |
| `xaa` | boolean | — | bool | Cross-App Access(SEP-990)开关。IdP 连接详情由 `settings.xaaIdp` 提供 | 否 | 内部(条件性) | |

---

## 五、Scope 概念

`ConfigScopeSchema`(`types.ts:10-19`)枚举 7 个 scope:

| Scope | 含义 | 谁可写 |
|---|---|---|
| `local` | 项目级私有 | 用户 |
| `user` | 用户全局 | 用户 |
| `project` | 项目级共享(checked-in) | 用户(提交到代码库) |
| `dynamic` | 运行时注入(SDK `--mcp-config`) | SDK 调用方 |
| `enterprise` | 企业托管(`managed-mcp.json`) | 管理员 |
| `claudeai` | claude.ai 远程 connector | claude.ai |
| `managed` | managed settings 内联 | 管理员 |

`ScopedMcpServerConfig`(`types.ts:163-169`)= `McpServerConfig & { scope: ConfigScope; pluginSource?: string }`。

---

## 六、Approve / Reject 流程

`.kode.mcp.json` 中 scope=`project` 的 server **不会自动启动**——用户必须显式 approve 或 reject。

### 6.1 状态字段(settings.json)

记录 approve/reject 状态的字段在 `.kode/settings.json`:

| 字段名 | 含义 |
|---|---|
| `enabledMcpjsonServers` | 已 approve 的 server 名列表 |
| `disabledMcpjsonServers` | 已 reject 的 server 名列表 |
| `enableAllProjectMcpServers` | 若为 true,自动 approve 所有项目级 server |

### 6.2 启动时行为

- 启动时遍历 `.kode.mcp.json` 中的 project scope server:
  - 若 `enableAllProjectMcpServers=true`:全部 approve
  - 否则,server 名在 `enabledMcpjsonServers` 中:启动
  - server 名在 `disabledMcpjsonServers` 中:跳过
  - 其他:首次启动会弹出 approve/reject 提示

### 6.3 重置项目选择

CLI 子命令:

```
kode mcp reset-project-choices
```

定义在 `src/main.tsx:3959`,清空当前项目所有 project-scoped server 的 approve/reject 标记。下次启动会重新询问。

### 6.4 Enterprise allowlist / denylist

企业级 MCP allowlist/denylist 通过 settings 字段控制(`.kode/settings.json` 或 managed):

| 字段 | 作用 |
|---|---|
| `allowedMcpServers` | 企业 allowlist。undefined=全部允许;空数组=全部禁止 |
| `deniedMcpServers` | 企业 denylist。**denylist 优先**——同时在两个列表中则被拒绝 |
| `allowManagedMcpServersOnly` | true 时 `allowedMcpServers` 仅从 managed settings 读取 |

每个 entry 形如 `{serverName}` 或 `{serverCommand: [...]}` 或 `{serverUrl: "https://..."}`,三选一(见 `AllowedMcpServerEntrySchema` / `DeniedMcpServerEntrySchema`,`types.ts:115-207`)。

---

## 七、MCP 输出 token 截断

来源:`src/utils/mcpValidation.ts`(注:此文件是 **输出截断** 逻辑,不是配置校验)。

| 常量 | 值 | 含义 |
|---|---|---|
| `DEFAULT_MAX_MCP_OUTPUT_TOKENS` | 25000 | MCP 工具输出 token 上限的硬编码默认 |
| `MCP_TOKEN_COUNT_THRESHOLD_FACTOR` | 0.5 | 启发式阈值:输出 estimate ≤ `MAX * 0.5` 时跳过精确 token 计数 |
| `IMAGE_TOKEN_ESTIMATE` | 1600 | 单个 image block 的 token 估算 |

### MCP 输出 token 上限解析(`getMaxMcpOutputTokens`)

优先级(高 → 低):

1. `MAX_MCP_OUTPUT_TOKENS` 环境变量(用户显式覆盖,必须为正整数)
2. GrowthBook flag `tengu_satin_quoll` 的 `mcp_tool` key(数字)
3. 硬编码默认 25000

超出上限的输出会被截断,并附加 `[OUTPUT TRUNCATED - exceeded N token limit]` 消息。

---

## 八、Schema 缺口

1. `TransportSchema` 基础枚举缺少 `claudeai-proxy` 和 `ws-ide`,但 union 中包含它们——枚举与 union 不一致,易让外部消费者误以为只有 6 种 transport。
2. `args` 字段在 `stdio` schema 中使用 `.default([])`,但其他 transport 的可选数组字段(如 `headers`)无默认——一致性缺口。
3. `McpOAuthConfigSchema.xaa` 是 boolean,但其语义依赖 `settings.xaaIdp`——跨 schema 隐式依赖未在文档/schema 描述中显式关联。
4. `McpJsonConfigSchema` 顶层无 `scope` 字段(scope 在 `ScopedMcpServerConfig` 运行时附加)——文件型配置的 scope 隐含来自文件位置,无 schema 强制。
5. `headersHelper` 字段(`sse`/`http`/`ws`)无 `.describe()`,schema 描述缺失。
