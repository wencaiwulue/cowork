# CLI 命令行参数参考

> 对照源: `src/main.tsx`(全局 flags 在 ~968-1006 + 3817-3880;子命令树在 3900+);flag→state 映射见 `src/bootstrap/state.ts`;权限模式枚举见 `src/types/permissions.ts:16-36`;effort 校验见 `main.tsx:993-999`。
> **本文件手工维护,以源码为准。**

---

## 一、全局 flags

按功能分组。所有 flag 均在 `src/main.tsx` 的 program 主体(~968-1006)或 ant-only 块(~3817-3880)定义。

### 1.1 会话与恢复

| Flag | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `-p, --print` | boolean | false | bool | 打印模式:输出响应后退出(适合管道) | 否 | | `kode -p "fix typo"` |
| `-c, --continue` | boolean | false | bool | 继续当前目录最近会话 | 否 | | |
| `-r, --resume [value]` | value\|true | — | session ID 或搜索词 | 按 session ID 恢复,或交互式 picker(可带搜索词) | 否 | | `--resume abc-123` |
| `--fork-session` | boolean | false | bool | 恢复时创建新 session ID 而非复用原 ID | 否 | | |
| `--from-pr [value]` | value\|true | — | PR number/URL 或搜索词 | 恢复与 PR 关联的会话 | 否 | | |
| `--no-session-persistence` | boolean | false | bool | 禁用会话持久化(仅 `--print`) | 否 | | |
| `--session-id <uuid>` | string | — | UUID | 使用指定 session ID(必须合法 UUID) | 否 | | |
| `-n, --name <name>` | string | — | 显示名 | 会话显示名(在 `/resume` 和终端标题中显示) | 否 | | |
| `--bare` | boolean | false | bool | 最小模式:跳过 hooks、LSP、plugin sync、attribution、auto-memory、KODE.md 自动发现等 | 否 | | |

### 1.2 模型与 API

| Flag | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `--model <model>` | string | — | 模型 alias(`sonnet`/`opus`/`haiku`)或全名(`claude-sonnet-4-6`) | 当前会话使用的模型 | 否 | | `--model sonnet` |
| `--effort <level>` | string | — | `low`\|`medium`\|`high`\|`max` | effort 级别(`max` 接受但可能被运行时门控) | 否 | | `--effort high` |
| `--agent <agent>` | string | — | agent 名 | 当前会话的 agent,覆盖 `settings.agent` | 否 | | `--agent reviewer` |
| `--agents <json>` | string(JSON) | — | JSON object | 自定义 agent 定义(例:`{"reviewer": {"description": "...", "prompt": "..."}}`) | 否 | | |
| `--betas <betas...>` | string[] | — | beta header 名 | API 请求附加的 beta headers(仅 API key 用户) | 否 | | |
| `--fallback-model <model>` | string | — | 模型 | 默认模型过载时的回退模型(仅 `--print`) | 否 | | |

### 1.3 权限

| Flag | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `--permission-mode <mode>` | string | — | `acceptEdits`\|`bypassPermissions`\|`default`\|`dontAsk`\|`plan`(+ `auto`,仅 `feature('TRANSCRIPT_CLASSIFIER')` 启用时) | 当前会话权限模式。choices 来自运行时 `PERMISSION_MODES` | 否 | | `--permission-mode plan` |
| `--dangerously-skip-permissions` | boolean | false | bool | 跳过所有权限检查(仅沙箱使用) | 否 | | |
| `--allow-dangerously-skip-permissions` | boolean | false | bool | 允许(但不默认启用)跳过权限检查 | 否 | | |
| `--allowedTools, --allowed-tools <tools...>` | string[] | — | 工具规则(逗号或空格分隔) | 允许的工具列表 | 否 | | `--allowedTools "Bash(git:*) Edit"` |
| `--disallowedTools, --disallowed-tools <tools...>` | string[] | — | 工具规则 | 拒绝的工具列表 | 否 | | |
| `--tools <tools...>` | string[] | — | `""`/`default`/工具名列表 | 内置工具集白名单(`""` 全禁,`default` 全用) | 否 | | `--tools Bash,Edit,Read` |
| `--add-dir <directories...>` | string[] | — | 绝对路径 | 额外允许工具访问的目录 | 否 | | |

