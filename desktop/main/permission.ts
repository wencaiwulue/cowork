import type { PermissionResponse } from './ipc'

export type NormalizedPermissionRequest = {
  sessionId: string
  requestId: string
  toolName: string
  description: string
  input: Record<string, unknown>
  toolUseId?: string
  blockedPath?: string
  decisionReason?: string
  agentContext?: string
  teamContext?: string
  permissionSuggestions?: unknown[]
  raw: unknown
}

type PermissionRequestInput = {
  sessionId: string
  message: unknown
}

export function normalizePermissionRequest(
  input: PermissionRequestInput,
): NormalizedPermissionRequest | null {
  if (!isRecord(input.message) || input.message.type !== 'control_request') {
    return null
  }

  const requestId = stringValue(input.message.request_id)
  const request = isRecord(input.message.request) ? input.message.request : undefined
  if (!requestId || !request || request.subtype !== 'can_use_tool') {
    return null
  }

  const toolName =
    stringValue(request.display_name) ??
    stringValue(request.tool_name) ??
    'Tool'
  const rawInput = isRecord(request.input) ? request.input : {}
  const description =
    stringValue(request.description) ??
    stringValue(request.title) ??
    summarizeToolInput(toolName, rawInput)

  return {
    sessionId: input.sessionId,
    requestId,
    toolName,
    description,
    input: rawInput,
    toolUseId: stringValue(request.tool_use_id),
    blockedPath: stringValue(request.blocked_path),
    decisionReason: stringValue(request.decision_reason),
    agentContext: agentContextSummary(request),
    teamContext: teamContextSummary(request),
    permissionSuggestions: Array.isArray(request.permission_suggestions)
      ? request.permission_suggestions
      : undefined,
    raw: input.message,
  }
}

function agentContextSummary(request: Record<string, unknown>): string | undefined {
  const context = firstRecord(
    request.agent_context,
    request.agentContext,
    request.agent,
  )
  const agentType =
    stringValue(request.agent_type) ??
    stringValue(request.subagent_type) ??
    stringValue(context?.agent_type) ??
    stringValue(context?.subagent_type) ??
    stringValue(context?.type) ??
    stringValue(context?.name)
  const agentId =
    stringValue(request.agent_id) ??
    stringValue(context?.agent_id) ??
    stringValue(context?.id)
  const description =
    stringValue(request.agent_description) ??
    stringValue(context?.description)
  return labeledSummary('Agent', [
    agentType,
    agentId,
    description,
  ])
}

function teamContextSummary(request: Record<string, unknown>): string | undefined {
  const context = firstRecord(
    request.team_context,
    request.teamContext,
    request.team,
  )
  const teamName =
    stringValue(request.team_name) ??
    stringValue(context?.team_name) ??
    stringValue(context?.name)
  const teammate =
    stringValue(request.teammate_name) ??
    stringValue(request.to) ??
    stringValue(context?.teammate_name) ??
    stringValue(context?.member) ??
    stringValue(context?.to)
  const mode =
    stringValue(request.mode) ??
    stringValue(context?.mode)
  return labeledSummary('Team', [
    teamName,
    teammate ? `@${teammate.replace(/^@/, '')}` : undefined,
    mode,
  ])
}

function labeledSummary(label: string, values: Array<string | undefined>): string | undefined {
  const parts = values.filter((value): value is string => Boolean(value))
  return parts.length ? `${label}: ${parts.join(' · ')}` : undefined
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
  return values.find(isRecord)
}

export function createPermissionResponse(
  request: NormalizedPermissionRequest,
  behavior: 'allow' | 'deny',
): PermissionResponse {
  if (behavior === 'allow') {
    return {
      behavior: 'allow',
      updatedInput: request.input,
      toolUseID: request.toolUseId,
      decisionClassification: 'user_temporary',
    }
  }

  return {
    behavior: 'deny',
    message: 'User denied permission',
    toolUseID: request.toolUseId,
    decisionClassification: 'user_reject',
  }
}

function summarizeToolInput(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const entries = Object.entries(input)
  if (entries.length === 0) return `${toolName} requires permission`
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join(', ')
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
