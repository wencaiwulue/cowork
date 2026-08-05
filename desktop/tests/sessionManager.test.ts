import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DesktopSession } from '../main/ipc'
import { DesktopSessionManager, normalizeStoredSession } from '../main/sessionManager'
import { loadDesktopStore, saveDesktopStore } from '../main/store'

class FakeProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = {
    write: vi.fn(),
  }
  kill = vi.fn()
}

const fakeProcesses: FakeProcess[] = []
type FakeHost = EventEmitter & {
  sendMessage: ReturnType<typeof vi.fn>
  respondToPermission: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

const fakeHosts: FakeHost[] = []
// Vitest hoists vi.mock while Bun's Vitest shim lacks vi.hoisted, so these must be var bindings.
var loadDesktopStoreMock: ReturnType<typeof vi.fn>
var saveDesktopStoreMock: ReturnType<typeof vi.fn>

vi.mock('../main/sessionHost', () => ({
  createSessionHost: vi.fn(options => {
    const child = new FakeProcess()
    fakeProcesses.push(child)
    const host = new EventEmitter() as FakeHost
    fakeHosts.push(host)
    Object.assign(host, {
      sessionId: options.sessionId,
      cwd: options.cwd,
      sendMessage: vi.fn(),
      respondToPermission: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
    })
    return host
  }),
}))

vi.mock('../main/store', () => ({
  loadDesktopStore: loadDesktopStoreMock = vi.fn(async () => ({ sessions: [] })),
  saveDesktopStore: saveDesktopStoreMock = vi.fn(async () => undefined),
}))

beforeEach(() => {
  fakeProcesses.length = 0
  fakeHosts.length = 0
  loadDesktopStoreMock.mockResolvedValue({ sessions: [] })
  saveDesktopStoreMock.mockClear()
})

async function flushAsyncEvents(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

function storedSession(): DesktopSession {
  return {
    id: 'session-1',
    title: 'project',
    cwd: '/tmp/project',
    createdAt: 1,
    updatedAt: 2,
    status: 'running',
    activity: 'streaming',
    lastError: 'old runtime error',
    messages: [],
    toolUses: [{
      id: 'toolu-agent:started',
      toolUseId: 'toolu-agent',
      toolName: 'Agent',
      status: 'started',
      timestamp: 1,
      summary: 'review diff',
    }],
    agentTasks: [{
      id: 'agent-123',
      status: 'running',
      description: 'review diff',
    }],
    runtimeEvents: [{ type: 'assistant' }],
    layout: {
      sidebarWidth: 280,
      workspaceRatio: 0.5,
      activePane: 'terminal',
      primaryView: 'teammates',
      terminalId: 'stale-terminal',
      previewUrl: 'https://claude.ai',
      settingsActiveSection: 'settings-mcp',
      expandedPaths: ['/tmp/project/src'],
    },
  }
}

describe('normalizeStoredSession', () => {
  it('clears volatile runtime state loaded from disk', () => {
    const normalized = normalizeStoredSession(storedSession())

    expect(normalized.status).toBe('stopped')
    expect(normalized.activity).toBe('idle')
    expect(normalized.lastError).toBeUndefined()
    expect(normalized.layout.terminalId).toBeUndefined()
    expect(normalized.layout.activePane).toBe('terminal')
    expect(normalized.layout.primaryView).toBe('teams')
    expect(normalized.layout.previewUrl).toBe('')
    expect(normalized.layout.settingsActiveSection).toBe('settings-mcp')
    expect(normalized.runtimeEvents).toEqual([])
    expect(normalized.toolUses).toHaveLength(1)
    expect(normalized.agentTasks).toHaveLength(1)
  })

  it('defaults missing first-class agent section layout state', () => {
    const session = storedSession()
    delete session.layout.agentsActiveSection

    const normalized = normalizeStoredSession(session)

    expect(normalized.layout.agentsActiveSection).toBe('agents-catalog')
  })

  it('migrates legacy scheduled task sections out of grouped settings layout state', () => {
    const session = storedSession()
    session.layout.activePane = 'tasks'
    session.layout.primaryView = 'tasks'
    session.layout.settingsActiveSection = 'tasks-global-tasks'

    const normalized = normalizeStoredSession(session)

    expect(normalized.layout.settingsActiveSection).toBe('settings-runtime')
    expect(normalized.layout.tasksActiveSection).toBe('tasks-global-tasks')
  })

  it('derives a primary view for stored sessions created before primary navigation existed', () => {
    const agentsSession = storedSession()
    agentsSession.layout.activePane = 'agents'
    delete agentsSession.layout.primaryView

    const settingsSession = storedSession()
    settingsSession.layout.activePane = 'settings'
    delete settingsSession.layout.primaryView

    const tasksSession = storedSession()
    tasksSession.layout.activePane = 'tasks'
    delete tasksSession.layout.primaryView

    const teamsSession = storedSession()
    teamsSession.layout.activePane = 'teams'
    delete teamsSession.layout.primaryView

    const legacyTeamsSession = storedSession()
    legacyTeamsSession.layout.activePane = 'agents'
    legacyTeamsSession.layout.primaryView = 'teams'

    const chatSession = storedSession()
    chatSession.layout.activePane = 'preview'
    delete chatSession.layout.primaryView

    expect(normalizeStoredSession(agentsSession).layout.primaryView).toBe('agents')
    expect(normalizeStoredSession(settingsSession).layout.primaryView).toBe('settings')
    expect(normalizeStoredSession(tasksSession).layout.primaryView).toBe('tasks')
    expect(normalizeStoredSession(teamsSession).layout.primaryView).toBe('teams')
    expect(normalizeStoredSession(legacyTeamsSession).layout.activePane).toBe('teams')
    expect(normalizeStoredSession(legacyTeamsSession).layout.primaryView).toBe('teams')
    expect(normalizeStoredSession(chatSession).layout.primaryView).toBe('chat')
  })
})

describe('DesktopSessionManager focus and resume events', () => {
  it('emits session-updated on resume and session-focused on focus', async () => {
    const events: unknown[] = []
    const window = {
      webContents: {
        send: vi.fn((_channel, event) => events.push(event)),
      },
    }
    const manager = new DesktopSessionManager(() => window as never)
    const session = await manager.create('/tmp/project')
    events.length = 0

    await manager.resume(session.id)
    await manager.focus(session.id)

    expect(events).toEqual([
      { type: 'session-updated', session: expect.objectContaining({ id: session.id }) },
      { type: 'session-focused', sessionId: session.id },
    ])
  })

  it('drops runtime events when the window has been destroyed', async () => {
    const send = vi.fn()
    const window = {
      isDestroyed: () => true,
      webContents: {
        isDestroyed: () => false,
        send,
      },
    }
    const manager = new DesktopSessionManager(() => window as never)

    await manager.create('/tmp/project')

    expect(send).not.toHaveBeenCalled()
  })

  it('removes closed sessions and focuses the next newest session', async () => {
    const events: unknown[] = []
    const window = {
      webContents: {
        send: vi.fn((_channel, event) => events.push(event)),
      },
    }
    const manager = new DesktopSessionManager(() => window as never)
    const first = await manager.create('/tmp/first')
    const second = await manager.create('/tmp/second')
    await manager.focus(first.id)
    events.length = 0

    await manager.close(first.id)

    expect(manager.list().map(session => session.id)).toEqual([second.id])
    expect(events).toEqual([
      { type: 'session-closed', sessionId: first.id },
      { type: 'session-focused', sessionId: second.id },
    ])
  })

  it('clears the persisted desktop transcript view without closing the runtime host', async () => {
    const events: unknown[] = []
    const manager = new DesktopSessionManager(
      () => null,
      event => events.push(event),
    )
    const session = await manager.create('/tmp/project')
    const current = manager.getSession(session.id)
    current.messages = [
      { id: 'user-1', role: 'user', text: 'hello' },
      { id: 'assistant-1', role: 'assistant', text: 'hi' },
    ]
    current.toolUses = [{
      id: 'tool-1',
      toolUseId: 'toolu-1',
      toolName: 'Bash',
      status: 'started',
      timestamp: 1,
    }]
    current.agentTasks = [{
      id: 'agent-1',
      status: 'running',
      description: 'review',
    }]
    current.runtimeEvents = [{ type: 'assistant' }]
    current.lastError = 'old error'
    current.activity = 'streaming'
    events.length = 0
    saveDesktopStoreMock.mockClear()

    const cleared = await manager.clearDesktopView(session.id)

    expect(cleared.messages).toEqual([])
    expect(cleared.toolUses).toEqual([])
    expect(cleared.agentTasks).toEqual([])
    expect(cleared.runtimeEvents).toEqual([])
    expect(cleared.lastError).toBeUndefined()
    expect(cleared.activity).toBe('idle')
    expect(fakeHosts).toHaveLength(1)
    expect(fakeHosts[0]?.close).not.toHaveBeenCalled()
    expect(saveDesktopStoreMock).toHaveBeenCalled()
    expect(events).toEqual([
      { type: 'session-updated', session: expect.objectContaining({ id: session.id, messages: [] }) },
    ])
  })

  it('clears optional layout fields when patches set them to undefined', async () => {
    const manager = new DesktopSessionManager(() => null)
    const session = await manager.create('/tmp/project')

    await manager.updateLayout(session.id, {
      activeFile: 'src/app.txt',
      terminalId: 'terminal-1',
      previewUrl: 'http://localhost:3000',
      selectedAgentType: 'desktop-smoke-agent',
      selectedAgentSource: 'built-in',
      selectedTeamName: 'frontend',
      selectedTeamRecipient: 'builder',
      selectedGlobalTaskId: 'task-1',
      selectedProjectTaskId: 'project-task-1',
      selectedMcpName: 'playwright',
      selectedMcpSourcePath: '/tmp/.kode.mcp.json',
      selectedMcpScope: 'project',
      selectedSkillName: 'existing-skill',
      selectedSkillPath: '/tmp/skills/existing-skill',
      selectedSkillScope: 'project',
      selectedPluginIdentity: '["user","demo@marketplace","demo@marketplace"]',
    })
    await manager.updateLayout(session.id, {
      activeFile: undefined,
      terminalId: undefined,
      previewUrl: undefined,
      selectedAgentType: undefined,
      selectedAgentSource: undefined,
      selectedTeamName: undefined,
      selectedTeamRecipient: undefined,
      selectedGlobalTaskId: undefined,
      selectedProjectTaskId: undefined,
      selectedMcpName: undefined,
      selectedMcpSourcePath: undefined,
      selectedMcpScope: undefined,
      selectedSkillName: undefined,
      selectedSkillPath: undefined,
      selectedSkillScope: undefined,
      selectedPluginIdentity: undefined,
    })

    expect(manager.getSession(session.id).layout).toMatchObject({
      activeFile: undefined,
      terminalId: undefined,
      previewUrl: undefined,
      selectedAgentType: undefined,
      selectedAgentSource: undefined,
      selectedTeamName: undefined,
      selectedTeamRecipient: undefined,
      selectedGlobalTaskId: undefined,
      selectedProjectTaskId: undefined,
      selectedMcpName: undefined,
      selectedMcpSourcePath: undefined,
      selectedMcpScope: undefined,
      selectedSkillName: undefined,
      selectedSkillPath: undefined,
      selectedSkillScope: undefined,
      selectedPluginIdentity: undefined,
    })
  })

  it('starts agent sessions on the agent primary view', async () => {
    const manager = new DesktopSessionManager(() => null)
    const session = await manager.create('/tmp/project', {
      agentType: 'reviewer',
      model: 'sonnet',
      permissionMode: 'plan',
      isolation: 'worktree',
    })

    expect(session.layout.activePane).toBe('agents')
    expect(session.layout.primaryView).toBe('agents')
  })

  it('keeps sessions running when the runtime writes warning stderr', async () => {
    const events: unknown[] = []
    const window = {
      webContents: {
        send: vi.fn((_channel, event) => events.push(event)),
      },
    }
    const manager = new DesktopSessionManager(() => window as never)
    const session = await manager.create('/tmp/project')
    events.length = 0

    fakeHosts[0].emit('stderr', 'warning: retrying provider request\n')
    await flushAsyncEvents()

    expect(manager.getSession(session.id)).toEqual(
      expect.objectContaining({
        status: 'running',
        activity: 'idle',
        lastError: undefined,
      }),
    )
    expect(events).toEqual([])
  })

  it('marks sessions failed on non-zero runtime exit using captured stderr', async () => {
    const events: unknown[] = []
    const window = {
      webContents: {
        send: vi.fn((_channel, event) => events.push(event)),
      },
    }
    const manager = new DesktopSessionManager(() => window as never)
    const session = await manager.create('/tmp/project')
    events.length = 0

    fakeHosts[0].emit('stderr', 'fatal provider error\n')
    fakeHosts[0].emit('exit', 2, null)
    await flushAsyncEvents()

    expect(manager.getSession(session.id)).toEqual(
      expect.objectContaining({
        status: 'error',
        activity: 'idle',
        lastError: 'fatal provider error',
      }),
    )
    expect(events).toEqual([
      {
        type: 'runtime-error',
        sessionId: session.id,
        message: 'fatal provider error',
      },
      {
        type: 'session-updated',
        session: expect.objectContaining({
          id: session.id,
          status: 'error',
          activity: 'idle',
          lastError: 'fatal provider error',
        }),
      },
    ])
  })

  it('uses an injected event sink for session updates', async () => {
    const sentEvents: unknown[] = []
    const window = {
      webContents: {
        send: vi.fn(),
      },
    }
    const manager = new DesktopSessionManager(
      () => window as never,
      event => sentEvents.push(event),
    )

    const session = await manager.create('/tmp/project')

    expect(sentEvents).toEqual([
      {
        type: 'session-updated',
        session: expect.objectContaining({ id: session.id }),
      },
    ])
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('marks in-flight streamed messages complete when the runtime exits with an error', async () => {
    const manager = new DesktopSessionManager(() => null)
    const session = await manager.create('/tmp/project')

    fakeHosts[0].emit('message', {
      type: 'stream_event',
      uuid: 'delta-1',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'partial answer' },
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).messages).toMatchObject([
      { role: 'assistant', text: 'partial answer', streaming: true },
    ])

    fakeHosts[0].emit('stderr', 'fatal provider error\n')
    fakeHosts[0].emit('exit', 2, null)
    await flushAsyncEvents()

    expect(manager.getSession(session.id).messages).toMatchObject([
      { role: 'assistant', text: 'partial answer', streaming: false },
    ])
    expect(manager.getSession(session.id)).toEqual(
      expect.objectContaining({
        status: 'error',
        activity: 'idle',
        lastError: 'fatal provider error',
      }),
    )
  })

  it('persists visible feedback when cancelling a session turn', async () => {
    const events: unknown[] = []
    const window = {
      webContents: {
        send: vi.fn((_channel, event) => events.push(event)),
      },
    }
    const manager = new DesktopSessionManager(() => window as never)
    const session = await manager.create('/tmp/project')
    events.length = 0

    await manager.cancel(session.id)

    expect(fakeHosts[0].cancel).toHaveBeenCalled()
    expect(manager.getSession(session.id).messages.at(-1)).toEqual(
      expect.objectContaining({
        role: 'system',
        text: 'Cancellation requested',
      }),
    )
    expect(manager.getSession(session.id).activity).toBe('cancelling')
    expect(events).toEqual([
      {
        type: 'session-updated',
        session: expect.objectContaining({
          id: session.id,
          activity: 'cancelling',
          messages: expect.arrayContaining([
            expect.objectContaining({ text: 'Cancellation requested' }),
          ]),
        }),
      },
    ])
  })

  it('preserves desktop config when persisting sessions', async () => {
    loadDesktopStoreMock.mockResolvedValue({
      sessions: [],
      config: {
        proxy: {
          enabled: true,
          url: 'socks5://127.0.0.1:18999',
        },
      },
    })
    const manager = new DesktopSessionManager(() => null)

    await manager.create('/tmp/project')

    expect(saveDesktopStore).toHaveBeenCalledWith(expect.objectContaining({
      config: {
        proxy: {
          enabled: true,
          url: 'socks5://127.0.0.1:18999',
        },
      },
      sessions: [expect.objectContaining({ cwd: '/tmp/project' })],
    }))
  })

  it('clears pending permission state when cancelling a session turn', async () => {
    const manager = new DesktopSessionManager(() => null)
    const session = await manager.create('/tmp/project')

    fakeHosts[0].emit('message', {
      type: 'control_request',
      uuid: 'permission-1',
      request_id: 'request-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        description: 'Run pwd',
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).activity).toBe('waiting_permission')

    await manager.cancel(session.id)
    fakeHosts[0].emit('message', {
      type: 'assistant',
      uuid: 'interrupt-response',
      message: {
        content: [{ type: 'text', text: 'interrupt handled' }],
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).activity).toBe('idle')
  })

  it('marks in-flight streamed messages complete when cancelling a turn', async () => {
    const manager = new DesktopSessionManager(() => null)
    const session = await manager.create('/tmp/project')

    fakeHosts[0].emit('message', {
      type: 'stream_event',
      uuid: 'delta-1',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'partial answer' },
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).messages).toMatchObject([
      { role: 'assistant', text: 'partial answer', streaming: true },
    ])

    await manager.cancel(session.id)

    expect(manager.getSession(session.id).messages).toMatchObject([
      { role: 'assistant', text: 'partial answer', streaming: false },
      { role: 'system', text: 'Cancellation requested' },
    ])
  })

  it('accumulates streamed assistant deltas and replaces them with the final assistant message', async () => {
    const events: unknown[] = []
    const window = {
      webContents: {
        send: vi.fn((_channel, event) => events.push(event)),
      },
    }
    const manager = new DesktopSessionManager(() => window as never)
    const session = await manager.create('/tmp/project')
    events.length = 0

    fakeHosts[0].emit('message', {
      type: 'stream_event',
      uuid: 'delta-1',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'hello ' },
      },
    })
    await flushAsyncEvents()
    fakeHosts[0].emit('message', {
      type: 'stream_event',
      uuid: 'delta-2',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'desktop' },
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).messages).toMatchObject([{
      role: 'assistant',
      text: 'hello desktop',
      streaming: true,
    }])
    expect(manager.getSession(session.id).activity).toBe('streaming')

    fakeHosts[0].emit('message', {
      type: 'assistant',
      uuid: 'assistant-final',
      message: {
        content: [{ type: 'text', text: 'hello desktop final' }],
      },
    })
    await flushAsyncEvents()

    const finalMessages = manager.getSession(session.id).messages
    expect(finalMessages).toEqual([
      expect.objectContaining({
        id: 'assistant-final',
        role: 'assistant',
        text: 'hello desktop final',
      }),
    ])
    expect(finalMessages[0]).not.toHaveProperty('streaming')
    expect(manager.getSession(session.id).activity).toBe('idle')
  })

  it('keeps indexed assistant streams separate and removes extra streams when final text arrives', async () => {
    const manager = new DesktopSessionManager(() => null)
    const session = await manager.create('/tmp/project')

    fakeHosts[0].emit('message', {
      type: 'stream_event',
      uuid: 'delta-block-0',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'first block' },
      },
    })
    await flushAsyncEvents()
    fakeHosts[0].emit('message', {
      type: 'stream_event',
      uuid: 'delta-block-1',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'second block' },
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).messages).toMatchObject([
      { role: 'assistant', text: 'first block', streaming: true },
      { role: 'assistant', text: 'second block', streaming: true },
    ])

    fakeHosts[0].emit('message', {
      type: 'assistant',
      uuid: 'assistant-final-indexed',
      message: {
        content: [
          { type: 'text', text: 'first block' },
          { type: 'text', text: 'second block' },
        ],
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).messages).toEqual([
      expect.objectContaining({
        id: 'assistant-final-indexed',
        role: 'assistant',
        text: 'first block\nsecond block',
      }),
    ])
  })

  it('does not duplicate optimistic user messages echoed by the runtime', async () => {
    const manager = new DesktopSessionManager(() => null)
    const session = await manager.create('/tmp/project')

    await manager.send(session.id, 'hello desktop')
    fakeHosts[0].emit('message', {
      type: 'user',
      uuid: 'runtime-user-echo',
      message: {
        content: [{ type: 'text', text: 'hello desktop' }],
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).messages).toMatchObject([
      { role: 'user', text: 'hello desktop' },
    ])
  })

  it('does not duplicate runtime user echoes with normalized whitespace', async () => {
    const manager = new DesktopSessionManager(() => null)
    const session = await manager.create('/tmp/project')

    await manager.send(session.id, 'hello desktop')
    fakeHosts[0].emit('message', {
      type: 'user',
      uuid: 'runtime-user-echo-whitespace',
      message: {
        content: [{ type: 'text', text: 'hello   desktop' }],
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).messages).toMatchObject([
      { role: 'user', text: 'hello desktop' },
    ])
  })

  it('does not render turn result text as a duplicate system chat bubble', async () => {
    const manager = new DesktopSessionManager(() => null)
    const session = await manager.create('/tmp/project')

    fakeHosts[0].emit('message', {
      type: 'assistant',
      uuid: 'assistant-final',
      message: {
        content: [{ type: 'text', text: 'desktop response' }],
      },
    })
    await flushAsyncEvents()
    fakeHosts[0].emit('message', {
      type: 'result',
      subtype: 'success',
      result: 'desktop response',
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).messages).toMatchObject([
      { role: 'assistant', text: 'desktop response' },
    ])
  })

  it('keeps runtime system status events out of the visible chat timeline', async () => {
    const manager = new DesktopSessionManager(() => null)
    const session = await manager.create('/tmp/project')

    fakeHosts[0].emit('message', {
      type: 'system',
      subtype: 'status',
      message: 'Working...',
    })
    fakeHosts[0].emit('message', {
      type: 'system',
      subtype: 'task_progress',
      message: 'desktop response',
    })
    await flushAsyncEvents()

    const updatedSession = manager.getSession(session.id)
    expect(updatedSession.messages).toEqual([])
  })

  it('keeps thinking and assistant streams separate through final mixed messages', async () => {
    const manager = new DesktopSessionManager(() => null)
    const session = await manager.create('/tmp/project')

    fakeHosts[0].emit('message', {
      type: 'stream_event',
      uuid: 'thinking-delta',
      event: {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'checking ' },
      },
    })
    await flushAsyncEvents()
    fakeHosts[0].emit('message', {
      type: 'stream_event',
      uuid: 'assistant-delta',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'answering' },
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).messages).toMatchObject([
      { role: 'thinking', text: 'checking ', streaming: true },
      { role: 'assistant', text: 'answering', streaming: true },
    ])

    fakeHosts[0].emit('message', {
      type: 'assistant',
      uuid: 'assistant-final',
      message: {
        content: [
          { type: 'thinking', thinking: 'checked context' },
          { type: 'text', text: 'final answer' },
        ],
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).messages).toMatchObject([
      {
        id: 'assistant-final:thinking',
        role: 'thinking',
        text: 'checked context',
      },
      {
        id: 'assistant-final',
        role: 'assistant',
        text: 'final answer',
      },
    ])
  })

  it('shows thinking block-start feedback and replaces it with the first thinking delta', async () => {
    const manager = new DesktopSessionManager(() => null)
    const session = await manager.create('/tmp/project')

    fakeHosts[0].emit('message', {
      type: 'stream_event',
      uuid: 'thinking-start',
      event: {
        type: 'content_block_start',
        content_block: { type: 'thinking', thinking: '' },
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).messages).toMatchObject([
      { role: 'thinking', text: 'Thinking...', streaming: true },
    ])

    fakeHosts[0].emit('message', {
      type: 'stream_event',
      uuid: 'thinking-delta',
      event: {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'checking context' },
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).messages).toMatchObject([
      { role: 'thinking', text: 'checking context', streaming: true },
    ])
  })

  it('marks streaming-only thinking complete when the turn result arrives', async () => {
    const manager = new DesktopSessionManager(() => null)
    const session = await manager.create('/tmp/project')

    fakeHosts[0].emit('message', {
      type: 'stream_event',
      uuid: 'thinking-delta',
      event: {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'checking context' },
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).messages).toMatchObject([
      { role: 'thinking', text: 'checking context', streaming: true },
    ])

    fakeHosts[0].emit('message', {
      type: 'result',
      subtype: 'success',
      result: 'turn complete',
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).messages).toMatchObject([
      { role: 'thinking', text: 'checking context', streaming: false },
    ])
  })

  it('marks streamed thinking complete when final assistant text arrives without final thinking', async () => {
    const manager = new DesktopSessionManager(() => null)
    const session = await manager.create('/tmp/project')

    fakeHosts[0].emit('message', {
      type: 'stream_event',
      uuid: 'thinking-delta',
      event: {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'checking context' },
      },
    })
    await flushAsyncEvents()

    fakeHosts[0].emit('message', {
      type: 'assistant',
      uuid: 'assistant-final',
      message: {
        content: [{ type: 'text', text: 'final answer' }],
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).messages).toMatchObject([
      { role: 'thinking', text: 'checking context', streaming: false },
      { id: 'assistant-final', role: 'assistant', text: 'final answer' },
    ])
  })

  it('tracks turn activity from send through permissions and result', async () => {
    const events: unknown[] = []
    const window = {
      webContents: {
        send: vi.fn((_channel, event) => events.push(event)),
      },
    }
    const manager = new DesktopSessionManager(() => window as never)
    const session = await manager.create('/tmp/project')
    events.length = 0

    await manager.send(session.id, 'hello')

    expect(fakeHosts[0].sendMessage).toHaveBeenCalledWith('hello')
    expect(manager.getSession(session.id).activity).toBe('sending')

    fakeHosts[0].emit('message', {
      type: 'stream_event',
      uuid: 'delta-1',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'working' },
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).activity).toBe('streaming')

    fakeHosts[0].emit('message', {
      type: 'control_request',
      uuid: 'permission-1',
      request_id: 'request-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        description: 'Run pwd',
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).activity).toBe('waiting_permission')

    fakeHosts[0].emit('message', {
      type: 'result',
      subtype: 'success',
      result: 'done but permission is still open',
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).activity).toBe('waiting_permission')

    manager.respondToPermission(session.id, 'request-1', {
      behavior: 'allow',
      updatedInput: { command: 'pwd' },
    })
    await flushAsyncEvents()

    expect(fakeHosts[0].respondToPermission).toHaveBeenCalledWith('request-1', {
      behavior: 'allow',
      updatedInput: { command: 'pwd' },
    })
    expect(manager.getSession(session.id).activity).toBe('streaming')

    fakeHosts[0].emit('message', {
      type: 'assistant',
      uuid: 'assistant-after-permission',
      message: {
        content: [{ type: 'text', text: 'permission handled' }],
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).activity).toBe('idle')

    fakeHosts[0].emit('message', {
      type: 'result',
      subtype: 'success',
      result: 'done',
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).activity).toBe('idle')
  })

  it('keeps waiting permission activity until all pending permission requests resolve', async () => {
    const manager = new DesktopSessionManager(() => null)
    const session = await manager.create('/tmp/project')

    fakeHosts[0].emit('message', {
      type: 'control_request',
      uuid: 'permission-1',
      request_id: 'request-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        description: 'Run pwd',
      },
    })
    fakeHosts[0].emit('message', {
      type: 'control_request',
      uuid: 'permission-2',
      request_id: 'request-2',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Read',
        description: 'Read package.json',
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).activity).toBe('waiting_permission')

    manager.respondToPermission(session.id, 'request-1', {
      behavior: 'allow',
      updatedInput: { command: 'pwd' },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).activity).toBe('waiting_permission')

    manager.respondToPermission(session.id, 'request-2', {
      behavior: 'deny',
      message: 'User denied permission',
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).activity).toBe('idle')
  })

  it('keeps waiting permission activity when streamed text arrives before permission resolves', async () => {
    const manager = new DesktopSessionManager(() => null)
    const session = await manager.create('/tmp/project')

    fakeHosts[0].emit('message', {
      type: 'control_request',
      uuid: 'permission-1',
      request_id: 'request-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        description: 'Run pwd',
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).activity).toBe('waiting_permission')

    fakeHosts[0].emit('message', {
      type: 'stream_event',
      uuid: 'delta-after-permission',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'still working' },
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).activity).toBe('waiting_permission')
  })

  it('merges pending agent tool use with the final launched task by tool_use_id', async () => {
    const events: unknown[] = []
    const window = {
      webContents: {
        send: vi.fn((_channel, event) => events.push(event)),
      },
    }
    const manager = new DesktopSessionManager(() => window as never)
    const session = await manager.create('/tmp/project')
    events.length = 0

    fakeHosts[0].emit('message', {
      type: 'assistant',
      uuid: 'assistant-agent',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu-agent',
          name: 'Agent',
          input: {
            subagent_type: 'reviewer',
            description: 'review diff',
          },
        }],
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).agentTasks).toMatchObject([{
      id: 'toolu-agent',
      toolUseId: 'toolu-agent',
      status: 'pending',
      lastToolName: 'Agent',
    }])
    expect(manager.getSession(session.id).toolUses).toMatchObject([{
      id: 'toolu-agent:started',
      toolName: 'Agent',
      status: 'started',
    }])

    fakeHosts[0].emit('message', {
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu-agent',
          content: JSON.stringify({
            status: 'async_launched',
            agentId: 'agent-123',
            subagent_type: 'reviewer',
            description: 'review diff',
            totalTokens: 99,
          }),
        }],
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).agentTasks).toMatchObject([{
      id: 'agent-123',
      toolUseId: 'toolu-agent',
      status: 'running',
      agentType: 'reviewer',
      tokenCount: 99,
      toolTimeline: [
        {
          id: 'toolu-agent:started',
          toolName: 'Agent',
          status: 'started',
        },
        {
          id: 'toolu-agent:completed',
          toolName: 'Agent',
          status: 'completed',
        },
      ],
    }])
    expect(manager.getSession(session.id).toolUses).toMatchObject([
      {
        id: 'toolu-agent:started',
        toolName: 'Agent',
        status: 'started',
      },
      {
        id: 'toolu-agent:completed',
        toolName: 'Agent',
        status: 'completed',
      },
    ])
    expect(manager.getSession(session.id).messages).toEqual([])
  })

  it('tracks team create and delete runtime events in session state', async () => {
    const manager = new DesktopSessionManager(() => null)
    const session = await manager.create('/tmp/project')

    fakeHosts[0].emit('message', {
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu-team-create',
          name: 'TeamCreate',
          input: { team_name: 'frontend', description: 'UI work' },
        }],
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).team).toMatchObject({
      name: 'frontend',
      status: 'running',
      active: true,
      members: [],
    })
    expect(manager.getSession(session.id).toolUses).toMatchObject([{
      id: 'toolu-team-create:started',
      toolName: 'TeamCreate',
      status: 'started',
    }])

    fakeHosts[0].emit('message', {
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu-team-delete',
          name: 'TeamDelete',
          input: { team_name: 'frontend' },
        }],
      },
    })
    await flushAsyncEvents()

    expect(manager.getSession(session.id).team).toMatchObject({
      name: 'frontend',
      status: 'stopped',
      active: false,
      members: [],
    })
  })

  it('previews an agent task output file from the tracked task metadata', async () => {
    const events: unknown[] = []
    const window = {
      webContents: {
        send: vi.fn((_channel, event) => events.push(event)),
      },
    }
    const manager = new DesktopSessionManager(() => window as never)
    const session = await manager.create('/tmp/project')
    const tempDir = await mkdtemp(join(tmpdir(), 'claude-desktop-task-output-'))
    const outputFile = join(tempDir, 'agent-output.txt')
    await writeFile(outputFile, `${'x'.repeat(1200)}\nagent output tail\n`)
    events.length = 0

    fakeHosts[0].emit('message', {
      type: 'result',
      subtype: 'success',
      result: [
        '<task_notification>',
        '<task_id>agent-123</task_id>',
        '<status>completed</status>',
        `<output_file>${outputFile}</output_file>`,
        '</task_notification>',
      ].join(''),
    })
    await flushAsyncEvents()

    const preview = await manager.previewAgentTaskOutput(session.id, {
      taskId: 'agent-123',
      maxBytes: 1024,
    })

    expect(preview).toMatchObject({
      taskId: 'agent-123',
      path: outputFile,
      truncated: true,
    })
    expect(preview.contents).toContain('agent output tail')
    expect(manager.getSession(session.id).agentTasks?.[0]?.outputPreview)
      .toContain('agent output tail')
    expect(events.some(event =>
      (event as { session?: DesktopSession }).session?.agentTasks?.[0]?.outputPreview?.includes('agent output tail'),
    )).toBe(true)
  })
})