### 1.4 I/O 与输出

| Flag | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `--output-format <format>` | enum | `text` | `text`\|`json`\|`stream-json` | 输出格式(仅 `--print`) | 否 | | `--output-format stream-json` |
| `--input-format <format>` | enum | `text` | `text`\|`stream-json` | 输入格式(仅 `--print`) | 否 | | |
| `--json-schema <schema>` | string | — | JSON Schema 字符串 | 结构化输出校验的 JSON Schema | 否 | | |
| `--include-hook-events` | boolean | false | bool | 在 stream-json 输出中包含 hook 生命周期事件 | 否 | | |
| `--include-partial-messages` | boolean | false | bool | 在 stream-json 中包含 partial message chunks | 否 | | |
| `--replay-user-messages` | boolean | false | bool | 把 stdin 用户消息回显到 stdout(仅 stream-json 输入输出) | 否 | | |

### 1.5 MCP 与 Plugin

| Flag | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `--mcp-config <configs...>` | string[] | — | JSON 文件路径或 JSON 字符串 | 加载 MCP server 配置(空格分隔) | 否 | | |
| `--strict-mcp-config` | boolean | false | bool | 仅使用 `--mcp-config` 的 MCP server,忽略其他来源 | 否 | | |
| `--plugin-dir <path>` | string[](可重复) | — | 目录路径 | 本次会话从指定目录加载插件(可多次 `--plugin-dir`) | 否 | | |
| `--disable-slash-commands` | boolean | false | bool | 禁用所有 skills | 否 | | |

### 1.6 调试与 IDE

| Flag | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `-d, --debug [filter]` | string\|true | — | filter 字符串(如 `"api,hooks"` 或 `"!1p,!file"`) | 启用 debug 模式,可选分类过滤 | 否 | | `-d api` |
| `--debug-file <path>` | string | — | 文件路径 | 写 debug 日志到指定文件(隐式启用 debug) | 否 | | |
| `--verbose` | boolean | false | bool | 覆盖 config 的 verbose 设置 | 否 | | |
| `--ide` | boolean | false | bool | 启动时若仅一个有效 IDE 则自动连接 | 否 | | |

### 1.7 Settings 与配置

| Flag | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `--settings <file-or-json>` | string | — | 文件路径或 JSON 字符串 | 加载额外 settings(flagSettings source) | 否 | | `--settings '{"model":"sonnet"}'` |
| `--setting-sources <sources>` | string | `user,project,local`(默认全部) | 逗号分隔的 `user`/`project`/`local` | 启用的 settings source(policy 和 flag 始终启用) | 否 | | `--setting-sources user,project` |
| `-w, --worktree [name]` | string\|true | — | worktree 名 | 为本次会话创建 git worktree | 否 | | |
| `--tmux` | string\|boolean | false | bool 或 `classic` | 为 worktree 创建 tmux 会话(需 `--worktree`) | 否 | | |
| `--chrome` / `--no-chrome` | boolean | — | bool | 启用/禁用 Claude in Chrome 集成 | 否 | | |
| `--file <specs...>` | string[] | — | `file_id:relative_path` | 启动时下载的文件资源 | 否 | | |

### 1.8 系统提示词

| Flag | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `--system-prompt <prompt>` | string | — | 任意文本 | 替换默认系统提示词 | 否 | | |
| `--append-system-prompt <prompt>` | string | — | 任意文本 | 在默认系统提示词后追加 | 否 | | |

### 1.9 废弃 flags

| Flag | 废弃说明 | 替代 |
|---|---|---|
| `--mcp-debug` | `[DEPRECATED. Use --debug instead]`。启用 MCP debug 模式 | `--debug` |
| `--max-thinking-tokens <tokens>` | `[DEPRECATED. Use --thinking instead for newer models]`。最大 thinking token 数(仅 `--print`) | `--thinking` |
| `--dangerously-skip-permissions-with-classifiers`(ant-only,hideHelp) | `[ANT-ONLY] Deprecated alias for --permission-mode auto` | `--permission-mode auto` |
| `--afk`(ant-only,hideHelp) | `[ANT-ONLY] Deprecated alias for --permission-mode auto` | `--permission-mode auto` |

