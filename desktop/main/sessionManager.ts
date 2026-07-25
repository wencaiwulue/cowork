import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import type { BrowserWindow } from 'electron'
import {
  type DesktopAttachment,
  type DesktopMessage,
  type DesktopSession,
  type DesktopSessionLayoutPatch,
  type AgentSessionConfig,
  type AgentTaskInfo,
  type AgentTaskToolEvent,
  type AgentTaskOutputPreviewInput,
  type AgentTaskOutputPreviewResult,
  type PermissionResponse,
  type RuntimeEvent,
} from './ipc'
import { createSessionHost, type SessionHost } from './sessionHost'
import { loadDesktopStore, saveDesktopStore } from './store'
import {
  extractAgentTaskUpdate,
  toDesktopMessages,
  toStreamTextUpdate,
} from './messageMapper'
import { safeSendDesktopEvent } from './electronEvents'

const STREAMING_THINKING_PLACEHOLDER = 'Thinking...'
type StreamingMessageKey = `${DesktopMessage['role']}:${string}`

function derivePrimaryView(
  layout: DesktopSession['layout'],
): NonNullable<DesktopSession['layout']['primaryView']> {
  if (
    layout.primaryView === 'chat' ||
    layout.primaryView === 'agents' ||
    layout.primaryView === 'teams' ||
    layout.primaryView === 'tasks' ||
    layout.primaryView === 'settings'
  ) {
    return layout.primaryView
  }
  if (layout.primaryView === 'teammates') return 'teams'
  if (layout.activePane === 'settings') return 'settings'
  if (layout.activePane === 'tasks') return 'tasks'
  if (layout.activePane === 'teams') return 'teams'
  if (layout.activePane === 'agents') return 'agents'
  return 'chat'
}

function deriveActivePane(
  layout: DesktopSession['layout'],
): DesktopSession['layout']['activePane'] {
  if (
    layout.activePane === 'agents' &&
    (layout.primaryView === 'teams' || layout.primaryView === 'teammates')
  ) {
    return 'teams'
  }
  return layout.activePane ?? 'files'
}

function isTasksSection(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('tasks-')
}

function createSession(cwd: string, agent?: AgentSessionConfig): DesktopSession {
  const now = Date.now()
  return {
    id: randomUUID(),
    title: agent?.agentType ? `${agent.agentType} · ${cwd.split('/').pop() || cwd}` : cwd.split('/').pop() || cwd,
    cwd,
    createdAt: now,
    updatedAt: now,
    status: 'starting',
    activity: 'starting',
    messages: [],
    agent,
    toolUses: [],
    agentTasks: [],
    runtimeEvents: [],
    layout: {
      sidebarWidth: 280,
      workspaceRatio: 0.5,
      activePane: agent?.agentType ? 'agents' : 'files',
      primaryView: agent?.agentType ? 'agents' : 'chat',
      previewUrl: '',
      settingsActiveSection: 'settings-runtime',
      tasksActiveSection: 'tasks-project-tasks',
      agentsActiveSection: 'agents-catalog',
      teamsActiveSection: 'agents-teams',
      expandedPaths: [],
    },
  }
}

function isResultMessage(raw: unknown): boolean {
  return Boolean(
    raw &&
    typeof raw === 'object' &&
    'type' in raw &&
    (raw as { type?: unknown }).type === 'result',
  )
}

function isDuplicateRuntimeUserEcho(
  session: DesktopSession,
  message: DesktopMessage,
): boolean {
  if (message.role !== 'user' || !message.text.trim()) return false
  const previousUser = [...session.messages]
    .reverse()
    .find(item => item.role === 'user')
  return previousUser
    ? normalizedUserEchoText(previousUser.text) === normalizedUserEchoText(message.text)
    : false
}

function normalizedUserEchoText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

function streamingKey(
  role: DesktopMessage['role'],
  streamKey: string | undefined,
): StreamingMessageKey {
  return `${role}:${streamKey ?? 'default'}`
}

