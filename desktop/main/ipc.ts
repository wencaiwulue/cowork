export const desktopChannels = [
  'app:ready',
  'app:closeWindow',
  'app:setUnsavedChanges',
  'diagnostics:export',
  'sessions:list',
  'sessions:create',
  'sessions:resume',
  'sessions:focus',
  'sessions:close',
  'sessions:rename',
  'sessions:send',
  'sessions:launchAgentTask',
  'sessions:stopAgentTask',
  'sessions:readAgentTaskOutput',
  'sessions:previewAgentTaskOutput',
  'sessions:resumeAgentTask',
  'sessions:cancel',
  'sessions:answerQuestion',
  'sessions:updateLayout',
  'sessions:clearDesktopView',
  'permissions:respond',
  'workspace:tree',
  'workspace:readFile',
  'workspace:saveFile',
  'workspace:openFolder',
  'workspaceTasks:list',
  'workspaceTasks:addOrUpdate',
  'workspaceTasks:remove',
  'workspaceTasks:pause',
  'workspaceTasks:resume',
  'git:status',
  'git:diff',
  'terminal:create',
  'terminal:write',
  'terminal:resize',
  'terminal:kill',
  'preview:setUrl',
  'preview:openExternal',
  'clipboard:writeText',
  'commands:list',
  'config:get',
  'config:updateProxy',
  'mcp:addOrUpdate',
  'mcp:read',
  'mcp:remove',
  'mcp:setEnabled',
  'workspaceMcp:list',
  'workspaceMcp:addOrUpdate',
  'workspaceMcp:read',
  'workspaceMcp:remove',
  'workspaceMcp:setApproval',
  'workspaceMcp:check',
  'tasks:addOrUpdate',
  'tasks:remove',
  'tasks:pause',
  'tasks:resume',
  'skills:installLocal',
  'skills:save',
  'skills:read',
  'skills:remove',
  'workspaceSkills:list',
  'workspaceSkills:installLocal',
  'workspaceSkills:save',
  'workspaceSkills:read',
  'workspaceSkills:remove',
  'plugins:list',
  'plugins:install',
  'plugins:uninstall',
  'plugins:setEnabled',
  'plugins:update',
  'agents:list',
  'agents:get',
  'agents:save',
  'agents:delete',
  'agents:refresh',
  'agents:diagnose',
  'teams:list',
  'teams:members',
  'teams:create',
  'teams:send',
  'teams:shutdown',
  'teams:removeMember',
  'teams:delete',
] as const

export type DesktopChannel = (typeof desktopChannels)[number]

const channelSet = new Set<string>(desktopChannels)

export function assertDesktopChannel(channel: string): DesktopChannel {
  if (!channelSet.has(channel)) {
    throw new Error(`Unknown desktop IPC channel: ${channel}`)
  }
  return channel as DesktopChannel
}