---

## 二、子命令表

来源:`src/main.tsx:3900+`。`-p/--print` 模式跳过子命令注册。

### 2.1 `mcp`(`kode mcp ...`)

管理 MCP server(源 `main.tsx:3900`)。

| 子命令 | 说明 |
|---|---|
| `mcp serve` | 启动 Kode Code MCP server |
| `mcp add <name> <command-or-url> [args...]` | 添加 MCP server(支持 `--scope`、`--transport`、`-e`/`--env`、`-s`/`--scope`、`-t`/`--transport`) |
| `mcp add-json <name> <json>` | 用 JSON 字符串添加 MCP server(`--scope` 默认 `local`,`--client-secret`) |
| `mcp add-from-claude-desktop` | 从 Claude Desktop 导入(Mac/WSL,`--scope` 默认 `local`) |
| `mcp remove <name>` | 移除 MCP server(`--scope` 可选,未指定则从任意 scope 移除) |
| `mcp list` | 列出已配置的 MCP server |
| `mcp get <name>` | 查看某 MCP server 详情 |
| `mcp reset-project-choices` | 重置当前项目所有 project-scoped(`.kode.mcp.json`)server 的 approve/reject 标记 |

### 2.2 `auth`(`kode auth ...`)

管理鉴权(源 `main.tsx:4106`)。

| 子命令 | 说明 |
|---|---|
| `auth login` | 登录(`--email`、`--sso`、`--console`、`--claudeai`) |
| `auth status` | 查看鉴权状态(`--json` 默认,`--text`) |
| `auth logout` | 登出 |

### 2.3 `plugin` / `plugins`(`kode plugin ...`)

管理插件(源 `main.tsx:4154`,有 `plugins` alias)。

| 子命令 | 说明 |
|---|---|
| `plugin validate <path>` | 验证 plugin 或 marketplace manifest |
| `plugin list` | 列出已安装插件(`--json`、`--available`) |
| `plugin install <plugin>` / `plugin i` | 安装插件(`plugin@marketplace`,`--scope` 默认 `user`) |
| `plugin uninstall <plugin>` / `plugin remove` / `plugin rm` | 卸载插件(`--scope`、`--keep-data`) |
| `plugin enable <plugin>` | 启用已禁用插件(`--scope`) |
| `plugin disable [plugin]` | 禁用插件(`-a/--all`、`--scope`) |
| `plugin update <plugin>` | 更新插件到最新版(`--scope`) |
| `plugin marketplace add <source>` | 添加 marketplace(`--sparse`、`--scope`) |
| `plugin marketplace list` | 列出 marketplace(`--json`) |
| `plugin marketplace remove <name>` / `rm` | 移除 marketplace |
| `plugin marketplace update [name]` | 更新 marketplace(无 name 则全部) |

### 2.4 其他顶级子命令

| 子命令 | 说明 | 选项 |
|---|---|---|
| `server` | 启动 Kode Code session server | `--port`(默认 0)、`--host`(默认 0.0.0.0)、`--auth-token`、`--unix`、`--workspace`、`--idle-timeout`(默认 600000)、`--max-sessions`(默认 32) |
| `ssh <host> [dir]` | 在远程主机上通过 SSH 运行 Kode | `--permission-mode`、`--dangerously-skip-permissions`、`--local` |
| `open <cc-url>` | 连接到 Kode Code server(内部,用 `cc://` URL) | `-p/--print [prompt]`、`--output-format` |
| `setup-token` | 设置长期鉴权 token(需 Claude 订阅) | — |
| `agents` | 列出已配置 agent | `--setting-sources`、`--json` |
| `doctor` | 检查 auto-updater 健康 | — |
| `update` / `upgrade` | 检查并安装更新 | — |
| `install [target]` | 安装 native build(`target` 为 `stable`/`latest`/具体版本) | `--force` |
| `completion <shell>` | 生成 shell 补全脚本(bash/zsh/fish) | `--output <file>` |