export function normalizeStoredSession(session: DesktopSession): DesktopSession {
  const legacyTasksActiveSection = isTasksSection(session.layout.settingsActiveSection)
    ? session.layout.settingsActiveSection
    : undefined
  return {
    ...session,
    status: 'stopped',
    activity: 'idle',
    lastError: undefined,
    runtimeEvents: [],
    layout: {
      ...session.layout,
      activePane: deriveActivePane(session.layout),
      primaryView: derivePrimaryView(session.layout),
      previewUrl:
        session.layout.previewUrl === 'https://claude.ai'
          ? ''
          : session.layout.previewUrl,
      settingsActiveSection: legacyTasksActiveSection
        ? 'settings-runtime'
        : session.layout.settingsActiveSection ?? 'settings-runtime',
      tasksActiveSection: session.layout.tasksActiveSection ??
        legacyTasksActiveSection ??
        'tasks-project-tasks',
      agentsActiveSection: session.layout.agentsActiveSection ?? 'agents-catalog',
      teamsActiveSection: session.layout.teamsActiveSection ?? 'agents-teams',
      terminalId: undefined,
    },
  }
}

export class DesktopSessionManager {
  private sessions = new Map<string, DesktopSession>()
  private hosts = new Map<string, SessionHost>()
  private stderrBySession = new Map<string, string[]>()
  private streamingMessageBySession = new Map<string, Map<StreamingMessageKey, string>>()
  private pendingPermissionRequestsBySession = new Map<string, Set<string>>()
  private activeSessionId: string | undefined

  constructor(
    private readonly windowProvider: () => BrowserWindow | null,
    private readonly eventSink?: (event: RuntimeEvent) => void,
  ) {}

  async init(): Promise<void> {
    const store = await loadDesktopStore()
    for (const session of store.sessions) {
      this.sessions.set(session.id, normalizeStoredSession(session))
    }
    this.activeSessionId = store.activeSessionId
  }

  list(): DesktopSession[] {
    return [...this.sessions.values()].sort((a, b) => {
      if (a.id === this.activeSessionId) return -1
      if (b.id === this.activeSessionId) return 1
      return b.updatedAt - a.updatedAt
    })
  }

  async create(cwd: string, agent?: AgentSessionConfig): Promise<DesktopSession> {
    const session = createSession(cwd, agent)
    this.sessions.set(session.id, session)
    this.activeSessionId = session.id
    this.startHost(session)
    await this.persist()
    this.emit({ type: 'session-updated', session })
    return session
  }

  async resume(sessionId: string): Promise<DesktopSession> {
    const session = this.getSession(sessionId)
    if (!this.hosts.has(sessionId)) {
      this.startHost(session)
    }
    this.emit({ type: 'session-updated', session })
    return session
  }

  async focus(sessionId: string): Promise<void> {
    this.getSession(sessionId)
    this.activeSessionId = sessionId
    await this.persist()
    this.emit({ type: 'session-focused', sessionId })
  }

