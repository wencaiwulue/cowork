import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions,
} from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  assertDesktopChannel,
  type DesktopChannel,
  type DesktopProxySettings,
  type DesktopSessionLayoutPatch,
  type AgentLaunchInput,
  type DesktopAttachment,
  type AgentSaveInput,
  type AgentSource,
  type AgentTaskOutputInput,
  type AgentTaskOutputPreviewInput,
  type AgentTaskResumeInput,
  type AgentTaskStopInput,
  type McpServerInput,
  type PermissionResponse,
  type PluginInstallInput,
  type PluginSetEnabledInput,
  type ProjectScheduledTaskInput,
  type ScheduledTaskInput,
  type SkillSaveInput,
  type TeamCreateInput,
  type TeamDeleteInput,
  type TeamMessageInput,
  type TeamRemoveMemberInput,
  type TeamShutdownInput,
  validateIpcArgs,
} from './ipc'
import { DesktopSessionManager } from './sessionManager'
import { parseDesktopDeepLink } from './deepLink'
import { gitDiff, gitStatus } from './git'
import {
  readWorkspaceFile,
  readWorkspaceTree,
  saveWorkspaceFile,
} from './workspace'
import { TerminalManager } from './terminal'
import {
  addOrUpdateProjectScheduledTask,
  fireDueProjectScheduledTasks,
  listProjectScheduledTasks,
  pauseProjectScheduledTask,
  removeProjectScheduledTask,
  resumeProjectScheduledTask,
} from './workspaceTasks'
import {
  addOrUpdateProjectMcpServer,
  addOrUpdateMcpServer,
  addOrUpdateScheduledTask,
  fireDueScheduledTasks,
  installLocalSkill,
  installProjectSkill,
  listProjectSkills,
  listProjectMcpServers,
  loadClaudeDesktopConfig,
  pauseScheduledTask,
  readLocalSkill,
  readMcpServer,
  readProjectMcpServer,
  readProjectSkill,
  removeLocalSkill,
  removeProjectSkill,
  removeProjectMcpServer,
  removeMcpServer,
  removeScheduledTask,
  resumeScheduledTask,
  saveDesktopProxySettings,
  saveLocalSkill,
  saveProjectSkill,
  setMcpServerEnabled,
  setProjectMcpServerApproval,
} from './config'
import { checkMcpHealth } from './mcpHealth'
import { installPlugin, listPlugins, setPluginEnabled, uninstallPlugin, updatePlugin } from './plugins'
import {
  buildAgentLaunchPrompt,
  buildAgentTaskOutputPrompt,
  buildAgentTaskResumePrompt,
  buildAgentTaskStopPrompt,
  buildTeamMessagePrompt,
  buildTeamShutdownPrompt,
  createTeam,
  deleteTeam,
  deleteAgent,
  diagnoseAgent,
  getAgent,
  listAgents,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  saveAgent,
  upsertTeamMember,
} from './agents'
import { safeSendDesktopEvent } from './electronEvents'
import {
  recordSmokeDesktopEvent,
  recordSmokeIpcCall as recordSmokeIpcCallForApp,
} from './smokeEvents'
import { navigationActionForUrl, normalizeRendererEntryUrl } from './navigation'
import { ensureDefaultDesktopWorkspace } from './defaultWorkspace'
import { assertWorkspaceDirectory } from './workspaceDirectory'
import {
  recordOperationalEvent as appendOperationalEvent,
  writeDiagnosticsBundle,
  type DesktopReleasePolicy,
  type OperationalEvent,
} from './diagnostics'
import { desktopStorePath } from './store'
import { listCustomCommands } from './customCommands'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let projectTaskScheduler: NodeJS.Timeout | undefined
let projectTaskSchedulerRunning = false
let globalTaskSchedulerRunning = false
let allowMainWindowClose = false
let appQuitRequested = false
let rendererHasUnsavedChanges = false
let sessionPickerRunning = false
let operationalEvents: OperationalEvent[] = []

const terminalManager = new TerminalManager()
const sessionManager = new DesktopSessionManager(() => mainWindow, sendDesktopEvent)

const env = Function('return process.env')() as NodeJS.ProcessEnv
if (env.CLAUDE_CODE_DESKTOP_USER_DATA_DIR) {
  app.setPath('userData', env.CLAUDE_CODE_DESKTOP_USER_DATA_DIR)
}

process.on('uncaughtExceptionMonitor', error => {
  recordOperationalEvent({
    type: 'main-process',
    message: error.stack || error.message,
    details: { event: 'uncaughtExceptionMonitor' },
  })
})

process.on('unhandledRejection', reason => {
  recordOperationalEvent({
    type: 'main-process',
    message: reason instanceof Error ? reason.stack || reason.message : String(reason),
    details: { event: 'unhandledRejection' },
  })
})

function rendererUrl(): string | undefined {
  const env = Function('return process.env')() as NodeJS.ProcessEnv
  if (isDev && env.DESKTOP_RENDERER_URL) {
    const normalized = normalizeRendererEntryUrl(env.DESKTOP_RENDERER_URL)
    if (!normalized) {
      throw new Error('DESKTOP_RENDERER_URL must be a local renderer HTML entry URL.')
    }
    return normalized
  }
  return undefined
}

function rendererFilePath(): string {
  return join(__dirname, '../renderer/index.html')
}

function preloadPath(): string {
  return join(__dirname, '../preload/preload.cjs')
}