### 2.5 ant-only 子命令(仅 `USER_TYPE=ant`)

| 子命令 | 说明 | 选项 |
|---|---|---|
| `auto-mode defaults` | 打印默认 auto mode 配置(env/allow/deny)JSON | — |
| `auto-mode config` | 打印 effective auto mode 配置 JSON | — |
| `auto-mode critique` | 用 AI 反馈自定义 auto mode 规则 | `--model` |
| `up` | 初始化/升级本地 dev 环境(读最近 KODE.md 的 `# claude up` 段) | — |
| `rollback [target]` | 回滚到先前版本 | `-l/--list`、`--dry-run`、`--safe` |
| `log [number\|sessionId]` | 管理会话日志 | — |
| `error [number]` | 查看错误日志 | — |
| `export <source> <outputFile>` | 导出会话到文本文件 | — |
| `task create <subject>` | 创建任务 | `-d/--description`、`-l/--list` |
| `task list` | 列出任务 | `-l/--list`、`--pending`、`--json` |
| `task get <id>` | 查看任务详情 | `-l/--list` |
| `task update <id>` | 更新任务 | `-l/--list`、`-s/--status`、`--subject`、`-d/--description`、`--owner`、`--clear-owner` |
| `task dir` | 显示任务目录路径 | `-l/--list` |

### 2.6 条件性子命令

| 子命令 | 条件 | 说明 |
|---|---|---|
| `remote-control` | `feature('BRIDGE_MODE')` | 启动带 Remote Control 的交互会话(`--rc` 别名) |
| `assistant [sessionId]` | `feature('KAIROS')` | 作为 client attach 到运行中的 bridge session |

---

## 三、Flag → Settings / State 映射

CLI flags 不直接走 `flagSettings` 文件 source,而是通过两条路径注入:

### 3.1 经 flagSettings 注入(合并到 settings 层)

| Flag | 映射路径 | 说明 |
|---|---|---|
| `--settings <file-or-json>` | `setFlagSettingsPath(path)` 或 `setFlagSettingsInline(obj)`(state.ts:1137/1147);`loadSettingsFromDisk` 中 `flagSettings` source 读取并 `SettingsSchema().safeParse` 后合并 | 作为 `flagSettings` source 整体合并到 settings |
| `--setting-sources <sources>` | `setAllowedSettingSources(parseSettingSourcesFlag(...))`(state.ts:1230) | 控制 user/project/local 是否启用(policy 和 flag 始终启用) |
| `--agents <json>` | `parseAgentsFromJson(parsedAgents, 'flagSettings')`(main.tsx:2045) | 注入到 flagSettings 的 agent 定义 |

### 3.2 直接 state 注入(运行时覆盖,不走 settings 层)

