import { contextBridge, ipcRenderer } from 'electron'
import type {
  ClaudeDesktopConfig,
  AgentDiagnostics,
  AgentInfo,
  AgentLaunchInput,
  AgentListResult,
  AgentSaveInput,
  AgentSource,
  CustomCommandInfo,
  AgentTaskOutputInput,
  AgentTaskOutputPreviewInput,
  AgentTaskOutputPreviewResult,
  AgentTaskResumeInput,
  AgentTaskStopInput,
  DesktopProxySettings,
  DiagnosticExportResult,
  SessionCreateInput,
  DesktopSession,
  InstalledSkillInfo,
  McpHealthResult,
  McpServerInput,
  McpServerInfo,
  PermissionResponse,
  PluginCommandResult,
  PluginInstallInput,
  PluginSetEnabledInput,
  ProjectScheduledTaskInfo,
  ProjectScheduledTaskInput,
  RuntimeEvent,
  ScheduledTaskInfo,
  ScheduledTaskInput,
  SkillSaveInput,
  TeamCreateInput,
  TeamDeleteInput,
  TeamInfo,
  TeamMemberInfo,
  TeamMessageInput,
  TeamRemoveMemberInput,
  TeamShutdownInput,
  TerminalSessionInfo,
  WorkspaceEntry,
  MigrationSource,
  MigrationSourceInfo,
  MigrationResult,
} from '../main/ipc'

