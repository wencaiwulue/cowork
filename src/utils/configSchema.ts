/**
 * GlobalConfigSchema — Zod validation schema for `~/.kode.json`.
 *
 * 本 schema 用于校验/补默认值/未来生成 JSON Schema,加载路径未改变,默认值仍由
 * `createDefaultGlobalConfig()` 在 `getConfig()` 中通过浅合并提供。
 *
 * 设计要点(见 `docs/design/2026-08-05-config-reference-and-schema.md` §B1):
 * - 使用项目惯用的 `lazySchema(() => z.object({...}))` 模式,与 `SettingsSchema` 一致。
 * - **逐字段从 `GlobalConfig` 类型映射**(`src/utils/config.ts:183-578`)。
 * - 复杂嵌套对象(`projects`、`oauthAccount`、`chromeExtension`、`s1mAccessCache`、
 *   `customApiKeyResponses`、`tipsHistory`、`cachedStatsigGates` 等)用 `.passthrough()` 的
 *   object 或 `z.unknown()` 容忍,目标是校验结构 + 诊断,而非严格类型建模。
 * - 外层 object 使用 `.passthrough()`:历史 `~/.kode.json` 含未知键(plugin 注入或已移除字段),
 *   严格校验会破坏启动。
 * - **所有字段 `.optional()`,不加 `.default()`**:默认值仍由 `createDefaultGlobalConfig()`
 *   在加载时 spread 提供;在 schema 里加 `.default()` 会改变 `getConfig` 的合并语义。
 * - 接入点在 `getConfig`(`src/utils/config.ts`),`safeParse` 失败只 `logForDebugging`,
 *   **不抛出、不替换返回值**——零行为变更。
 */
import { lazySchema } from './lazySchema.js'
import { z } from 'zod/v4'

/**
 * 未知嵌套对象容错 schema:接受任意 object,保留未知键。
 * 用于 `projects`、`oauthAccount` 等结构复杂、且非校验重点的字段。
 */
const looseObject = () => z.record(z.string(), z.unknown())