| Flag | State 字段 / 行为 | 来源 |
|---|---|---|
| `--model <model>` | `STATE.mainLoopModelOverride`(经 `setMainLoopModelOverride`);也写入 `STATE.initialMainLoopModel` | main.tsx:2018、state.ts:847-853 |
| `--agent <agent>` | 主线程 agent 类型(`STATE.agentType`,main.tsx:1115) | 直接 state |
| `--verbose` | `STATE.verbose` 覆盖(经 `getGlobalConfig().verbose` fallback) | main.tsx:1127 |
| `--effort <level>` | `parseEffortValue(options.effort)` → `effortValue`(main.tsx:2639/3030) | 直接 state |
| `--permission-mode <mode>` | 会话权限模式(运行时直接消费) | main.tsx |
| `--dangerously-skip-permissions` | `setSessionBypassPermissionsMode(true)` | state.ts:1264 |
| `--add-dir <dirs>` | `getAdditionalDirectoriesForClaudeMd` 等读取的额外目录 | state.ts |
| `--ide` | IDE 自动连接 | main.tsx |
| `--bare` | 设置 `process.env.CLAUDE_CODE_SIMPLE='1'` | main.tsx:1015 |
| `--chrome` / `--no-chrome` | `setChromeFlagOverride(true/false)` | state.ts:1247 |
| `--cowork` | `setUseCoworkPlugins(true)`(并 resetSettingsCache)→ settings 文件名变 `cowork_settings.json` | state.ts:1255 |
| `--plugin-dir <paths>` | `setInlinePlugins([...])` | state.ts:1239 |
| `--no-session-persistence` | `setSessionPersistenceDisabled(true)` | state.ts |
| `--session-id <uuid>` | `setSessionId(uuid)` | state.ts |
| `--betas <betas>` | `setSdkBetas([...])` | state.ts |
| `--name <name>` | `setSessionName(name)` | state.ts |
| `--channels <servers>` | `setAllowedChannels([...])` | state.ts |
| `--client-type` | `setClientType(...)` | state.ts |
| `--deep-link-*` | 各自的 state 字段 | state.ts |
| `--question-preview-format` | `setQuestionPreviewFormat(...)` | state.ts |
| `--sdk-url <url>` | SDK I/O streaming 远程 WebSocket endpoint | state.ts |
| `--teleport [session]` / `--remote [description]` | teleport/remote session 状态 | state.ts |
| `--messaging-socket-path <path>` | UDS messaging server socket path | state.ts |
| `--agent-id`/`--agent-name`/`--team-name`/`--agent-color`/`--agent-type` | teammate 身份字段 | state.ts |
| `--parent-session-id` | 父 session ID(analytics 关联) | state.ts |
| `--teammate-mode <mode>` | teammate spawn 模式(`auto`/`tmux`/`in-process`) | state.ts |

---

## 四、关键枚举实际取值(以源码为准)

### 4.1 `--permission-mode`

来源:`EXTERNAL_PERMISSION_MODES`(`src/types/permissions.ts:16-22`)+ 运行时 `INTERNAL_PERMISSION_MODES`(`permissions.ts:33-38`)。

| 取值 | 来源 | 用户可用 |
|---|---|---|
| `acceptEdits` | `EXTERNAL_PERMISSION_MODES` | 是 |
| `bypassPermissions` | `EXTERNAL_PERMISSION_MODES` | 是 |
| `default` | `EXTERNAL_PERMISSION_MODES` | 是 |
| `dontAsk` | `EXTERNAL_PERMISSION_MODES` | 是 |
| `plan` | `EXTERNAL_PERMISSION_MODES` | 是 |
| `auto` | 仅当 `feature('TRANSCRIPT_CLASSIFIER')` 启用时加入(`permissions.ts:35`) | 条件性 |
| `bubble` | 内部模式(`PermissionMode` union,`permissions.ts:28`) | **否**(不在 `INTERNAL_PERMISSION_MODES`,不可用户寻址) |

CLI flag 的 `choices` 来自运行时 `PERMISSION_MODES` = `INTERNAL_PERMISSION_MODES`。

### 4.2 `--output-format`

```
text | json | stream-json
```

来源:`main.tsx:976`(`.choices(['text', 'json', 'stream-json'])`)。

### 4.3 `--input-format`

```
text | stream-json
```

来源:`main.tsx:983`(`.choices(['text', 'stream-json'])`)。

### 4.4 `--effort`

```
low | medium | high | max
```

来源:`main.tsx:993-999`。`argParser` 接受小写形式并校验,`InvalidArgumentError` 提示 "It must be one of: low, medium, high, max"。

注意:settings 层的 `effortLevel`(`SettingsSchema`)对非 `USER_TYPE=ant` 用户 **不含 `max`**(`types.ts:703-710`),仅 `low`/`medium`/`high`。CLI 接受 `max` 但实际生效需 ant。

### 4.5 `--thinking`

```
enabled | adaptive | disabled
```

来源:`main.tsx`(`.choices(['enabled', 'adaptive', 'disabled'])`,**`.hideHelp()`**)。`enabled` 等价于 `adaptive`。

### 4.6 `--teammate-mode`

```
auto | tmux | in-process
```

来源:`main.tsx:3863`(hideHelp)。

---

## 五、内部 / 隐藏 flags(`.hideHelp()`)