export function validateIpcArgs(
  channel: DesktopChannel,
  args: unknown[],
): unknown[] {
  switch (channel) {
    case 'app:closeWindow':
    case 'diagnostics:export':
    case 'sessions:list':
      return expectArity(channel, args, 0)
    case 'app:setUnsavedChanges': {
      const [hasUnsavedChanges] = expectArity(channel, args, 1)
      return [expectBoolean(channel, 'hasUnsavedChanges', hasUnsavedChanges)]
    }
    case 'sessions:create': {
      expectArity(channel, args, 0, 1)
      if (args[0] === undefined) return args
      if (typeof args[0] === 'string') return args
      return [validateSessionCreateInput(channel, args[0])]
    }
    case 'sessions:resume':
    case 'sessions:focus':
    case 'sessions:close':
    case 'sessions:cancel':
    case 'sessions:clearDesktopView':
      expectArity(channel, args, 1)
      return [expectStringArg(channel, args, 0, 'sessionId')]
    case 'sessions:send': {
      expectArity(channel, args, 2, 3)
      return [
        expectStringArg(channel, args, 0, 'sessionId'),
        expectNonEmptyStringArg(channel, args, 1, 'text'),
        args[2] === undefined ? undefined : args[2],
      ].filter(value => value !== undefined)
    }
    case 'sessions:answerQuestion': {
      expectArity(channel, args, 4)
      return [
        expectStringArg(channel, args, 0, 'sessionId'),
        expectStringArg(channel, args, 1, 'toolUseId'),
        args[2], // answers: Record<string, string>
        args[3], // questions: Array<{question, options}>
      ]
    }
    case 'sessions:launchAgentTask': {
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'sessionId'),
        validateAgentLaunchInput(channel, args[1]),
      ]
    }
    case 'sessions:stopAgentTask': {
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'sessionId'),
        validateAgentTaskStopInput(channel, args[1]),
      ]
    }
    case 'sessions:readAgentTaskOutput': {
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'sessionId'),
        validateAgentTaskOutputInput(channel, args[1]),
      ]
    }
    case 'sessions:previewAgentTaskOutput': {
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'sessionId'),
        validateAgentTaskOutputPreviewInput(channel, args[1]),
      ]
    }
    case 'sessions:resumeAgentTask': {
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'sessionId'),
        validateAgentTaskResumeInput(channel, args[1]),
      ]
    }
    case 'sessions:updateLayout': {
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'sessionId'),
        validateLayoutPatch(channel, args[1]),
      ]
    }
    case 'permissions:respond': {
      expectArity(channel, args, 3)
      return [
        expectStringArg(channel, args, 0, 'sessionId'),
        expectStringArg(channel, args, 1, 'requestId'),
        validatePermissionResponse(channel, args[2]),
      ]
    }
    case 'workspace:tree':
    case 'workspace:openFolder':
    case 'git:status':
    case 'git:diff':
    case 'terminal:create':
    case 'commands:list':
      expectArity(channel, args, 1)
      return [expectStringArg(channel, args, 0, 'cwd')]
    case 'workspaceTasks:list':
      expectArity(channel, args, 1)
      return [expectStringArg(channel, args, 0, 'cwd')]
    case 'workspace:readFile':
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'cwd'),
        validateWorkspaceRelativePath(channel, args[1]),
      ]
    case 'workspace:saveFile':
      expectArity(channel, args, 3)
      return [
        expectStringArg(channel, args, 0, 'cwd'),
        validateWorkspaceRelativePath(channel, args[1]),
        expectStringArg(channel, args, 2, 'contents'),
      ]
    case 'workspaceTasks:addOrUpdate':
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'cwd'),
        validateProjectScheduledTaskInput(channel, args[1]),
      ]
    case 'workspaceTasks:remove':
    case 'workspaceTasks:pause':
    case 'workspaceTasks:resume':
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'cwd'),
        expectNonEmptyStringArg(channel, args, 1, 'taskId'),
      ]
    case 'terminal:write':
      expectArity(channel, args, 2)
      return [
        expectNonEmptyStringArg(channel, args, 0, 'terminalId'),
        expectStringArg(channel, args, 1, 'data'),
      ]
    case 'terminal:resize':
      expectArity(channel, args, 3)
      return [
        expectNonEmptyStringArg(channel, args, 0, 'terminalId'),
        expectInteger(channel, 'columns', args[1], 20, 400),
        expectInteger(channel, 'rows', args[2], 5, 120),
      ]
    case 'terminal:kill':
      expectArity(channel, args, 1)
      return [expectNonEmptyStringArg(channel, args, 0, 'terminalId')]
    case 'preview:setUrl':
    case 'preview:openExternal':
      expectArity(channel, args, 1)
      return [expectHttpUrl(channel, args, 0, 'url')]
    case 'clipboard:writeText':
      expectArity(channel, args, 1)
      return [expectNonEmptyStringArg(channel, args, 0, 'text')]
    case 'config:get':
      return expectArity(channel, args, 0)
    case 'config:updateProxy':
      expectArity(channel, args, 1)
      return [validateProxySettings(channel, args[0])]
    case 'mcp:addOrUpdate':
      expectArity(channel, args, 1)
      return [validateMcpServerInput(channel, args[0])]
    case 'mcp:read':
    case 'mcp:remove':
      expectArity(channel, args, 1)
      return [validateMcpName(channel, args[0])]
    case 'mcp:setEnabled':
      expectArity(channel, args, 2)
      return [
        expectNonEmptyStringArg(channel, args, 0, 'name'),
        expectBoolean(channel, 'enabled', args[1]),
      ]
    case 'workspaceMcp:list':
    case 'workspaceMcp:check':
      expectArity(channel, args, 1)
      return [expectStringArg(channel, args, 0, 'cwd')]
    case 'workspaceMcp:addOrUpdate':
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'cwd'),
        validateMcpServerInput(channel, args[1]),
      ]
    case 'workspaceMcp:read':
    case 'workspaceMcp:remove':
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'cwd'),
        validateMcpName(channel, args[1]),
      ]
    case 'workspaceMcp:setApproval':
      expectArity(channel, args, 3)
      return [
        expectStringArg(channel, args, 0, 'cwd'),
        validateMcpName(channel, args[1]),
        expectBoolean(channel, 'approved', args[2]),
      ]
    case 'tasks:addOrUpdate':
      expectArity(channel, args, 1)
      return [validateScheduledTaskInput(channel, args[0])]
    case 'tasks:remove':
    case 'tasks:pause':
    case 'tasks:resume':
      expectArity(channel, args, 1)
      return [expectNonEmptyStringArg(channel, args, 0, 'taskId')]
    case 'skills:installLocal': {
      expectArity(channel, args, 0, 1)
      if (args[0] !== undefined) assertString(channel, 'sourceDir', args[0])
      return args
    }
    case 'skills:save':
      expectArity(channel, args, 1)
      return [validateSkillSaveInput(channel, args[0])]
    case 'skills:read':
    case 'skills:remove':
      expectArity(channel, args, 1)
      return [validateMcpName(channel, args[0])]
    case 'workspaceSkills:list':
      expectArity(channel, args, 1)
      return [expectStringArg(channel, args, 0, 'cwd')]
    case 'workspaceSkills:installLocal': {
      expectArity(channel, args, 1, 2)
      const cwd = expectStringArg(channel, args, 0, 'cwd')
      if (args[1] !== undefined) assertString(channel, 'sourceDir', args[1])
      return args.length === 1 ? [cwd] : [cwd, args[1]]
    }
    case 'workspaceSkills:save':
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'cwd'),
        validateSkillSaveInput(channel, args[1]),
      ]
    case 'workspaceSkills:read':
    case 'workspaceSkills:remove':
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'cwd'),
        validateMcpName(channel, args[1]),
      ]
    case 'plugins:list':
      expectArity(channel, args, 1)
      return [expectStringArg(channel, args, 0, 'cwd')]
    case 'plugins:install':
    case 'plugins:uninstall':
    case 'plugins:update':
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'cwd'),
        validatePluginInstallInput(channel, args[1]),
      ]
    case 'plugins:setEnabled':
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'cwd'),
        validatePluginSetEnabledInput(channel, args[1]),
      ]
    case 'teams:list':
    case 'agents:list':
    case 'agents:refresh':
      expectArity(channel, args, 1)
      return [expectStringArg(channel, args, 0, 'cwd')]
    case 'teams:members':
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'cwd'),
        expectNonEmptyStringArg(channel, args, 1, 'teamName'),
      ]
    case 'teams:create':
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'sessionId'),
        validateTeamCreateInput(channel, args[1]),
      ]
    case 'teams:send':
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'sessionId'),
        validateTeamMessageInput(channel, args[1]),
      ]
    case 'teams:shutdown':
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'sessionId'),
        validateTeamShutdownInput(channel, args[1]),
      ]
    case 'teams:removeMember':
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'sessionId'),
        validateTeamRemoveMemberInput(channel, args[1]),
      ]
    case 'teams:delete':
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'sessionId'),
        validateTeamDeleteInput(channel, args[1]),
      ]
    case 'agents:get':
      expectArity(channel, args, 2, 3)
      return [
        expectStringArg(channel, args, 0, 'cwd'),
        expectNonEmptyStringArg(channel, args, 1, 'agentType'),
        args[2] === undefined ? undefined : validateAgentSource(channel, args[2]),
      ].filter(value => value !== undefined)
    case 'agents:save':
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'cwd'),
        validateAgentSaveInput(channel, args[1]),
      ]
    case 'agents:delete':
      expectArity(channel, args, 3)
      return [
        expectStringArg(channel, args, 0, 'cwd'),
        expectNonEmptyStringArg(channel, args, 1, 'agentType'),
        validateAgentSource(channel, args[2]),
      ]
    case 'agents:diagnose':
      expectArity(channel, args, 2)
      return [
        expectStringArg(channel, args, 0, 'cwd'),
        expectNonEmptyStringArg(channel, args, 1, 'agentType'),
      ]
    case 'app:ready':
      return expectArity(channel, args, 0)
  }
}