export const GlobalConfigSchema = lazySchema(() =>
  z
    .object({
      // --- 用户偏好(部分在 GLOBAL_CONFIG_KEYS 白名单) ---
      apiKeyHelper: z.string().optional(),
      installMethod: z
        .enum(['local', 'native', 'global', 'unknown'])
        .optional(),
      autoUpdates: z.boolean().optional(),
      autoUpdatesProtectedForNative: z.boolean().optional(),
      theme: z.string().optional(),
      preferredNotifChannel: z.string().optional(),
      customNotifyCommand: z.string().optional(),
      verbose: z.boolean().optional(),
      editorMode: z.string().optional(),
      diffTool: z.enum(['terminal', 'auto']).optional(),
      env: z.record(z.string(), z.string()).optional(),
      tipsHistory: z.record(z.string(), z.number()).optional(),

      // --- 启动 / 安装统计 ---
      numStartups: z.number().optional(),
      userID: z.string().optional(),
      firstStartTime: z.string().optional(),
      claudeCodeFirstTokenDate: z.string().optional(),
      doctorShownAtSession: z.number().optional(),
      githubActionSetupCount: z.number().optional(),
      slackAppInstallCount: z.number().optional(),

      // --- Onboarding / 版本追踪 ---
      hasCompletedOnboarding: z.boolean().optional(),
      lastOnboardingVersion: z.string().optional(),
      lastReleaseNotesSeen: z.string().optional(),
      changelogLastFetched: z.number().optional(),
      cachedChangelog: z.string().optional(),
      migrationVersion: z.number().optional(),
      // First-run migration wizard decision fields.
      migrationPromptSeen: z.boolean().optional(),
      migratedFrom: z.enum(["claude", "codex", "none"]).optional(),

      // --- OAuth / 账号 ---
      oauthAccount: looseObject().optional(),
      primaryApiKey: z.string().optional(),
      hasAcknowledgedCostThreshold: z.boolean().optional(),
      hasAvailableSubscription: z.boolean().optional(),
      subscriptionNoticeCount: z.number().optional(),
      subscriptionUpsellShownCount: z.number().optional(),
      recommendedSubscription: z.string().optional(),
      bridgeOauthDeadExpiresAt: z.number().optional(),
      bridgeOauthDeadFailCount: z.number().optional(),

      // --- 缓存(Statsig / GrowthBook / 其他)---
      cachedStatsigGates: looseObject().optional(),
      cachedDynamicConfigs: looseObject().optional(),
      cachedGrowthBookFeatures: looseObject().optional(),
      growthBookOverrides: looseObject().optional(),
      s1mAccessCache: looseObject().optional(),
      s1mNonSubscriberAccessCache: looseObject().optional(),
      passesEligibilityCache: looseObject().optional(),
      groveConfigCache: looseObject().optional(),
      overageCreditGrantCache: looseObject().optional(),
      clientDataCache: z.unknown().optional(),
      additionalModelOptionsCache: z.array(z.unknown()).optional(),
      metricsStatusCache: looseObject().optional(),
      penguinModeOrgEnabled: z.boolean().optional(),
      startupPrefetchedAt: z.number().optional(),
      cachedExtraUsageDisabledReason: z
        .union([z.string(), z.null()])
        .optional(),
      cachedChromeExtensionInstalled: z.boolean().optional(),

      // --- Project 配置(per-project)---
      projects: looseObject().optional(),

      // --- MCP ---
      mcpServers: looseObject().optional(),
      claudeAiMcpEverConnected: z.array(z.string()).optional(),

      // --- Custom API key responses ---
      customApiKeyResponses: z
        .object({
          approved: z.array(z.string()).optional(),
          rejected: z.array(z.string()).optional(),
        })
        .passthrough()
        .optional(),

      // --- IDE / Terminal 设置追踪 ---
      iterm2KeyBindingInstalled: z.boolean().optional(),
      iterm2SetupInProgress: z.boolean().optional(),
      iterm2BackupPath: z.string().optional(),
      iterm2It2SetupComplete: z.boolean().optional(),
      appleTerminalBackupPath: z.string().optional(),
      appleTerminalSetupInProgress: z.boolean().optional(),
      shiftEnterKeyBindingInstalled: z.boolean().optional(),
      optionAsMetaKeyInstalled: z.boolean().optional(),
      preferTmuxOverIterm2: z.boolean().optional(),
      autoConnectIde: z.boolean().optional(),
      autoInstallIdeExtension: z.boolean().optional(),
      hasIdeOnboardingBeenShown: looseObject().optional(),
      ideHintShownCount: z.number().optional(),
      hasIdeAutoConnectDialogBeenShown: z.boolean().optional(),
      deepLinkTerminal: z.string().optional(),

      // --- 调用 / 提示 / Callout 追踪 ---
      hasSeenTasksHint: z.boolean().optional(),
      hasUsedStash: z.boolean().optional(),
      hasUsedBackgroundTask: z.boolean().optional(),
      queuedCommandUpHintCount: z.number().optional(),
      memoryUsageCount: z.number().optional(),
      promptQueueUseCount: z.number().optional(),
      btwUseCount: z.number().optional(),
      lastPlanModeUse: z.number().optional(),
      lastShownEmergencyTip: z.string().optional(),
      transcriptShareDismissed: z.boolean().optional(),
      feedbackSurveyState: looseObject().optional(),
      voiceNoticeSeenCount: z.number().optional(),
      voiceLangHintShownCount: z.number().optional(),
      voiceLangHintLastLanguage: z.string().optional(),
      voiceFooterHintSeenCount: z.number().optional(),
      opus1mMergeNoticeSeenCount: z.number().optional(),
      experimentNoticesSeenCount: looseObject().optional(),
      modelSwitchCalloutDismissed: z.boolean().optional(),
      modelSwitchCalloutLastShown: z.number().optional(),
      modelSwitchCalloutVersion: z.string().optional(),
      effortCalloutDismissed: z.boolean().optional(),
      effortCalloutV2Dismissed: z.boolean().optional(),
      remoteDialogSeen: z.boolean().optional(),
      desktopUpsellSeenCount: z.number().optional(),
      desktopUpsellDismissed: z.boolean().optional(),
      idleReturnDismissed: z.boolean().optional(),
      autoPermissionsNotificationCount: z.number().optional(),
      hasShownS1MWelcomeV2: looseObject().optional(),
      hasShownOpusPlanWelcome: looseObject().optional(),
      passesUpsellSeenCount: z.number().optional(),
      hasVisitedPasses: z.boolean().optional(),
      passesLastSeenRemaining: z.number().optional(),
      overageCreditUpsellSeenCount: z.number().optional(),
      hasVisitedExtraUsage: z.boolean().optional(),

      // --- 迁移标记(一次性)---
      opusProMigrationComplete: z.boolean().optional(),
      opusProMigrationTimestamp: z.number().optional(),
      sonnet1m45MigrationComplete: z.boolean().optional(),
      legacyOpusMigrationTimestamp: z.number().optional(),
      sonnet45To46MigrationTimestamp: z.number().optional(),
      hasResetAutoModeOptInForDefaultOffer: z.boolean().optional(),
      hasSeenUndercoverAutoNotice: z.boolean().optional(),
      hasSeenUltraplanTerms: z.boolean().optional(),
      bypassPermissionsModeAccepted: z.boolean().optional(),

      // --- 渠道 / Chrome / LSP / Plugin / Skill ---
      hasCompletedClaudeInChromeOnboarding: z.boolean().optional(),
      claudeInChromeDefaultEnabled: z.boolean().optional(),
      chromeExtension: z
        .object({
          pairedDeviceId: z.string().optional(),
          pairedDeviceName: z.string().optional(),
        })
        .passthrough()
        .optional(),
      claudeCodeHints: z
        .object({
          plugin: z.array(z.string()).optional(),
          disabled: z.boolean().optional(),
        })
        .passthrough()
        .optional(),
      officialMarketplaceAutoInstallAttempted: z.boolean().optional(),
      officialMarketplaceAutoInstalled: z.boolean().optional(),
      officialMarketplaceAutoInstallFailReason: z
        .enum(['policy_blocked', 'git_unavailable', 'gcs_unavailable', 'unknown'])
        .optional(),
      officialMarketplaceAutoInstallRetryCount: z.number().optional(),
      officialMarketplaceAutoInstallLastAttemptTime: z.number().optional(),
      officialMarketplaceAutoInstallNextRetryTime: z.number().optional(),
      lspRecommendationDisabled: z.boolean().optional(),
      lspRecommendationNeverPlugins: z.array(z.string()).optional(),
      lspRecommendationIgnoredCount: z.number().optional(),
      skillUsage: looseObject().optional(),
      githubRepoPaths: looseObject().optional(),

      // --- Companion / Teammate / Speculation / Tungsten ---
      companion: z.unknown().optional(),
      companionMuted: z.boolean().optional(),
      teammateMode: z.enum(['auto', 'tmux', 'in-process']).optional(),
      teammateDefaultModel: z
        .union([z.string(), z.null()])
        .optional(),
      tungstenPanelVisible: z.boolean().optional(),
      speculationEnabled: z.boolean().optional(),

      // --- 用户偏好(杂项)---
      autoCompactEnabled: z.boolean().optional(),
      showTurnDuration: z.boolean().optional(),
      todoFeatureEnabled: z.boolean().optional(),
      showExpandedTodos: z.boolean().optional(),
      showSpinnerTree: z.boolean().optional(),
      messageIdleNotifThresholdMs: z.number().optional(),
      fileCheckpointingEnabled: z.boolean().optional(),
      terminalProgressBarEnabled: z.boolean().optional(),
      showStatusInTerminalTab: z.boolean().optional(),
      taskCompleteNotifEnabled: z.boolean().optional(),
      inputNeededNotifEnabled: z.boolean().optional(),
      agentPushNotifEnabled: z.boolean().optional(),
      respectGitignore: z.boolean().optional(),
      copyFullResponse: z.boolean().optional(),
      copyOnSelect: z.boolean().optional(),
      permissionExplainerEnabled: z.boolean().optional(),
      prStatusFooterEnabled: z.boolean().optional(),
      remoteControlAtStartup: z.boolean().optional(),
      hasUsedBackslashReturn: z.boolean().optional(),
    })
    .passthrough(),
)
