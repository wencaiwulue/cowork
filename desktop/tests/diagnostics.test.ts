import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildDiagnosticsBundle,
  recordOperationalEvent,
  redactDiagnosticText,
  writeDiagnosticsBundle,
} from '../main/diagnostics'
import type { DesktopSession } from '../main/ipc'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

describe('desktop diagnostics', () => {
  it('redacts common secret forms in diagnostic text', () => {
    expect(
      redactDiagnosticText('failed token=abc123 password: hunter2 Authorization: Bearer secret-token'),
    ).toBe('failed token=[redacted] password: [redacted] Authorization: [redacted]')
  })

  it('builds a support bundle without message bodies', () => {
    const bundle = buildDiagnosticsBundle({
      generatedAt: '2026-07-16T00:00:00.000Z',
      app: {
        name: 'Claude Code Desktop',
        version: '1.2.3',
        isPackaged: true,
      },
      runtime: {
        platform: 'darwin',
        arch: 'arm64',
        node: '25.0.0',
        electron: '43.0.0',
      },
      paths: {
        userData: '/Users/test/Library/Application Support/Claude Code Desktop',
      },
      sessions: [sampleSession()],
      operationalEvents: [
        ...recordOperationalEvent([], {
          type: 'runtime-error',
          message: 'runtime failed api_key=super-secret',
          details: { token: 'abc123' },
          timestamp: 1,
        }),
        ...recordOperationalEvent([], {
          type: 'update-error',
          message: 'manual update check failed token=update-secret',
          timestamp: 2,
        }),
      ],
      releasePolicy: {
        updatePolicy: 'manual',
        reason: 'Use release notes password=hidden until updater exists.',
        releaseNotesRequired: true,
        rollbackRequired: true,
      },
      config: {
        claudeHome: '/Users/test/.claude',
        settingsPath: '/Users/test/.claude/settings.json',
        settingsExists: true,
        settings: { env: { ANTHROPIC_API_KEY: 'secret' } },
        localSettingsPath: '/Users/test/.claude/settings.local.json',
        localSettingsExists: false,
        proxy: {
          enabled: true,
          url: 'https://user:pass@example.com/proxy?token=secret',
        },
        runtimeCapabilities: {
          remoteIsolation: false,
          worktreeIsolation: true,
        },
        mcpServers: [],
        skills: [],
        scheduledTasks: [],
        plugins: [],
      },
    })

    expect(bundle.schemaVersion).toBe(1)
    expect(bundle.sessions[0]).toMatchObject({
      id: 'session-1',
      status: 'error',
      activity: 'idle',
      messageCounts: {
        user: 1,
        assistant: 1,
      },
      agentTaskCounts: {
        failed: 1,
      },
      runtimeEventCount: 1,
      sidebarWidth: 280,
      workspaceRatio: 0.5,
      expandedPathCount: 2,
      activePane: 'settings',
      primaryView: 'settings',
      activeFile: 'src/index.ts',
      terminalId: 'terminal-1',
      previewUrl: 'http://localhost:5173',
      settingsActiveSection: 'settings-mcp',
      tasksActiveSection: 'tasks-global-tasks',
      agentsActiveSection: 'agents-editor',
      teamsActiveSection: 'agents-teams',
      selectedAgentType: 'reviewer',
      selectedAgentSource: 'project',
      selectedTeamName: 'frontend',
      selectedTeamRecipient: 'builder',
      selectedMcpName: 'playwright',
      selectedMcpSourcePath: '/Users/test/.claude/.mcp.json',
      selectedMcpScope: 'project',
      selectedSkillName: 'existing-skill',
      selectedSkillPath: '/Users/test/.claude/skills/existing-skill',
      selectedSkillScope: 'project',
      selectedPluginIdentity: 'project:custom-plugin',
    })
    expect(JSON.stringify(bundle)).not.toContain('please inspect secret.txt')
    expect(JSON.stringify(bundle)).not.toContain('answer body')
    expect(JSON.stringify(bundle)).not.toContain('super-secret')
    expect(JSON.stringify(bundle)).not.toContain('abc123')
    expect(JSON.stringify(bundle)).not.toContain('update-secret')
    expect(JSON.stringify(bundle)).not.toContain('password=hidden')
    expect(bundle.config.proxyUrl).toContain('%5Bredacted%5D')
    expect(bundle.release).toEqual({
      updatePolicy: 'manual',
      reason: 'Use release notes password=[redacted] until updater exists.',
      releaseNotesRequired: true,
      rollbackRequired: true,
      failedUpdateEventCount: 1,
    })
  })

  it('writes diagnostics JSON and reports byte count', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'claude-desktop-diagnostics-'))
    tempDirs.push(dir)
    const outputPath = join(dir, 'bundle.json')

    const result = await writeDiagnosticsBundle(outputPath, {
      generatedAt: '2026-07-16T00:00:00.000Z',
      app: {
        name: 'Claude Code Desktop',
        version: '1.2.3',
        isPackaged: false,
      },
      runtime: {
        platform: 'darwin',
        arch: 'arm64',
        node: '25.0.0',
        electron: '43.0.0',
      },
      paths: {
        userData: dir,
      },
      sessions: [],
      operationalEvents: [],
    })

    const contents = await readFile(outputPath, 'utf8')
    expect(result.path).toBe(outputPath)
    expect(result.bytes).toBe(Buffer.byteLength(contents, 'utf8'))
    expect(JSON.parse(contents)).toMatchObject({
      schemaVersion: 1,
      generatedAt: '2026-07-16T00:00:00.000Z',
    })
  })
})

function sampleSession(): DesktopSession {
  return {
    id: 'session-1',
    title: 'demo',
    cwd: '/tmp/demo',
    createdAt: 1,
    updatedAt: 2,
    status: 'error',
    activity: 'idle',
    lastError: 'failed password=secret',
    messages: [
      {
        id: 'message-1',
        role: 'user',
        text: 'please inspect secret.txt',
      },
      {
        id: 'message-2',
        role: 'assistant',
        text: 'answer body',
      },
    ],
    toolUses: [
      {
        id: 'tool-1',
        toolName: 'Read',
        status: 'started',
        timestamp: 1,
      },
    ],
    agentTasks: [
      {
        id: 'task-1',
        status: 'failed',
      },
    ],
    runtimeEvents: [{ type: 'tool_use', input: { token: 'secret' } }],
    layout: {
      sidebarWidth: 280,
      workspaceRatio: 0.5,
      activePane: 'settings',
      primaryView: 'settings',
      activeFile: 'src/index.ts',
      terminalId: 'terminal-1',
      previewUrl: 'http://localhost:5173',
      settingsActiveSection: 'settings-mcp',
      tasksActiveSection: 'tasks-global-tasks',
      agentsActiveSection: 'agents-editor',
      teamsActiveSection: 'agents-teams',
      selectedAgentType: 'reviewer',
      selectedAgentSource: 'project',
      selectedTeamName: 'frontend',
      selectedTeamRecipient: 'builder',
      selectedMcpName: 'playwright',
      selectedMcpSourcePath: '/Users/test/.claude/.mcp.json',
      selectedMcpScope: 'project',
      selectedSkillName: 'existing-skill',
      selectedSkillPath: '/Users/test/.claude/skills/existing-skill',
      selectedSkillScope: 'project',
      selectedPluginIdentity: 'project:custom-plugin',
      expandedPaths: ['src', 'src/components'],
    },
  }
}
