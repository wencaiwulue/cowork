import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { redactSecrets } from './config'
import type {
  AgentSource,
  ClaudeDesktopConfig,
  DesktopSession,
  DiagnosticExportResult,
} from './ipc'

export type OperationalEvent = {
  type:
    | 'desktop-error'
    | 'renderer-process-gone'
    | 'renderer-unresponsive'
    | 'renderer-responsive'
    | 'runtime-error'
    | 'terminal-exit'
    | 'update-error'
    | 'main-process'
  timestamp: number
  message?: string
  details?: Record<string, unknown>
}

export type DiagnosticsBundleInput = {
  generatedAt: string
  app: {
    name: string
    version: string
    isPackaged: boolean
    locale?: string
  }
  runtime: {
    platform: NodeJS.Platform
    arch: string
    node: string
    electron: string
    chrome?: string
    v8?: string
  }
  paths: {
    userData: string
    sessionsStore?: string
  }
  sessions: DesktopSession[]
  operationalEvents: OperationalEvent[]
  releasePolicy?: DesktopReleasePolicy
  config?: ClaudeDesktopConfig
  configError?: string
}

export type DesktopReleasePolicy = {
  updatePolicy?: string
  reason?: string
  releaseNotesRequired?: boolean
  rollbackRequired?: boolean
}

export type DiagnosticsBundle = {
  schemaVersion: 1
  generatedAt: string
  app: DiagnosticsBundleInput['app']
  runtime: DiagnosticsBundleInput['runtime']
  paths: DiagnosticsBundleInput['paths']
  config: {
    claudeHome?: string
    settingsPath?: string
    settingsExists?: boolean
    localSettingsPath?: string
    localSettingsExists?: boolean
    proxyEnabled?: boolean
    proxyUrl?: string
    mcpServerCount?: number
    skillCount?: number
    pluginCount?: number
    scheduledTaskCount?: number
    configError?: string
  }
  release: {
    updatePolicy?: string
    reason?: string
    releaseNotesRequired?: boolean
    rollbackRequired?: boolean
    failedUpdateEventCount: number
  }
  sessions: Array<{
    id: string
    title: string
    cwd: string
    status: DesktopSession['status']
    activity: DesktopSession['activity']
    createdAt: number
    updatedAt: number
    lastError?: string
    agentType?: string
    messageCounts: Record<string, number>
    pendingToolUseCount: number
    agentTaskCounts: Record<string, number>
    runtimeEventCount: number
    sidebarWidth: number
    workspaceRatio: number
    expandedPathCount: number
    activePane: DesktopSession['layout']['activePane']
    primaryView?: DesktopSession['layout']['primaryView']
    activeFile?: string
    terminalId?: string
    previewUrl?: string
    settingsActiveSection?: string
    tasksActiveSection?: string
    agentsActiveSection?: string
    teamsActiveSection?: string
    selectedAgentType?: string
    selectedAgentSource?: AgentSource
    selectedAgentTaskId?: string
    selectedTeamName?: string
    selectedTeamRecipient?: string
    selectedGlobalTaskId?: string
    selectedProjectTaskId?: string
    selectedMcpName?: string
    selectedMcpSourcePath?: string
    selectedMcpScope?: 'user' | 'project'
    selectedSkillName?: string
    selectedSkillPath?: string
    selectedSkillScope?: 'user' | 'project'
    selectedPluginIdentity?: string
  }>
  operationalEvents: OperationalEvent[]
}