const api = {
  app: {
    closeWindow: () =>
      ipcRenderer.invoke('app:closeWindow') as Promise<void>,
    setUnsavedChanges: (hasUnsavedChanges: boolean) =>
      ipcRenderer.invoke('app:setUnsavedChanges', hasUnsavedChanges) as Promise<void>,
    exportDiagnostics: () =>
      ipcRenderer.invoke('diagnostics:export') as Promise<DiagnosticExportResult | undefined>,
  },
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list') as Promise<DesktopSession[]>,
    create: (input?: string | SessionCreateInput) =>
      ipcRenderer.invoke('sessions:create', input) as Promise<
        DesktopSession | undefined
      >,
    resume: (sessionId: string) =>
      ipcRenderer.invoke('sessions:resume', sessionId) as Promise<DesktopSession>,
    focus: (sessionId: string) =>
      ipcRenderer.invoke('sessions:focus', sessionId) as Promise<void>,
    close: (sessionId: string) =>
      ipcRenderer.invoke('sessions:close', sessionId) as Promise<void>,
    rename: (sessionId: string, title: string) =>
      ipcRenderer.invoke('sessions:rename', sessionId, title) as Promise<DesktopSession>,
    send: (sessionId: string, text: string, attachments?: Array<{ id: string; mimeType: string; filename: string; dataUrl: string }>) =>
      ipcRenderer.invoke('sessions:send', sessionId, text, attachments) as Promise<void>,
    launchAgentTask: (sessionId: string, input: AgentLaunchInput) =>
      ipcRenderer.invoke(
        'sessions:launchAgentTask',
        sessionId,
        input,
      ) as Promise<void>,
    stopAgentTask: (sessionId: string, input: AgentTaskStopInput) =>
      ipcRenderer.invoke(
        'sessions:stopAgentTask',
        sessionId,
        input,
      ) as Promise<void>,
    readAgentTaskOutput: (sessionId: string, input: AgentTaskOutputInput) =>
      ipcRenderer.invoke(
        'sessions:readAgentTaskOutput',
        sessionId,
        input,
      ) as Promise<void>,
    previewAgentTaskOutput: (
      sessionId: string,
      input: AgentTaskOutputPreviewInput,
    ) =>
      ipcRenderer.invoke(
        'sessions:previewAgentTaskOutput',
        sessionId,
        input,
      ) as Promise<AgentTaskOutputPreviewResult>,
    resumeAgentTask: (sessionId: string, input: AgentTaskResumeInput) =>
      ipcRenderer.invoke(
        'sessions:resumeAgentTask',
        sessionId,
        input,
      ) as Promise<void>,
    cancel: (sessionId: string) =>
      ipcRenderer.invoke('sessions:cancel', sessionId) as Promise<void>,
    answerQuestion: (
      sessionId: string,
      toolUseId: string,
      answers: Record<string, string>,
      questions: Array<{question: string; options: Array<{label: string; description: string}>}>,
    ) =>
      ipcRenderer.invoke('sessions:answerQuestion', sessionId, toolUseId, answers, questions) as Promise<void>,
    clearDesktopView: (sessionId: string) =>
      ipcRenderer.invoke('sessions:clearDesktopView', sessionId) as Promise<DesktopSession>,
    updateLayout: (sessionId: string, patch: Partial<DesktopSession['layout']>) =>
      ipcRenderer.invoke(
        'sessions:updateLayout',
        sessionId,
        patch,
      ) as Promise<DesktopSession>,
  },
  permissions: {
    respond: (
      sessionId: string,
      requestId: string,
      response: PermissionResponse,
    ) =>
      ipcRenderer.invoke(
        'permissions:respond',
        sessionId,
        requestId,
        response,
      ) as Promise<void>,
  },
  workspace: {
    tree: (cwd: string) =>
      ipcRenderer.invoke('workspace:tree', cwd) as Promise<WorkspaceEntry[]>,
    readFile: (cwd: string, path: string) =>
      ipcRenderer.invoke('workspace:readFile', cwd, path) as Promise<string>,
    saveFile: (cwd: string, path: string, contents: string) =>
      ipcRenderer.invoke(
        'workspace:saveFile',
        cwd,
        path,
        contents,
      ) as Promise<void>,
    openFolder: (cwd: string) =>
      ipcRenderer.invoke('workspace:openFolder', cwd) as Promise<void>,
  },
  workspaceTasks: {
    list: (cwd: string) =>
      ipcRenderer.invoke('workspaceTasks:list', cwd) as Promise<ProjectScheduledTaskInfo[]>,
    addOrUpdate: (cwd: string, task: ProjectScheduledTaskInput) =>
      ipcRenderer.invoke(
        'workspaceTasks:addOrUpdate',
        cwd,
        task,
      ) as Promise<ProjectScheduledTaskInfo[]>,
    remove: (cwd: string, taskId: string) =>
      ipcRenderer.invoke(
        'workspaceTasks:remove',
        cwd,
        taskId,
      ) as Promise<ProjectScheduledTaskInfo[]>,
    pause: (cwd: string, taskId: string) =>
      ipcRenderer.invoke(
        'workspaceTasks:pause',
        cwd,
        taskId,
      ) as Promise<ProjectScheduledTaskInfo[]>,
    resume: (cwd: string, taskId: string) =>
      ipcRenderer.invoke(
        'workspaceTasks:resume',
        cwd,
        taskId,
      ) as Promise<ProjectScheduledTaskInfo[]>,
  },
  git: {
    status: (cwd: string) =>
      ipcRenderer.invoke('git:status', cwd) as Promise<string>,
    diff: (cwd: string) => ipcRenderer.invoke('git:diff', cwd) as Promise<string>,
  },
  terminal: {
    create: (cwd: string) =>
      ipcRenderer.invoke('terminal:create', cwd) as Promise<TerminalSessionInfo>,
    write: (terminalId: string, data: string) =>
      ipcRenderer.invoke('terminal:write', terminalId, data) as Promise<void>,
    resize: (terminalId: string, columns: number, rows: number) =>
      ipcRenderer.invoke(
        'terminal:resize',
        terminalId,
        columns,
        rows,
      ) as Promise<void>,
    kill: (terminalId: string) =>
      ipcRenderer.invoke('terminal:kill', terminalId) as Promise<void>,
  },
  preview: {
    setUrl: (url: string) =>
      ipcRenderer.invoke('preview:setUrl', url) as Promise<void>,
    openExternal: (url: string) =>
      ipcRenderer.invoke('preview:openExternal', url) as Promise<void>,
  },
  clipboard: {
    writeText: (text: string) =>
      ipcRenderer.invoke('clipboard:writeText', text) as Promise<void>,
  },
  commands: {
    list: (cwd: string) =>
      ipcRenderer.invoke('commands:list', cwd) as Promise<CustomCommandInfo[]>,
  },
  config: {
    get: () =>
      ipcRenderer.invoke('config:get') as Promise<ClaudeDesktopConfig>,
    updateProxy: (proxy: DesktopProxySettings) =>
      ipcRenderer.invoke(
        'config:updateProxy',
        proxy,
      ) as Promise<DesktopProxySettings>,
  },
  mcp: {
    addOrUpdate: (server: McpServerInput) =>
      ipcRenderer.invoke('mcp:addOrUpdate', server) as Promise<McpServerInfo[]>,
    read: (name: string) =>
      ipcRenderer.invoke('mcp:read', name) as Promise<McpServerInfo>,
    remove: (name: string) =>
      ipcRenderer.invoke('mcp:remove', name) as Promise<McpServerInfo[]>,
    setEnabled: (name: string, enabled: boolean) =>
      ipcRenderer.invoke('mcp:setEnabled', name, enabled) as Promise<McpServerInfo[]>,
  },
  workspaceMcp: {
    list: (cwd: string) =>
      ipcRenderer.invoke('workspaceMcp:list', cwd) as Promise<McpServerInfo[]>,
    addOrUpdate: (cwd: string, server: McpServerInput) =>
      ipcRenderer.invoke(
        'workspaceMcp:addOrUpdate',
        cwd,
        server,
      ) as Promise<McpServerInfo[]>,
    read: (cwd: string, name: string) =>
      ipcRenderer.invoke(
        'workspaceMcp:read',
        cwd,
        name,
      ) as Promise<McpServerInfo>,
    remove: (cwd: string, name: string) =>
      ipcRenderer.invoke('workspaceMcp:remove', cwd, name) as Promise<McpServerInfo[]>,
    setApproval: (cwd: string, name: string, approved: boolean) =>
      ipcRenderer.invoke(
        'workspaceMcp:setApproval',
        cwd,
        name,
        approved,
      ) as Promise<McpServerInfo[]>,
    check: (cwd: string) =>
      ipcRenderer.invoke('workspaceMcp:check', cwd) as Promise<McpHealthResult>,
  },
  tasks: {
    addOrUpdate: (task: ScheduledTaskInput) =>
      ipcRenderer.invoke('tasks:addOrUpdate', task) as Promise<ScheduledTaskInfo[]>,
    remove: (taskId: string) =>
      ipcRenderer.invoke('tasks:remove', taskId) as Promise<ScheduledTaskInfo[]>,
    pause: (taskId: string) =>
      ipcRenderer.invoke('tasks:pause', taskId) as Promise<ScheduledTaskInfo[]>,
    resume: (taskId: string) =>
      ipcRenderer.invoke('tasks:resume', taskId) as Promise<ScheduledTaskInfo[]>,
  },
  skills: {
    installLocal: (sourceDir?: string) =>
      ipcRenderer.invoke('skills:installLocal', sourceDir) as Promise<
        InstalledSkillInfo | undefined
      >,
    save: (input: SkillSaveInput) =>
      ipcRenderer.invoke('skills:save', input) as Promise<InstalledSkillInfo>,
    remove: (name: string) =>
      ipcRenderer.invoke('skills:remove', name) as Promise<InstalledSkillInfo[]>,
    read: (name: string) =>
      ipcRenderer.invoke('skills:read', name) as Promise<InstalledSkillInfo>,
  },
  workspaceSkills: {
    list: (cwd: string) =>
      ipcRenderer.invoke('workspaceSkills:list', cwd) as Promise<InstalledSkillInfo[]>,
    installLocal: (cwd: string, sourceDir?: string) =>
      ipcRenderer.invoke('workspaceSkills:installLocal', cwd, sourceDir) as Promise<
        InstalledSkillInfo | undefined
      >,
    save: (cwd: string, input: SkillSaveInput) =>
      ipcRenderer.invoke('workspaceSkills:save', cwd, input) as Promise<InstalledSkillInfo>,
    remove: (cwd: string, name: string) =>
      ipcRenderer.invoke(
        'workspaceSkills:remove',
        cwd,
        name,
      ) as Promise<InstalledSkillInfo[]>,
    read: (cwd: string, name: string) =>
      ipcRenderer.invoke(
        'workspaceSkills:read',
        cwd,
        name,
      ) as Promise<InstalledSkillInfo>,
  },
  plugins: {
    list: (cwd: string) =>
      ipcRenderer.invoke('plugins:list', cwd) as Promise<PluginCommandResult>,
    install: (cwd: string, input: PluginInstallInput) =>
      ipcRenderer.invoke('plugins:install', cwd, input) as Promise<PluginCommandResult>,
    uninstall: (cwd: string, input: PluginInstallInput) =>
      ipcRenderer.invoke('plugins:uninstall', cwd, input) as Promise<PluginCommandResult>,
    setEnabled: (cwd: string, input: PluginSetEnabledInput) =>
      ipcRenderer.invoke('plugins:setEnabled', cwd, input) as Promise<PluginCommandResult>,
    update: (cwd: string, input: PluginInstallInput) =>
      ipcRenderer.invoke('plugins:update', cwd, input) as Promise<PluginCommandResult>,
  },
  agents: {
    list: (cwd: string) =>
      ipcRenderer.invoke('agents:list', cwd) as Promise<AgentListResult>,
    get: (cwd: string, agentType: string, source?: AgentSource) =>
      ipcRenderer.invoke('agents:get', cwd, agentType, source) as Promise<AgentInfo>,
    save: (cwd: string, input: AgentSaveInput) =>
      ipcRenderer.invoke('agents:save', cwd, input) as Promise<AgentInfo>,
    delete: (cwd: string, agentType: string, source: AgentSource) =>
      ipcRenderer.invoke('agents:delete', cwd, agentType, source) as Promise<void>,
    refresh: (cwd: string) =>
      ipcRenderer.invoke('agents:refresh', cwd) as Promise<AgentListResult>,
    diagnose: (cwd: string, agentType: string) =>
      ipcRenderer.invoke('agents:diagnose', cwd, agentType) as Promise<AgentDiagnostics>,
  },
  teams: {
    list: (cwd: string) =>
      ipcRenderer.invoke('teams:list', cwd) as Promise<TeamInfo[]>,
    members: (cwd: string, teamName: string) =>
      ipcRenderer.invoke('teams:members', cwd, teamName) as Promise<TeamMemberInfo[]>,
    create: (sessionId: string, input: TeamCreateInput) =>
      ipcRenderer.invoke('teams:create', sessionId, input) as Promise<void>,
    send: (sessionId: string, input: TeamMessageInput) =>
      ipcRenderer.invoke('teams:send', sessionId, input) as Promise<void>,
    shutdown: (sessionId: string, input: TeamShutdownInput) =>
      ipcRenderer.invoke('teams:shutdown', sessionId, input) as Promise<void>,
    removeMember: (sessionId: string, input: TeamRemoveMemberInput) =>
      ipcRenderer.invoke('teams:removeMember', sessionId, input) as Promise<void>,
    delete: (sessionId: string, input: TeamDeleteInput) =>
      ipcRenderer.invoke('teams:delete', sessionId, input) as Promise<void>,
  },
  migration: {
    getSources: () =>
      ipcRenderer.invoke('migration:getSources') as Promise<MigrationSourceInfo[]>,
    perform: (source: MigrationSource) =>
      ipcRenderer.invoke('migration:perform', source) as Promise<MigrationResult>,
    skip: () =>
      ipcRenderer.invoke('migration:skip') as Promise<{ ok: true }>,
    onShowWizard: (callback: (sources: MigrationSourceInfo[]) => void) => {
      const listener = (_event: unknown, sources: MigrationSourceInfo[]) =>
        callback(sources)
      ipcRenderer.on('migration:showWizard', listener)
      return () => ipcRenderer.off('migration:showWizard', listener)
    },
  },
  onEvent(callback: (event: RuntimeEvent) => void) {
    const listener = (_event: unknown, payload: RuntimeEvent) =>
      callback(payload)
    ipcRenderer.on('desktop:event', listener)
    return () => ipcRenderer.off('desktop:event', listener)
  },
}

contextBridge.exposeInMainWorld('claudeDesktop', api)

export type ClaudeDesktopApi = typeof api