export type RuntimeEvent =
  | { type: 'app-close-request' }
  | { type: 'command-palette' }
  | { type: 'primary-nav'; view: 'chat' | 'agents' | 'teams' | 'tasks' | 'settings' }
  | { type: 'workspace-pane'; pane: 'files' | 'diff' | 'editor' | 'terminal' | 'preview' }
  | { type: 'session-updated'; session: DesktopSession }
  | { type: 'session-focused'; sessionId: string }
  | { type: 'session-closed'; sessionId: string }
  | { type: 'runtime-message'; sessionId: string; message: unknown }
  | { type: 'runtime-error'; sessionId: string; message: string }
  | { type: 'terminal-data'; terminalId: string; data: string }
  | { type: 'terminal-state'; terminal: TerminalSessionInfo }
  | { type: 'terminal-exit'; terminalId: string; code: number | null; signal: string | null }
  | { type: 'preview-url'; url: string }
  | { type: 'desktop-error'; message: string }

export type PermissionResponse =
  | {
      behavior: 'allow'
      updatedInput?: Record<string, unknown>
      updatedPermissions?: unknown[]
      toolUseID?: string
      decisionClassification?: 'user_temporary' | 'user_permanent'
    }
  | {
      behavior: 'deny'
      message: string
      interrupt?: boolean
      toolUseID?: string
      decisionClassification?: 'user_reject'
    }

export type DesktopAttachment = {
  id: string
  mimeType: string
  filename: string
  dataUrl: string
}

export type DesktopQuestionOption = {
  label: string
  description: string
}
export type DesktopQuestion = {
  toolUseId: string
  questions: Array<{
    question: string
    header: string
    options: DesktopQuestionOption[]
    multiSelect: boolean
  }>
}

export type DesktopMessage = {
  id: string
  role: 'user' | 'assistant' | 'thinking' | 'system' | 'tool' | 'tool_output'
  text: string
  timestamp: number
  streaming?: boolean
  raw?: unknown
  attachments?: DesktopAttachment[]
  question?: DesktopQuestion
}

export type AgentSource =
  | 'built-in'
  | 'user'
  | 'project'
  | 'local'
  | 'managed'
  | 'flag'
  | 'plugin'

export type AgentInfo = {
  agentType: string
  source: AgentSource
  whenToUse: string
  editable: boolean
  path?: string
  baseDir?: string
  tools?: string[]
  disallowedTools?: string[]
  skills?: string[]
  requiredMcpServers?: string[]
  model?: string
  permissionMode?: string
  memory?: string
  isolation?: 'worktree' | 'remote'
  background?: boolean
  hasHooks?: boolean
  prompt?: string
}

export type AgentListResult = {
  activeAgents: AgentInfo[]
  allAgents: AgentInfo[]
  failedFiles?: Array<{ path: string; error: string }>
}

export type AgentSaveInput = {
  source: 'user' | 'project'
  agentType: string
  whenToUse: string
  prompt: string
  tools?: string[]
  disallowedTools?: string[]
  skills?: string[]
  requiredMcpServers?: string[]
  model?: string
  permissionMode?: string
  memory?: string
  isolation?: 'worktree' | 'remote'
  background?: boolean
}

export type AgentDiagnostics = {
  agentType: string
  ok: boolean
  configuredMcpServers: string[]
  configuredSkills: string[]
  requiredMcpServers: string[]
  requiredSkills: string[]
  missingMcpServers: string[]
  missingSkills: string[]
  tools?: string[]
  disallowedTools?: string[]
  hasHooks: boolean
  memory?: string
  isolation?: 'worktree' | 'remote'
  readiness: Array<{
    label: string
    ok: boolean
    detail: string
  }>
  warnings: string[]
}

export type AgentSessionConfig = {
  agentType?: string
  model?: string
  permissionMode?: string
  isolation?: 'worktree' | 'remote'
}

export type SessionCreateInput = {
  cwd?: string
  defaultCwd?: boolean
  agent?: AgentSessionConfig
}

export type AgentLaunchInput = {
  agentType: string
  description: string
  prompt: string
  model?: string
  runInBackground?: boolean
  isolation?: 'worktree' | 'remote'
  name?: string
  teamName?: string
  mode?: string
}

export type AgentTaskInfo = {
  id: string
  toolUseId?: string
  agentType?: string
  description?: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  lastToolName?: string
  lastToolInput?: unknown
  outputFile?: string
  error?: string
  result?: string
  outputPreview?: string
  worktreePath?: string
  remoteSessionUrl?: string
  tokenCount?: number
  toolUseCount?: number
  durationMs?: number
  toolTimeline?: AgentTaskToolEvent[]
  raw?: unknown
}

export type AgentTaskToolEvent = {
  id: string
  toolUseId?: string
  toolName: string
  status: 'started' | 'completed' | 'failed'
  timestamp: number
  input?: unknown
  summary?: string
}

export type AgentTaskStopInput = {
  taskId: string
}

export type AgentTaskOutputInput = {
  taskId: string
  block?: boolean
  timeoutMs?: number
}

export type AgentTaskOutputPreviewInput = {
  taskId: string
  maxBytes?: number
}

export type AgentTaskOutputPreviewResult = {
  taskId: string
  path: string
  contents: string
  bytesRead: number
  truncated: boolean
}

export type AgentTaskResumeInput = {
  taskId: string
  prompt: string
}