以下 flag 在 `--help` 中隐藏。它们是 **实验/内部,变更不通知,不建议依赖**。来源:`grep ".hideHelp()" src/main.tsx`。

> ⚠️ **本节所有 flag 均标 `内部`**——非稳定 API,无行为承诺,后续版本可能改名、改语义或移除。

### 5.1 主选项块中的隐藏 flags

| Flag | 类型 | 作用描述 |
|---|---|---|
| `--debug-to-stderr` | boolean | 启用 debug 模式(输出到 stderr) |
| `--init` | boolean | 运行 Setup hooks 的 `init` trigger,然后继续 |
| `--init-only` | boolean | 运行 Setup 和 `SessionStart:startup` hooks,然后退出 |
| `--maintenance` | boolean | 运行 Setup hooks 的 `maintenance` trigger,然后继续 |
| `--thinking <mode>` | enum(`enabled`\|`adaptive`\|`disabled`) | thinking 模式(`enabled` 等价 `adaptive`) |
| `--max-thinking-tokens <tokens>` | number | **已废弃**,用 `--thinking`;最大 thinking token 数(仅 `--print`) |
| `--max-turns <turns>` | number | 非交互模式最大 agentic turn 数(仅 `--print`) |
| `--max-budget-usd <amount>` | number | API 调用最大美元预算(仅 `--print`) |
| `--permission-prompt-tool <tool>` | string | 权限 prompt 用的 MCP 工具(仅 `--print`) |
| `--system-prompt-file <file>` | string | 从文件读取系统提示词 |
| `--append-system-prompt-file <file>` | string | 从文件读取并追加到默认系统提示词 |
| `--prefill <text>` | string | 预填输入框但不提交 |
| `--deep-link-origin` | flag | 标识本次会话由 deep link 启动 |
| `--deep-link-repo <slug>` | string | deep link `?repo=` 解析到的 repo slug |
| `--deep-link-last-fetch <ms>` | number | deep link trampoline 预计算的 `FETCH_HEAD` mtime(epoch ms) |
| `--resume-session-at <message id>` | string | 恢复时只到指定 assistant message(需 `--resume` + print 模式) |
| `--rewind-files <user-message-id>` | string | 恢复文件到指定 user message 状态并退出(需 `--resume`) |
| `--enable-auth-status` | boolean | SDK 模式下启用 auth status 消息 |
| `--workload <tag>` | string | 计费 header 归因的 workload tag(仅 `--print`) |

### 5.2 ant-only 隐藏 flags(`process.env.USER_TYPE === 'ant'`)

| Flag | 类型 | 作用描述 |
|---|---|---|
| `--advisor <model>` | string | 启用服务端 advisor 工具(需 `canUserConfigureAdvisor()`) |
| `--dangerously-skip-permissions-with-classifiers` | flag | **已废弃**,[ANT-ONLY] `--permission-mode auto` 别名 |
| `--afk` | flag | **已废弃**,[ANT-ONLY] `--permission-mode auto` 别名 |
| `--tasks [id]` | string | [ANT-ONLY] Tasks 模式:监听并自动处理 tasks |

### 5.3 feature-gated 隐藏 flags

| Flag | 条件 | 作用描述 |
|---|---|---|
| `--enable-auto-mode` | `feature('TRANSCRIPT_CLASSIFIER')` | opt-in auto mode |
| `--assistant` | `feature('KAIROS')` | 强制 assistant 模式(Agent SDK daemon) |
| `--channels <servers...>` | `feature('KAIROS')` 或 `KAIROS_CHANNELS` | 注册 channel 通知的 MCP server 列表 |
| `--dangerously-load-development-channels <servers...>` | `feature('KAIROS')` 或 `KAIROS_CHANNELS` | 加载未在 allowlist 的 channel server(仅本地开发) |
| `--messaging-socket-path <path>` | `feature('UDS_INBOX')` | UDS messaging server 的 unix socket 路径 |
| `--proactive` | `feature('PROACTIVE')` 或 `KAIROS` | 以 proactive autonomous 模式启动(**未 hideHelp**) |
| `--brief` | `feature('KAIROS')` 或 `KAIROS_BRIEF` | 启用 SendUserMessage 工具(agent→user 通信)(**未 hideHelp**) |