function rendererFileUrl(): string {
  return pathToFileURL(rendererFilePath()).href
}

function activeRendererEntryUrl(): string {
  return rendererUrl() ?? rendererFileUrl()
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 700,
    title: 'Claude Code Desktop',
    backgroundColor: '#f4f2ee',
    webPreferences: {
      preload: preloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!mainWindow) return
    const action = navigationActionForUrl(targetUrl, activeRendererEntryUrl())
    if (action.type === 'allow') return
    event.preventDefault()
    if (action.type === 'external') void shell.openExternal(action.url)
  })

  mainWindow.webContents.setWindowOpenHandler(details => {
    const action = navigationActionForUrl(details.url, activeRendererEntryUrl())
    if (action.type === 'external') void shell.openExternal(action.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    recordOperationalEvent({
      type: 'renderer-process-gone',
      message: details.reason,
      details: {
        reason: details.reason,
        exitCode: details.exitCode,
      },
    })
  })

  mainWindow.webContents.on('unresponsive', () => {
    recordOperationalEvent({
      type: 'renderer-unresponsive',
      message: 'Renderer became unresponsive.',
    })
  })

  mainWindow.webContents.on('responsive', () => {
    recordOperationalEvent({
      type: 'renderer-responsive',
      message: 'Renderer became responsive.',
    })
  })

  const url = rendererUrl()
  if (url) {
    await mainWindow.loadURL(url)
  } else {
    await mainWindow.loadFile(rendererFilePath())
  }

  if (isDev && env.DESKTOP_OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('close', event => {
    if (allowMainWindowClose) return
    if (appQuitRequested && !rendererHasUnsavedChanges) return
    event.preventDefault()
    appQuitRequested = false
    sendDesktopEvent({ type: 'app-close-request' })
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    allowMainWindowClose = false
    rendererHasUnsavedChanges = false
  })
}

function sendDesktopEvent(event: unknown): void {
  recordDesktopEventForDiagnostics(event)
  recordSmokeDesktopEvent(app, event, isSmokeRun())
  safeSendDesktopEvent(mainWindow, event)
}

function recordOperationalEvent(
  event: Omit<OperationalEvent, 'timestamp'> & { timestamp?: number },
): void {
  operationalEvents = appendOperationalEvent(operationalEvents, event)
}

function recordDesktopEventForDiagnostics(event: unknown): void {
  if (!event || typeof event !== 'object' || !('type' in event)) return
  const typed = event as {
    type?: unknown
    message?: unknown
    sessionId?: unknown
    terminalId?: unknown
    code?: unknown
    signal?: unknown
  }
  if (typed.type === 'desktop-error') {
    recordOperationalEvent({
      type: 'desktop-error',
      message: typeof typed.message === 'string' ? typed.message : undefined,
    })
  }
  if (typed.type === 'runtime-error') {
    recordOperationalEvent({
      type: 'runtime-error',
      message: typeof typed.message === 'string' ? typed.message : undefined,
      details: {
        sessionId: typed.sessionId,
      },
    })
  }
  if (typed.type === 'terminal-exit') {
    recordOperationalEvent({
      type: 'terminal-exit',
      message: `Terminal exited with ${typed.code ?? typed.signal ?? 'unknown'}.`,
      details: {
        terminalId: typed.terminalId,
        code: typed.code,
        signal: typed.signal,
      },
    })
  }
}

async function pickDirectory(): Promise<string | undefined> {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose project folder',
  })
  return result.canceled ? undefined : result.filePaths[0]
}

async function pickSkillDirectory(): Promise<string | undefined> {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    properties: ['openDirectory'],
    title: 'Choose a local skill folder containing SKILL.md',
  })
  return result.canceled ? undefined : result.filePaths[0]
}

async function createSessionFromPicker(): Promise<void> {
  if (sessionPickerRunning) return
  sessionPickerRunning = true
  try {
    if (!mainWindow) await createWindow()
    const selected = await pickDirectory()
    if (!selected) return
    const session = await sessionManager.create(await assertWorkspaceDirectory(selected))
    await sessionManager.focus(session.id)
  } finally {
    sessionPickerRunning = false
  }
}

async function createDefaultSession(): Promise<void> {
  if (sessionPickerRunning) return
  sessionPickerRunning = true
  try {
    if (!mainWindow) await createWindow()
    const session = await sessionManager.create(
      await assertWorkspaceDirectory(await ensureDefaultDesktopWorkspace()),
    )
    await sessionManager.focus(session.id)
  } finally {
    sessionPickerRunning = false
  }
}

async function exportDiagnostics(): Promise<{ path: string; bytes: number; generatedAt: string } | undefined> {
  const generatedAt = new Date().toISOString()
  const defaultPath = join(
    app.getPath('downloads'),
    `claude-code-desktop-diagnostics-${generatedAt.replace(/[:.]/g, '-')}.json`,
  )
  const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
    title: 'Export Claude Code Desktop Diagnostics',
    defaultPath,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return undefined

  let config
  let configError: string | undefined
  try {
    config = await loadClaudeDesktopConfig()
  } catch (cause) {
    configError = cause instanceof Error ? cause.message : String(cause)
  }

  return writeDiagnosticsBundle(result.filePath, {
    generatedAt,
    app: {
      name: app.getName(),
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      locale: app.getLocale(),
    },
    runtime: {
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      v8: process.versions.v8,
    },
    paths: {
      userData: app.getPath('userData'),
      sessionsStore: desktopStorePath(env),
    },
    sessions: sessionManager.list(),
    operationalEvents,
    releasePolicy: await loadDesktopReleasePolicy(),
    config,
    configError,
  })
}

