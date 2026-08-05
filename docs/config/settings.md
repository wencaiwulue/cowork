# `.kode/settings.json` 配置参考

> 对照源: `src/utils/settings/types.ts`(`SettingsSchema` 第 255-1072 行);合并逻辑见 `src/utils/settings/settings.ts`;文件路径见 `src/utils/settings/settings.ts:274-307`、`src/utils/settings/managedPath.ts`。
> **本文件手工维护,以源码为准。**

---

## 一、文件位置

| Source | 文件路径 | 作用域 | 可手编 |
|---|---|---|---|
| `userSettings` | `~/.kode/settings.json`(或 `$KODE_CONFIG_DIR/settings.json`) | 全局 | 是 |
| `projectSettings` | `$PROJECT/.kode/settings.json` | 项目(checked-in) | 是 |
| `localSettings` | `$PROJECT/.kode/settings.local.json` | 项目(gitignore) | 是 |
| `policySettings` (managed file) | macOS:`/Library/Application Support/KodeCode/managed-settings.json`;Linux:`/etc/kode-code/managed-settings.json`;Windows:`C:\Program Files\KodeCode\managed-settings.json` | 全机 | 仅管理员 |
| `policySettings` (drop-in) | `<managed>/managed-settings.d/*.json`(按文件名字母序合并,后合并优先) | 全机 | 仅管理员 |
| `policySettings` (MDM) | macOS plist / Windows HKLM | 全机 | 仅管理员 |
| `policySettings` (remote) | 远程 API 下发的托管策略 | 全机 | 否 |
| `policySettings` (HKCU) | Windows 注册表 HKCU(最低优先级兜底) | 用户 | 是(用户级注册表) |
| `flagSettings` (文件) | `--settings <path>` 指定的 JSON 文件 | 会话 | 否 |
| `flagSettings` (inline) | SDK 调用注入的 `flagSettingsInline` | 会话 | 否 |

> 默认 settings 文件名为 `settings.json`;开启 cowork 模式时为 `cowork_settings.json`(见 `getUserSettingsFilePath`)。

---

## 二、合并语义

