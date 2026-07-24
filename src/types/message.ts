import type { UUID } from 'crypto'

export type MessageOrigin = any
export type SystemMessageLevel = any
export type PartialCompactDirection = any
export type LooseRecord = any
export type BaseMessage = {
  type: string
  uuid?: UUID
  parentUuid?: UUID | null
  isMeta?: boolean
  message?: any
  timestamp?: string
  [key: string]: any
}
export type UserMessage = BaseMessage & { type: 'user' }
export type AssistantMessage = BaseMessage & { type: 'assistant' }
export type NormalizedUserMessage<TContent = any> = UserMessage & {
  message: { content: TContent[] }
}
export type NormalizedAssistantMessage<TContent = any> = AssistantMessage & {
  message: { content: TContent[] }
}
export type SystemMessage = BaseMessage & { type: 'system' }
export type ProgressMessage<TData = any> = BaseMessage & {
  type: 'progress'
  uuid: UUID
  timestamp: string
  toolUseID: string
  parentToolUseID: string
  data: TData
}
export type AttachmentMessage<TAttachment = any> = BaseMessage & {
  type: 'attachment'
  attachment: TAttachment
}
export type CollapsibleMessage = any
export type CollapsedReadSearchGroup = any
export type CompactMetadata = any
export type GroupedToolUseMessage = any
export type HookResultMessage = any
export type RenderableMessage = any
export type RequestStartEvent = any
export type StopHookInfo = any
export type StreamEvent = any
export type SystemAPIErrorMessage = any
export type SystemAgentsKilledMessage = any
export type SystemApiMetricsMessage = any
export type SystemAwaySummaryMessage = any
export type SystemBridgeStatusMessage = any
export type SystemCompactBoundaryMessage = SystemMessage & {
  subtype: 'compact_boundary'
  compactMetadata: any
  logicalParentUuid?: UUID
}
export type SystemFileSnapshotMessage = any
export type SystemInformationalMessage = any
export type SystemLocalCommandMessage = any
export type SystemMemorySavedMessage = any
export type SystemMicrocompactBoundaryMessage = any
export type SystemPermissionRetryMessage = any
export type SystemScheduledTaskFireMessage = any
export type SystemStopHookSummaryMessage = any
export type SystemThinkingMessage = any
export type SystemTurnDurationMessage = any
export type TombstoneMessage = any
export type ToolUseSummaryMessage = any
export type Message =
  | UserMessage
  | AssistantMessage
  | SystemMessage
  | AttachmentMessage
  | ProgressMessage
export type NormalizedMessage = Message
