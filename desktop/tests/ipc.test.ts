import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertDesktopChannel,
  desktopChannels,
  validateIpcArgs,
} from '../main/ipc'
import type { DesktopChannel } from '../main/ipc'

describe('desktop IPC channels', () => {
  const mainSource = readFileSync(join(process.cwd(), 'desktop/main/main.ts'), 'utf8')
  const preloadSource = readFileSync(join(process.cwd(), 'desktop/preload/preload.ts'), 'utf8')

  it('accepts planned public channels', () => {
    expect(desktopChannels).toContain('app:closeWindow')
    expect(desktopChannels).toContain('app:setUnsavedChanges')
    expect(desktopChannels).toContain('diagnostics:export')
    expect(desktopChannels).toContain('sessions:create')
    expect(desktopChannels).toContain('sessions:focus')
    expect(desktopChannels).toContain('sessions:updateLayout')
    expect(desktopChannels).toContain('sessions:clearDesktopView')
    expect(desktopChannels).toContain('workspace:readFile')
    expect(desktopChannels).toContain('workspaceTasks:list')
    expect(desktopChannels).toContain('workspaceTasks:addOrUpdate')
    expect(desktopChannels).toContain('workspaceTasks:remove')
    expect(desktopChannels).toContain('workspaceTasks:pause')
    expect(desktopChannels).toContain('workspaceTasks:resume')
    expect(desktopChannels).toContain('terminal:resize')
    expect(desktopChannels).toContain('preview:openExternal')
    expect(desktopChannels).toContain('clipboard:writeText')
    expect(desktopChannels).toContain('commands:list')
    expect(desktopChannels).toContain('config:get')
    expect(desktopChannels).toContain('config:updateProxy')
    expect(desktopChannels).toContain('mcp:addOrUpdate')
    expect(desktopChannels).toContain('mcp:read')
    expect(desktopChannels).toContain('mcp:remove')
    expect(desktopChannels).toContain('mcp:setEnabled')
    expect(desktopChannels).toContain('workspaceMcp:list')
    expect(desktopChannels).toContain('workspaceMcp:addOrUpdate')
    expect(desktopChannels).toContain('workspaceMcp:read')
    expect(desktopChannels).toContain('workspaceMcp:remove')
    expect(desktopChannels).toContain('workspaceMcp:setApproval')
    expect(desktopChannels).toContain('workspaceMcp:check')
    expect(desktopChannels).toContain('tasks:addOrUpdate')
    expect(desktopChannels).toContain('tasks:remove')
    expect(desktopChannels).toContain('tasks:pause')
    expect(desktopChannels).toContain('tasks:resume')
    expect(desktopChannels).toContain('skills:installLocal')
    expect(desktopChannels).toContain('skills:save')
    expect(desktopChannels).toContain('skills:read')
    expect(desktopChannels).toContain('workspaceSkills:list')
    expect(desktopChannels).toContain('workspaceSkills:installLocal')
    expect(desktopChannels).toContain('workspaceSkills:save')
    expect(desktopChannels).toContain('workspaceSkills:read')
    expect(desktopChannels).toContain('plugins:list')
    expect(desktopChannels).toContain('plugins:install')
    expect(desktopChannels).toContain('plugins:uninstall')
    expect(desktopChannels).toContain('plugins:setEnabled')
    expect(desktopChannels).toContain('plugins:update')
    expect(desktopChannels).toContain('agents:list')
    expect(desktopChannels).toContain('agents:save')
    expect(desktopChannels).toContain('agents:diagnose')
    expect(desktopChannels).toContain('sessions:launchAgentTask')
    expect(desktopChannels).toContain('sessions:stopAgentTask')
    expect(desktopChannels).toContain('sessions:readAgentTaskOutput')
    expect(desktopChannels).toContain('sessions:previewAgentTaskOutput')
    expect(desktopChannels).toContain('sessions:resumeAgentTask')
    expect(desktopChannels).toContain('teams:list')
    expect(desktopChannels).toContain('teams:create')
    expect(desktopChannels).toContain('teams:send')
    expect(desktopChannels).toContain('teams:shutdown')
    expect(desktopChannels).toContain('teams:removeMember')
    expect(desktopChannels).toContain('teams:delete')
    expect(assertDesktopChannel('sessions:send')).toBe('sessions:send')
  })

  it('keeps preload invoke channels covered by the main startup channel audit', () => {
    const invokedChannels = [
      ...new Set(
        [...preloadSource.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)]
          .map(match => match[1]),
      ),
    ].sort()
    const startupAuditBlock = mainSource.match(
      /for \(const channel of \[([\s\S]*?)\]\) \{\n\s*assertDesktopChannel\(channel\)/,
    )?.[1] ?? ''
    const auditedChannels = [
      ...new Set(
        [...startupAuditBlock.matchAll(/'([^']+)'/g)]
          .map(match => match[1]),
      ),
    ].sort()

    expect(
      invokedChannels.filter(channel => !auditedChannels.includes(channel)),
    ).toEqual([])
  })

  it('requires an explicit team deletion payload in the preload API', () => {
    expect(preloadSource).toContain('delete: (sessionId: string, input: TeamDeleteInput) =>')
    expect(preloadSource).not.toContain('delete: (sessionId: string, input: TeamDeleteInput = {}) =>')
  })

  it('rejects unknown channels', () => {
    expect(() => assertDesktopChannel('shell:exec')).toThrow(
      'Unknown desktop IPC channel: shell:exec',
    )
  })

  it('rejects extra arguments on fixed-shape channels', () => {
    const cases: Array<[DesktopChannel, unknown[], number]> = [
      ['app:closeWindow', ['unexpected'], 0],
      ['app:setUnsavedChanges', [true, 'unexpected'], 1],
      ['diagnostics:export', ['unexpected'], 0],
      ['sessions:focus', ['session-1', 'unexpected'], 1],
      ['sessions:clearDesktopView', ['session-1', 'unexpected'], 1],
      ['workspace:tree', ['/tmp/project', 'unexpected'], 1],
      ['git:status', ['/tmp/project', 'unexpected'], 1],
      ['terminal:create', ['/tmp/project', 'unexpected'], 1],
      ['workspaceTasks:list', ['/tmp/project', 'unexpected'], 1],
      ['workspaceTasks:pause', ['/tmp/project', 'task-1', 'unexpected'], 2],
      ['workspaceTasks:resume', ['/tmp/project', 'task-1', 'unexpected'], 2],
      ['terminal:kill', ['terminal-1', 'unexpected'], 1],
      ['preview:setUrl', ['https://example.com', 'unexpected'], 1],
      ['clipboard:writeText', ['copy me', 'unexpected'], 1],
      ['commands:list', ['/tmp/project', 'unexpected'], 1],
      ['mcp:read', ['server-1', 'unexpected'], 1],
      ['mcp:remove', ['server-1', 'unexpected'], 1],
      ['mcp:setEnabled', ['server-1', true, 'unexpected'], 2],
      ['workspaceMcp:list', ['/tmp/project', 'unexpected'], 1],
      ['workspaceMcp:read', ['/tmp/project', 'server-1', 'unexpected'], 2],
      ['workspaceMcp:check', ['/tmp/project', 'unexpected'], 1],
      ['workspaceMcp:setApproval', ['/tmp/project', 'server-1', true, 'unexpected'], 3],
      ['tasks:remove', ['task-1', 'unexpected'], 1],
      ['tasks:pause', ['task-1', 'unexpected'], 1],
      ['tasks:resume', ['task-1', 'unexpected'], 1],
      ['skills:read', ['demo-skill', 'unexpected'], 1],
      ['skills:save', [{ name: 'demo-skill', contents: 'x' }, 'unexpected'], 1],
      ['workspaceSkills:list', ['/tmp/project', 'unexpected'], 1],
      ['workspaceSkills:read', ['/tmp/project', 'demo-skill', 'unexpected'], 2],
      ['workspaceSkills:save', ['/tmp/project', { name: 'demo-skill', contents: 'x' }, 'unexpected'], 2],
      ['plugins:list', ['/tmp/project', 'unexpected'], 1],
      ['plugins:uninstall', ['/tmp/project', { plugin: 'demo@marketplace', scope: 'user' }, 'unexpected'], 2],
      ['plugins:setEnabled', ['/tmp/project', { plugin: 'demo@marketplace', scope: 'user', enabled: true }, 'unexpected'], 2],
      ['plugins:update', ['/tmp/project', { plugin: 'demo@marketplace', scope: 'user' }, 'unexpected'], 2],
      ['agents:list', ['/tmp/project', 'unexpected'], 1],
      ['agents:refresh', ['/tmp/project', 'unexpected'], 1],
      ['teams:list', ['/tmp/project', 'unexpected'], 1],
      ['teams:members', ['/tmp/project', 'frontend', 'unexpected'], 2],
    ]

    for (const [channel, args, expectedArity] of cases) {
      expect(() => validateIpcArgs(channel, args)).toThrow(
        `${channel} expected ${expectedArity} argument(s), got ${args.length}`,
      )
    }
  })

  it('validates IPC payloads before they reach main handlers', () => {
    expect(validateIpcArgs('app:closeWindow', [])).toEqual([])
    expect(validateIpcArgs('app:setUnsavedChanges', [true])).toEqual([true])
    expect(validateIpcArgs('diagnostics:export', [])).toEqual([])
    expect(validateIpcArgs('sessions:send', ['session-1', 'hello'])).toEqual([
      'session-1',
      'hello',
    ])
    expect(validateIpcArgs('sessions:clearDesktopView', ['session-1'])).toEqual([
      'session-1',
    ])
    expect(
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        {
          activePane: 'tasks',
          primaryView: 'tasks',
          workspaceRatio: 0.6,
          tasksActiveSection: 'tasks-global-tasks',
          selectedGlobalTaskId: 'task-1',
          selectedProjectTaskId: 'project-task-1',
          selectedMcpName: 'playwright',
          selectedMcpSourcePath: '/tmp/.mcp.json',
          selectedMcpScope: 'project',
          selectedSkillName: 'existing-skill',
          selectedSkillPath: '/tmp/skills/existing-skill',
          selectedSkillScope: 'project',
          selectedPluginIdentity: '["user","demo@marketplace","demo@marketplace"]',
        },
      ]),
    ).toEqual([
      'session-1',
      {
        activePane: 'tasks',
        primaryView: 'tasks',
        workspaceRatio: 0.6,
        tasksActiveSection: 'tasks-global-tasks',
        selectedGlobalTaskId: 'task-1',
        selectedProjectTaskId: 'project-task-1',
        selectedMcpName: 'playwright',
        selectedMcpSourcePath: '/tmp/.mcp.json',
        selectedMcpScope: 'project',
        selectedSkillName: 'existing-skill',
        selectedSkillPath: '/tmp/skills/existing-skill',
        selectedSkillScope: 'project',
        selectedPluginIdentity: '["user","demo@marketplace","demo@marketplace"]',
      },
    ])
    expect(
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        {
          activePane: 'agents',
          primaryView: 'agents',
          agentsActiveSection: 'agents-editor',
          selectedAgentType: 'desktop-smoke-agent',
          selectedAgentSource: 'built-in',
        },
      ]),
    ).toEqual([
      'session-1',
      {
        activePane: 'agents',
        primaryView: 'agents',
        agentsActiveSection: 'agents-editor',
        selectedAgentType: 'desktop-smoke-agent',
        selectedAgentSource: 'built-in',
      },
    ])
    expect(
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        {
          activePane: 'teams',
          primaryView: 'teams',
          teamsActiveSection: 'agents-teams',
          selectedTeamName: 'frontend',
          selectedTeamRecipient: 'builder',
        },
      ]),
    ).toEqual([
      'session-1',
      {
        activePane: 'teams',
        primaryView: 'teams',
        teamsActiveSection: 'agents-teams',
        selectedTeamName: 'frontend',
        selectedTeamRecipient: 'builder',
      },
    ])
    expect(
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        { activePane: 'agents', primaryView: 'teammates' },
      ]),
    ).toEqual([
      'session-1',
      { activePane: 'teams', primaryView: 'teams' },
    ])
    expect(
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        { activeFile: undefined, terminalId: undefined, previewUrl: undefined },
      ]),
    ).toEqual([
      'session-1',
      { activeFile: undefined, terminalId: undefined, previewUrl: undefined },
    ])
    expect(validateIpcArgs('sessions:create', [{
      cwd: '/tmp/project',
      defaultCwd: false,
      agent: {
        agentType: 'reviewer',
        model: 'sonnet',
        permissionMode: 'plan',
        isolation: 'worktree',
      },
    }])).toEqual([{
      cwd: '/tmp/project',
      defaultCwd: false,
      agent: {
        agentType: 'reviewer',
        model: 'sonnet',
        permissionMode: 'plan',
        isolation: 'worktree',
      },
    }])
    expect(validateIpcArgs('sessions:create', [{ defaultCwd: true }])).toEqual([{
      cwd: undefined,
      defaultCwd: true,
      agent: undefined,
    }])
    expect(validateIpcArgs('sessions:launchAgentTask', [
      'session-1',
      {
        agentType: 'reviewer',
        description: 'review code',
        prompt: 'inspect this diff',
        runInBackground: true,
        isolation: 'worktree',
      },
    ])).toEqual([
      'session-1',
      {
        agentType: 'reviewer',
        description: 'review code',
        prompt: 'inspect this diff',
        runInBackground: true,
        isolation: 'worktree',
        model: undefined,
        mode: undefined,
        name: undefined,
        teamName: undefined,
      },
    ])
    expect(validateIpcArgs('sessions:stopAgentTask', [
      'session-1',
      { taskId: 'agent-123' },
    ])).toEqual([
      'session-1',
      { taskId: 'agent-123' },
    ])
    expect(validateIpcArgs('sessions:readAgentTaskOutput', [
      'session-1',
      { taskId: 'agent-123', block: false, timeoutMs: 0 },
    ])).toEqual([
      'session-1',
      { taskId: 'agent-123', block: false, timeoutMs: 0 },
    ])
    expect(validateIpcArgs('sessions:previewAgentTaskOutput', [
      'session-1',
      { taskId: 'agent-123', maxBytes: 2048 },
    ])).toEqual([
      'session-1',
      { taskId: 'agent-123', maxBytes: 2048 },
    ])
    expect(validateIpcArgs('sessions:resumeAgentTask', [
      'session-1',
      { taskId: 'agent-123', prompt: 'continue with tests' },
    ])).toEqual([
      'session-1',
      { taskId: 'agent-123', prompt: 'continue with tests' },
    ])
    expect(validateIpcArgs('preview:setUrl', ['https://example.com'])).toEqual([
      'https://example.com',
    ])
    expect(validateIpcArgs('clipboard:writeText', ['copy me'])).toEqual([
      'copy me',
    ])
    expect(validateIpcArgs('commands:list', ['/tmp/project'])).toEqual([
      '/tmp/project',
    ])
    expect(validateIpcArgs('config:get', [])).toEqual([])
    expect(validateIpcArgs('config:updateProxy', [
      { enabled: true, url: 'socks5://127.0.0.1:7890' },
    ])).toEqual([{ enabled: true, url: 'socks5://127.0.0.1:7890' }])
    expect(validateIpcArgs('skills:installLocal', ['/tmp/skill'])).toEqual([
      '/tmp/skill',
    ])
    expect(validateIpcArgs('workspaceSkills:installLocal', [
      '/tmp/project',
      '/tmp/skill',
    ])).toEqual(['/tmp/project', '/tmp/skill'])
    expect(validateIpcArgs('plugins:install', [
      '/tmp/project',
      { plugin: 'demo@marketplace', scope: 'user' },
    ])).toEqual([
      '/tmp/project',
      { plugin: 'demo@marketplace', scope: 'user' },
    ])
    expect(validateIpcArgs('plugins:uninstall', [
      '/tmp/project',
      { plugin: 'demo@marketplace', scope: 'project' },
    ])).toEqual([
      '/tmp/project',
      { plugin: 'demo@marketplace', scope: 'project' },
    ])
    expect(validateIpcArgs('plugins:setEnabled', [
      '/tmp/project',
      { plugin: 'demo@marketplace', scope: 'local', enabled: false },
    ])).toEqual([
      '/tmp/project',
      { plugin: 'demo@marketplace', scope: 'local', enabled: false },
    ])
    expect(validateIpcArgs('plugins:update', [
      '/tmp/project',
      { plugin: 'demo@marketplace', scope: 'user' },
    ])).toEqual([
      '/tmp/project',
      { plugin: 'demo@marketplace', scope: 'user' },
    ])
    expect(validateIpcArgs('workspaceTasks:addOrUpdate', [
      '/tmp/project',
      { cron: '0 9 * * *', prompt: 'run daily', recurring: true },
    ])).toEqual([
      '/tmp/project',
      { id: undefined, cron: '0 9 * * *', prompt: 'run daily', recurring: true },
    ])
    expect(validateIpcArgs('workspaceTasks:pause', [
      '/tmp/project',
      'task-1',
    ])).toEqual([
      '/tmp/project',
      'task-1',
    ])
    expect(validateIpcArgs('workspaceTasks:resume', [
      '/tmp/project',
      'task-1',
    ])).toEqual([
      '/tmp/project',
      'task-1',
    ])
    expect(validateIpcArgs('mcp:addOrUpdate', [{
      name: 'playwright',
      mode: 'stdio',
      command: 'npx',
      args: ['@playwright/mcp'],
    }])).toEqual([{
      name: 'playwright',
      mode: 'stdio',
      command: 'npx',
      args: ['@playwright/mcp'],
    }])
    expect(validateIpcArgs('mcp:addOrUpdate', [{
      name: 'remote',
      mode: 'remote',
      type: 'streamable-http',
      url: 'https://mcp.example/server',
    }])).toEqual([{
      name: 'remote',
      mode: 'remote',
      type: 'streamable-http',
      url: 'https://mcp.example/server',
    }])
    expect(validateIpcArgs('mcp:setEnabled', [
      'playwright',
      false,
    ])).toEqual([
      'playwright',
      false,
    ])
    expect(validateIpcArgs('mcp:read', ['playwright'])).toEqual(['playwright'])
    expect(validateIpcArgs('workspaceMcp:addOrUpdate', [
      '/tmp/project',
      { name: 'project-server', mode: 'stdio', command: 'node', args: ['server.mjs'] },
    ])).toEqual([
      '/tmp/project',
      { name: 'project-server', mode: 'stdio', command: 'node', args: ['server.mjs'] },
    ])
    expect(validateIpcArgs('workspaceMcp:setApproval', [
      '/tmp/project',
      'project-server',
      true,
    ])).toEqual([
      '/tmp/project',
      'project-server',
      true,
    ])
    expect(validateIpcArgs('workspaceMcp:read', [
      '/tmp/project',
      'project-server',
    ])).toEqual([
      '/tmp/project',
      'project-server',
    ])
    expect(validateIpcArgs('tasks:addOrUpdate', [{
      id: 'task-1',
      prompt: 'run status',
      enabled: true,
    }])).toEqual([{
      id: 'task-1',
      name: undefined,
      schedule: undefined,
      prompt: 'run status',
      enabled: true,
    }])
    expect(validateIpcArgs('agents:save', [
      '/tmp/project',
      {
        source: 'project',
        agentType: 'reviewer',
        whenToUse: 'when reviewing',
        prompt: 'review carefully',
        tools: ['Read', 'Grep'],
      },
    ])).toEqual([
      '/tmp/project',
      {
        source: 'project',
        agentType: 'reviewer',
        whenToUse: 'when reviewing',
        prompt: 'review carefully',
        tools: ['Read', 'Grep'],
        background: undefined,
        disallowedTools: undefined,
        isolation: undefined,
        memory: undefined,
        model: undefined,
        permissionMode: undefined,
        requiredMcpServers: undefined,
        skills: undefined,
      },
    ])
    expect(validateIpcArgs('teams:create', [
      'session-1',
      { teamName: 'frontend', description: 'UI team', agentType: 'planner' },
    ])).toEqual([
      'session-1',
      { teamName: 'frontend', description: 'UI team', agentType: 'planner' },
    ])
    expect(validateIpcArgs('teams:send', [
      'session-1',
      { teamName: 'frontend', to: 'alice', message: 'status?' },
    ])).toEqual([
      'session-1',
      { teamName: 'frontend', to: 'alice', message: 'status?' },
    ])
    expect(validateIpcArgs('teams:shutdown', [
      'session-1',
      { teamName: 'frontend', to: 'alice', reason: 'done' },
    ])).toEqual([
      'session-1',
      { teamName: 'frontend', to: 'alice', reason: 'done' },
    ])
    expect(validateIpcArgs('teams:removeMember', [
      'session-1',
      { teamName: 'frontend', memberName: 'alice' },
    ])).toEqual([
      'session-1',
      { teamName: 'frontend', memberName: 'alice' },
    ])
    expect(validateIpcArgs('teams:delete', [
      'session-1',
      { teamName: 'frontend' },
    ])).toEqual([
      'session-1',
      { teamName: 'frontend' },
    ])
    expect(() => validateIpcArgs('teams:delete', [
      'session-1',
      {},
    ])).toThrow('teams:delete teamName must be a string')
    expect(() => validateIpcArgs('teams:delete', [
      'session-1',
      { teamName: '   ' },
    ])).toThrow('teams:delete teamName must not be empty')
    expect(validateIpcArgs('skills:remove', ['demo-skill'])).toEqual([
      'demo-skill',
    ])
    expect(validateIpcArgs('skills:read', ['demo-skill'])).toEqual([
      'demo-skill',
    ])
    expect(validateIpcArgs('skills:save', [{
      name: 'demo-skill',
      contents: '---\ndescription: Demo\n---\n',
    }])).toEqual([{
      name: 'demo-skill',
      contents: '---\ndescription: Demo\n---\n',
    }])
    expect(validateIpcArgs('workspaceSkills:read', ['/tmp/project', 'demo-skill'])).toEqual([
      '/tmp/project',
      'demo-skill',
    ])
    expect(validateIpcArgs('workspaceSkills:save', [
      '/tmp/project',
      {
        name: 'demo-skill',
        contents: '---\ndescription: Demo\n---\n',
      },
    ])).toEqual([
      '/tmp/project',
      {
        name: 'demo-skill',
        contents: '---\ndescription: Demo\n---\n',
      },
    ])
    expect(validateIpcArgs('workspaceSkills:remove', ['/tmp/project', 'demo-skill'])).toEqual([
      '/tmp/project',
      'demo-skill',
    ])

    expect(() => validateIpcArgs('sessions:send', ['session-1', ''])).toThrow(
      'sessions:send text must not be empty',
    )
    expect(() =>
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        { activePane: 'unknown' },
      ]),
    ).toThrow('sessions:updateLayout activePane is invalid')
    expect(() =>
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        { primaryView: 'unknown' },
      ]),
    ).toThrow('sessions:updateLayout primaryView is invalid')
    expect(() =>
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        { settingsActiveSection: 42 },
      ]),
    ).toThrow('sessions:updateLayout settingsActiveSection must be a string')
    expect(() =>
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        { tasksActiveSection: 42 },
      ]),
    ).toThrow('sessions:updateLayout tasksActiveSection must be a string')
    expect(() =>
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        { selectedGlobalTaskId: 42 },
      ]),
    ).toThrow('sessions:updateLayout selectedGlobalTaskId must be a string')
    expect(() =>
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        { selectedProjectTaskId: 42 },
      ]),
    ).toThrow('sessions:updateLayout selectedProjectTaskId must be a string')
    expect(() =>
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        { agentsActiveSection: 42 },
      ]),
    ).toThrow('sessions:updateLayout agentsActiveSection must be a string')
    expect(() =>
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        { teamsActiveSection: 42 },
      ]),
    ).toThrow('sessions:updateLayout teamsActiveSection must be a string')
    expect(() =>
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        { selectedTeamName: 42 },
      ]),
    ).toThrow('sessions:updateLayout selectedTeamName must be a string')
    expect(() =>
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        { selectedTeamRecipient: 42 },
      ]),
    ).toThrow('sessions:updateLayout selectedTeamRecipient must be a string')
    expect(() =>
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        { selectedAgentSource: 'unknown-source' },
      ]),
    ).toThrow('sessions:updateLayout selectedAgentSource is invalid')
    expect(() =>
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        { selectedMcpScope: 'workspace' },
      ]),
    ).toThrow('sessions:updateLayout selectedMcpScope is invalid')
    expect(() =>
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        { selectedSkillScope: 'workspace' },
      ]),
    ).toThrow('sessions:updateLayout selectedSkillScope is invalid')
    expect(() =>
      validateIpcArgs('sessions:updateLayout', [
        'session-1',
        { selectedPluginIdentity: 42 },
      ]),
    ).toThrow('sessions:updateLayout selectedPluginIdentity must be a string')
    expect(() => validateIpcArgs('sessions:create', [{ defaultCwd: 'yes' }])).toThrow(
      'sessions:create defaultCwd must be a boolean',
    )
    expect(() => validateIpcArgs('terminal:write', ['', 'pwd\n'])).toThrow(
      'terminal:write terminalId must not be empty',
    )
    expect(() => validateIpcArgs('terminal:resize', ['', 120, 24])).toThrow(
      'terminal:resize terminalId must not be empty',
    )
    expect(() => validateIpcArgs('terminal:kill', [''])).toThrow(
      'terminal:kill terminalId must not be empty',
    )
    expect(() => validateIpcArgs('terminal:resize', ['term-1', 5, 24])).toThrow(
      'terminal:resize columns must be an integer from 20 to 400',
    )
    expect(() => validateIpcArgs('preview:setUrl', ['file:///tmp/a.html'])).toThrow(
      'preview:setUrl url must start with http:// or https://',
    )
    expect(() => validateIpcArgs('clipboard:writeText', [''])).toThrow(
      'clipboard:writeText text must not be empty',
    )
    expect(() =>
      validateIpcArgs('workspace:readFile', ['/tmp/project', '']),
    ).toThrow('workspace:readFile path must not be empty')
    expect(() =>
      validateIpcArgs('workspace:readFile', ['/tmp/project', '/etc/passwd']),
    ).toThrow('workspace:readFile path must be relative')
    expect(() =>
      validateIpcArgs('workspace:readFile', ['/tmp/project', '../secrets.txt']),
    ).toThrow('workspace:readFile path must not contain parent directory segments')
    expect(() =>
      validateIpcArgs('workspace:saveFile', ['/tmp/project', 'src/../secrets.txt', 'x']),
    ).toThrow('workspace:saveFile path must not contain parent directory segments')
    expect(() =>
      validateIpcArgs('config:updateProxy', [
        { enabled: true, url: 'ftp://127.0.0.1:21' },
      ]),
    ).toThrow('config:updateProxy proxy.url must start with socks5://')
    expect(() =>
      validateIpcArgs('mcp:addOrUpdate', [
        { name: 'bad/server', mode: 'stdio', command: 'npx' },
      ]),
    ).toThrow('mcp:addOrUpdate name must not contain path separators')
    expect(() =>
      validateIpcArgs('teams:create', [
        'session-1',
        { teamName: '../outside' },
      ]),
    ).toThrow('teams:create teamName must not contain path separators')
    expect(() =>
      validateIpcArgs('workspaceMcp:addOrUpdate', [
        '/tmp/project',
        { name: 'bad/server', mode: 'stdio', command: 'npx' },
      ]),
    ).toThrow('workspaceMcp:addOrUpdate name must not contain path separators')
    expect(() =>
      validateIpcArgs('workspaceMcp:setApproval', ['/tmp/project', 'bad/server', true]),
    ).toThrow('workspaceMcp:setApproval name must not contain path separators')
    expect(() =>
      validateIpcArgs('workspaceMcp:read', ['/tmp/project', 'bad/server']),
    ).toThrow('workspaceMcp:read name must not contain path separators')
    expect(() =>
      validateIpcArgs('workspaceMcp:setApproval', ['/tmp/project', 'server', 'yes']),
    ).toThrow('workspaceMcp:setApproval approved must be a boolean')
    expect(() =>
      validateIpcArgs('mcp:addOrUpdate', [
        { name: 'remote', mode: 'remote', type: 'streamable-http', url: 'file:///tmp' },
      ]),
    ).toThrow('mcp:addOrUpdate url must start with http:// or https://')
    expect(() =>
      validateIpcArgs('mcp:setEnabled', ['server', 'yes']),
    ).toThrow('mcp:setEnabled enabled must be a boolean')
    expect(() =>
      validateIpcArgs('tasks:addOrUpdate', [
        { prompt: '', enabled: true },
      ]),
    ).toThrow('tasks:addOrUpdate prompt must not be empty')
    expect(() =>
      validateIpcArgs('workspaceTasks:addOrUpdate', [
        '/tmp/project',
        { cron: 'bad', prompt: 'run daily', recurring: true },
      ]),
    ).toThrow('workspaceTasks:addOrUpdate cron must be a valid 5-field cron expression')
    expect(() =>
      validateIpcArgs('workspaceTasks:pause', ['/tmp/project', '']),
    ).toThrow('workspaceTasks:pause taskId must not be empty')
    expect(() =>
      validateIpcArgs('workspaceTasks:resume', ['/tmp/project', 1]),
    ).toThrow('workspaceTasks:resume taskId must be a string')
    expect(() => validateIpcArgs('skills:remove', ['../bad'])).toThrow(
      'skills:remove name must not contain path separators',
    )
    expect(() =>
      validateIpcArgs('skills:save', [{ name: '../bad', contents: 'x' }]),
    ).toThrow('skills:save name must not contain path separators')
    expect(() =>
      validateIpcArgs('skills:save', [{ name: 'demo', contents: '' }]),
    ).toThrow('skills:save contents must not be empty')
    expect(() =>
      validateIpcArgs('workspaceSkills:remove', ['/tmp/project', '../bad']),
    ).toThrow('workspaceSkills:remove name must not contain path separators')
    expect(() =>
      validateIpcArgs('workspaceSkills:read', ['/tmp/project', '../bad']),
    ).toThrow('workspaceSkills:read name must not contain path separators')
    expect(() =>
      validateIpcArgs('workspaceSkills:save', ['/tmp/project', { name: '../bad', contents: 'x' }]),
    ).toThrow('workspaceSkills:save name must not contain path separators')
    expect(() =>
      validateIpcArgs('plugins:install', [
        '/tmp/project',
        { plugin: '', scope: 'user' },
      ]),
    ).toThrow('plugins:install plugin must not be empty')
    expect(() =>
      validateIpcArgs('plugins:install', [
        '/tmp/project',
        { plugin: '--help', scope: 'user' },
      ]),
    ).toThrow('plugins:install plugin must not start with a dash')
    expect(() =>
      validateIpcArgs('plugins:install', [
        '/tmp/project',
        { plugin: 'demo plugin', scope: 'user' },
      ]),
    ).toThrow('plugins:install plugin contains invalid characters')
    expect(() =>
      validateIpcArgs('plugins:uninstall', [
        '/tmp/project',
        { plugin: '--help', scope: 'user' },
      ]),
    ).toThrow('plugins:uninstall plugin must not start with a dash')
    expect(() =>
      validateIpcArgs('plugins:setEnabled', [
        '/tmp/project',
        { plugin: 'demo@marketplace', scope: 'user', enabled: 'yes' },
      ]),
    ).toThrow('plugins:setEnabled enabled must be a boolean')
    expect(() =>
      validateIpcArgs('plugins:update', [
        '/tmp/project',
        { plugin: 'demo plugin', scope: 'user' },
      ]),
    ).toThrow('plugins:update plugin contains invalid characters')
    expect(() =>
      validateIpcArgs('agents:save', [
        '/tmp/project',
        { source: 'built-in', agentType: 'x', whenToUse: 'x', prompt: 'x' },
      ]),
    ).toThrow('agents:save source must be user or project')
    expect(() =>
      validateIpcArgs('sessions:launchAgentTask', [
        'session-1',
        { description: '', prompt: 'x' },
      ]),
    ).toThrow('sessions:launchAgentTask description must not be empty')
    expect(() =>
      validateIpcArgs('sessions:launchAgentTask', [
        'session-1',
        { description: 'inspect', prompt: 'x' },
      ]),
    ).toThrow('sessions:launchAgentTask agentType must be a string')
    expect(() =>
      validateIpcArgs('sessions:launchAgentTask', [
        'session-1',
        { agentType: '   ', description: 'inspect', prompt: 'x' },
      ]),
    ).toThrow('sessions:launchAgentTask agentType must not be empty')
    expect(() =>
      validateIpcArgs('sessions:readAgentTaskOutput', [
        'session-1',
        { taskId: 'agent-123', timeoutMs: 600_001 },
      ]),
    ).toThrow('sessions:readAgentTaskOutput timeoutMs must be an integer from 0 to 600000')
    expect(() =>
      validateIpcArgs('sessions:previewAgentTaskOutput', [
        'session-1',
        { taskId: 'agent-123', maxBytes: 16 },
      ]),
    ).toThrow('sessions:previewAgentTaskOutput maxBytes must be an integer from 1024 to 262144')
    expect(() =>
      validateIpcArgs('sessions:resumeAgentTask', [
        'session-1',
        { taskId: 'agent-123', prompt: '' },
      ]),
    ).toThrow('sessions:resumeAgentTask prompt must not be empty')
    expect(() =>
      validateIpcArgs('teams:send', [
        'session-1',
        { teamName: 'frontend', to: '', message: 'status?' },
      ]),
    ).toThrow('teams:send to must not be empty')
    expect(() =>
      validateIpcArgs('teams:removeMember', [
        'session-1',
        { teamName: 'frontend', memberName: '' },
      ]),
    ).toThrow('teams:removeMember memberName must not be empty')
    expect(() =>
      validateIpcArgs('teams:removeMember', [
        'session-1',
        { teamName: 'frontend', memberName: '../alice' },
      ]),
    ).toThrow('teams:removeMember memberName must not contain path separators')
  })
})
