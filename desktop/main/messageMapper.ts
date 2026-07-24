import type { AgentTaskInfo, AgentTaskToolEvent, DesktopMessage } from './ipc'

function extractText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''

  if ('text' in value && typeof value.text === 'string') {
    return value.text
  }

  if ('content' in value) {
    const content = (value as { content?: unknown }).content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content.map(extractText).filter(Boolean).join('\n')
    }
  }

  return ''
}

function extractThinking(value: unknown): string {
  if (!value || typeof value !== 'object') return ''

  if ('thinking' in value && typeof value.thinking === 'string') {
    return value.thinking
  }

  if (
    'type' in value &&
    (value as { type?: unknown }).type === 'redacted_thinking'
  ) {
    return '[redacted thinking block]'
  }

  if ('content' in value) {
    const content = (value as { content?: unknown }).content
    if (Array.isArray(content)) {
      return content.map(extractThinking).filter(Boolean).join('\n')
    }
  }

  return ''
}

function messageId(message: { type: string; uuid?: string }): string {
  return message.uuid ??
    `${message.type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function streamedToolUse(raw: unknown): DesktopMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const message = raw as {
    type?: unknown
    uuid?: unknown
    event?: {
      type?: unknown
      content_block?: {
        type?: unknown
        id?: unknown
        name?: unknown
      }
    }
  }
  if (message.type !== 'stream_event' || message.event?.type !== 'content_block_start') {
    return null
  }
  const block = message.event.content_block
  const blockType = block?.type
  if (
    blockType !== 'tool_use' &&
    blockType !== 'server_tool_use' &&
    blockType !== 'mcp_tool_use'
  ) {
    return null
  }
  const name = typeof block.name === 'string' && block.name.trim()
    ? block.name.trim()
    : 'tool'
  return {
    id: typeof block.id === 'string' ? block.id : messageId({ type: 'tool', uuid: typeof message.uuid === 'string' ? message.uuid : undefined }),
    role: 'tool',
    text: `Using ${name}...`,
    raw,
  }
}

export function toDesktopMessages(raw: unknown): DesktopMessage[] {
  if (!raw || typeof raw !== 'object' || !('type' in raw)) {
    return []
  }

  const message = raw as {
    type: string
    subtype?: string
    uuid?: string
    message?: unknown
    result?: string
    request?: { subtype?: string; tool_name?: string; description?: string }
  }

  if (
    message.type === 'keep_alive' ||
    message.type === 'control_response' ||
    message.type === 'control_cancel_request' ||
    message.type === 'streamlined_tool_use_summary'
  ) {
    return []
  }

  if (message.type === 'system') {
    return []
  }

  const toolUse = streamedToolUse(raw)
  if (toolUse) return [toolUse]

  const id = messageId(message)

  if (message.type === 'user') {
    if (containsToolResult(message.message)) return []
    return [{
      id,
      role: 'user',
      text: extractText(message.message),
      raw,
    }]
  }

  if (message.type === 'assistant') {
    const text = extractText(message.message)
    const thinking = extractThinking(message.message)
    const messages: DesktopMessage[] = []
    if (thinking) {
      messages.push({
        id: text ? `${id}:thinking` : id,
        role: 'thinking',
        text: thinking,
        raw,
      })
    }
    if (text) {
      messages.push({
        id,
        role: 'assistant',
        text,
        raw,
      })
    }
    return messages
  }

  if (message.type === 'streamlined_text') {
    const textValue = (raw as { text?: unknown }).text
    const text = typeof textValue === 'string' ? textValue : ''
    if (!text) return []
    return [{
      id,
      role: 'assistant',
      text,
      raw,
    }]
  }

  if (message.type === 'result') return []

  if (message.type === 'control_request') {
    return [{
      id,
      role: 'tool',
      text:
        message.request?.description ??
        `${message.request?.tool_name ?? 'Tool'} requires permission`,
      raw,
    }]
  }

  return []
}

export function toDesktopMessage(raw: unknown): DesktopMessage | null {
  return toDesktopMessages(raw)[0] ?? null
}

export type StreamTextUpdate = {
  id?: string
  streamKey?: string
  role: 'assistant' | 'thinking'
  text: string
  mode: 'delta' | 'snapshot'
  raw: unknown
}

function streamEventKey(value: {
  index?: unknown
  content_block_index?: unknown
  content_block?: { id?: unknown }
}): string | undefined {
  const key = value.index ?? value.content_block_index ?? value.content_block?.id
  if (typeof key === 'number') return String(key)
  if (typeof key === 'string' && key.length > 0) return key
  return undefined
}

export function toStreamTextUpdate(raw: unknown): StreamTextUpdate | null {
  if (!raw || typeof raw !== 'object') return null
  const message = raw as {
    type?: unknown
    uuid?: unknown
    index?: unknown
    content_block_index?: unknown
    text?: unknown
    delta?: { type?: unknown; text?: unknown }
    event?: {
      type?: unknown
      index?: unknown
      content_block_index?: unknown
      delta?: { type?: unknown; text?: unknown }
      content_block?: { type?: unknown; id?: unknown }
    }
  }
  if (message.type === 'streamlined_text' && typeof message.text === 'string') {
    return {
      id: typeof message.uuid === 'string' ? message.uuid : undefined,
      role: 'assistant',
      text: message.text,
      mode: 'snapshot',
      raw,
    }
  }
  const delta = message.type === 'stream_event' && message.event?.type === 'content_block_delta'
    ? message.event.delta
    : message.type === 'content_block_delta'
      ? message.delta
      : undefined
  const streamKey = message.type === 'stream_event'
    ? message.event ? streamEventKey(message.event) : undefined
    : streamEventKey(message)
  if (message.type === 'stream_event' && message.event?.type === 'content_block_start') {
    const blockType = message.event.content_block?.type
    if (blockType === 'thinking') {
      return {
        id: typeof message.uuid === 'string' ? message.uuid : undefined,
        streamKey,
        role: 'thinking',
        text: '',
        mode: 'snapshot',
        raw,
      }
    }
    if (blockType === 'redacted_thinking') {
      return {
        id: typeof message.uuid === 'string' ? message.uuid : undefined,
        streamKey,
        role: 'thinking',
        text: '[redacted thinking block]',
        mode: 'snapshot',
        raw,
      }
    }
  }
  if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
    return {
      id: typeof message.uuid === 'string' ? message.uuid : undefined,
      streamKey,
      role: 'assistant',
      text: delta.text,
      mode: 'delta',
      raw,
    }
  }
  if (
    delta?.type === 'thinking_delta' &&
    'thinking' in delta &&
    typeof (delta as { thinking?: unknown }).thinking === 'string'
  ) {
    return {
      id: typeof message.uuid === 'string' ? message.uuid : undefined,
      streamKey,
      role: 'thinking',
      text: (delta as { thinking: string }).thinking,
      mode: 'delta',
      raw,
    }
  }
  return null
}

export function extractAgentTaskUpdate(raw: unknown): AgentTaskInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const message = raw as {
    type?: unknown
    uuid?: unknown
    message?: { content?: unknown }
    result?: unknown
    usage?: unknown
  }

  const taskNotification = extractTaskNotification(raw)
  if (taskNotification) return taskNotification

  const blocks = contentBlocks(message.message)
  for (const block of blocks) {
    if (!isRecord(block)) continue
    if (block.type === 'tool_use') {
      const parsed = parseToolUseBlock(block)
      if (parsed) return parsed
      continue
    }
    if (block.type !== 'tool_result') continue
    const parsed = parseToolResultContent(block)
    if (parsed) return parsed
  }

  if (message.type === 'result' && typeof message.result === 'string') {
    const task = parseTaskNotificationXml(message.result)
    if (task) return task
  }

  if (message.type === 'result') {
    const usage = usageFromRecord(message)
    if (usage) {
      return {
        id: 'session-usage',
        status: 'completed',
        ...usage,
        raw,
      }
    }
  }

  return null
}

function contentBlocks(message: unknown): unknown[] {
  if (!isRecord(message)) return []
  const content = message.content
  return Array.isArray(content) ? content : []
}

function containsToolResult(message: unknown): boolean {
  return contentBlocks(message).some((block) => (
    isRecord(block) && block.type === 'tool_result'
  ))
}

function parseToolUseBlock(block: Record<string, unknown>): AgentTaskInfo | null {
  const name = stringValue(block.name)
  const input = isRecord(block.input) ? block.input : {}
  const toolUseId = stringValue(block.id)
  if (name === 'Agent') {
    const description = stringValue(input.description)
    return {
      id: toolUseId ?? `agent-pending-${Date.now().toString(36)}`,
      toolUseId,
      agentType: stringValue(input.subagent_type),
      description,
      status: 'pending',
      lastToolName: name,
      lastToolInput: input,
      toolTimeline: [toolStartedEvent(name, toolUseId, input)],
      raw: block,
    }
  }
  if (name === 'TaskOutput' || name === 'TaskStop') {
    const taskId = stringValue(input.task_id)
    if (!taskId) return null
    return {
      id: taskId,
      toolUseId,
      status: 'running',
      lastToolName: name,
      lastToolInput: input,
      toolTimeline: [toolStartedEvent(name, toolUseId, input)],
      raw: block,
    }
  }
  if (name === 'SendMessage') {
    const to = stringValue(input.to)
    if (!to) return null
    return {
      id: to,
      toolUseId,
      status: 'running',
      lastToolName: name,
      lastToolInput: input,
      toolTimeline: [toolStartedEvent(name, toolUseId, input)],
      raw: block,
    }
  }
  if (name === 'TeamCreate' || name === 'TeamDelete') {
    const teamName = stringValue(input.team_name) ?? stringValue(input.teamName)
    const id =
      teamName ??
      toolUseId ??
      `team-${name.toLowerCase()}-${Date.now().toString(36)}`
    return {
      id,
      toolUseId,
      description: teamName,
      status: 'running',
      lastToolName: name,
      lastToolInput: input,
      toolTimeline: [toolStartedEvent(name, toolUseId, input)],
      raw: block,
    }
  }
  return null
}

function parseToolResultContent(block: Record<string, unknown>): AgentTaskInfo | null {
  const content = block.content
  const toolUseId = stringValue(block.tool_use_id)
  const values = Array.isArray(content) ? content : [content]
  for (const value of values) {
    const text = extractText(value)
    if (!text) continue
    const xmlTask = parseTaskNotificationXml(text)
    if (xmlTask) return { ...xmlTask, toolUseId: xmlTask.toolUseId ?? toolUseId }
    const jsonTask = parseToolResultJson(text, toolUseId)
    if (jsonTask) return jsonTask
  }
  return null
}

function parseToolResultJson(text: string, toolUseId?: string): AgentTaskInfo | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const taskOutput = parseTaskOutputJson(parsed, toolUseId)
    if (taskOutput) return taskOutput
    const taskStop = parseTaskStopJson(parsed, toolUseId)
    if (taskStop) return taskStop
    const sendMessage = parseSendMessageJson(parsed, toolUseId)
    if (sendMessage) return sendMessage
    const status = stringValue(parsed.status)
    if (
      status !== 'completed' &&
      status !== 'async_launched' &&
      status !== 'remote_launched' &&
      status !== 'teammate_spawned'
    ) {
      return null
    }
    const id =
      stringValue(parsed.agentId) ??
      stringValue(parsed.taskId) ??
      stringValue(parsed.teammate_id) ??
      `agent-${Date.now().toString(36)}`
    return {
      id,
      toolUseId,
      agentType: stringValue(parsed.agent_type) ?? stringValue(parsed.subagent_type),
      description: stringValue(parsed.description),
      status: status === 'completed' ? 'completed' : 'running',
      outputFile: stringValue(parsed.outputFile) ?? stringValue(parsed.output_file),
      result: stringValue(parsed.result),
      remoteSessionUrl: stringValue(parsed.sessionUrl),
      ...usageFromRecord(parsed),
      toolTimeline: [
        toolCompletedEvent(
          'Agent',
          toolUseId,
          stringValue(parsed.result) ?? stringValue(parsed.status),
        ),
      ],
      raw: parsed,
    }
  } catch {
    return null
  }
}

function parseTaskOutputJson(
  parsed: Record<string, unknown>,
  toolUseId?: string,
): AgentTaskInfo | null {
  if (
    parsed.retrieval_status !== 'success' &&
    parsed.retrieval_status !== 'timeout' &&
    parsed.retrieval_status !== 'not_ready'
  ) {
    return null
  }
  const task = isRecord(parsed.task) ? parsed.task : undefined
  const taskId = task ? stringValue(task.task_id) : undefined
  if (!taskId) return null
  const statusRaw = stringValue(task.status)
  return {
    id: taskId,
    toolUseId,
    description: stringValue(task.description),
    status: normalizeTaskStatus(statusRaw),
    lastToolName: 'TaskOutput',
    outputPreview: truncateText(stringValue(task.output) ?? stringValue(task.result)),
    result: stringValue(task.result),
    error: stringValue(task.error),
    toolTimeline: [
      toolResultEvent(
        'TaskOutput',
        toolUseId,
        parsed.retrieval_status === 'success' ? 'completed' : 'failed',
        stringValue(task.result) ?? stringValue(task.output) ?? stringValue(parsed.retrieval_status),
      ),
    ],
    raw: parsed,
  }
}

function parseTaskStopJson(
  parsed: Record<string, unknown>,
  toolUseId?: string,
): AgentTaskInfo | null {
  const taskId = stringValue(parsed.task_id)
  if (!taskId || !stringValue(parsed.message)) return null
  return {
    id: taskId,
    toolUseId,
    status: 'cancelled',
    lastToolName: 'TaskStop',
    result: stringValue(parsed.message),
    toolTimeline: [
      toolCompletedEvent('TaskStop', toolUseId, stringValue(parsed.message)),
    ],
    raw: parsed,
  }
}

function parseSendMessageJson(
  parsed: Record<string, unknown>,
  toolUseId?: string,
): AgentTaskInfo | null {
  if (typeof parsed.success !== 'boolean') return null
  const message = stringValue(parsed.message)
  const target = stringValue(parsed.target)
  if (!message && !target) return null
  const id = target ?? extractAgentIdFromSendMessage(message) ?? `send-${Date.now().toString(36)}`
  return {
    id,
    toolUseId,
    status: parsed.success ? 'running' : 'failed',
    lastToolName: 'SendMessage',
    result: message,
    toolTimeline: [
      toolResultEvent(
        'SendMessage',
        toolUseId,
        parsed.success ? 'completed' : 'failed',
        message,
      ),
    ],
    raw: parsed,
  }
}

function extractTaskNotification(raw: unknown): AgentTaskInfo | null {
  if (!isRecord(raw)) return null
  const message = raw.message
  const text = extractText(message)
  return text ? parseTaskNotificationXml(text) : null
}

function parseTaskNotificationXml(text: string): AgentTaskInfo | null {
  if (!text.includes('<task_notification>')) return null
  const id = tagValue(text, 'task_id') ?? `task-${Date.now().toString(36)}`
  const statusRaw = tagValue(text, 'status')
  const status: AgentTaskInfo['status'] =
    statusRaw === 'completed'
      ? 'completed'
      : statusRaw === 'failed'
        ? 'failed'
        : statusRaw === 'killed'
          ? 'cancelled'
          : 'running'
  return {
    id,
    status,
    description: tagValue(text, 'summary'),
    outputFile: tagValue(text, 'output_file'),
    result: tagValue(text, 'result'),
    worktreePath: tagValue(text, 'worktree_path'),
    tokenCount: numberTagValue(text, 'total_tokens'),
    toolUseCount: numberTagValue(text, 'tool_uses'),
    durationMs: numberTagValue(text, 'duration_ms'),
    raw: text,
  }
}

function toolStartedEvent(
  toolName: string,
  toolUseId: string | undefined,
  input: unknown,
): AgentTaskToolEvent {
  return {
    id: timelineEventId(toolName, toolUseId, 'started'),
    toolUseId,
    toolName,
    status: 'started',
    timestamp: Date.now(),
    input,
    summary: summarizeToolInput(input),
  }
}

function toolCompletedEvent(
  toolName: string,
  toolUseId: string | undefined,
  summary?: string,
): AgentTaskToolEvent {
  return toolResultEvent(toolName, toolUseId, 'completed', summary)
}

function toolResultEvent(
  toolName: string,
  toolUseId: string | undefined,
  status: AgentTaskToolEvent['status'],
  summary?: string,
): AgentTaskToolEvent {
  return {
    id: timelineEventId(toolName, toolUseId, status),
    toolUseId,
    toolName,
    status,
    timestamp: Date.now(),
    summary: truncateText(summary),
  }
}

function timelineEventId(
  toolName: string,
  toolUseId: string | undefined,
  status: AgentTaskToolEvent['status'],
): string {
  return `${toolUseId ?? toolName}:${status}`
}

function summarizeToolInput(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  return (
    stringValue(input.description) ??
    stringValue(input.prompt) ??
    stringValue(input.message) ??
    stringValue(input.task_id) ??
    stringValue(input.to)
  )
}

function tagValue(text: string, tag: string): string | undefined {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return match?.[1]?.trim() || undefined
}

function numberTagValue(text: string, tag: string): number | undefined {
  const value = tagValue(text, tag)
  if (!value || !/^\d+$/.test(value)) return undefined
  return Number.parseInt(value, 10)
}

function normalizeTaskStatus(status: string | undefined): AgentTaskInfo['status'] {
  if (status === 'completed') return 'completed'
  if (status === 'failed' || status === 'error') return 'failed'
  if (status === 'killed' || status === 'cancelled' || status === 'canceled') return 'cancelled'
  if (status === 'pending') return 'pending'
  return 'running'
}

function usageFromRecord(record: Record<string, unknown>): Pick<
  AgentTaskInfo,
  'tokenCount' | 'toolUseCount' | 'durationMs'
> | undefined {
  const totalTokens =
    numberValue(record.totalTokens) ??
    numberValue(record.total_tokens) ??
    tokenCountFromUsage(record.usage)
  const toolUseCount = numberValue(record.totalToolUseCount) ?? numberValue(record.tool_uses)
  const durationMs = numberValue(record.totalDurationMs) ?? numberValue(record.duration_ms)
  if (
    totalTokens === undefined &&
    toolUseCount === undefined &&
    durationMs === undefined
  ) {
    return undefined
  }
  return {
    tokenCount: totalTokens,
    toolUseCount,
    durationMs,
  }
}

function tokenCountFromUsage(usage: unknown): number | undefined {
  if (!isRecord(usage)) return undefined
  const total =
    (numberValue(usage.input_tokens) ?? 0) +
    (numberValue(usage.output_tokens) ?? 0) +
    (numberValue(usage.cache_creation_input_tokens) ?? 0) +
    (numberValue(usage.cache_read_input_tokens) ?? 0)
  return total > 0 ? total : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function truncateText(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > 1200 ? `${trimmed.slice(0, 1200)}...` : trimmed
}

function extractAgentIdFromSendMessage(message: string | undefined): string | undefined {
  if (!message) return undefined
  const match = message.match(/Agent "([^"]+)"/)
  return match?.[1]
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