### 5.4 Teammate 身份隐藏 flags(始终注册但 hideHelp)

| Flag | 作用描述 |
|---|---|
| `--agent-id <id>` | teammate agent ID |
| `--agent-name <name>` | teammate 显示名 |
| `--team-name <name>` | swarm coordination 用 team 名 |
| `--agent-color <color>` | teammate UI 颜色 |
| `--plan-mode-required` | 要求先进入 plan 模式 |
| `--parent-session-id <id>` | 父 session ID(analytics 关联) |
| `--teammate-mode <mode>` | teammate spawn 模式(`auto`\|`tmux`\|`in-process`) |
| `--agent-type <type>` | 该 teammate 的自定义 agent 类型 |

### 5.5 其他隐藏 flags

| Flag | 条件 | 作用描述 |
|---|---|---|
| `--sdk-url <url>` | 始终 | SDK I/O streaming 的远程 WebSocket endpoint(仅 `-p` + stream-json) |
| `--teleport [session]` | 始终 | 恢复 teleport session |
| `--remote [description]` | 始终 | 创建远程 session |
| `--remote-control [name]` / `--rc [name]` | `feature('BRIDGE_MODE')` | 启动带 Remote Control 的交互会话 |
| `--hard-fail` | `feature('HARD_FAIL')` | `logError` 时崩溃而非静默记录 |
| `--cowork` | 始终(在 `pluginCmd` 子命令的 option 中) | 使用 `cowork_plugins` 目录 |

### 5.6 ANT-ONLY(非隐藏但 ant-gated)flags

以下 flag 在 `process.env.USER_TYPE === 'ant'` 时注册,部分不 hideHelp:

| Flag | 类型 | hideHelp | 作用 |
|---|---|---|---|
| `--delegate-permissions` | flag | 否 | [ANT-ONLY] `--permission-mode auto` 别名 |
| `--agent-teams` | boolean | 否 | [ANT-ONLY] 强制多 agent 模式 |

---

## 六、Schema 缺口

1. **`--effort` CLI 接受 `max`,但 settings 层 `effortLevel` 对非 ant 用户不含 `max`**——CLI 与 settings schema 枚举不一致。
2. **`--thinking` 默认值不明确**:CLI `.choices(['enabled','adaptive','disabled'])` 无 `.default()`,描述说 "enabled (equivalent to adaptive)"——默认实际依赖 `alwaysThinkingEnabled` settings 字段。
3. **ant-only flags 的非 ant 行为未文档化**:`--delegate-permissions`、`--agent-teams` 等在非 ant 构建中根本不注册,而非降级为 no-op——文档需说明构建时剥离。
4. **`--permission-mode` 的 choices 是运行时动态的**(`PERMISSION_MODES` 依赖 feature flag),`--help` 输出与实际可接受值可能不一致(在不同构建下)。
5. **flag→settings 映射分散**:大部分 flag 不走 settings 层而是直接 state 注入,但文档/用户常假设 `--model` 等价于 `settings.model`——实际 `--model` 走 `STATE.mainLoopModelOverride`,而 `flagSettings.model` 只有 `--settings '{"model":"..."}'` 才注入。映射关系无单一源,散落在 `main.tsx` 和 `state.ts`。
6. **`--max-turns` / `--max-budget-usd` 是 hideHelp 的**——但语义上是用户可配的(在 `--print` 模式下),分类上更适合放到主 flags 表而非"内部"。hideHelp 与"内部"并非等价。
7. **`--debug-to-stderr` / `--debug-file` 等 debug 类 flag 的 argParser 行为不一致**(`--debug-to-stderr` 用 `Boolean` argParser,`--debug-file` 是普通 boolean trigger)。
8. **`--cowork` flag 在 `pluginCmd` 子命令中作为 `coworkOption()` 出现**(`main.tsx:4151`),但全局似乎也有相关 state(`setUseCoworkPlugins`)——cowork 的入口路径不止一处,易混淆。