export type TeamMemberInfo = {
  agentId: string
  name: string
  color?: string
  mode?: string
  status?: string
}

export type TeamInfo = {
  name: string
  description?: string
  backend?: string
  mode?: string
  status?: string
  active?: boolean
  path?: string
  members: TeamMemberInfo[]
}

export type TeamCreateInput = {
  teamName: string
  description?: string
  agentType?: string
}

export type TeamMessageInput = {
  teamName: string
  to: string
  message: string
}

export type TeamShutdownInput = {
  teamName: string
  to: string
  reason?: string
}

export type TeamRemoveMemberInput = {
  teamName: string
  memberName: string
}

export type TeamDeleteInput = {
  teamName: string
}

export type DesktopSession = {
  id: string
  title: string
  cwd: string
  createdAt: number
  updatedAt: number
  status: 'starting' | 'running' | 'stopped' | 'error'
  activity:
    | 'idle'
    | 'starting'
    | 'sending'
    | 'streaming'
    | 'waiting_permission'
    | 'cancelling'
  lastError?: string
  messages: DesktopMessage[]
  agent?: AgentSessionConfig
  toolUses?: AgentTaskToolEvent[]
  agentTasks?: AgentTaskInfo[]
  team?: TeamInfo
  runtimeEvents?: unknown[]
  layout: {
    sidebarWidth: number
    workspaceRatio: number
    activePane:
      | 'files'
      | 'diff'
      | 'editor'
      | 'terminal'
      | 'preview'
      | 'settings'
      | 'tasks'
      | 'teams'
      | 'agents'
      | 'mcp'
      | 'skills'
    primaryView?: 'chat' | 'agents' | 'teams' | 'teammates' | 'tasks' | 'settings' | 'mcp' | 'skills'
    activeFile?: string
    terminalId?: string
    previewUrl?: string
    settingsActiveSection?: string
    tasksActiveSection?: string
    agentsActiveSection?: string
    teamsActiveSection?: string
    mcpActiveSection?: string
    skillsActiveSection?: string
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
    expandedPaths?: string[]
  }
}

export type DesktopSessionLayoutPatch = Partial<DesktopSession['layout']>

export type WorkspaceEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: WorkspaceEntry[]
}

export type TerminalSessionInfo = {
  id: string
  mode: 'pty' | 'shell'
  shell: string
  columns: number
  rows: number
  error?: string
}

export type DiagnosticExportResult = {
  path: string
  bytes: number
  generatedAt: string
}

export type CustomCommandInfo = {
  name: string
  scope: 'user' | 'project'
  kind?: 'workflow'
  path: string
  description?: string
}

export type DesktopProxySettings = {
  enabled: boolean
  url: string
}

export type McpServerInfo = {
  name: string
  type?: string
  command?: string
  args?: string[]
  url?: string
  sourcePath: string
  enabled?: boolean
  approvalStatus?: 'approved' | 'rejected' | 'pending'
  raw?: unknown
}

export type McpHealthResult = {
  ok: boolean
  output: string
  error?: string
}

export type PluginCommandResult = {
  ok: boolean
  output: string
  error?: string
}

export type PluginInstallInput = {
  plugin: string
  scope: 'user' | 'project' | 'local'
}

export type PluginSetEnabledInput = PluginInstallInput & {
  enabled: boolean
}

export type McpServerInput =
  | {
      name: string
      mode: 'stdio'
      command: string
      args?: string[]
    }
  | {
      name: string
      mode: 'remote'
      type: 'streamable-http' | 'sse'
      url?: string
    }

export type ScheduledTaskInfo = {
  id: string
  name?: string
  schedule?: string
  prompt: string
  enabled: boolean
  createdAt?: number
  lastFiredAt?: number
  nextRunAt?: number
  raw?: unknown
}

export type ScheduledTaskInput = {
  id?: string
  name?: string
  schedule?: string
  prompt: string
  enabled: boolean
}

export type ProjectScheduledTaskInfo = {
  id: string
  cron: string
  prompt: string
  createdAt: number
  enabled: boolean
  lastFiredAt?: number
  recurring?: boolean
  permanent?: boolean
  nextRunAt?: number
}

export type ProjectScheduledTaskInput = {
  id?: string
  cron: string
  prompt: string
  recurring: boolean
}

export type InstalledSkillInfo = {
  name: string
  path: string
  description?: string
  contents?: string
}

export type SkillSaveInput = {
  name: string
  contents: string
}

export type ClaudeDesktopConfig = {
  claudeHome: string
  settingsPath: string
  settingsExists: boolean
  settings?: unknown
  localSettingsPath: string
  localSettingsExists: boolean
  localSettings?: unknown
  proxy: DesktopProxySettings
  runtimeCapabilities: {
    remoteIsolation: boolean
    worktreeIsolation: boolean
  }
  mcpServers: McpServerInfo[]
  skills: InstalledSkillInfo[]
  scheduledTasks: ScheduledTaskInfo[]
  plugins: Array<{
    id: string
    scope?: string
    version?: string
    installPath?: string
    installedAt?: string
    enabled?: boolean
  }>
}

function expectArity(
  channel: DesktopChannel,
  args: unknown[],
  min: number,
  max = min,
): unknown[] {
  if (args.length < min || args.length > max) {
    throw new Error(
      `${channel} expected ${min === max ? min : `${min}-${max}`} argument(s), got ${args.length}`,
    )
  }
  return args
}

function expectStringArg(
  channel: DesktopChannel,
  args: unknown[],
  index: number,
  name: string,
): string {
  if (args.length <= index) {
    throw new Error(`${channel} expected at least ${index + 1} argument(s), got ${args.length}`)
  }
  return assertString(channel, name, args[index])
}

function expectNonEmptyStringArg(
  channel: DesktopChannel,
  args: unknown[],
  index: number,
  name: string,
): string {
  const value = expectStringArg(channel, args, index, name)
  if (value.trim().length === 0) {
    throw new Error(`${channel} ${name} must not be empty`)
  }
  return value
}

function assertString(
  channel: DesktopChannel,
  name: string,
  value: unknown,
): string {
  if (typeof value !== 'string') {
    throw new Error(`${channel} ${name} must be a string`)
  }
  return value
}