  async close(sessionId: string): Promise<void> {
    const host = this.hosts.get(sessionId)
    this.hosts.delete(sessionId)
    this.stderrBySession.delete(sessionId)
    this.streamingMessageBySession.delete(sessionId)
    this.pendingPermissionRequestsBySession.delete(sessionId)
    const removed = this.sessions.delete(sessionId)
    if (this.activeSessionId === sessionId) {
      const nextActive = [...this.sessions.values()].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      )[0]
      this.activeSessionId = nextActive?.id
    }
    host?.close()
    if (removed) {
      await this.persist()
      this.emit({ type: 'session-closed', sessionId })
      if (this.activeSessionId) {
        this.emit({ type: 'session-focused', sessionId: this.activeSessionId })
      }
    }
  }

  renameSession(sessionId: string, title: string): DesktopSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    const trimmed = title.trim()
    if (!trimmed) throw new Error('Title must not be empty')
    session.title = trimmed
    session.updatedAt = Date.now()
    this.emit({ type: 'session-updated', session })
    return session
  }

  async send(sessionId: string, text: string, attachments?: DesktopAttachment[]): Promise<void> {
    const session = this.getSession(sessionId)
    const host = this.hosts.get(sessionId) ?? this.startHost(session)
    this.streamingMessageBySession.delete(sessionId)
    const message: DesktopMessage = {
      id: randomUUID(),
      role: 'user',
      text,
      ...(attachments?.length ? { attachments } : {}),
    }
    session.messages.push(message)
    session.activity = 'sending'
    session.updatedAt = Date.now()
    await this.persist()
    this.emit({ type: 'session-updated', session })
    this.emit({ type: 'runtime-message', sessionId: session.id, message: { type: 'outgoing:user-send', text, timestamp: Date.now(), attachments } })
    host.sendMessage(text, attachments)
  }

  async answerQuestion(
    sessionId: string,
    toolUseId: string,
    answers: Record<string, string>,
    questions: Array<{question: string; options: Array<{label: string; description: string}>}>,
  ): Promise<void> {
    const session = this.getSession(sessionId)
    const host = this.hosts.get(sessionId) ?? this.startHost(session)
    host.answerQuestion(toolUseId, answers, questions)
    this.emit({ type: 'runtime-message', sessionId: session.id, message: { type: 'question:answered', toolUseId, answers, timestamp: Date.now() } })
  }

  async cancel(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    this.pendingPermissionRequestsBySession.delete(sessionId)
    session.activity = 'cancelling'
    this.finishStreamingMessages(session)
    session.messages.push({
      id: randomUUID(),
      role: 'system',
      text: 'Cancellation requested',
    })
    session.updatedAt = Date.now()
    await this.persist()
    this.emit({ type: 'session-updated', session })
    this.hosts.get(sessionId)?.cancel()
  }

  async clearDesktopView(sessionId: string): Promise<DesktopSession> {
    const session = this.getSession(sessionId)
    this.streamingMessageBySession.delete(sessionId)
    this.pendingPermissionRequestsBySession.delete(sessionId)
    session.messages = []
    session.toolUses = []
    session.agentTasks = []
    session.runtimeEvents = []
    session.lastError = undefined
    session.activity = 'idle'
    session.updatedAt = Date.now()
    await this.persist()
    this.emit({ type: 'session-updated', session })
    return session
  }

  async updateLayout(
    sessionId: string,
    patch: DesktopSessionLayoutPatch,
  ): Promise<DesktopSession> {
    const session = this.getSession(sessionId)
    session.layout = {
      ...session.layout,
      ...patch,
      sidebarWidth: clampNumber(
        patch.sidebarWidth ?? session.layout.sidebarWidth,
        220,
        420,
      ),
      workspaceRatio: clampNumber(
        patch.workspaceRatio ?? session.layout.workspaceRatio,
        0.3,
        0.75,
      ),
    }
    session.updatedAt = Date.now()
    await this.persist()
    this.emit({ type: 'session-updated', session })
    return session
  }

  async previewAgentTaskOutput(
    sessionId: string,
    input: AgentTaskOutputPreviewInput,
  ): Promise<AgentTaskOutputPreviewResult> {
    const session = this.getSession(sessionId)
    const task = (session.agentTasks ?? []).find(item => item.id === input.taskId)
    if (!task) throw new Error(`Agent task not found: ${input.taskId}`)
    if (!task.outputFile) {
      throw new Error(`Agent task has no output file: ${input.taskId}`)
    }
    const maxBytes = clampNumber(input.maxBytes ?? 65_536, 1024, 262_144)
    const preview = await readTextFilePreview(task.outputFile, maxBytes)
    task.outputPreview = preview.contents
    session.updatedAt = Date.now()
    await this.persist()
    this.emit({ type: 'session-updated', session })
    return {
      taskId: input.taskId,
      path: task.outputFile,
      ...preview,
    }
  }

  respondToPermission(
    sessionId: string,
    requestId: string,
    response: PermissionResponse,
  ): void {
    const host = this.hosts.get(sessionId)
    if (!host) throw new Error(`Claude runtime is not running for session ${sessionId}`)
    host.respondToPermission(requestId, response)
    const pending = this.pendingPermissionRequestsBySession.get(sessionId)
    pending?.delete(requestId)
    const hasPendingPermissions = Boolean(pending && pending.size > 0)
    if (pending?.size === 0) {
      this.pendingPermissionRequestsBySession.delete(sessionId)
    }
    const session = this.getSession(sessionId)
    session.activity = hasPendingPermissions
      ? 'waiting_permission'
      : response.behavior === 'deny' ? 'idle' : 'streaming'
    session.updatedAt = Date.now()
    void this.persist().then(() => {
      this.emit({ type: 'session-updated', session })
    })
  }

  getSession(sessionId: string): DesktopSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Unknown session: ${sessionId}`)
    return session
  }

  killAll(): void {
    for (const host of this.hosts.values()) {
      host.close()
    }
    this.hosts.clear()
    this.streamingMessageBySession.clear()
  }

  private startHost(session: DesktopSession): SessionHost {
    session.status = 'running'
    session.activity = 'idle'
    session.lastError = undefined
    session.updatedAt = Date.now()
    const host = createSessionHost({
      sessionId: session.id,
      cwd: session.cwd,
      agent: session.agent,
    })
    this.hosts.set(session.id, host)
    this.stderrBySession.set(session.id, [])
    this.pendingPermissionRequestsBySession.set(session.id, new Set())

    host.on('message', async raw => {
      this.emit({ type: 'runtime-message', sessionId: session.id, message: raw })
      this.applyRuntimeActivity(session, raw)
      this.applyAgentTaskUpdate(session, raw)
      const streamUpdated = await this.applyStreamTextUpdate(session, raw)
      if (streamUpdated) return
      if (isResultMessage(raw)) {
        this.finishStreamingMessages(session)
        session.updatedAt = Date.now()
        await this.persist()
        this.emit({ type: 'session-updated', session })
        return
      }
      const desktopMessages = toDesktopMessages(raw)
      if (desktopMessages.length > 0) {
        for (const desktopMessage of desktopMessages) {
          if (isDuplicateRuntimeUserEcho(session, desktopMessage)) continue
          const streamingMessageIds =
            desktopMessage.role === 'assistant' || desktopMessage.role === 'thinking'
              ? this.consumeStreamingMessagesForRole(session, desktopMessage.role)
              : []
          const streamingIndex = streamingMessageIds.length > 0
            ? session.messages.findIndex(message => message.id === streamingMessageIds[0])
            : -1
          if (
            (desktopMessage.role === 'assistant' || desktopMessage.role === 'thinking') &&
            streamingIndex >= 0
          ) {
            session.messages[streamingIndex] = desktopMessage
            const extraStreamingIds = new Set(streamingMessageIds.slice(1))
            if (extraStreamingIds.size > 0) {
              session.messages = session.messages.filter(message =>
                !extraStreamingIds.has(message.id),
              )
            }
          } else {
            session.messages.push(desktopMessage)
          }
        }
        if (desktopMessages.some(message =>
          message.role === 'assistant' || message.role === 'thinking'
        )) {
          this.finishStreamingMessages(session)
        }
        session.updatedAt = Date.now()
        await this.persist()
        this.emit({ type: 'session-updated', session })
      }
    })

    host.on('stderr', message => {
      const text = String(message)
      const stderr = this.stderrBySession.get(session.id) ?? []
      stderr.push(text)
      this.stderrBySession.set(session.id, stderr.slice(-12))
      if (text.trim()) {
        this.emit({ type: 'runtime-message', sessionId: session.id, message: { type: 'runtime:stderr', text, timestamp: Date.now() } })
      }
    })

    host.on('exit', async (code, signal) => {
      if (!this.sessions.has(session.id)) {
        this.hosts.delete(session.id)
        this.stderrBySession.delete(session.id)
        this.pendingPermissionRequestsBySession.delete(session.id)
        return
      }
      const failed = code !== 0 && code !== null
      session.status = failed ? 'error' : 'stopped'
      session.activity = 'idle'
      this.finishStreamingMessages(session)
      if (failed) {
        const stderr = this.stderrBySession.get(session.id) ?? []
        session.lastError =
          stderr.join('').trim() ||
          `Claude runtime exited with code ${code}${signal ? ` (${signal})` : ''}`
        this.emit({
          type: 'runtime-error',
          sessionId: session.id,
          message: session.lastError,
        })
      }
      session.updatedAt = Date.now()
      this.hosts.delete(session.id)
      this.stderrBySession.delete(session.id)
      this.streamingMessageBySession.delete(session.id)
      this.pendingPermissionRequestsBySession.delete(session.id)
      await this.persist()
      this.emit({ type: 'session-updated', session })
    })

    return host
  }

  private async applyStreamTextUpdate(
    session: DesktopSession,
    raw: unknown,
  ): Promise<boolean> {
    const update = toStreamTextUpdate(raw)
    if (!update) return false
    const pending = this.pendingPermissionRequestsBySession.get(session.id)
    session.activity = pending && pending.size > 0 ? 'waiting_permission' : 'streaming'
    const streamingMessages =
      this.streamingMessageBySession.get(session.id) ?? new Map<StreamingMessageKey, string>()
    this.streamingMessageBySession.set(session.id, streamingMessages)
    const key = streamingKey(update.role, update.streamKey)
    let messageId = streamingMessages.get(key)
    let message = messageId
      ? session.messages.find(item => item.id === messageId)
      : undefined
    if (!message || message.role !== update.role) {
      message = {
        id: update.id ?? randomUUID(),
        role: update.role,
        text: '',
        streaming: true,
        raw: update.raw,
      }
      session.messages.push(message)
      messageId = message.id
      streamingMessages.set(key, messageId)
    }
    const baseText =
      update.role === 'thinking' && message.text === STREAMING_THINKING_PLACEHOLDER
        ? ''
        : message.text
    message.text = update.mode === 'snapshot'
      ? update.text || (update.role === 'thinking' ? STREAMING_THINKING_PLACEHOLDER : '')
      : `${baseText}${update.text}`
    message.streaming = true
    message.raw = update.raw
    session.updatedAt = Date.now()
    await this.persist()
    this.emit({ type: 'session-updated', session })
    return true
  }

  private consumeStreamingMessagesForRole(
    session: DesktopSession,
    role: 'assistant' | 'thinking',
  ): string[] {
    const streamingMessages = this.streamingMessageBySession.get(session.id)
    if (!streamingMessages) return []
    const entries = [...streamingMessages.entries()]
      .filter(([key]) => key.startsWith(`${role}:`))
    if (entries.length === 0) return []
    const messageOrder = new Map(
      session.messages.map((message, index) => [message.id, index]),
    )
    const messageIds = entries
      .map(([, messageId]) => messageId)
      .filter((messageId, index, all) => all.indexOf(messageId) === index)
      .sort((left, right) =>
        (messageOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (messageOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
      )
    for (const [key] of entries) {
      streamingMessages.delete(key)
    }
    if (streamingMessages.size === 0) {
      this.streamingMessageBySession.delete(session.id)
    }
    return messageIds
  }

  private finishStreamingMessages(session: DesktopSession): void {
    const streamingMessages = this.streamingMessageBySession.get(session.id)
    if (!streamingMessages) return
    for (const messageId of streamingMessages.values()) {
      const message = session.messages.find(item => item.id === messageId)
      if (message) message.streaming = false
    }
    this.streamingMessageBySession.delete(session.id)
  }

  private applyAgentTaskUpdate(session: DesktopSession, raw: unknown): void {
    const update = extractAgentTaskUpdate(raw)
    if (!update) return
    const tasks = session.agentTasks ?? []
    const existingIndex = tasks.findIndex(task =>
      task.id === update.id ||
      Boolean(update.toolUseId && task.toolUseId === update.toolUseId),
    )
    session.agentTasks =
      existingIndex >= 0
        ? tasks.map((task, index) => index === existingIndex ? mergeAgentTask(task, update) : task)
        : [...tasks, update]
    session.toolUses = mergeToolTimeline(session.toolUses, update.toolTimeline)?.slice(-100) ?? []
    applyTeamUpdate(session, update)
    session.runtimeEvents = [...(session.runtimeEvents ?? []), raw].slice(-200)
  }

  private applyRuntimeActivity(session: DesktopSession, raw: unknown): void {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) return
    const message = raw as {
      type?: unknown
      request_id?: unknown
    }

    if (message.type === 'control_request' && typeof message.request_id === 'string') {
      const pending =
        this.pendingPermissionRequestsBySession.get(session.id) ?? new Set<string>()
      pending.add(message.request_id)
      this.pendingPermissionRequestsBySession.set(session.id, pending)
      session.activity = 'waiting_permission'
      return
    }

    if (message.type === 'result') {
      const pending = this.pendingPermissionRequestsBySession.get(session.id)
      session.activity = pending && pending.size > 0 ? 'waiting_permission' : 'idle'
      return
    }

    if (message.type === 'assistant') {
      const pending = this.pendingPermissionRequestsBySession.get(session.id)
      session.activity = pending && pending.size > 0 ? 'waiting_permission' : 'idle'
    }
  }

  private async persist(): Promise<void> {
    const store = await loadDesktopStore()
    await saveDesktopStore({
      ...store,
      sessions: this.list(),
      activeSessionId: this.activeSessionId,
    })
  }

  private emit(event: RuntimeEvent): void {
    if (this.eventSink) {
      this.eventSink(event)
      return
    }
    safeSendDesktopEvent(this.windowProvider(), event)
  }
}

function mergeAgentTask(
  current: AgentTaskInfo,
  update: AgentTaskInfo,
): AgentTaskInfo {
  return {
    ...current,
    ...update,
    toolTimeline: mergeToolTimeline(current.toolTimeline, update.toolTimeline),
  }
}

function mergeToolTimeline(
  current: AgentTaskToolEvent[] = [],
  update: AgentTaskToolEvent[] = [],
): AgentTaskToolEvent[] | undefined {
  if (current.length === 0 && update.length === 0) return undefined
  const byId = new Map<string, AgentTaskToolEvent>()
  for (const event of [...current, ...update]) {
    byId.set(event.id, event)
  }
  return [...byId.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-50)
}

function applyTeamUpdate(session: DesktopSession, update: AgentTaskInfo): void {
  if (update.lastToolName === 'TeamCreate') {
    const name = update.description || update.id
    session.team = {
      ...(session.team?.name === name ? session.team : { members: [] }),
      name,
      status: 'running',
      active: true,
    }
    return
  }
  if (update.lastToolName === 'TeamDelete') {
    const name = update.description || session.team?.name || update.id
    session.team = {
      ...(session.team?.name === name ? session.team : { members: [] }),
      name,
      status: 'stopped',
      active: false,
    }
  }
}

async function readTextFilePreview(
  path: string,
  maxBytes: number,
): Promise<{ contents: string; bytesRead: number; truncated: boolean }> {
  const file = await open(path, 'r')
  try {
    const stats = await file.stat()
    const start = Math.max(0, stats.size - maxBytes)
    const length = stats.size - start
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await file.read(buffer, 0, length, start)
    return {
      contents: buffer.subarray(0, bytesRead).toString('utf8'),
      bytesRead,
      truncated: start > 0,
    }
  } finally {
    await file.close()
  }
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}
