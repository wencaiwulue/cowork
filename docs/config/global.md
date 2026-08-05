# `~/.kode.json` 配置参考

> 对照源: `src/utils/config.ts`(`GlobalConfig` 类型第 183-578 行;`createDefaultGlobalConfig` 第 585-623 行;`GLOBAL_CONFIG_KEYS` 白名单第 627-667 行;`getConfig` 第 ~1421-1462 行);文件路径见 `src/utils/env.ts:14-18`。
> **本文件手工维护,以源码为准。**

---

## 一、文件性质

`~/.kode.json` 是 **运行时状态文件**,既存用户偏好,也存运行时缓存、统计计数、迁移标记、OAuth 状态等。

- 文件路径:`getKodeGlobalFile()`(`src/utils/env.ts:14-18`)= `$KODE_CONFIG_DIR/.kode.json`(或 `$HOME/.kode.json`)。OAuth 多账号时可能带后缀 `.kode-<suffix>.json`(`fileSuffixForOauthConfig()`)。
- 加载:`getConfig()`(`config.ts:~1421-1462`)用 `jsonParse` 解析后,与 `createDefaultGlobalConfig()` 浅合并(`{ ...createDefault(), ...parsedConfig }`)。
- **无 zod schema 校验**:未知/malformed key 被静默合并保留(设计文档 B 任务会引入 `GlobalConfigSchema` 做 fail-open 校验)。
- 持久化:`saveGlobalConfig()` 写回,带 lockfile 重入保护。

---

## 二、用户可配 vs 内部

### 用户可配字段(`GLOBAL_CONFIG_KEYS` 白名单)

来源:`src/utils/config.ts:627-666`,共 38 个。这些是 `/config` 斜杠命令暴露给用户修改的字段。

| 字段名 | 类型 | 默认值 | 作用描述 | 示例 |
|---|---|---|---|---|
| `apiKeyHelper` | string? | — | **已废弃**(迁移到 `settings.apiKeyHelper`)。鉴权 helper 脚本 | |
| `installMethod` | `'local'\|'native'\|'global'\|'unknown'`? | — | 安装方式 | `"native"` |
| `autoUpdates` | boolean? | — | 是否启用自动更新 | `true` |
| `autoUpdatesProtectedForNative` | boolean? | — | native 安装下因保护而禁用 auto-update 的标记 | |
| `theme` | ThemeSetting | `"dark"` | UI 主题 | `"dark"` |
| `verbose` | boolean | `false` | 是否输出 verbose 日志 | `true` |
| `preferredNotifChannel` | NotificationChannel | `"auto"` | 首选通知通道(见 `NOTIFICATION_CHANNELS` 在 `configConstants.ts`) | `"iterm2"` |
| `shiftEnterKeyBindingInstalled` | boolean? | — | Shift+Enter 绑定是否已安装 | |
| `editorMode` | EditorMode | `"normal"` | 编辑器模式(见 `EDITOR_MODES` 在 `configConstants.ts`;`emacs` 向后兼容) | `"vscode"` |
| `hasUsedBackslashReturn` | boolean? | — | 是否用过反斜杠回车 | |
| `autoCompactEnabled` | boolean | `true` | 是否启用 auto-compact | `true` |
| `showTurnDuration` | boolean | `true` | 是否显示 turn 时长消息 | `true` |
| `diffTool` | `'terminal'\|'auto'` | `"auto"` | diff 显示工具 | `"auto"` |
| `env` | Record&lt;string,string&gt; | `{}` | **已废弃**(迁移到 `settings.env`)。环境变量 | |
| `tipsHistory` | Record&lt;string, number&gt; | `{}` | 各 tip 上次显示的 numStartups | |
| `todoFeatureEnabled` | boolean | `true` | 是否启用 todo feature | |
| `showExpandedTodos` | boolean? | `false` | 是否默认展开 todo | |
| `messageIdleNotifThresholdMs` | number | `60000` | 用户空闲多久后触发完成通知(毫秒) | `60000` |
| `autoConnectIde` | boolean? | `false` | 启动时若仅一个有效 IDE 则自动连接 | |
| `autoInstallIdeExtension` | boolean? | `true` | 在 IDE 内运行时自动安装 IDE 扩展 | |
| `fileCheckpointingEnabled` | boolean | `true` | 是否启用文件 checkpoint | |
| `terminalProgressBarEnabled` | boolean | `true` | 终端进度条(OSC 9;4) | |
| `showStatusInTerminalTab` | boolean? | — | 终端标签状态指示器(OSC 21337) | |
| `taskCompleteNotifEnabled` | boolean? | — | 任务完成通知(默认 off,显式 opt-in) | |
| `inputNeededNotifEnabled` | boolean? | — | 需要输入通知(默认 off) | |
| `agentPushNotifEnabled` | boolean? | — | agent push 通知(默认 off) | |
| `respectGitignore` | boolean | `true` | 文件拾取器是否遵守 `.gitignore` | |
| `claudeInChromeDefaultEnabled` | boolean? | — | Claude in Chrome 是否默认启用 | |
| `hasCompletedClaudeInChromeOnboarding` | boolean? | — | Claude in Chrome onboarding 是否完成 | |
| `lspRecommendationDisabled` | boolean? | — | 禁用所有 LSP 插件推荐 | |
| `lspRecommendationNeverPlugins` | string[]? | — | 永不推荐的插件 ID 列表 | |
| `lspRecommendationIgnoredCount` | number? | — | 已忽略的推荐次数(超过 5 后停止) | |
| `copyFullResponse` | boolean | `false` | `/copy` 是否总是复制完整响应 | |
| `copyOnSelect` | boolean? | —(undefined→true) | 全屏文本选中后自动复制 | |
| `permissionExplainerEnabled` | boolean? | —(默认 true) | 启用 Haiku 生成的权限请求解释 | |
| `prStatusFooterEnabled` | boolean? | —(默认 true) | 在 footer 显示 PR review 状态 | |
| `remoteControlAtStartup` | boolean? | — | 启动时运行 Remote Control(需 BRIDGE_MODE) | |
| `remoteDialogSeen` | boolean? | — | 是否已看过 remote callout dialog | |