function assertBoolean(
  channel: DesktopChannel,
  name: string,
  value: unknown,
): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${channel} ${name} must be a boolean`)
  }
  return value
}

function expectInteger(
  channel: DesktopChannel,
  name: string,
  value: unknown,
  min: number,
  max: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`${channel} ${name} must be an integer from ${min} to ${max}`)
  }
  return value
}

function expectHttpUrl(
  channel: DesktopChannel,
  args: unknown[],
  index: number,
  name: string,
): string {
  const value = expectStringArg(channel, args, index, name)
  if (!/^https?:\/\//.test(value)) {
    throw new Error(`${channel} ${name} must start with http:// or https://`)
  }
  return value
}

function validateWorkspaceRelativePath(
  channel: DesktopChannel,
  value: unknown,
): string {
  const path = assertString(channel, 'path', value).trim()
  if (!path) throw new Error(`${channel} path must not be empty`)
  if (/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(path)) {
    throw new Error(`${channel} path must be relative`)
  }
  const segments = path.split(/[\\/]+/).filter(Boolean)
  if (segments.some(segment => segment === '..')) {
    throw new Error(`${channel} path must not contain parent directory segments`)
  }
  return path
}

function validateProxySettings(
  channel: DesktopChannel,
  value: unknown,
): DesktopProxySettings {
  if (!value || typeof value !== 'object') {
    throw new Error(`${channel} proxy must be an object`)
  }
  const proxy = value as Partial<DesktopProxySettings>
  if (typeof proxy.enabled !== 'boolean') {
    throw new Error(`${channel} proxy.enabled must be a boolean`)
  }
  if (typeof proxy.url !== 'string') {
    throw new Error(`${channel} proxy.url must be a string`)
  }
  const url = proxy.url.trim()
  if (
    proxy.enabled &&
    !/^(socks5|socks4|http|https):\/\//.test(url)
  ) {
    throw new Error(
      `${channel} proxy.url must start with socks5://, socks4://, http://, or https://`,
    )
  }
  return { enabled: proxy.enabled, url }
}

function validateMcpName(channel: DesktopChannel, value: unknown): string {
  const name = assertString(channel, 'name', value).trim()
  if (!name) throw new Error(`${channel} name must not be empty`)
  if (/[\/\\]/.test(name)) throw new Error(`${channel} name must not contain path separators`)
  return name
}

function validateSkillSaveInput(
  channel: DesktopChannel,
  value: unknown,
): SkillSaveInput {
  if (!isRecord(value)) {
    throw new Error(`${channel} skill must be an object`)
  }
  const name = validateMcpName(channel, value.name)
  const contents = assertString(channel, 'contents', value.contents)
  if (!contents.trim()) throw new Error(`${channel} contents must not be empty`)
  return { name, contents }
}

function validateTeamName(channel: DesktopChannel, value: unknown): string {
  const teamName = assertString(channel, 'teamName', value).trim()
  if (!teamName) throw new Error(`${channel} teamName must not be empty`)
  if (/[\/\\]/.test(teamName)) {
    throw new Error(`${channel} teamName must not contain path separators`)
  }
  return teamName
}

function validateTeamMemberName(channel: DesktopChannel, value: unknown): string {
  const memberName = assertString(channel, 'memberName', value).trim()
  if (!memberName) throw new Error(`${channel} memberName must not be empty`)
  if (/[\/\\]/.test(memberName)) {
    throw new Error(`${channel} memberName must not contain path separators`)
  }
  return memberName
}

function validateMcpServerInput(
  channel: DesktopChannel,
  value: unknown,
): McpServerInput {
  if (!isRecord(value)) {
    throw new Error(`${channel} server must be an object`)
  }
  const name = validateMcpName(channel, value.name)
  if (value.mode === 'stdio') {
    const command = assertString(channel, 'command', value.command).trim()
    if (!command) throw new Error(`${channel} command must not be empty`)
    if (
      value.args !== undefined &&
      (!Array.isArray(value.args) || !value.args.every(item => typeof item === 'string'))
    ) {
      throw new Error(`${channel} args must be a string array`)
    }
    return {
      name,
      mode: 'stdio',
      command,
      args: Array.isArray(value.args) ? value.args : [],
    }
  }
  if (value.mode === 'remote') {
    if (value.type !== 'streamable-http' && value.type !== 'sse') {
      throw new Error(`${channel} type must be streamable-http or sse`)
    }
    const url =
      value.url === undefined ? undefined : assertString(channel, 'url', value.url).trim()
    if (url && !/^https?:\/\//.test(url)) {
      throw new Error(`${channel} url must start with http:// or https://`)
    }
    return {
      name,
      mode: 'remote',
      type: value.type,
      url,
    }
  }
  throw new Error(`${channel} mode must be stdio or remote`)
}

function validateScheduledTaskInput(
  channel: DesktopChannel,
  value: unknown,
): ScheduledTaskInput {
  if (!isRecord(value)) {
    throw new Error(`${channel} task must be an object`)
  }
  const id =
    value.id === undefined ? undefined : assertString(channel, 'id', value.id).trim()
  if (id !== undefined && !id) throw new Error(`${channel} id must not be empty`)
  const prompt = assertString(channel, 'prompt', value.prompt).trim()
  if (!prompt) throw new Error(`${channel} prompt must not be empty`)
  if (typeof value.enabled !== 'boolean') {
    throw new Error(`${channel} enabled must be a boolean`)
  }
  const name =
    value.name === undefined ? undefined : assertString(channel, 'name', value.name).trim()
  const schedule =
    value.schedule === undefined
      ? undefined
      : assertString(channel, 'schedule', value.schedule).trim()
  return {
    id,
    name,
    schedule,
    prompt,
    enabled: value.enabled,
  }
}