async function loadDesktopReleasePolicy(): Promise<DesktopReleasePolicy | undefined> {
  const candidates = [
    join(__dirname, '../../release-policy.json'),
    join(__dirname, '../release-policy.json'),
    join(process.cwd(), 'desktop/release-policy.json'),
  ]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await readFile(candidate, 'utf8')) as DesktopReleasePolicy
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // Try the next source-layout or packaged-layout candidate.
    }
  }
  return undefined
}

async function workspaceCwd(cwd: string): Promise<string> {
  return assertWorkspaceDirectory(cwd)
}

async function handleDeepLink(url: string): Promise<void> {
  const { sessionId, cwd } = parseDesktopDeepLink(url)
  if (!sessionId && !cwd) return
  if (!mainWindow) await createWindow()

  const existing = sessionId
    ? sessionManager.list().find(session => session.id === sessionId)
    : undefined

  if (existing) {
    await sessionManager.resume(existing.id)
    await sessionManager.focus(existing.id)
    return
  }

  if (cwd) {
    try {
      const session = await sessionManager.create(await assertWorkspaceDirectory(cwd))
      await sessionManager.focus(session.id)
    } catch (cause) {
      sendDesktopEvent({
        type: 'desktop-error',
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }
}

async function runProjectTaskSchedulerTick(): Promise<void> {
  if (projectTaskSchedulerRunning) return
  projectTaskSchedulerRunning = true
  try {
    const now = Date.now()
    for (const session of sessionManager.list()) {
      const fired = await fireDueProjectScheduledTasks(session.cwd, now)
      for (const task of fired) {
        await sessionManager.send(session.id, task.prompt)
      }
    }
  } catch (cause) {
    sendDesktopEvent({
      type: 'desktop-error',
      message: cause instanceof Error ? cause.message : String(cause),
    })
  } finally {
    projectTaskSchedulerRunning = false
  }
}

async function runGlobalTaskSchedulerTick(): Promise<void> {
  if (globalTaskSchedulerRunning) return
  globalTaskSchedulerRunning = true
  try {
    const activeSession = sessionManager.list()[0]
    if (!activeSession) return
    const fired = await fireDueScheduledTasks(Date.now())
    for (const task of fired) {
      await sessionManager.send(activeSession.id, task.prompt)
    }
  } catch (cause) {
    sendDesktopEvent({
      type: 'desktop-error',
      message: cause instanceof Error ? cause.message : String(cause),
    })
  } finally {
    globalTaskSchedulerRunning = false
  }
}

function startProjectTaskScheduler(): void {
  if (projectTaskScheduler) return
  const intervalMs = Number.parseInt(
    env.CLAUDE_CODE_DESKTOP_TASK_SCHEDULER_INTERVAL_MS ?? '60000',
    10,
  )
  projectTaskScheduler = setInterval(() => {
    void Promise.all([
      runProjectTaskSchedulerTick(),
      runGlobalTaskSchedulerTick(),
    ])
  }, Number.isFinite(intervalMs) && intervalMs >= 1_000 ? intervalMs : 60_000)
  projectTaskScheduler.unref?.()
  setTimeout(() => {
    void Promise.all([
      runProjectTaskSchedulerTick(),
      runGlobalTaskSchedulerTick(),
    ])
  }, 2_000).unref?.()
}

function registerIpc(): void {
  for (const channel of [
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
  ]) {
    assertDesktopChannel(channel)
  }

  handleIpc('app:closeWindow', () => {
    allowMainWindowClose = true
    mainWindow?.close()
  })
  handleIpc('app:setUnsavedChanges', (hasUnsavedChanges: boolean) => {
    rendererHasUnsavedChanges = hasUnsavedChanges
  })
  handleIpc('diagnostics:export', () => exportDiagnostics())
  handleIpc('sessions:list', () => sessionManager.list())
  handleIpc('sessions:create', async (input?: string | { cwd?: string; defaultCwd?: boolean; agent?: unknown }) => {
    const selected = typeof input === 'string'
      ? input
      : input?.cwd || (input?.defaultCwd ? await ensureDefaultDesktopWorkspace() : await pickDirectory())
    if (!selected) return undefined
    const cwd = await assertWorkspaceDirectory(selected)
    const session = await sessionManager.create(
      cwd,
      typeof input === 'string' ? undefined : input?.agent as never,
    )
    await sessionManager.focus(session.id)
    return session
  })
  handleIpc('sessions:resume', (sessionId: string) =>
    sessionManager.resume(sessionId),
  )
  handleIpc('sessions:focus', (sessionId: string) =>
    sessionManager.focus(sessionId),
  )
  handleIpc('sessions:close', (sessionId: string) =>
    sessionManager.close(sessionId),
  )
  handleIpc('sessions:rename', (sessionId: string, title: string) =>
    sessionManager.renameSession(sessionId, title),
  )
  handleIpc('sessions:send', (sessionId: string, text: string, attachments?: DesktopAttachment[]) =>
    sessionManager.send(sessionId, text, attachments),
  )
  handleIpc('sessions:launchAgentTask', async (sessionId: string, input: AgentLaunchInput) => {
    const session = sessionManager.getSession(sessionId)
    await sessionManager.send(sessionId, buildAgentLaunchPrompt(input))
    if (input.teamName) await upsertTeamMember(input, session.cwd)
    return session
  })
  handleIpc('sessions:stopAgentTask', (sessionId: string, input: AgentTaskStopInput) =>
    sessionManager.send(sessionId, buildAgentTaskStopPrompt(input)),
  )
  handleIpc('sessions:readAgentTaskOutput', (sessionId: string, input: AgentTaskOutputInput) =>
    sessionManager.send(sessionId, buildAgentTaskOutputPrompt(input)),
  )
  handleIpc(
    'sessions:previewAgentTaskOutput',
    (sessionId: string, input: AgentTaskOutputPreviewInput) =>
      sessionManager.previewAgentTaskOutput(sessionId, input),
  )
  handleIpc('sessions:resumeAgentTask', (sessionId: string, input: AgentTaskResumeInput) =>
    sessionManager.send(sessionId, buildAgentTaskResumePrompt(input)),
  )
  handleIpc('sessions:answerQuestion', (sessionId: string, toolUseId: string, answers: Record<string, string>, questions: Array<{question: string; options: Array<{label: string; description: string}>}>) =>
    sessionManager.answerQuestion(sessionId, toolUseId, answers, questions),
  )
  handleIpc('sessions:cancel', (sessionId: string) =>
    sessionManager.cancel(sessionId),
  )
  handleIpc('sessions:updateLayout', (sessionId: string, patch: DesktopSessionLayoutPatch) =>
    sessionManager.updateLayout(sessionId, patch),
  )
  handleIpc('sessions:clearDesktopView', (sessionId: string) =>
    sessionManager.clearDesktopView(sessionId),
  )
  handleIpc(
    'permissions:respond',
    (sessionId: string, requestId: string, response: PermissionResponse) =>
      sessionManager.respondToPermission(sessionId, requestId, response),
  )
  handleIpc('workspace:tree', async (cwd: string) =>
    readWorkspaceTree(await workspaceCwd(cwd)),
  )
  handleIpc('workspace:readFile', async (cwd: string, path: string) =>
    readWorkspaceFile(await workspaceCwd(cwd), path),
  )
  handleIpc(
    'workspace:saveFile',
    async (cwd: string, path: string, contents: string) =>
      saveWorkspaceFile(await workspaceCwd(cwd), path, contents),
  )
  handleIpc('workspace:openFolder', async (cwd: string) => {
    const error = await shell.openPath(await workspaceCwd(cwd))
    if (error) throw new Error(error)
  })
  handleIpc('workspaceTasks:list', async (cwd: string) =>
    listProjectScheduledTasks(await workspaceCwd(cwd)),
  )
  handleIpc(
    'workspaceTasks:addOrUpdate',
    async (cwd: string, task: ProjectScheduledTaskInput) =>
      addOrUpdateProjectScheduledTask(await workspaceCwd(cwd), task),
  )
  handleIpc('workspaceTasks:remove', async (cwd: string, taskId: string) =>
    removeProjectScheduledTask(await workspaceCwd(cwd), taskId),
  )
  handleIpc('workspaceTasks:pause', async (cwd: string, taskId: string) =>
    pauseProjectScheduledTask(await workspaceCwd(cwd), taskId),
  )
  handleIpc('workspaceTasks:resume', async (cwd: string, taskId: string) =>
    resumeProjectScheduledTask(await workspaceCwd(cwd), taskId),
  )
  handleIpc('git:status', async (cwd: string) => gitStatus(await workspaceCwd(cwd)))
  handleIpc('git:diff', async (cwd: string) => gitDiff(await workspaceCwd(cwd)))
  handleIpc('terminal:create', async (cwd: string) =>
    terminalManager.create(await workspaceCwd(cwd)),
  )
  handleIpc('terminal:write', (id: string, data: string) =>
    terminalManager.write(id, data),
  )
  handleIpc(
    'terminal:resize',
    (id: string, columns: number, rows: number) =>
      terminalManager.resize(id, columns, rows),
  )
  handleIpc('terminal:kill', (id: string) =>
    terminalManager.kill(id),
  )
  handleIpc('preview:setUrl', async (url: string) => {
    sendDesktopEvent({ type: 'preview-url', url })
  })
  handleIpc('preview:openExternal', async (url: string) => {
    await shell.openExternal(url)
  })
  handleIpc('clipboard:writeText', (text: string) => {
    clipboard.writeText(text)
  })
  handleIpc('commands:list', async (cwd: string) =>
    listCustomCommands(await workspaceCwd(cwd)),
  )
  handleIpc('config:get', () => loadClaudeDesktopConfig())
  handleIpc('config:updateProxy', (proxy: DesktopProxySettings) =>
    saveDesktopProxySettings(proxy),
  )
  handleIpc('mcp:addOrUpdate', (server: McpServerInput) =>
    addOrUpdateMcpServer(server),
  )
  handleIpc('mcp:remove', (name: string) =>
    removeMcpServer(name),
  )
  handleIpc('mcp:read', (name: string) =>
    readMcpServer(name),
  )
  handleIpc('mcp:setEnabled', (name: string, enabled: boolean) =>
    setMcpServerEnabled(name, enabled),
  )
  handleIpc('workspaceMcp:list', async (cwd: string) =>
    listProjectMcpServers(await workspaceCwd(cwd)),
  )
  handleIpc('workspaceMcp:addOrUpdate', async (cwd: string, server: McpServerInput) =>
    addOrUpdateProjectMcpServer(await workspaceCwd(cwd), server),
  )
  handleIpc('workspaceMcp:remove', async (cwd: string, name: string) =>
    removeProjectMcpServer(await workspaceCwd(cwd), name),
  )
  handleIpc('workspaceMcp:read', async (cwd: string, name: string) =>
    readProjectMcpServer(await workspaceCwd(cwd), name),
  )
  handleIpc('workspaceMcp:setApproval', async (cwd: string, name: string, approved: boolean) =>
    setProjectMcpServerApproval(await workspaceCwd(cwd), name, approved),
  )
  handleIpc('workspaceMcp:check', async (cwd: string) =>
    checkMcpHealth(await workspaceCwd(cwd)),
  )
  handleIpc('tasks:addOrUpdate', (task: ScheduledTaskInput) =>
    addOrUpdateScheduledTask(task),
  )
  handleIpc('tasks:remove', (taskId: string) =>
    removeScheduledTask(taskId),
  )
  handleIpc('tasks:pause', (taskId: string) =>
    pauseScheduledTask(taskId),
  )
  handleIpc('tasks:resume', (taskId: string) =>
    resumeScheduledTask(taskId),
  )
  handleIpc('skills:installLocal', async (sourceDir?: string) => {
    const selected = sourceDir || (await pickSkillDirectory())
    if (!selected) return undefined
    return installLocalSkill(selected)
  })
  handleIpc('skills:save', (input: SkillSaveInput) =>
    saveLocalSkill(input),
  )
  handleIpc('skills:remove', (name: string) =>
    removeLocalSkill(name),
  )
  handleIpc('skills:read', (name: string) =>
    readLocalSkill(name),
  )
  handleIpc('workspaceSkills:list', async (cwd: string) =>
    listProjectSkills(await workspaceCwd(cwd)),
  )
  handleIpc('workspaceSkills:installLocal', async (cwd: string, sourceDir?: string) => {
    const selected = sourceDir || (await pickSkillDirectory())
    if (!selected) return undefined
    return installProjectSkill(await workspaceCwd(cwd), selected)
  })
  handleIpc('workspaceSkills:save', async (cwd: string, input: SkillSaveInput) =>
    saveProjectSkill(await workspaceCwd(cwd), input),
  )
  handleIpc('workspaceSkills:remove', async (cwd: string, name: string) =>
    removeProjectSkill(await workspaceCwd(cwd), name),
  )
  handleIpc('workspaceSkills:read', async (cwd: string, name: string) =>
    readProjectSkill(await workspaceCwd(cwd), name),
  )
  handleIpc('plugins:list', async (cwd: string) =>
    listPlugins(await workspaceCwd(cwd)),
  )
  handleIpc('plugins:install', async (cwd: string, input: PluginInstallInput) =>
    installPlugin(await workspaceCwd(cwd), input),
  )
  handleIpc('plugins:uninstall', async (cwd: string, input: PluginInstallInput) =>
    uninstallPlugin(await workspaceCwd(cwd), input),
  )
  handleIpc('plugins:setEnabled', async (cwd: string, input: PluginSetEnabledInput) =>
    setPluginEnabled(await workspaceCwd(cwd), input),
  )
  handleIpc('plugins:update', async (cwd: string, input: PluginInstallInput) =>
    updatePlugin(await workspaceCwd(cwd), input),
  )
  handleIpc('agents:list', async (cwd: string) =>
    listAgents(cwd ? await workspaceCwd(cwd) : ''),
  )
  handleIpc('agents:get', async (cwd: string, agentType: string, source?: AgentSource) =>
    getAgent(await workspaceCwd(cwd), agentType, source),
  )
  handleIpc('agents:save', async (cwd: string, input: AgentSaveInput) =>
    saveAgent(input.source === 'project' ? await workspaceCwd(cwd) : '', input),
  )
  handleIpc('agents:delete', async (cwd: string, agentType: string, source: AgentSource) =>
    deleteAgent(source === 'project' ? await workspaceCwd(cwd) : '', agentType, source),
  )
  handleIpc('agents:refresh', async (cwd: string) =>
    listAgents(cwd ? await workspaceCwd(cwd) : ''),
  )
  handleIpc('agents:diagnose', async (cwd: string, agentType: string) =>
    diagnoseAgent(await workspaceCwd(cwd), agentType),
  )
  handleIpc('teams:list', async (cwd: string) =>
    listTeams(await workspaceCwd(cwd)),
  )
  handleIpc('teams:members', async (cwd: string, teamName: string) =>
    listTeamMembers(teamName, await workspaceCwd(cwd)),
  )
  handleIpc('teams:create', async (sessionId: string, input: TeamCreateInput) => {
    const session = sessionManager.getSession(sessionId)
    return createTeam(input, session.cwd)
  })
  handleIpc('teams:send', (sessionId: string, input: TeamMessageInput) =>
    sessionManager.send(sessionId, buildTeamMessagePrompt(input)),
  )
  handleIpc('teams:shutdown', (sessionId: string, input: TeamShutdownInput) =>
    sessionManager.send(sessionId, buildTeamShutdownPrompt(input)),
  )
  handleIpc('teams:removeMember', async (sessionId: string, input: TeamRemoveMemberInput) => {
    const session = sessionManager.getSession(sessionId)
    await removeTeamMember(input, session.cwd)
    return session
  })
  handleIpc('teams:delete', async (sessionId: string, input: TeamDeleteInput) => {
    const session = sessionManager.getSession(sessionId)
    await deleteTeam(input, session.cwd)
    return session
  })
}

function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          id: 'new-session',
          label: 'New Session',
          accelerator: 'CmdOrCtrl+N',
          click: () => void createDefaultSession(),
        },
        {
          id: 'open-folder',
          label: 'Open Project Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: () => void createSessionFromPicker(),
        },
        { type: 'separator' },
        {
          id: 'new-custom-agent',
          label: 'New Custom Agent',
          click: () => sendDesktopEvent({ type: 'lifecycle-action', action: 'new-custom-agent' }),
        },
        {
          id: 'new-team',
          label: 'New Team',
          click: () => sendDesktopEvent({ type: 'lifecycle-action', action: 'new-team' }),
        },
        {
          id: 'new-global-task',
          label: 'New Global Scheduled Task',
          click: () => sendDesktopEvent({ type: 'lifecycle-action', action: 'new-global-task' }),
        },
        {
          id: 'new-project-task',
          label: 'New Project Scheduled Task',
          click: () => sendDesktopEvent({ type: 'lifecycle-action', action: 'new-project-task' }),
        },
        { type: 'separator' },
        {
          id: 'add-mcp-server',
          label: 'Add MCP Server',
          click: () => sendDesktopEvent({ type: 'lifecycle-action', action: 'add-mcp-server' }),
        },
        {
          id: 'new-user-skill',
          label: 'New User Skill',
          click: () => sendDesktopEvent({ type: 'lifecycle-action', action: 'new-user-skill' }),
        },
        {
          id: 'new-project-skill',
          label: 'New Project Skill',
          click: () => sendDesktopEvent({ type: 'lifecycle-action', action: 'new-project-skill' }),
        },
        { type: 'separator' },
        {
          id: 'clear-desktop-transcript-view',
          label: 'Clear Desktop Transcript View',
          click: () => sendDesktopEvent({ type: 'clear-desktop-transcript-view' }),
        },
        { type: 'separator' },
        process.platform === 'darwin'
          ? { role: 'close' }
          : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          id: 'command-palette',
          label: 'Command Palette...',
          accelerator: 'CmdOrCtrl+K',
          click: () => sendDesktopEvent({ type: 'command-palette' }),
        },
        { type: 'separator' },
        {
          label: 'Go to Page',
          submenu: [
            {
              id: 'view-chat',
              label: 'Chat',
              accelerator: 'CmdOrCtrl+1',
              click: () => sendDesktopEvent({ type: 'primary-nav', view: 'chat' }),
            },
            {
              id: 'view-agents',
              label: 'Agents',
              accelerator: 'CmdOrCtrl+2',
              click: () => sendDesktopEvent({ type: 'primary-nav', view: 'agents' }),
            },
            {
              id: 'view-teams',
              label: 'Teams',
              accelerator: 'CmdOrCtrl+3',
              click: () => sendDesktopEvent({ type: 'primary-nav', view: 'teams' }),
            },
            {
              id: 'view-tasks',
              label: 'Tasks',
              accelerator: 'CmdOrCtrl+4',
              click: () => sendDesktopEvent({ type: 'primary-nav', view: 'tasks' }),
            },
            {
              id: 'view-settings',
              label: 'Settings',
              accelerator: 'CmdOrCtrl+5',
              click: () => sendDesktopEvent({ type: 'primary-nav', view: 'settings' }),
            },
          ],
        },
        {
          label: 'Workspace Pane',
          submenu: [
            {
              id: 'pane-files',
              label: 'Files',
              accelerator: 'CmdOrCtrl+Shift+1',
              click: () => sendDesktopEvent({ type: 'workspace-pane', pane: 'files' }),
            },
            {
              id: 'pane-diff',
              label: 'Diff',
              accelerator: 'CmdOrCtrl+Shift+2',
              click: () => sendDesktopEvent({ type: 'workspace-pane', pane: 'diff' }),
            },
            {
              id: 'pane-editor',
              label: 'Editor',
              accelerator: 'CmdOrCtrl+Shift+3',
              click: () => sendDesktopEvent({ type: 'workspace-pane', pane: 'editor' }),
            },
            {
              id: 'pane-terminal',
              label: 'Terminal',
              accelerator: 'CmdOrCtrl+Shift+4',
              click: () => sendDesktopEvent({ type: 'workspace-pane', pane: 'terminal' }),
            },
            {
              id: 'pane-preview',
              label: 'Preview',
              accelerator: 'CmdOrCtrl+Shift+5',
              click: () => sendDesktopEvent({ type: 'workspace-pane', pane: 'preview' }),
            },
          ],
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Agents',
      submenu: [
        {
          id: 'agents-overview',
          label: 'Overview',
          click: () => sendDesktopEvent({ type: 'agents-action', action: 'overview' }),
        },
        {
          id: 'agents-available',
          label: 'Available Agents',
          click: () => sendDesktopEvent({ type: 'agents-action', action: 'available' }),
        },
        {
          id: 'agents-run',
          label: 'Run Agent',
          click: () => sendDesktopEvent({ type: 'agents-action', action: 'run' }),
        },
        {
          id: 'agents-custom',
          label: 'Custom Agents',
          click: () => sendDesktopEvent({ type: 'agents-action', action: 'custom' }),
        },
        {
          id: 'agents-running',
          label: 'Running Agent Tasks',
          click: () => sendDesktopEvent({ type: 'agents-action', action: 'running' }),
        },
        { type: 'separator' },
        {
          id: 'agents-new-custom',
          label: 'New Custom Agent',
          click: () => sendDesktopEvent({ type: 'agents-action', action: 'new-custom' }),
        },
        { type: 'separator' },
        {
          id: 'agents-refresh',
          label: 'Refresh Agents',
          click: () => sendDesktopEvent({ type: 'agents-action', action: 'refresh' }),
        },
      ],
    },
    {
      label: 'Teams',
      submenu: [
        {
          id: 'teams-management',
          label: 'Team Management',
          click: () => sendDesktopEvent({ type: 'teams-action', action: 'management' }),
        },
        {
          id: 'teams-new',
          label: 'New Team',
          click: () => sendDesktopEvent({ type: 'teams-action', action: 'new' }),
        },
        { type: 'separator' },
        {
          id: 'teams-refresh',
          label: 'Refresh Teams',
          click: () => sendDesktopEvent({ type: 'teams-action', action: 'refresh' }),
        },
      ],
    },
    {
      label: 'Tasks',
      submenu: [
        {
          id: 'tasks-project',
          label: 'Project Scheduled Tasks',
          click: () => sendDesktopEvent({ type: 'tasks-action', action: 'project' }),
        },
        {
          id: 'tasks-global',
          label: 'Global Scheduled Tasks',
          click: () => sendDesktopEvent({ type: 'tasks-action', action: 'global' }),
        },
        { type: 'separator' },
        {
          id: 'tasks-new-project',
          label: 'New Project Scheduled Task',
          click: () => sendDesktopEvent({ type: 'tasks-action', action: 'new-project' }),
        },
        {
          id: 'tasks-new-global',
          label: 'New Global Scheduled Task',
          click: () => sendDesktopEvent({ type: 'tasks-action', action: 'new-global' }),
        },
        { type: 'separator' },
        {
          id: 'tasks-refresh',
          label: 'Refresh Tasks',
          click: () => sendDesktopEvent({ type: 'tasks-action', action: 'refresh' }),
        },
      ],
    },
    {
      label: 'MCP',
      submenu: [
        {
          id: 'mcp-servers',
          label: 'MCP Servers',
          click: () => sendDesktopEvent({ type: 'mcp-action', action: 'servers' }),
        },
        {
          id: 'mcp-add-server',
          label: 'Add MCP Server',
          click: () => sendDesktopEvent({ type: 'mcp-action', action: 'add-server' }),
        },
        { type: 'separator' },
        {
          id: 'mcp-check-health',
          label: 'Check MCP Health',
          click: () => sendDesktopEvent({ type: 'mcp-action', action: 'check-health' }),
        },
      ],
    },
    {
      label: 'Skills',
      submenu: [
        {
          id: 'skills-list',
          label: 'Skills',
          click: () => sendDesktopEvent({ type: 'skills-action', action: 'list' }),
        },
        {
          id: 'skills-new-user',
          label: 'New User Skill',
          click: () => sendDesktopEvent({ type: 'skills-action', action: 'new-user' }),
        },
        {
          id: 'skills-new-project',
          label: 'New Project Skill',
          click: () => sendDesktopEvent({ type: 'skills-action', action: 'new-project' }),
        },
        { type: 'separator' },
        {
          id: 'skills-install-user',
          label: 'Install User Skill',
          click: () => sendDesktopEvent({ type: 'skills-action', action: 'install-user' }),
        },
        {
          id: 'skills-install-project',
          label: 'Install Project Skill',
          click: () => sendDesktopEvent({ type: 'skills-action', action: 'install-project' }),
        },
      ],
    },
    {
      label: 'Plugins',
      submenu: [
        {
          id: 'plugins-settings',
          label: 'Plugins',
          click: () => sendDesktopEvent({ type: 'plugins-action', action: 'settings' }),
        },
        {
          id: 'plugins-list',
          label: 'List Plugins',
          click: () => sendDesktopEvent({ type: 'plugins-action', action: 'list' }),
        },
        {
          id: 'plugins-install',
          label: 'Install Plugin',
          click: () => sendDesktopEvent({ type: 'plugins-action', action: 'install' }),
        },
        { type: 'separator' },
        {
          id: 'plugins-refresh',
          label: 'Refresh Plugins',
          click: () => sendDesktopEvent({ type: 'plugins-action', action: 'refresh' }),
        },
      ],
    },
    {
      label: 'Settings',
      submenu: [
        {
          id: 'settings-general',
          label: 'General',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendDesktopEvent({ type: 'settings-action', action: 'general' }),
        },
        {
          id: 'settings-proxy',
          label: 'Proxy',
          click: () => sendDesktopEvent({ type: 'settings-action', action: 'proxy' }),
        },
        {
          id: 'settings-mcp',
          label: 'MCP Servers',
          click: () => sendDesktopEvent({ type: 'settings-action', action: 'mcp' }),
        },
        {
          id: 'settings-mcp-check',
          label: 'Check MCP Health',
          click: () => sendDesktopEvent({ type: 'settings-action', action: 'mcp-check' }),
        },
        { type: 'separator' },
        {
          id: 'settings-skills',
          label: 'Skills',
          click: () => sendDesktopEvent({ type: 'settings-action', action: 'skills' }),
        },
        {
          id: 'settings-install-user-skill',
          label: 'Install User Skill',
          click: () => sendDesktopEvent({ type: 'settings-action', action: 'install-user-skill' }),
        },
        {
          id: 'settings-install-project-skill',
          label: 'Install Project Skill',
          click: () => sendDesktopEvent({ type: 'settings-action', action: 'install-project-skill' }),
        },
        { type: 'separator' },
        {
          id: 'settings-plugins',
          label: 'Plugins',
          click: () => sendDesktopEvent({ type: 'settings-action', action: 'plugins' }),
        },
        {
          id: 'settings-list-plugins',
          label: 'List Plugins',
          click: () => sendDesktopEvent({ type: 'settings-action', action: 'list-plugins' }),
        },
        {
          id: 'settings-install-plugin',
          label: 'Install Plugin',
          click: () => sendDesktopEvent({ type: 'settings-action', action: 'install-plugin' }),
        },
        { type: 'separator' },
        {
          id: 'settings-refresh',
          label: 'Refresh Settings',
          click: () => sendDesktopEvent({ type: 'settings-action', action: 'refresh' }),
        },
        {
          id: 'settings-diagnostics',
          label: 'Export Diagnostics',
          click: () => sendDesktopEvent({ type: 'settings-action', action: 'diagnostics' }),
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
            ]
          : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          id: 'help-command-palette',
          label: 'Command Palette',
          click: () => sendDesktopEvent({ type: 'command-palette' }),
        },
        { type: 'separator' },
        {
          id: 'help-refresh-settings',
          label: 'Refresh Settings',
          click: () => sendDesktopEvent({ type: 'settings-action', action: 'refresh' }),
        },
        {
          id: 'help-export-diagnostics',
          label: 'Export Diagnostics',
          click: () => sendDesktopEvent({ type: 'settings-action', action: 'diagnostics' }),
        },
        { type: 'separator' },
        {
          id: 'open-claude-code-docs',
          label: 'Claude Code Docs',
          click: () => void shell.openExternal('https://code.claude.com/docs'),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function handleIpc(
  channel: DesktopChannel,
  handler: (...args: never[]) => unknown,
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    recordSmokeIpcCall(channel, args)
    const validated = validateIpcArgs(channel, args)
    await delaySmokeIpc(channel)
    return handler(...validated as never[])
  })
}

function recordSmokeIpcCall(channel: DesktopChannel, args: unknown[]): void {
  const global = globalThis as typeof globalThis & {
    __claudeDesktopSmokeIpcCalls?: Record<string, number>
    __claudeDesktopSmokeIpcArgs?: Record<string, unknown[]>
  }
  recordSmokeIpcCallForApp(app, channel, args, isSmokeRun())
  global.__claudeDesktopSmokeIpcCalls =
    (app as Electron.App & {
      __claudeDesktopSmokeIpcCalls?: Record<string, number>
    }).__claudeDesktopSmokeIpcCalls
  global.__claudeDesktopSmokeIpcArgs =
    (app as Electron.App & {
      __claudeDesktopSmokeIpcArgs?: Record<string, unknown[]>
    }).__claudeDesktopSmokeIpcArgs
}

async function delaySmokeIpc(channel: DesktopChannel): Promise<void> {
  if (
    !isSmokeRun() ||
    ![
      'config:updateProxy',
      'mcp:addOrUpdate',
      'workspaceMcp:addOrUpdate',
      'workspace:saveFile',
      'workspace:tree',
      'config:get',
      'agents:refresh',
      'preview:setUrl',
    ].includes(channel)
  ) {
    return
  }
  await new Promise(resolve =>
    setTimeout(resolve, channel === 'config:get' ? 300 : channel === 'preview:setUrl' ? 500 : 100),
  )
}

function isSmokeRun(): boolean {
  return Function('return process.env')().CLAUDE_CODE_DESKTOP_SMOKE === '1'
}

terminalManager.on('data', (terminalId: string, data: string) => {
  sendDesktopEvent({
    type: 'terminal-data',
    terminalId,
    data,
  })
})

terminalManager.on('state', terminal => {
  sendDesktopEvent({
    type: 'terminal-state',
    terminal,
  })
})

terminalManager.on('exit', (terminalId: string, code: number | null, signal: string | null) => {
  sendDesktopEvent({
    type: 'terminal-exit',
    terminalId,
    code,
    signal,
  })
})

app.setName('Claude Code Desktop')
if ((process as NodeJS.Process & { defaultApp?: boolean }).defaultApp) {
  app.setAsDefaultProtocolClient('claude-dev', process.execPath, [
    process.argv[1],
  ])
} else {
  app.setAsDefaultProtocolClient('claude')
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.on('second-instance', (_event, argv) => {
  const deepLink = argv.find(arg => arg.startsWith('claude://') || arg.startsWith('claude-dev://'))
  if (deepLink) void handleDeepLink(deepLink)
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('open-url', event => {
  event.preventDefault()
  void handleDeepLink((event as Electron.Event & { url: string }).url)
})

app.on('before-quit', () => {
  appQuitRequested = true
})

app.whenReady().then(async () => {
  await sessionManager.init()
  registerIpc()
  installApplicationMenu()
  await createWindow()
  startProjectTaskScheduler()
})

app.on('window-all-closed', () => {
  if (projectTaskScheduler) {
    clearInterval(projectTaskScheduler)
    projectTaskScheduler = undefined
  }
  terminalManager.killAll()
  sessionManager.killAll()
  if (process.platform !== 'darwin' || isSmokeRun()) {
    app.quit()
  }
})

app.on('activate', () => {
  if (!mainWindow) void createWindow()
})