### 废弃字段(仍可配,但有迁移替代)

| 字段名 | 废弃原因 | 替代 |
|---|---|---|
| `apiKeyHelper` | 已迁移到 settings 层 | `settings.apiKeyHelper`(`.kode/settings.json`) |
| `env` | 已迁移到 settings 层 | `settings.env` |
| `customNotifyCommand` | 已迁移到 hooks | Notification hook(见 `docs/hooks.md`) |

---

## 三、内部运行时状态字段(按类别)

下列字段 **不建议手编**。它们是运行时状态,直接编辑可能破坏会话追踪、迁移幂等性、缓存一致性。修改偏好请用 `/config` 命令。

完整字段定义见 `src/utils/config.ts:183-578`。这里按类别列代表字段并指引到源码。

### 3.1 启动 / 安装统计

| 代表字段 | 类别 |
|---|---|
| `numStartups`、`firstStartTime`、`installMethod`、`userID`、`claudeCodeFirstTokenDate` | 启动次数、首次启动时间、安装方式、用户 ID |
| `doctorShownAtSession` | Doctor 上次显示时的 session 数 |
| `githubActionSetupCount`、`slackAppInstallCount` | GitHub Action / Slack App 安装计数 |

### 3.2 Onboarding / 版本追踪

| 代表字段 | 类别 |
|---|---|
| `hasCompletedOnboarding`、`lastOnboardingVersion` | onboarding 完成状态与版本 |
| `lastReleaseNotesSeen`、`changelogLastFetched`、`cachedChangelog`(已废弃) | release notes 追踪 |
| `migrationVersion` | 已应用的迁移集版本(等于 `CURRENT_MIGRATION_VERSION` 时跳过 sync 迁移) |

### 3.3 OAuth / 账号

| 代表字段 | 类别 |
|---|---|
| `oauthAccount`(`AccountInfo`)、`primaryApiKey`、`hasAcknowledgedCostThreshold` | OAuth 账号信息、API key、成本阈值确认 |
| `hasAvailableSubscription`、`subscriptionNoticeCount`、`subscriptionUpsellShownCount`(已废弃)、`recommendedSubscription`(已废弃) | 订阅状态与 upsell 追踪 |
| `bridgeOauthDeadExpiresAt`、`bridgeOauthDeadFailCount` | 跨进程 OAuth 失败退避 |

### 3.4 缓存(Statsig / GrowthBook / 其他)

