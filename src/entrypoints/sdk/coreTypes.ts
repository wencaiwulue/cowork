// SDK Core Types - Common serializable types used by both SDK consumers and SDK builders.
//
// Types are generated from Zod schemas in coreSchemas.ts.
// To modify types:
// 1. Edit Zod schemas in coreSchemas.ts
// 2. Run: bun scripts/generate-sdk-types.ts
//
// Schemas are available in coreSchemas.ts for runtime validation but are not
// part of the public API.

// Re-export sandbox types for SDK consumers
export type {
  SandboxFilesystemConfig,
  SandboxIgnoreViolations,
  SandboxNetworkConfig,
  SandboxSettings,
} from '../sandboxTypes.js'
// Re-export all generated types
export * from './coreTypes.generated.js'

// Re-export utility types that can't be expressed as Zod schemas
export type { NonNullableUsage } from './sdkUtilityTypes.js'

export type AccountInfo = any
export type AgentDefinition = any
export type AgentInfo = any
export type AgentMcpServerSpec = any
export type ApiKeySource = any
export type AsyncHookJSONOutput = any
export type ConfigChangeHookInput = any
export type ConfigScope = any
export type CwdChangedHookInput = any
export type ElicitationHookInput = any
export type ElicitationResultHookInput = any
export type ExitReason = any
export type FastModeState = any
export type FileChangedHookInput = any
export type HookEvent = any
export type HookInput = any
export type HookJSONOutput = any
export type InstructionsLoadedHookInput = any
export type McpServerConfigForProcessTransport = any
export type McpServerStatus = any
export type ModelInfo = any
export type ModelUsage = any
export type NotificationHookInput = any
export type PermissionDeniedHookInput = any
export type PermissionMode = any
export type PermissionRequestHookInput = any
export type PermissionResult = any
export type PermissionUpdate = any
export type PostCompactHookInput = any
export type PostToolUseFailureHookInput = any
export type PostToolUseHookInput = any
export type PreCompactHookInput = any
export type PreToolUseHookInput = any
export type RewindFilesResult = any
export type SDKAPIRetryMessage = any
export type SDKAssistantMessage = any
export type SDKAssistantMessageError = any
export type SDKAuthStatusMessage = any
export type SDKCompactBoundaryMessage = any
export type SDKElicitationCompleteMessage = any
export type SDKFilesPersistedEvent = any
export type SDKHookProgressMessage = any
export type SDKHookResponseMessage = any
export type SDKHookStartedMessage = any
export type SDKLocalCommandOutputMessage = any
export type SDKMessage = any
export type SDKPartialAssistantMessage = any
export type SDKPermissionDenial = any
export type SDKPostTurnSummaryMessage = any
export type SDKPromptSuggestionMessage = any
export type SDKRateLimitInfo = any
export type SDKResultError = any
export type SDKResultMessage = any
export type SDKResultSuccess = any
export type SDKSessionInfo = any
export type SDKSessionStateChangedMessage = any
export type SDKStatus = any
export type SDKStatusMessage = any
export type SDKStreamlinedTextMessage = any
export type SDKStreamlinedToolUseSummaryMessage = any
export type SDKSystemMessage = any
export type SDKTaskNotificationMessage = any
export type SDKTaskProgressMessage = any
export type SDKTaskStartedMessage = any
export type SDKToolProgressMessage = any
export type SDKToolUseSummaryMessage = any
export type SDKUserMessage = any
export type SDKUserMessageReplay = any
export type SessionEndHookInput = any
export type SessionStartHookInput = any
export type SetupHookInput = any
export type SlashCommand = any
export type StopFailureHookInput = any
export type StopHookInput = any
export type SubagentStartHookInput = any
export type SubagentStopHookInput = any
export type SyncHookJSONOutput = any
export type TaskCompletedHookInput = any
export type TaskCreatedHookInput = any
export type TeammateIdleHookInput = any
export type UserPromptSubmitHookInput = any
export type WorktreeCreateHookInput = any
export type WorktreeRemoveHookInput = any

// Const arrays for runtime usage
export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'PermissionRequest',
  'PermissionDenied',
  'Setup',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'Elicitation',
  'ElicitationResult',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
] as const

export const EXIT_REASONS = [
  'clear',
  'resume',
  'logout',
  'prompt_input_exit',
  'other',
  'bypass_permissions_disabled',
] as const