const secretValuePattern =
  /((?:token|secret|password|authorization|api[_-]?key|access[_-]?key|session)[\w.-]*\s*[:=]\s*)(["']?)(?:Bearer\s+)?[^"'\s,;]+(\2)/gi
const bearerPattern = /(bearer\s+)[A-Za-z0-9._~+/=-]+/gi

export function redactDiagnosticText(value: string): string {
  return value
    .replace(secretValuePattern, '$1$2[redacted]$3')
    .replace(bearerPattern, '$1[redacted]')
}

export function recordOperationalEvent(
  events: OperationalEvent[],
  event: Omit<OperationalEvent, 'timestamp'> & { timestamp?: number },
  limit = 100,
): OperationalEvent[] {
  const next = [
    ...events,
    {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
      message: event.message ? redactDiagnosticText(event.message) : undefined,
      details: event.details
        ? redactSecrets(event.details) as Record<string, unknown>
        : undefined,
    },
  ]
  return next.slice(-limit)
}

export function buildDiagnosticsBundle(
  input: DiagnosticsBundleInput,
): DiagnosticsBundle {
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    app: input.app,
    runtime: input.runtime,
    paths: redactSecrets(input.paths) as DiagnosticsBundle['paths'],
    config: summarizeConfig(input.config, input.configError),
    release: summarizeReleasePolicy(input.releasePolicy, input.operationalEvents),
    sessions: input.sessions.map(summarizeSession),
    operationalEvents: input.operationalEvents.map(event => ({
      ...event,
      message: event.message ? redactDiagnosticText(event.message) : undefined,
      details: event.details
        ? redactSecrets(event.details) as Record<string, unknown>
        : undefined,
    })),
  }
}

export async function writeDiagnosticsBundle(
  outputPath: string,
  input: DiagnosticsBundleInput,
): Promise<DiagnosticExportResult> {
  await mkdir(dirname(outputPath), { recursive: true })
  const bundle = buildDiagnosticsBundle(input)
  const contents = `${JSON.stringify(bundle, null, 2)}\n`
  await writeFile(outputPath, contents, 'utf8')
  return {
    path: outputPath,
    bytes: Buffer.byteLength(contents, 'utf8'),
    generatedAt: input.generatedAt,
  }
}

function summarizeReleasePolicy(
  releasePolicy: DesktopReleasePolicy | undefined,
  operationalEvents: OperationalEvent[],
): DiagnosticsBundle['release'] {
  return {
    updatePolicy: releasePolicy?.updatePolicy,
    reason: releasePolicy?.reason
      ? redactDiagnosticText(releasePolicy.reason)
      : undefined,
    releaseNotesRequired: releasePolicy?.releaseNotesRequired,
    rollbackRequired: releasePolicy?.rollbackRequired,
    failedUpdateEventCount: operationalEvents
      .filter(event => event.type === 'update-error').length,
  }
}

function summarizeConfig(
  config: ClaudeDesktopConfig | undefined,
  configError: string | undefined,
): DiagnosticsBundle['config'] {
  if (!config) {
    return configError ? { configError: redactDiagnosticText(configError) } : {}
  }
  return {
    claudeHome: config.claudeHome,
    settingsPath: config.settingsPath,
    settingsExists: config.settingsExists,
    localSettingsPath: config.localSettingsPath,
    localSettingsExists: config.localSettingsExists,
    proxyEnabled: config.proxy.enabled,
    proxyUrl: config.proxy.url
      ? redactSecrets(config.proxy.url, 'proxyUrl') as string
      : '',
    mcpServerCount: config.mcpServers.length,
    skillCount: config.skills.length,
    pluginCount: config.plugins.length,
    scheduledTaskCount: config.scheduledTasks.length,
  }
}

function summarizeSession(session: DesktopSession): DiagnosticsBundle['sessions'][number] {
  return {
    id: session.id,
    title: session.title,
    cwd: session.cwd,
    status: session.status,
    activity: session.activity,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastError: session.lastError
      ? redactDiagnosticText(session.lastError)
      : undefined,
    agentType: session.agent?.agentType,
    messageCounts: countBy(session.messages.map(message => message.role)),
    pendingToolUseCount: session.toolUses?.filter(tool => tool.status === 'started').length ?? 0,
    agentTaskCounts: countBy((session.agentTasks ?? []).map(task => task.status)),
    runtimeEventCount: session.runtimeEvents?.length ?? 0,
    sidebarWidth: session.layout.sidebarWidth,
    workspaceRatio: session.layout.workspaceRatio,
    expandedPathCount: session.layout.expandedPaths?.length ?? 0,
    activePane: session.layout.activePane,
    primaryView: session.layout.primaryView,
    activeFile: session.layout.activeFile,
    terminalId: session.layout.terminalId,
    previewUrl: session.layout.previewUrl,
    settingsActiveSection: session.layout.settingsActiveSection,
    tasksActiveSection: session.layout.tasksActiveSection,
    agentsActiveSection: session.layout.agentsActiveSection,
    teamsActiveSection: session.layout.teamsActiveSection,
    selectedAgentType: session.layout.selectedAgentType,
    selectedAgentSource: session.layout.selectedAgentSource,
    selectedAgentTaskId: session.layout.selectedAgentTaskId,
    selectedTeamName: session.layout.selectedTeamName,
    selectedTeamRecipient: session.layout.selectedTeamRecipient,
    selectedGlobalTaskId: session.layout.selectedGlobalTaskId,
    selectedProjectTaskId: session.layout.selectedProjectTaskId,
    selectedMcpName: session.layout.selectedMcpName,
    selectedMcpSourcePath: session.layout.selectedMcpSourcePath,
    selectedMcpScope: session.layout.selectedMcpScope,
    selectedSkillName: session.layout.selectedSkillName,
    selectedSkillPath: session.layout.selectedSkillPath,
    selectedSkillScope: session.layout.selectedSkillScope,
    selectedPluginIdentity: session.layout.selectedPluginIdentity,
  }
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
}