| 代表字段 | 类别 |
|---|---|
| `cachedStatsigGates`、`cachedDynamicConfigs` | Statsig 缓存 |
| `cachedGrowthBookFeatures`、`growthBookOverrides`(ant-only) | GrowthBook 缓存与本地覆盖 |
| `s1mAccessCache`、`s1mNonSubscriberAccessCache`、`passesEligibilityCache`、`groveConfigCache` | Sonnet-1M / Guest passes / Grove 缓存 |
| `overageCreditGrantCache`、`metricsStatusCache` | Overage credit / metrics 缓存 |
| `clientDataCache`、`additionalModelOptionsCache` | 客户端数据 / 额外模型选项缓存 |
| `penguinModeOrgEnabled`、`startupPrefetchedAt` | fast mode / 启动预取 |

### 3.5 Project 配置(per-project)

| 代表字段 | 类别 |
|---|---|
| `projects`(`Record<string, ProjectConfig>`) | 每项目的 trust、MCP approve、worktree、统计等(完整结构见 `ProjectConfig` 在 `config.ts:76-136`) |

### 3.6 IDE / Terminal 设置追踪

| 代表字段 | 类别 |
|---|---|
| `iterm2KeyBindingInstalled`(legacy)、`iterm2SetupInProgress`、`iterm2BackupPath`、`iterm2It2SetupComplete`、`preferTmuxOverIterm2` | iTerm2 设置状态 |
| `appleTerminalBackupPath`、`appleTerminalSetupInProgress` | Terminal.app 设置 |
| `shiftEnterKeyBindingInstalled`、`optionAsMetaKeyInstalled` | 键绑定 |
| `hasIdeOnboardingBeenShown`、`ideHintShownCount`、`hasIdeAutoConnectDialogBeenShown` | IDE dialog 追踪 |
| `deepLinkTerminal` | deep link 用的终端标识 |

### 3.7 调用 / 提示 / Callout 追踪

| 代表字段 | 类别 |
|---|---|
| `tipsHistory` | 每 tip 上次显示时的 numStartups(在白名单中) |
| `memoryUsageCount`、`promptQueueUseCount`、`btwUseCount` | 功能使用计数 |
| `hasSeenTasksHint`、`hasUsedStash`、`hasUsedBackgroundTask`、`queuedCommandUpHintCount` | UI 提示追踪 |
| `voiceNoticeSeenCount`、`voiceLangHintShownCount`、`voiceLangHintLastLanguage`、`voiceFooterHintSeenCount` | voice mode 提示 |
| `opus1mMergeNoticeSeenCount`、`experimentNoticesSeenCount`、`modelSwitchCallout*`、`effortCallout*`、`desktopUpsell*`、`idleReturnDismissed`、`autoPermissionsNotificationCount` | 各 callout 追踪 |
| `lastPlanModeUse` | 上次 plan 模式使用时间戳 |

### 3.8 迁移标记(一次性)

| 代表字段 | 类别 |
|---|---|
| `opusProMigrationComplete`、`opusProMigrationTimestamp` | Opus 4.5 Pro 迁移 |
| `sonnet1m45MigrationComplete`、`legacyOpusMigrationTimestamp`、`sonnet45To46MigrationTimestamp` | 模型迁移 |
| `hasResetAutoModeOptInForDefaultOffer` | auto-mode opt-in 重置 |
| `hasSeenUndercoverAutoNotice`、`hasSeenUltraplanTerms` | ant-only 一次性提示 |

### 3.9 渠道 / Chrome / LSP / Plugin / Skill

| 代表字段 | 类别 |
|---|---|
| `claudeAiMcpEverConnected` | claude.ai MCP connector 是否曾连接成功 |
| `chromeExtension`(`{pairedDeviceId?, pairedDeviceName?}`)、`cachedChromeExtensionInstalled` | Chrome 扩展配对 |
| `claudeCodeHints`(`{plugin?: string[], disabled?:}`) | plugin hint 协议状态 |
| `officialMarketplaceAutoInstall*` | 官方 marketplace 自动安装追踪 |
| `skillUsage`(`Record<string, {usageCount, lastUsedAt}>`) | skill 使用计数(autocomplete 排序) |
| `githubRepoPaths` | GitHub repo 路径映射(teleport 目录切换) |

### 3.10 Teammate / Speculation / Tungsten / Companion

| 代表字段 | 类别 |
|---|---|
| `teammateMode`(`'auto'\|'tmux'\|'in-process'`)、`teammateDefaultModel` | teammate spawn 配置 |
| `tungstenPanelVisible` | tmux live panel 可见性(ant-only) |
| `companion`、`companionMuted` | /buddy companion |
| `speculationEnabled` | speculation 开关(ant-only) |