function validateProjectScheduledTaskInput(
  channel: DesktopChannel,
  value: unknown,
): ProjectScheduledTaskInput {
  if (!isRecord(value)) {
    throw new Error(`${channel} task must be an object`)
  }
  const id =
    value.id === undefined ? undefined : assertString(channel, 'id', value.id).trim()
  if (id !== undefined && !id) throw new Error(`${channel} id must not be empty`)
  const cron = assertString(channel, 'cron', value.cron).trim()
  if (!isValidCronExpression(cron)) {
    throw new Error(`${channel} cron must be a valid 5-field cron expression`)
  }
  const prompt = assertString(channel, 'prompt', value.prompt).trim()
  if (!prompt) throw new Error(`${channel} prompt must not be empty`)
  if (typeof value.recurring !== 'boolean') {
    throw new Error(`${channel} recurring must be a boolean`)
  }
  return { id, cron, prompt, recurring: value.recurring }
}

function validatePluginInstallInput(
  channel: DesktopChannel,
  value: unknown,
): PluginInstallInput {
  return validatePluginTargetInput(channel, value)
}

function validatePluginSetEnabledInput(
  channel: DesktopChannel,
  value: unknown,
): PluginSetEnabledInput {
  const input = validatePluginTargetInput(channel, value)
  return {
    ...input,
    enabled: expectBoolean(channel, 'enabled', (value as Record<string, unknown>).enabled),
  }
}

function validatePluginTargetInput(
  channel: DesktopChannel,
  value: unknown,
): PluginInstallInput {
  if (!isRecord(value)) {
    throw new Error(`${channel} plugin install input must be an object`)
  }
  const plugin = assertString(channel, 'plugin', value.plugin).trim()
  if (!plugin) throw new Error(`${channel} plugin must not be empty`)
  if (plugin.startsWith('-')) {
    throw new Error(`${channel} plugin must not start with a dash`)
  }
  if (/[\s;\u0000-\u001F\u007F]/.test(plugin)) {
    throw new Error(`${channel} plugin contains invalid characters`)
  }
  if (value.scope !== 'user' && value.scope !== 'project' && value.scope !== 'local') {
    throw new Error(`${channel} scope must be user, project, or local`)
  }
  return { plugin, scope: value.scope }
}

function validateSessionCreateInput(
  channel: DesktopChannel,
  value: unknown,
): SessionCreateInput {
  if (!isRecord(value)) {
    throw new Error(`${channel} input must be an object`)
  }
  const cwd =
    value.cwd === undefined ? undefined : assertString(channel, 'cwd', value.cwd)
  const defaultCwd =
    value.defaultCwd === undefined ? undefined : assertBoolean(channel, 'defaultCwd', value.defaultCwd)
  const agent =
    value.agent === undefined
      ? undefined
      : validateAgentSessionConfig(channel, value.agent)
  return { cwd, defaultCwd, agent }
}

function validateAgentSessionConfig(
  channel: DesktopChannel,
  value: unknown,
): AgentSessionConfig {
  if (!isRecord(value)) {
    throw new Error(`${channel} agent must be an object`)
  }
  return {
    agentType:
      value.agentType === undefined
        ? undefined
        : expectTrimmedString(channel, 'agentType', value.agentType),
    model:
      value.model === undefined
        ? undefined
        : expectTrimmedString(channel, 'model', value.model),
    permissionMode:
      value.permissionMode === undefined
        ? undefined
        : expectTrimmedString(channel, 'permissionMode', value.permissionMode),
    isolation:
      value.isolation === undefined
        ? undefined
        : validateIsolation(channel, value.isolation),
  }
}

function validateAgentLaunchInput(
  channel: DesktopChannel,
  value: unknown,
): AgentLaunchInput {
  if (!isRecord(value)) {
    throw new Error(`${channel} input must be an object`)
  }
  const description = expectTrimmedString(channel, 'description', value.description)
  const prompt = expectTrimmedString(channel, 'prompt', value.prompt)
  return {
    description,
    prompt,
    agentType: expectTrimmedString(channel, 'agentType', value.agentType),
    model:
      value.model === undefined
        ? undefined
        : expectTrimmedString(channel, 'model', value.model),
    runInBackground:
      value.runInBackground === undefined
        ? undefined
        : expectBoolean(channel, 'runInBackground', value.runInBackground),
    isolation:
      value.isolation === undefined
        ? undefined
        : validateIsolation(channel, value.isolation),
    name:
      value.name === undefined
        ? undefined
        : expectTrimmedString(channel, 'name', value.name),
    teamName:
      value.teamName === undefined
        ? undefined
        : expectTrimmedString(channel, 'teamName', value.teamName),
    mode:
      value.mode === undefined
        ? undefined
        : expectTrimmedString(channel, 'mode', value.mode),
  }
}

function validateAgentTaskStopInput(
  channel: DesktopChannel,
  value: unknown,
): AgentTaskStopInput {
  if (!isRecord(value)) {
    throw new Error(`${channel} input must be an object`)
  }
  return {
    taskId: expectTrimmedString(channel, 'taskId', value.taskId),
  }
}

function validateAgentTaskOutputInput(
  channel: DesktopChannel,
  value: unknown,
): AgentTaskOutputInput {
  if (!isRecord(value)) {
    throw new Error(`${channel} input must be an object`)
  }
  return {
    taskId: expectTrimmedString(channel, 'taskId', value.taskId),
    block:
      value.block === undefined
        ? undefined
        : expectBoolean(channel, 'block', value.block),
    timeoutMs:
      value.timeoutMs === undefined
        ? undefined
        : expectInteger(channel, 'timeoutMs', value.timeoutMs, 0, 600_000),
  }
}

function validateAgentTaskOutputPreviewInput(
  channel: DesktopChannel,
  value: unknown,
): AgentTaskOutputPreviewInput {
  if (!isRecord(value)) {
    throw new Error(`${channel} input must be an object`)
  }
  return {
    taskId: expectTrimmedString(channel, 'taskId', value.taskId),
    maxBytes:
      value.maxBytes === undefined
        ? undefined
        : expectInteger(channel, 'maxBytes', value.maxBytes, 1024, 262_144),
  }
}

function validateAgentTaskResumeInput(
  channel: DesktopChannel,
  value: unknown,
): AgentTaskResumeInput {
  if (!isRecord(value)) {
    throw new Error(`${channel} input must be an object`)
  }
  return {
    taskId: expectTrimmedString(channel, 'taskId', value.taskId),
    prompt: expectTrimmedString(channel, 'prompt', value.prompt),
  }
}

