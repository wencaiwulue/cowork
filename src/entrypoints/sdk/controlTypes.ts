import type { z } from 'zod/v4'
import type {
  ControlErrorResponseSchema,
  ControlResponseSchema,
  SDKControlApplyFlagSettingsRequestSchema,
  SDKControlCancelAsyncMessageRequestSchema,
  SDKControlCancelRequestSchema,
  SDKControlElicitationRequestSchema,
  SDKControlElicitationResponseSchema,
  SDKControlGetContextUsageRequestSchema,
  SDKControlGetContextUsageResponseSchema,
  SDKControlGetSettingsRequestSchema,
  SDKControlGetSettingsResponseSchema,
  SDKControlInitializeRequestSchema,
  SDKControlInitializeResponseSchema,
  SDKControlInterruptRequestSchema,
  SDKControlMcpMessageRequestSchema,
  SDKControlMcpReconnectRequestSchema,
  SDKControlMcpSetServersRequestSchema,
  SDKControlMcpSetServersResponseSchema,
  SDKControlMcpStatusRequestSchema,
  SDKControlMcpStatusResponseSchema,
  SDKControlMcpToggleRequestSchema,
  SDKControlPermissionRequestSchema,
  SDKControlReloadPluginsRequestSchema,
  SDKControlReloadPluginsResponseSchema,
  SDKControlRequestInnerSchema,
  SDKControlRequestSchema,
  SDKControlResponseSchema,
  SDKControlRewindFilesRequestSchema,
  SDKControlRewindFilesResponseSchema,
  SDKControlSeedReadStateRequestSchema,
  SDKControlSetMaxThinkingTokensRequestSchema,
  SDKControlSetModelRequestSchema,
  SDKControlSetPermissionModeRequestSchema,
  SDKControlStopTaskRequestSchema,
  SDKHookCallbackRequestSchema,
  SDKKeepAliveMessageSchema,
  SDKUpdateEnvironmentVariablesMessageSchema,
  StdinMessageSchema,
  StdoutMessageSchema,
} from './controlSchemas.js'
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKUserMessage,
} from './coreTypes.js'

export type SDKControlApplyFlagSettingsRequest = z.infer<
  ReturnType<typeof SDKControlApplyFlagSettingsRequestSchema>
>
export type SDKControlCancelAsyncMessageRequest = z.infer<
  ReturnType<typeof SDKControlCancelAsyncMessageRequestSchema>
>
export type SDKControlCancelRequest = z.infer<
  ReturnType<typeof SDKControlCancelRequestSchema>
>
export type SDKControlElicitationRequest = z.infer<
  ReturnType<typeof SDKControlElicitationRequestSchema>
>
export type SDKControlElicitationResponse = z.infer<
  ReturnType<typeof SDKControlElicitationResponseSchema>
>
export type SDKControlGetContextUsageRequest = z.infer<
  ReturnType<typeof SDKControlGetContextUsageRequestSchema>
>
export type SDKControlGetContextUsageResponse = z.infer<
  ReturnType<typeof SDKControlGetContextUsageResponseSchema>
>
export type SDKControlGetSettingsRequest = z.infer<
  ReturnType<typeof SDKControlGetSettingsRequestSchema>
>
export type SDKControlGetSettingsResponse = z.infer<
  ReturnType<typeof SDKControlGetSettingsResponseSchema>
>
export type SDKControlInitializeRequest = z.infer<
  ReturnType<typeof SDKControlInitializeRequestSchema>
>
export type SDKControlInitializeResponse = z.infer<
  ReturnType<typeof SDKControlInitializeResponseSchema>
>
export type SDKControlInterruptRequest = z.infer<
  ReturnType<typeof SDKControlInterruptRequestSchema>
>
export type SDKControlMcpMessageRequest = z.infer<
  ReturnType<typeof SDKControlMcpMessageRequestSchema>
>
export type SDKControlMcpReconnectRequest = z.infer<
  ReturnType<typeof SDKControlMcpReconnectRequestSchema>
>
export type SDKControlMcpSetServersRequest = z.infer<
  ReturnType<typeof SDKControlMcpSetServersRequestSchema>
>
export type SDKControlMcpSetServersResponse = z.infer<
  ReturnType<typeof SDKControlMcpSetServersResponseSchema>
>
export type SDKControlMcpStatusRequest = z.infer<
  ReturnType<typeof SDKControlMcpStatusRequestSchema>
>
export type SDKControlMcpStatusResponse = z.infer<
  ReturnType<typeof SDKControlMcpStatusResponseSchema>
>
export type SDKControlMcpToggleRequest = z.infer<
  ReturnType<typeof SDKControlMcpToggleRequestSchema>
>
export type SDKControlPermissionRequest = z.infer<
  ReturnType<typeof SDKControlPermissionRequestSchema>
>
export type SDKControlReloadPluginsRequest = z.infer<
  ReturnType<typeof SDKControlReloadPluginsRequestSchema>
>
export type SDKControlReloadPluginsResponse = z.infer<
  ReturnType<typeof SDKControlReloadPluginsResponseSchema>
>
export type SDKControlRequest = z.infer<ReturnType<typeof SDKControlRequestSchema>>
export type SDKControlRequestInner = z.infer<
  ReturnType<typeof SDKControlRequestInnerSchema>
>
export type SDKControlResponse = z.infer<
  ReturnType<typeof SDKControlResponseSchema>
>
export type SDKControlRewindFilesRequest = z.infer<
  ReturnType<typeof SDKControlRewindFilesRequestSchema>
>
export type SDKControlRewindFilesResponse = z.infer<
  ReturnType<typeof SDKControlRewindFilesResponseSchema>
>
export type SDKControlSeedReadStateRequest = z.infer<
  ReturnType<typeof SDKControlSeedReadStateRequestSchema>
>
export type SDKControlSetMaxThinkingTokensRequest = z.infer<
  ReturnType<typeof SDKControlSetMaxThinkingTokensRequestSchema>
>
export type SDKControlSetModelRequest = z.infer<
  ReturnType<typeof SDKControlSetModelRequestSchema>
>
export type SDKControlSetPermissionModeRequest = z.infer<
  ReturnType<typeof SDKControlSetPermissionModeRequestSchema>
>
export type SDKControlStopTaskRequest = z.infer<
  ReturnType<typeof SDKControlStopTaskRequestSchema>
>
export type SDKHookCallbackRequest = z.infer<
  ReturnType<typeof SDKHookCallbackRequestSchema>
>
export type SDKKeepAliveMessage = z.infer<ReturnType<typeof SDKKeepAliveMessageSchema>>
export type SDKUpdateEnvironmentVariablesMessage = z.infer<
  ReturnType<typeof SDKUpdateEnvironmentVariablesMessageSchema>
>
export type ControlResponse = z.infer<ReturnType<typeof ControlResponseSchema>>
export type ControlErrorResponse = z.infer<
  ReturnType<typeof ControlErrorResponseSchema>
>
export type StdinMessage = any
export type StdoutMessage = any

export type {
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKUserMessage,
}