### 3.11 其他

| 代表字段 | 类别 |
|---|---|
| `feedbackSurveyState`(`{lastShownTime?}`) | feedback survey 追踪 |
| `transcriptShareDismissed` | transcript share 提示 |
| `lastShownEmergencyTip` | 上次显示的紧急 tip |
| `hasSeenS1MWelcomeV2`、`hasShownOpusPlanWelcome`、`hasVisitedPasses`、`passesLastSeenRemaining`、`passesUpsellSeenCount`、`overageCreditUpsellSeenCount`、`hasVisitedExtraUsage` | 各 callout / 访问追踪 |
| `autoUpdatesProtectedForNative`(在白名单)、`bypassPermissionsModeAccepted`、`hasResetAutoModeOptInForDefaultOffer` | 模式接受/重置标记 |
| `remoteControlSpawnMode`(`'same-dir'\|'worktree'`,per-project 在 `ProjectConfig`) | Remote Control spawn 模式 |

---

## 四、手编风险与推荐路径

### 风险

1. **迁移幂等性破坏**:`migrationVersion`、`opusProMigrationComplete` 等字段控制一次性迁移。手编为已完成可能跳过必要迁移;手编为未完成可能触发重复迁移。
2. **缓存不一致**:`cachedStatsigGates`、`cachedGrowthBookFeatures`、`s1mAccessCache` 等缓存与远端不一致会导致功能 flag 判断错误。
3. **会话追踪混乱**:`numStartups`、`tipsHistory`、各 callout 计数依赖单调递增;手编回退会导致 callout 重新弹出或永不弹出。
4. **OAuth 状态损坏**:`oauthAccount`、`primaryApiKey`、`bridgeOauthDead*` 等损坏可能导致登录失败。
5. **Project config 丢失**:`projects` 是 per-project 状态(trust、MCP approve 等),手编可能丢失某项目的信任状态。

### 推荐路径

- **修改用户偏好**:用 `/config` 斜杠命令(只动 `GLOBAL_CONFIG_KEYS` 白名单字段)。
- **修改 settings**:编辑 `.kode/settings.json`(见 [settings.md](./settings.md))。
- **修改 MCP**:编辑 `.kode.mcp.json` 或用 `kode mcp` 子命令(见 [mcp.md](./mcp.md))。
- **修改 CLI 行为**:用命令行 flags(见 [cli.md](./cli.md))。
- **仅在调试/恢复时手编 `~/.kode.json`**:并先备份。

---

## 五、getConfig 加载语义

`getConfig()`(`config.ts:~1421-1462`)流程:

1. 读 `~/.kode.json` 文件内容
2. `stripBOM` 去除 BOM
3. `jsonParse` 解析(失败抛 `ConfigParseError`)
4. **未来 B2 任务**:在此插入 `GlobalConfigSchema().safeParse`,失败仅 `logForDebugging` 不抛
5. 返回 `{ ...createDefaultGlobalConfig(), ...parsedConfig }`(浅合并)

**浅合并的后果**:嵌套对象(如 `projects`、`customApiKeyResponses`、`tipsHistory`)若在 `parsedConfig` 中存在,会 **整体覆盖** 默认值而非深合并。手编时需提供完整嵌套对象。

---

## 六、Schema 缺口

1. **`GlobalConfig` 无 zod schema**:加载不校验,未知/malformed key 被静默保留(设计文档 B1/B2 任务会补 `GlobalConfigSchema`,fail-open)。
2. **浅合并语义**:嵌套对象需手编者提供完整结构,易出错——schema 应反映这一点(或文档应警告)。
3. **`GLOBAL_CONFIG_KEYS` 白名单与 `GlobalConfig` 类型不完全对应**:白名单含 `apiKeyHelper`/`env` 等已废弃字段,但不含 `customNotifyCommand`(也废弃)——废弃字段的白名单处理不一致。
4. **默认值散落**:`createDefaultGlobalConfig` 提供部分默认,但许多可选字段无显式默认(依赖运行时 fallback)。schema 应补 `.describe()` 标注默认来源。
5. **`tipsHistory` 在白名单但语义上是运行时状态**(记录 tip 上次显示的 numStartups)——白名单分类与"用户可配"语义不完全一致。
6. `customNotifyCommand`(废弃)未出现在 `GLOBAL_CONFIG_KEYS` 白名单,但类型中存在——文档需说明废弃字段在 `/config` 中不可见。