function validateAgentSaveInput(
  channel: DesktopChannel,
  value: unknown,
): AgentSaveInput {
  if (!isRecord(value)) {
    throw new Error(`${channel} agent must be an object`)
  }
  const source = validateAgentSource(channel, value.source)
  if (source !== 'user' && source !== 'project') {
    throw new Error(`${channel} source must be user or project`)
  }
  return {
    source,
    agentType: expectTrimmedString(channel, 'agentType', value.agentType),
    whenToUse: expectTrimmedString(channel, 'whenToUse', value.whenToUse),
    prompt: expectTrimmedString(channel, 'prompt', value.prompt),
    tools: validateOptionalStringList(channel, 'tools', value.tools),
    disallowedTools: validateOptionalStringList(
      channel,
      'disallowedTools',
      value.disallowedTools,
    ),
    skills: validateOptionalStringList(channel, 'skills', value.skills),
    requiredMcpServers: validateOptionalStringList(
      channel,
      'requiredMcpServers',
      value.requiredMcpServers,
    ),
    model:
      value.model === undefined
        ? undefined
        : expectTrimmedString(channel, 'model', value.model),
    permissionMode:
      value.permissionMode === undefined
        ? undefined
        : expectTrimmedString(channel, 'permissionMode', value.permissionMode),
    memory:
      value.memory === undefined
        ? undefined
        : expectTrimmedString(channel, 'memory', value.memory),
    isolation:
      value.isolation === undefined
        ? undefined
        : validateIsolation(channel, value.isolation),
    background:
      value.background === undefined
        ? undefined
        : expectBoolean(channel, 'background', value.background),
  }
}

function validateTeamCreateInput(
  channel: DesktopChannel,
  value: unknown,
): TeamCreateInput {
  if (!isRecord(value)) {
    throw new Error(`${channel} team must be an object`)
  }
  return {
    teamName: validateTeamName(channel, value.teamName),
    description:
      value.description === undefined
        ? undefined
        : expectTrimmedString(channel, 'description', value.description),
    agentType:
      value.agentType === undefined
        ? undefined
        : expectTrimmedString(channel, 'agentType', value.agentType),
  }
}

function validateTeamMessageInput(
  channel: DesktopChannel,
  value: unknown,
): TeamMessageInput {
  if (!isRecord(value)) {
    throw new Error(`${channel} message input must be an object`)
  }
  return {
    teamName: validateTeamName(channel, value.teamName),
    to: expectTrimmedString(channel, 'to', value.to),
    message: expectTrimmedString(channel, 'message', value.message),
  }
}

function validateTeamShutdownInput(
  channel: DesktopChannel,
  value: unknown,
): TeamShutdownInput {
  if (!isRecord(value)) {
    throw new Error(`${channel} shutdown input must be an object`)
  }
  return {
    teamName: validateTeamName(channel, value.teamName),
    to: expectTrimmedString(channel, 'to', value.to),
    reason:
      value.reason === undefined
        ? undefined
        : expectTrimmedString(channel, 'reason', value.reason),
  }
}

function validateTeamRemoveMemberInput(
  channel: DesktopChannel,
  value: unknown,
): TeamRemoveMemberInput {
  if (!isRecord(value)) {
    throw new Error(`${channel} remove member input must be an object`)
  }
  return {
    teamName: validateTeamName(channel, value.teamName),
    memberName: validateTeamMemberName(channel, value.memberName),
  }
}

function validateTeamDeleteInput(
  channel: DesktopChannel,
  value: unknown,
): TeamDeleteInput {
  if (!isRecord(value)) {
    throw new Error(`${channel} delete input must be an object`)
  }
  return {
    teamName: validateTeamName(channel, value.teamName),
  }
}

function validateAgentSource(
  channel: DesktopChannel,
  value: unknown,
): AgentSource {
  if (
    value !== 'built-in' &&
    value !== 'user' &&
    value !== 'project' &&
    value !== 'local' &&
    value !== 'managed' &&
    value !== 'flag' &&
    value !== 'plugin'
  ) {
    throw new Error(`${channel} source is invalid`)
  }
  return value
}

function validateIsolation(
  channel: DesktopChannel,
  value: unknown,
): 'worktree' | 'remote' {
  if (value !== 'worktree' && value !== 'remote') {
    throw new Error(`${channel} isolation must be worktree or remote`)
  }
  return value
}

function validateOptionalStringList(
  channel: DesktopChannel,
  name: string,
  value: unknown,
): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error(`${channel} ${name} must be a string array`)
  }
  return value.map(item => item.trim()).filter(Boolean)
}

function expectTrimmedString(
  channel: DesktopChannel,
  name: string,
  value: unknown,
): string {
  const text = assertString(channel, name, value).trim()
  if (!text) throw new Error(`${channel} ${name} must not be empty`)
  return text
}