- 所有 source 通过 `lodash.mergeWith` 深合并,后合并覆盖先合并(数组按 index 合并,对象递归合并)。
- 合并顺序(低 → 高):`plugin → user → project → local → flag → policy`。
- **policy 优先级最高**(详见 [README.md](./README.md#二合并优先级))。
- `SettingsSchema` 在外层对象和 `PermissionsSchema` 内层都使用 `.passthrough()`(`types.ts:84, 1072`),**未知字段保留不删**。
- schema 校验使用 `safeParse`,失败字段被静默丢弃但保留在文件中(`settings.ts` 的 invalid-field 保留逻辑)。
- `.describe()` 是元数据(运行时可通过 `--help` 类自省渲染),`.default()` **未使用**——默认值散落在 `createDefaultGlobalConfig` 和各 loader 中(见第六节 schema 缺口)。
- 校验错误的 schema 字段会被剔除并记录为 `ValidationError`;文件本体保持原样以便用户修正。

---

## 三、字段表(按功能分组)

> "默认值"列:settings 层 **不内置 `.default()`**,故大多为 `—`(由 `getInitialSettings` 后的运行时逻辑或 `GlobalConfig` 提供)。带有描述性默认的字段会在"作用描述"中注明。

### 3.1 元数据与认证

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `$schema` | string(literal URL) | — | `https://json.schemastore.org/claude-code-settings.json` | JSON Schema 引用,供编辑器校验 | 否 | | `"$schema": "https://json.schemastore.org/claude-code-settings.json"` |
| `apiKeyHelper` | string | — | 任意可执行脚本路径 | 输出鉴权值的脚本路径 | 否 | | `"apiKeyHelper": "/usr/local/bin/get-key.sh"` |
| `awsCredentialExport` | string | — | 脚本路径 | 导出 AWS 凭证的脚本 | 否 | | |
| `awsAuthRefresh` | string | — | 脚本路径 | 刷新 AWS 鉴权的脚本 | 否 | | |
| `gcpAuthRefresh` | string | — | 命令 | 刷新 GCP 鉴权的命令(例:`gcloud auth application-default login`) | 否 | | |
| `otelHeadersHelper` | string | — | 脚本路径 | 输出 OpenTelemetry headers 的脚本 | 否 | | |
| `xaaIdp` | object | — | `{issuer, clientId, callbackPort?}` | XAA(SEP-990)IdP 连接,仅在 `CLAUDE_CODE_ENABLE_XAA` 真值时 schema-validated | 否 | 内部(条件性) | |

### 3.2 文件拾取与会话

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `respectGitignore` | boolean | true(由 `GlobalConfig` 提供) | bool | 文件拾取器是否遵守 `.gitignore`(注:`.ignore` 始终遵守) | 否 | | `true` |
| `cleanupPeriodDays` | number(int ≥0) | 30(描述性默认) | 整数 ≥0 | 会话 transcript 保留天数。`0` 完全禁用会话持久化:不写 transcript 且启动时删除既有 transcript | 否 | | `30` |
| `fileSuggestion` | object | — | `{type: "command", command: string}` | `@` mention 的自定义文件建议命令 | 否 | | |
| `includeCoAuthoredBy` | boolean | true(描述性) | bool | 已废弃:用 `attribution` | 否 | 已废弃 | |
| `attribution` | object | — | `{commit?: string, pr?: string}` | 自定义 commit/PR 署名。空字符串隐藏署名 | 否 | | `{"commit": ""}` |
| `includeGitInstructions` | boolean | true(描述性) | bool | 是否在系统提示词中包含内置 commit/PR workflow 指令 | 否 | | |
| `defaultShell` | enum | `bash` | `bash` \| `powershell` | 输入框 `!` 命令使用的 shell(无 Windows 自动切换) | 否 | | `"bash"` |

### 3.3 权限

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `permissions` | object | — | 见下 | 工具权限配置 | 否 | | |
| `permissions.allow` | array&lt;rule&gt; | — | PermissionRule[] | 允许的工具规则 | 否 | | `["Bash(git:*)", "Edit"]` |
| `permissions.deny` | array&lt;rule&gt; | — | PermissionRule[] | 拒绝的工具规则 | 否 | | |
| `permissions.ask` | array&lt;rule&gt; | — | PermissionRule[] | 总是询问确认的规则 | 否 | | |
| `permissions.defaultMode` | enum | `default` | `acceptEdits` \| `bypassPermissions` \| `default` \| `dontAsk` \| `plan`(+ `auto`,仅在 `feature('TRANSCRIPT_CLASSIFIER')` 启用时) | 默认权限模式。`bubble` 是内部模式,不可用户寻址 | 否 | | `"plan"` |
| `permissions.disableBypassPermissionsMode` | enum | — | `"disable"` | 禁用 bypass 权限模式 | 否 | | `"disable"` |
| `permissions.disableAutoMode` | enum | — | `"disable"` | 禁用 auto 模式(仅 `feature('TRANSCRIPT_CLASSIFIER')` 时存在) | 否 | 内部(条件性) | |
| `permissions.additionalDirectories` | string[] | — | 绝对路径数组 | 额外纳入权限范围的目录 | 否 | | `["/tmp/shared"]` |
| `skipDangerousModePermissionPrompt` | boolean | — | bool | 用户已接受 bypass 模式 dialog | 否 | | |
| `allowManagedPermissionRulesOnly` | boolean | — | bool | 仅 managed settings 中的权限规则生效(其他 source 忽略) | 否 | | |
| `allowManagedHooksOnly` | boolean | — | bool | 仅 managed settings 中的 hooks 生效 | 否 | | |
| `allowManagedMcpServersOnly` | boolean | — | bool | `allowedMcpServers` 仅从 managed settings 读取 | 否 | | |

### 3.4 模型与 API

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `model` | string | — | 模型 alias 或全名 | 覆盖默认模型 | 否 | | `"sonnet"` / `"claude-sonnet-4-6"` |
| `availableModels` | string[] | — | 模型 ID/alias/family | 企业 allowlist。未设=全部可用;空数组=仅默认模型 | 否 | | `["opus", "sonnet"]` |
| `modelOverrides` | Record&lt;string,string&gt; | — | Anthropic model ID → provider-specific ID | Bedrock 推理 profile ARN 等映射 | 否 | | |
| `forceLoginMethod` | enum | — | `claudeai` \| `console` | 强制登录方式 | 否 | | |
| `forceLoginOrgUUID` | string | — | 组织 UUID | OAuth 登录附加 org UUID 参数 | 否 | | |
| `effortLevel` | enum | — | `low` \| `medium` \| `high`(+ `max`,仅 `USER_TYPE=ant`) | 持久化的 effort 级别 | 否 | | `"high"` |
| `alwaysThinkingEnabled` | boolean | true(描述性) | bool | false 关闭 thinking;absent/true 自动启用 | 否 | | |
| `fastMode` | boolean | — | bool | 快速模式开关 | 否 | | |
| `fastModePerSessionOptIn` | boolean | — | bool | true=fast mode 不跨会话持久化 | 否 | | |
| `advisorModel` | string | — | 模型 ID/alias | 服务端 advisor 工具用的模型 | 否 | 内部 | |
| `minimumVersion` | string | — | semver | 阻止低于此版本的 downgrade(切换 stable 频道时) | 否 | | |
| `autoUpdatesChannel` | enum | — | `latest` \| `stable` | 自动更新频道 | 否 | | `"stable"` |

### 3.5 MCP

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `enableAllProjectMcpServers` | boolean | — | bool | 自动 approve `.kode.mcp.json` 中所有项目级 MCP server | 否 | | |
| `enabledMcpjsonServers` | string[] | — | server 名数组 | 已 approve 的 `.kode.mcp.json` server 列表 | 否 | | |
| `disabledMcpjsonServers` | string[] | — | server 名数组 | 已 reject 的 `.kode.mcp.json` server 列表 | 否 | | |
| `allowedMcpServers` | array | — | AllowedMcpServerEntry[] | 企业 MCP allowlist(`serverName`/`serverCommand`/`serverUrl` 三选一) | 否 | | |
| `deniedMcpServers` | array | — | DeniedMcpServerEntry[] | 企业 MCP denylist(denylist 优先于 allowlist) | 否 | | |

### 3.6 Hooks

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `hooks` | object | — | 见 `HooksSchema`(`src/schemas/hooks.ts`) | 工具执行前后的自定义命令 | 否 | | |
| `disableAllHooks` | boolean | — | bool | 禁用所有 hooks 和 statusLine 执行 | 否 | | |
| `allowedHttpHookUrls` | string[] | — | URL 通配 pattern | HTTP hook 允许请求的 URL allowlist。支持 `*` 通配。undefined=全部允许;空数组=禁止所有 | 否 | | |
| `httpHookAllowedEnvVars` | string[] | — | 环境变量名数组 | HTTP hook 可插值到 headers 的环境变量名 allowlist | 否 | | |

### 3.7 Status line 与 UI

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `statusLine` | object | — | `{type: "command", command: string, padding?: number}` | 自定义状态栏 | 否 | | |
| `outputStyle` | string | — | output style 名 | 控制响应输出样式 | 否 | | |
| `language` | string | — | 语言名(如 `"japanese"`) | 偏好的响应语言 | 否 | | |
| `spinnerTipsEnabled` | boolean | — | bool | 是否显示 spinner tips | 否 | | |
| `spinnerVerbs` | object | — | `{mode: "append"\|"replace", verbs: string[]}` | 自定义 spinner 动词 | 否 | | |
| `spinnerTipsOverride` | object | — | `{excludeDefault?: boolean, tips: string[]}` | 覆盖 spinner tips | 否 | | |
| `syntaxHighlightingDisabled` | boolean | — | bool | 是否禁用 diff 语法高亮 | 否 | | |
| `terminalTitleFromRename` | boolean | true(描述性) | bool | `/rename` 是否更新终端标签标题 | 否 | | |
| `prefersReducedMotion` | boolean | — | bool | 减少动画(spinner shimmer、flash 等) | 否 | | |
| `showThinkingSummaries` | boolean | false | bool | 在 transcript view 显示 thinking 摘要 | 否 | | |
| `showClearContextOnPlanAccept` | boolean | false | bool | plan 批准 dialog 是否提供"clear context"选项 | 否 | | |
| `promptSuggestionEnabled` | boolean | true(描述性) | bool | 是否启用 prompt 建议 | 否 | | |
| `defaultView` | enum | — | `chat` \| `transcript` | 默认 transcript view(仅 `feature('KAIROS')` 或 `KAIROS_BRIEF`) | 否 | 内部(条件性) | |

### 3.8 插件 / Marketplace

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `enabledPlugins` | Record&lt;string, boolean\|string[]\|undefined&gt; | — | plugin-id@marketplace → true/false/版本约束 | 启用的插件 | 否 | | `{"formatter@anthropic-tools": true}` |
| `extraKnownMarketplaces` | Record&lt;string, ExtraKnownMarketplace&gt; | — | key 必须 == `source.name`(当 source.source === 'settings') | 额外 marketplace(通常项目级) | 否 | | |
| `strictKnownMarketplaces` | array | — | MarketplaceSource[] | 企业严格 marketplace allowlist(下载前检查) | 否 | | |
| `blockedMarketplaces` | array | — | MarketplaceSource[] | 企业 marketplace blocklist | 否 | | |
| `strictPluginOnlyCustomization` | boolean\|string[] | — | `true` \| array of `skills`\|`agents`\|`hooks`\|`mcp` | 阻止非 plugin 自定义源(用于 managed settings) | 否 | | `["skills","hooks"]` |
| `pluginConfigs` | Record&lt;string, {mcpServers?, options?}&gt; | — | plugin ID → 配置 | 每插件配置(MCP server 用户配置、选项) | 否 | | |
| `pluginTrustMessage` | string | — | 任意文本 | 仅从 policy settings 读取,附加到插件信任警告 | 否 | | |

### 3.9 环境

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `env` | Record&lt;string,string&gt; | — | env 名 → 值(value 经 `z.coerce.string()` 强制转字符串) | 给 Kode 会话注入的环境变量 | 否 | | `{"MAX_THINKING_TOKENS": "10000"}` |
| `skipWebFetchPreflight` | boolean | — | bool | 跳过 WebFetch blocklist 检查(企业环境) | 否 | | |

### 3.10 Auto mode(仅 `feature('TRANSCRIPT_CLASSIFIER')`)

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `skipAutoPermissionPrompt` | boolean | — | bool | 用户已接受 auto 模式 opt-in dialog | 否 | 内部(条件性) | |
| `useAutoModeDuringPlan` | boolean | true(描述性) | bool | plan 模式是否使用 auto 模式语义 | 否 | 内部(条件性) | |
| `autoMode` | object | — | `{allow?: string[], soft_deny?: string[], deny?: string[](仅 ant), environment?: string[]}` | auto mode classifier 提示定制 | 否 | 内部(条件性) | |
| `disableAutoMode` | enum | — | `"disable"` | 禁用 auto 模式 | 否 | 内部(条件性) | |
| `classifierPermissionsEnabled` | boolean | — | bool | 启用 Bash(prompt:...) 的 AI 分类(仅 `USER_TYPE=ant`) | 否 | 内部(ant) | |

### 3.11 Remote / IDE / Worktree

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `remote` | object | — | `{defaultEnvironmentId?: string}` | 远程会话配置 | 否 | | |
| `worktree` | object | — | `{symlinkDirectories?: string[], sparsePaths?: string[]}` | `--worktree` 的 git worktree 配置 | 否 | | |
| `sshConfigs` | array | — | Array of `{id, name, sshHost, sshPort?, sshIdentityFile?, startDirectory?}` | SSH 连接配置(通常 managed) | 否 | | |

### 3.12 Memory / KODE.md

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `claudeMdExcludes` | string[] | — | glob 或绝对路径(picomatch) | 排除的 KODE.md 文件(仅 User/Project/Local 类型;Managed 不可排除) | 否 | | `["**/code/KODE.md"]` |
| `autoMemoryEnabled` | boolean | — | bool | 启用 auto-memory | 否 | | |
| `autoMemoryDirectory` | string | — | 路径(支持 `~/`) | auto-memory 自定义目录(在 projectSettings 中设置时被忽略) | 否 | | |
| `autoDreamEnabled` | boolean | — | bool | 启用后台 memory consolidation(auto-dream) | 否 | | |

### 3.13 Channels / 通知

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `channelsEnabled` | boolean | — | bool | Teams/Enterprise 通道通知 opt-in(默认 off) | 否 | | |
| `allowedChannelPlugins` | array | — | Array of `{marketplace, plugin}` | 通道插件 allowlist(覆盖默认 Anthropic ledger) | 否 | | |

### 3.14 其他 / 实验 / KAIROS

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `companyAnnouncements` | string[] | — | 字符串数组 | 启动时显示的公司公告(随机选一条) | 否 | | |
| `feedbackSurveyRate` | number | — | 0–1 | 会话质量问卷出现的概率 | 否 | | `0.05` |
| `plansDirectory` | string | `~/.kode/plans/`(描述性) | 路径 | plan 文件的自定义目录(相对项目根) | 否 | | |
| `sandbox` | schema | — | 见 `SandboxSettingsSchema`(`src/entrypoints/sandboxTypes.ts`) | 沙箱配置 | 否 | | |
| `disableDeepLinkRegistration` | enum | — | `"disable"` | 阻止 `claude-cli://` 协议注册(仅 `feature('LODESTONE')`) | 否 | 内部(条件性) | |
| `voiceEnabled` | boolean | — | bool | 启用 voice mode(仅 `feature('VOICE_MODE')`) | 否 | 内部(条件性) | |
| `assistant` | boolean | — | bool | 以 assistant 模式启动(仅 `feature('KAIROS')`) | 否 | 内部(条件性) | |
| `assistantName` | string | — | 显示名 | assistant 模式下的显示名(仅 `feature('KAIROS')`) | 否 | 内部(条件性) | |
| `agent` | string | — | agent 名 | 主线程使用的 agent(覆盖系统提示词、工具限制、模型) | 否 | | `"code-reviewer"` |
| `minSleepDurationMs` | number(int ≥0) | — | 毫秒 | Sleep 工具最小睡眠时长(仅 `feature('PROACTIVE')` 或 `KAIROS`) | 否 | 内部(条件性) | |
| `maxSleepDurationMs` | number(int ≥-1) | — | 毫秒,`-1`=无限 | Sleep 工具最大睡眠时长(仅 `feature('PROACTIVE')` 或 `KAIROS`) | 否 | 内部(条件性) | |

---

## 四、`$schema` 引用说明

在文件顶部添加 `$schema` 字段可获得编辑器自动补全与校验:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "model": "sonnet",
  "permissions": {
    "allow": ["Bash(git:*)"]
  }
}
```

- 该 URL 由 `CLAUDE_CODE_SETTINGS_SCHEMA_URL`(`src/utils/settings/constants.ts:201`)定义。
- schema 内容托管于 [SchemaStore](https://json.schemastore.org/claude-code-settings.json)。
- `SettingsSchema` 中 `$schema` 是 `z.literal(CLAUDE_CODE_SETTINGS_SCHEMA_URL)`,只接受这个精确 URL。
- 源码 schema 与 SchemaStore schema 是 **两套独立维护** 的;源码 schema 是运行时权威。

---

## 五、重点字段详解

### 5.1 `permissions.defaultMode`

枚举来源:`EXTERNAL_PERMISSION_MODES`(`src/types/permissions.ts:16-22`):

- `acceptEdits` — 自动接受文件编辑
- `bypassPermissions` — 跳过所有权限检查(危险,仅沙箱使用)
- `default` — 标准询问行为
- `dontAsk` — 不询问,直接拒绝未 allow 的操作
- `plan` — plan 模式(只读分析,不执行修改)

额外:
- `auto` — **仅** 当 `feature('TRANSCRIPT_CLASSIFIER')` 启用时可用(`permissions.ts:30-36`),由 AI classifier 自动判断 allow/deny。运行时通过 `INTERNAL_PERMISSION_MODES` 注入。
- `bubble` — 内部模式,**不可** 用户寻址(不在 `EXTERNAL_PERMISSION_MODES`)。

CLI 对应 flag:`--permission-mode <mode>`,choices 来自 `PERMISSION_MODES`(运行时 `INTERNAL_PERMISSION_MODES`)。

### 5.2 `cleanupPeriodDays`

- 类型:`z.number().nonnegative().int()`
- 描述性默认:`30`
- 设为 `0` 时**完全禁用会话持久化**:不写 transcript,且启动时删除既有 transcript。

### 5.3 `respectGitignore`

- 描述性默认:`true`(由 `GlobalConfig.respectGitignore` 提供,见 `createDefaultGlobalConfig`)
- 注:`.ignore` 文件 **始终** 被遵守,与该字段无关。

### 5.4 `env`

- 类型:`Record<string, string>`(`EnvironmentVariablesSchema` = `z.record(z.string(), z.coerce.string())`)
- 值会被 **强制转为字符串**(数字、布尔都会被 `z.coerce.string()` 转换)
- 这些环境变量注入到 Kode 会话进程

### 5.5 `hooks`

完整 hook schema 见 `src/schemas/hooks.ts`(`HooksSchema`)。settings 中 `hooks` 字段直接引用该 schema。支持的 hook 事件:见 `settings.ts:597-608`(`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`、`SubagentStop`、`PreCompact`、`PostCompact`、`TeammateIdle`、`TaskCreated`、`TaskCompleted` 等)。

### 5.6 `apiKeyHelper`

指向一个脚本,脚本输出会作为鉴权值。等价的 `GlobalConfig.apiKeyHelper` 已废弃,迁移到此字段。

---

## 六、Schema 缺口(写文档时发现,供后续 B2 任务参考)

1. **SettingsSchema 完全不使用 `.default()`**——所有"默认值"散落在:
   - `createDefaultGlobalConfig`(`src/utils/config.ts:585-623`):如 `respectGitignore=true`、`autoCompactEnabled=true` 等(但这些是 GlobalConfig 字段,settings 层只是描述性引用)
   - 各 loader / runtime 路径中的硬编码默认
   - 字段描述中以自然语言说明的"(default: 30)"等(如 `cleanupPeriodDays`)
2. **部分字段缺 `.describe()`**(虽大多有,但仍有缺口需逐一审计):
   - `sandbox` 直接引用 `SandboxSettingsSchema()`,无 `.describe()`
   - `xaaIdp` 的子字段有 describe 但顶层 object 的描述在条件 spread 中
   - `extraKnownMarketplaces` 的内联 check 描述较长但字段自身 `.describe()` 存在
3. **合并优先级文档与代码不一致**:设计文档说 `flag > policy`,实际代码迭代顺序为 `policy > flag`(详见 [README.md](./README.md#二合并优先级))。需要在 schema 注释中明确合并顺序。
4. **条件性字段**(feature-flagged)在非启用构建下不被 schema 验证(通过 `...spread` 条件注入),但 `.passthrough()` 仍保留文件中的值——用户文档应说明哪些字段是条件性的。
5. `defaultShell` 的描述说"Defaults to 'bash' on all platforms",但 schema 无 `.default('bash')`——默认实际在运行时代码中。