function expectBoolean(
  channel: DesktopChannel,
  name: string,
  value: unknown,
): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${channel} ${name} must be a boolean`)
  }
  return value
}

function isValidCronExpression(expression: string): boolean {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const ranges = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ] as const
  return parts.every((part, index) =>
    part.split(',').every(item => isValidCronPart(item, ranges[index][0], ranges[index][1])),
  )
}

function isValidCronPart(part: string, min: number, max: number): boolean {
  const star = part.match(/^\*(?:\/(\d+))?$/)
  if (star) return !star[1] || Number.parseInt(star[1], 10) > 0
  const range = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/)
  if (range) {
    const start = Number.parseInt(range[1]!, 10)
    const end = Number.parseInt(range[2]!, 10)
    const step = range[3] ? Number.parseInt(range[3], 10) : 1
    return start >= min && end <= max && start <= end && step > 0
  }
  if (/^\d+$/.test(part)) {
    const value = Number.parseInt(part, 10)
    return value >= min && value <= max
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateLayoutPatch(
  channel: DesktopChannel,
  value: unknown,
): DesktopSessionLayoutPatch {
  if (!isRecord(value)) {
    throw new Error(`${channel} patch must be an object`)
  }
  const allowedPanes = new Set([
    'files',
    'diff',
    'editor',
    'terminal',
    'preview',
    'settings',
    'tasks',
    'teams',
    'agents',
    'mcp',
    'skills',
  ])
  const allowedPrimaryViews = new Set(['chat', 'agents', 'teams', 'teammates', 'tasks', 'settings', 'mcp', 'skills'])
  const allowedAgentSources = new Set(['built-in', 'user', 'project', 'local', 'managed', 'flag', 'plugin'])
  const allowedMcpScopes = new Set(['user', 'project'])
  const allowedSkillScopes = new Set(['user', 'project'])
  const patch: DesktopSessionLayoutPatch = {}
  if ('sidebarWidth' in value) {
    patch.sidebarWidth = expectInteger(
      channel,
      'sidebarWidth',
      value.sidebarWidth,
      220,
      420,
    )
  }
  if ('workspaceRatio' in value) {
    if (typeof value.workspaceRatio !== 'number') {
      throw new Error(`${channel} workspaceRatio must be a number`)
    }
    patch.workspaceRatio = value.workspaceRatio
  }
  if ('activePane' in value) {
    if (typeof value.activePane !== 'string' || !allowedPanes.has(value.activePane)) {
      throw new Error(`${channel} activePane is invalid`)
    }
    patch.activePane = value.activePane as DesktopSessionLayoutPatch['activePane']
  }
  if ('primaryView' in value) {
    if (
      typeof value.primaryView !== 'string' ||
      !allowedPrimaryViews.has(value.primaryView)
    ) {
      throw new Error(`${channel} primaryView is invalid`)
    }
    patch.primaryView = (value.primaryView === 'teammates'
      ? 'teams'
      : value.primaryView) as DesktopSessionLayoutPatch['primaryView']
  }
  if (patch.activePane === 'agents' && patch.primaryView === 'teams') {
    patch.activePane = 'teams'
  }
  if (patch.primaryView === 'mcp' || patch.primaryView === 'skills') {
    patch.activePane = patch.primaryView
  }
  for (const optionalString of ['activeFile', 'terminalId', 'previewUrl', 'settingsActiveSection', 'tasksActiveSection', 'agentsActiveSection', 'teamsActiveSection', 'mcpActiveSection', 'skillsActiveSection', 'selectedAgentType', 'selectedAgentTaskId', 'selectedTeamName', 'selectedTeamRecipient', 'selectedGlobalTaskId', 'selectedProjectTaskId', 'selectedMcpName', 'selectedMcpSourcePath', 'selectedSkillName', 'selectedSkillPath', 'selectedPluginIdentity'] as const) {
    if (optionalString in value) {
      const nextValue = value[optionalString]
      patch[optionalString] = nextValue === undefined
        ? undefined
        : assertString(channel, optionalString, nextValue)
    }
  }
  if ('selectedAgentSource' in value) {
    const nextValue = value.selectedAgentSource
    if (nextValue === undefined) {
      patch.selectedAgentSource = undefined
    } else if (typeof nextValue === 'string' && allowedAgentSources.has(nextValue)) {
      patch.selectedAgentSource = nextValue as AgentSource
    } else {
      throw new Error(`${channel} selectedAgentSource is invalid`)
    }
  }
  if ('selectedMcpScope' in value) {
    const nextValue = value.selectedMcpScope
    if (nextValue === undefined) {
      patch.selectedMcpScope = undefined
    } else if (typeof nextValue === 'string' && allowedMcpScopes.has(nextValue)) {
      patch.selectedMcpScope = nextValue as DesktopSessionLayoutPatch['selectedMcpScope']
    } else {
      throw new Error(`${channel} selectedMcpScope is invalid`)
    }
  }
  if ('selectedSkillScope' in value) {
    const nextValue = value.selectedSkillScope
    if (nextValue === undefined) {
      patch.selectedSkillScope = undefined
    } else if (typeof nextValue === 'string' && allowedSkillScopes.has(nextValue)) {
      patch.selectedSkillScope = nextValue as DesktopSessionLayoutPatch['selectedSkillScope']
    } else {
      throw new Error(`${channel} selectedSkillScope is invalid`)
    }
  }
  if ('expandedPaths' in value) {
    if (
      !Array.isArray(value.expandedPaths) ||
      !value.expandedPaths.every(item => typeof item === 'string')
    ) {
      throw new Error(`${channel} expandedPaths must be a string array`)
    }
    patch.expandedPaths = value.expandedPaths
  }
  return patch
}

function validatePermissionResponse(
  channel: DesktopChannel,
  value: unknown,
): PermissionResponse {
  if (!isRecord(value)) {
    throw new Error(`${channel} response must be an object`)
  }
  if (value.behavior === 'allow') {
    if (value.updatedInput !== undefined && !isRecord(value.updatedInput)) {
      throw new Error(`${channel} updatedInput must be an object`)
    }
    const updatedInput =
      value.updatedInput === undefined
        ? undefined
        : (value.updatedInput as Record<string, unknown>)
    const toolUseID =
      value.toolUseID === undefined
        ? undefined
        : assertString(channel, 'toolUseID', value.toolUseID)
    const decisionClassification =
      value.decisionClassification === 'user_temporary' ||
      value.decisionClassification === 'user_permanent'
        ? value.decisionClassification
        : undefined
    return {
      behavior: 'allow',
      updatedInput,
      updatedPermissions: Array.isArray(value.updatedPermissions)
        ? value.updatedPermissions
        : undefined,
      toolUseID,
      decisionClassification,
    }
  }
  if (value.behavior === 'deny') {
    const toolUseID =
      value.toolUseID === undefined
        ? undefined
        : assertString(channel, 'toolUseID', value.toolUseID)
    const decisionClassification =
      value.decisionClassification === 'user_reject'
        ? value.decisionClassification
        : undefined
    return {
      behavior: 'deny',
      message: assertString(channel, 'message', value.message),
      interrupt:
        typeof value.interrupt === 'boolean' ? value.interrupt : undefined,
      toolUseID,
      decisionClassification,
    }
  }
  throw new Error(`${channel} behavior must be allow or deny`)
}
