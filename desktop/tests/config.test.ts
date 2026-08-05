import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  addOrUpdateMcpServer,
  addOrUpdateProjectMcpServer,
  addOrUpdateScheduledTask,
  applyDesktopRuntimeEnv,
  fireDueScheduledTasks,
  installLocalSkill,
  installProjectSkill,
  loadClaudeDesktopConfig,
  loadClaudeRuntimeEnv,
  listProjectSkills,
  listProjectMcpServers,
  readMcpServer,
  readLocalSkill,
  readProjectMcpServer,
  readProjectSkill,
  redactSecrets,
  removeMcpServer,
  removeProjectMcpServer,
  removeLocalSkill,
  removeProjectSkill,
  removeScheduledTask,
  pauseScheduledTask,
  resumeScheduledTask,
  saveLocalSkill,
  saveProjectSkill,
  saveDesktopProxySettings,
  setMcpServerEnabled,
  setProjectMcpServerApproval,
} from '../main/config'

const originalClaudeHome = process.env.CLAUDE_CODE_DESKTOP_CLAUDE_HOME
const originalStorePath = process.env.CLAUDE_CODE_DESKTOP_STORE_PATH
const originalUserType = process.env.USER_TYPE

afterEach(() => {
  if (originalClaudeHome === undefined) {
    delete process.env.CLAUDE_CODE_DESKTOP_CLAUDE_HOME
  } else {
    process.env.CLAUDE_CODE_DESKTOP_CLAUDE_HOME = originalClaudeHome
  }
  if (originalStorePath === undefined) {
    delete process.env.CLAUDE_CODE_DESKTOP_STORE_PATH
  } else {
    process.env.CLAUDE_CODE_DESKTOP_STORE_PATH = originalStorePath
  }
  if (originalUserType === undefined) {
    delete process.env.USER_TYPE
  } else {
    process.env.USER_TYPE = originalUserType
  }
})

async function setupClaudeHome() {
  const root = join(tmpdir(), `claude-desktop-config-${randomUUID()}`)
  const home = join(root, '.kode')
  await mkdir(home, { recursive: true })
  process.env.CLAUDE_CODE_DESKTOP_CLAUDE_HOME = home
  process.env.CLAUDE_CODE_DESKTOP_STORE_PATH = join(root, 'desktop-store.json')
  return { root, home }
}

describe('desktop config', () => {
  it('redacts secrets before config reaches the renderer', () => {
    expect(redactSecrets({
      ANTHROPIC_AUTH_TOKEN: 'abcdef123456',
      url: 'https://example.com/mcp?key=secret-value',
    })).toEqual({
      ANTHROPIC_AUTH_TOKEN: 'abc...[redacted]...456',
      url: 'https://example.com/mcp?key=%5Bredacted%5D',
    })
  })

  it('reads settings env and applies desktop proxy to runtime env', async () => {
    const { home } = await setupClaudeHome()
    await writeFile(join(home, 'settings.json'), JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: 'https://example.test',
        ANTHROPIC_AUTH_TOKEN: 'secret-token',
      },
    }))
    await saveDesktopProxySettings({
      enabled: true,
      url: 'socks5://127.0.0.1:7890',
    })

    expect(loadClaudeRuntimeEnv()).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://example.test',
      ANTHROPIC_AUTH_TOKEN: 'secret-token',
    })
    expect(applyDesktopRuntimeEnv({
      PATH: '/bin',
      CLAUDE_CODE_DESKTOP_CLAUDE_HOME: home,
      CLAUDE_CODE_DESKTOP_STORE_PATH: process.env.CLAUDE_CODE_DESKTOP_STORE_PATH,
    })).toMatchObject({
      PATH: '/bin',
      CLAUDE_CODE_DESKTOP_CLAUDE_HOME: home,
      CLAUDE_CODE_DESKTOP_STORE_PATH: process.env.CLAUDE_CODE_DESKTOP_STORE_PATH,
      ANTHROPIC_BASE_URL: 'https://example.test',
      ANTHROPIC_AUTH_TOKEN: 'secret-token',
      ALL_PROXY: 'socks5://127.0.0.1:7890',
      HTTPS_PROXY: 'socks5://127.0.0.1:7890',
    })
  })

  it('loads MCP, scheduled tasks, plugins, and skills from Claude home', async () => {
    const { home } = await setupClaudeHome()
    await writeFile(join(home, 'settings.json'), JSON.stringify({
      env: { ANTHROPIC_AUTH_TOKEN: 'secret-token' },
      enabledPlugins: {
        'superpowers@claude-plugins-official': true,
        'disabled@claude-plugins-official': false,
      },
    }))
    await writeFile(join(home, '.kode.mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { command: 'npx', args: ['@playwright/mcp'] },
      },
    }))
    await writeFile(join(home, 'scheduled_tasks.json'), JSON.stringify({
      tasks: [{ id: 'task-1', prompt: 'run' }],
    }))
    await mkdir(join(home, 'plugins'), { recursive: true })
    await writeFile(join(home, 'plugins/installed_plugins.json'), JSON.stringify({
      plugins: {
        'superpowers@claude-plugins-official': [{
          scope: 'user',
          version: '1.0.0',
          installPath: '/tmp/plugin',
        }],
        'disabled@claude-plugins-official': [{
          scope: 'user',
          version: '1.0.0',
          installPath: '/tmp/disabled-plugin',
        }],
      },
    }))
    await mkdir(join(home, 'skills/demo-skill'), { recursive: true })
    await writeFile(
      join(home, 'skills/demo-skill/SKILL.md'),
      '---\ndescription: Demo skill\n---\n',
    )

    const config = await loadClaudeDesktopConfig()
    expect(config.settings).toMatchObject({
      env: { ANTHROPIC_AUTH_TOKEN: 'sec...[redacted]...ken' },
    })
    expect(config.mcpServers).toMatchObject([{ name: 'playwright', command: 'npx' }])
    expect(config.scheduledTasks).toMatchObject([{ id: 'task-1', prompt: 'run', enabled: true }])
    expect(config.plugins).toMatchObject([
      { id: 'superpowers@claude-plugins-official', enabled: true },
      { id: 'disabled@claude-plugins-official', enabled: false },
    ])
    expect(config.skills).toMatchObject([{ name: 'demo-skill', description: 'Demo skill' }])
    expect(config.runtimeCapabilities).toEqual({
      remoteIsolation: process.env.USER_TYPE === 'ant',
      worktreeIsolation: true,
    })
  })

  it('exposes private remote isolation only for ant runtimes', async () => {
    await setupClaudeHome()

    process.env.USER_TYPE = 'external'
    expect((await loadClaudeDesktopConfig()).runtimeCapabilities.remoteIsolation)
      .toBe(false)

    process.env.USER_TYPE = 'ant'
    expect((await loadClaudeDesktopConfig()).runtimeCapabilities.remoteIsolation)
      .toBe(true)
  })

  it('installs a local skill into Claude home', async () => {
    const { home, root } = await setupClaudeHome()
    const source = join(root, 'new-skill')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'SKILL.md'), '---\ndescription: New skill\n---\n')

    const installed = await installLocalSkill(source)

    expect(installed).toMatchObject({
      name: 'new-skill',
      path: join(home, 'skills/new-skill'),
    })
    await expect(readFile(join(home, 'skills/new-skill/SKILL.md'), 'utf8'))
      .resolves
      .toContain('New skill')

    const remaining = await removeLocalSkill('new-skill')
    expect(remaining.some(skill => skill.name === 'new-skill')).toBe(false)
    await expect(readFile(join(home, 'skills/new-skill/SKILL.md'), 'utf8'))
      .rejects
      .toThrow()
  })

  it('rejects removing a missing local skill', async () => {
    await setupClaudeHome()

    await expect(removeLocalSkill('missing-skill')).rejects.toThrow(
      'Skill not found: missing-skill',
    )
  })

  it('reads user and project skill details for settings inspection', async () => {
    const { home, root } = await setupClaudeHome()
    const project = join(root, 'project')
    await mkdir(join(home, 'skills/demo-skill'), { recursive: true })
    await mkdir(join(project, '.kode/skills/project-skill'), { recursive: true })
    await writeFile(
      join(home, 'skills/demo-skill/SKILL.md'),
      '---\ndescription: Demo skill\n---\n\nUse this skill for demos.\n',
    )
    await writeFile(
      join(project, '.kode/skills/project-skill/SKILL.md'),
      '---\ndescription: Project skill\n---\n\nUse this skill for the project.\n',
    )

    expect(await readLocalSkill('demo-skill')).toMatchObject({
      name: 'demo-skill',
      path: join(home, 'skills/demo-skill'),
      description: 'Demo skill',
      contents: expect.stringContaining('Use this skill for demos.'),
    })
    expect(await readProjectSkill(project, 'project-skill')).toMatchObject({
      name: 'project-skill',
      path: join(project, '.kode/skills/project-skill'),
      description: 'Project skill',
      contents: expect.stringContaining('Use this skill for the project.'),
    })
    await expect(readLocalSkill('../outside')).rejects.toThrow(
      'Skill name may only contain letters, numbers, dots, underscores, and dashes',
    )
  })

  it('saves user skill content directly from desktop settings', async () => {
    const { home } = await setupClaudeHome()

    const saved = await saveLocalSkill({
      name: 'draft-skill',
      contents: '---\ndescription: Draft skill\n---\n\nUse this skill for drafts.\n',
    })

    expect(saved).toMatchObject({
      name: 'draft-skill',
      path: join(home, 'skills/draft-skill'),
      description: 'Draft skill',
      contents: expect.stringContaining('Use this skill for drafts.'),
    })
    await expect(readLocalSkill('draft-skill')).resolves.toMatchObject({
      description: 'Draft skill',
      contents: expect.stringContaining('Use this skill for drafts.'),
    })
    await expect(saveLocalSkill({
      name: '../outside',
      contents: '---\ndescription: Bad\n---\n',
    })).rejects.toThrow(
      'Skill name may only contain letters, numbers, dots, underscores, and dashes',
    )
    await expect(saveLocalSkill({
      name: 'empty-skill',
      contents: '',
    })).rejects.toThrow('Skill contents must not be empty')
  })

  it('installs a local skill into project .kode/skills', async () => {
    const { root } = await setupClaudeHome()
    const project = join(root, 'project')
    const source = join(root, 'project-skill')
    await mkdir(project, { recursive: true })
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'SKILL.md'), '---\ndescription: Project skill\n---\n')

    const installed = await installProjectSkill(project, source)

    expect(installed).toMatchObject({
      name: 'project-skill',
      path: join(project, '.kode/skills/project-skill'),
    })
    expect(await listProjectSkills(project)).toMatchObject([{
      name: 'project-skill',
      description: 'Project skill',
    }])

    expect(await removeProjectSkill(project, 'project-skill')).toEqual([])
    await expect(readFile(join(project, '.kode/skills/project-skill/SKILL.md'), 'utf8'))
      .rejects
      .toThrow()
    await expect(removeProjectSkill(project, '../outside')).rejects.toThrow(
      'Skill name may only contain letters, numbers, dots, underscores, and dashes',
    )
  })

  it('rejects removing a missing project skill', async () => {
    const { root } = await setupClaudeHome()
    const project = join(root, 'project')
    await mkdir(project, { recursive: true })

    await expect(removeProjectSkill(project, 'missing-skill')).rejects.toThrow(
      'Skill not found: missing-skill',
    )
  })

  it('saves project skill content inside workspace .kode/skills', async () => {
    const { root } = await setupClaudeHome()
    const project = join(root, 'project')
    await mkdir(project, { recursive: true })

    const saved = await saveProjectSkill(project, {
      name: 'project-draft',
      contents: '---\ndescription: Project draft\n---\n\nUse this skill in this repo.\n',
    })

    expect(saved).toMatchObject({
      name: 'project-draft',
      path: join(project, '.kode/skills/project-draft'),
      description: 'Project draft',
      contents: expect.stringContaining('Use this skill in this repo.'),
    })
    await expect(readFile(join(project, '.kode/skills/project-draft/SKILL.md'), 'utf8'))
      .resolves
      .toContain('Use this skill in this repo.')
  })

  it('rejects project skill listing and installs through symlinked workspace skill directories', async () => {
    const { root } = await setupClaudeHome()
    const project = join(root, 'project')
    const outside = join(root, 'outside-skills')
    const source = join(root, 'project-skill')
    await mkdir(join(project, '.kode'), { recursive: true })
    await mkdir(outside, { recursive: true })
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'SKILL.md'), '---\ndescription: Project skill\n---\n')
    await mkdir(join(outside, 'external-skill'), { recursive: true })
    await writeFile(join(outside, 'external-skill/SKILL.md'), '---\ndescription: External skill\n---\n')
    await symlink(outside, join(project, '.kode/skills'))

    await expect(listProjectSkills(project)).rejects.toThrow(
      'Workspace file target must not be a symlink:',
    )
    await expect(readProjectSkill(project, 'external-skill')).rejects.toThrow(
      'Workspace file target must not be a symlink:',
    )
    await expect(installProjectSkill(project, source)).rejects.toThrow(
      'Workspace file target must not be a symlink:',
    )
    await expect(saveProjectSkill(project, {
      name: 'project-skill',
      contents: '---\ndescription: Project skill\n---\n',
    })).rejects.toThrow(
      'Workspace file target must not be a symlink:',
    )
    await expect(readFile(join(outside, 'project-skill/SKILL.md'), 'utf8'))
      .rejects
      .toThrow()
  })

  it('adds, updates, and removes MCP servers without leaking preserved remote URLs', async () => {
    const { home } = await setupClaudeHome()
    await writeFile(join(home, '.kode.mcp.json'), JSON.stringify({
      mcpServers: {
        remote: { type: 'streamable-http', url: 'https://mcp.example/server?key=secret' },
      },
    }))

    await addOrUpdateMcpServer({
      name: 'playwright',
      mode: 'stdio',
      command: 'npx',
      args: ['@playwright/mcp@latest', '--headless'],
    })
    await addOrUpdateMcpServer({
      name: 'remote',
      mode: 'remote',
      type: 'sse',
    })

    const updated = JSON.parse(await readFile(join(home, '.kode.mcp.json'), 'utf8'))
    expect(updated.mcpServers.playwright).toEqual({
      command: 'npx',
      args: ['@playwright/mcp@latest', '--headless'],
    })
    expect(updated.mcpServers.remote).toEqual({
      type: 'sse',
      url: 'https://mcp.example/server?key=secret',
    })

    const afterRemove = await removeMcpServer('playwright')
    expect(afterRemove.some(server => server.name === 'playwright')).toBe(false)
    const removed = JSON.parse(await readFile(join(home, '.kode.mcp.json'), 'utf8'))
    expect(removed.mcpServers.playwright).toBeUndefined()
  })

  it('rejects removing a missing user MCP server', async () => {
    const { home } = await setupClaudeHome()
    await writeFile(join(home, '.kode.mcp.json'), JSON.stringify({
      mcpServers: {
        existing: { command: 'node', args: ['server.mjs'] },
      },
    }))

    await expect(removeMcpServer('missing')).rejects.toThrow(
      'MCP server not found: missing',
    )
  })

  it('enables and disables user MCP servers through settings', async () => {
    const { home } = await setupClaudeHome()
    await writeFile(join(home, '.kode.mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { command: 'npx', args: ['@playwright/mcp'] },
      },
    }))

    expect((await loadClaudeDesktopConfig()).mcpServers).toMatchObject([{
      name: 'playwright',
      enabled: true,
    }])

    let servers = await setMcpServerEnabled('playwright', false)
    expect(servers).toMatchObject([{
      name: 'playwright',
      enabled: false,
    }])
    let settings = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'))
    expect(settings.disabledMcpServers).toEqual(['playwright'])
    const mcpConfig = JSON.parse(await readFile(join(home, '.kode.mcp.json'), 'utf8'))
    expect(mcpConfig.mcpServers.playwright).toEqual({
      command: 'npx',
      args: ['@playwright/mcp'],
    })

    servers = await setMcpServerEnabled('playwright', true)
    expect(servers).toMatchObject([{
      name: 'playwright',
      enabled: true,
    }])
    settings = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'))
    expect(settings.disabledMcpServers).toEqual([])

    await setMcpServerEnabled('playwright', false)
    expect(await removeMcpServer('playwright')).toEqual([])
    settings = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'))
    expect(settings.disabledMcpServers).toEqual([])
  })

  it('rejects enabling or disabling a missing user MCP server', async () => {
    const { home } = await setupClaudeHome()
    await writeFile(join(home, '.kode.mcp.json'), JSON.stringify({
      mcpServers: {
        existing: { command: 'node', args: ['server.mjs'] },
      },
    }))

    await expect(setMcpServerEnabled('missing', false)).rejects.toThrow(
      'MCP server not found: missing',
    )
    await expect(setMcpServerEnabled('missing', true)).rejects.toThrow(
      'MCP server not found: missing',
    )
    await expect(readFile(join(home, 'settings.json'), 'utf8')).rejects.toThrow()
  })

  it('reads user and project MCP server details for settings inspection', async () => {
    const { home, root } = await setupClaudeHome()
    const project = join(root, 'project')
    await mkdir(project, { recursive: true })
    await writeFile(join(home, '.kode.mcp.json'), JSON.stringify({
      mcpServers: {
        remote: { type: 'sse', url: 'https://mcp.example/server?key=secret' },
      },
    }))
    await writeFile(join(project, '.kode.mcp.json'), JSON.stringify({
      mcpServers: {
        project: { command: 'node', args: ['server.mjs'] },
      },
    }))

    expect(await readMcpServer('remote')).toMatchObject({
      name: 'remote',
      type: 'sse',
      url: 'https://mcp.example/server?key=%5Bredacted%5D',
      sourcePath: join(home, '.kode.mcp.json'),
      raw: { type: 'sse', url: 'https://mcp.example/server?key=%5Bredacted%5D' },
    })
    expect(await readProjectMcpServer(project, 'project')).toMatchObject({
      name: 'project',
      command: 'node',
      args: ['server.mjs'],
      sourcePath: join(project, '.kode.mcp.json'),
      raw: { command: 'node', args: ['server.mjs'] },
    })
    await expect(readProjectMcpServer(project, '../outside')).rejects.toThrow(
      'MCP server name must not contain path separators',
    )
  })

  it('adds and removes project-scoped MCP servers', async () => {
    const { root } = await setupClaudeHome()
    const project = join(root, 'project')
    await mkdir(project, { recursive: true })

    await addOrUpdateProjectMcpServer(project, {
      name: 'project-server',
      mode: 'stdio',
      command: 'node',
      args: ['server.mjs'],
    })

    expect(await listProjectMcpServers(project)).toMatchObject([{
      name: 'project-server',
      command: 'node',
      args: ['server.mjs'],
      sourcePath: join(project, '.kode.mcp.json'),
    }])

    const raw = JSON.parse(await readFile(join(project, '.kode.mcp.json'), 'utf8'))
    expect(raw.mcpServers['project-server']).toEqual({
      command: 'node',
      args: ['server.mjs'],
    })

    expect(await removeProjectMcpServer(project, 'project-server')).toEqual([])
  })

  it('rejects removing a missing project MCP server', async () => {
    const { root } = await setupClaudeHome()
    const project = join(root, 'project')
    await mkdir(project, { recursive: true })
    await writeFile(join(project, '.kode.mcp.json'), JSON.stringify({
      mcpServers: {
        existing: { command: 'node', args: ['server.mjs'] },
      },
    }))

    await expect(removeProjectMcpServer(project, 'missing')).rejects.toThrow(
      'MCP server not found: missing',
    )
  })

  it('approves and rejects project-scoped MCP servers in local settings', async () => {
    const { root } = await setupClaudeHome()
    const project = join(root, 'project')
    await mkdir(project, { recursive: true })
    await writeFile(join(project, '.kode.mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { command: 'npx', args: ['@playwright/mcp'] },
      },
    }))

    expect(await listProjectMcpServers(project)).toMatchObject([{
      name: 'playwright',
      approvalStatus: 'pending',
    }])

    let servers = await setProjectMcpServerApproval(project, 'playwright', true)
    expect(servers).toMatchObject([{
      name: 'playwright',
      approvalStatus: 'approved',
    }])
    let localSettings = JSON.parse(await readFile(join(project, '.kode/settings.local.json'), 'utf8'))
    expect(localSettings.enabledMcpjsonServers).toEqual(['playwright'])
    expect(localSettings.disabledMcpjsonServers).toEqual([])

    servers = await setProjectMcpServerApproval(project, 'playwright', false)
    expect(servers).toMatchObject([{
      name: 'playwright',
      approvalStatus: 'rejected',
    }])
    localSettings = JSON.parse(await readFile(join(project, '.kode/settings.local.json'), 'utf8'))
    expect(localSettings.enabledMcpjsonServers).toEqual([])
    expect(localSettings.disabledMcpjsonServers).toEqual(['playwright'])

    expect(await removeProjectMcpServer(project, 'playwright')).toEqual([])
    localSettings = JSON.parse(await readFile(join(project, '.kode/settings.local.json'), 'utf8'))
    expect(localSettings.enabledMcpjsonServers).toEqual([])
    expect(localSettings.disabledMcpjsonServers).toEqual([])
  })

  it('rejects approving or rejecting a missing project MCP server', async () => {
    const { root } = await setupClaudeHome()
    const project = join(root, 'project')
    await mkdir(project, { recursive: true })
    await writeFile(join(project, '.kode.mcp.json'), JSON.stringify({
      mcpServers: {
        existing: { command: 'node', args: ['server.mjs'] },
      },
    }))

    await expect(setProjectMcpServerApproval(project, 'missing', true)).rejects.toThrow(
      'MCP server not found: missing',
    )
    await expect(setProjectMcpServerApproval(project, 'missing', false)).rejects.toThrow(
      'MCP server not found: missing',
    )
    await expect(readFile(join(project, '.kode/settings.local.json'), 'utf8'))
      .rejects
      .toThrow()
  })

  it('rejects project-scoped MCP files that are symlinks outside the workspace', async () => {
    const { root } = await setupClaudeHome()
    const project = join(root, 'project')
    const outside = join(root, 'outside')
    await mkdir(project, { recursive: true })
    await mkdir(outside, { recursive: true })
    const outsideMcp = join(outside, '.kode.mcp.json')
    await writeFile(outsideMcp, JSON.stringify({
      mcpServers: {
        secret: { command: 'secret-command' },
      },
    }))
    await symlink(outsideMcp, join(project, '.kode.mcp.json'))

    await expect(listProjectMcpServers(project)).rejects.toThrow(
      'Workspace file target must not be a symlink:',
    )
    await expect(addOrUpdateProjectMcpServer(project, {
      name: 'project-server',
      mode: 'stdio',
      command: 'node',
    })).rejects.toThrow('Workspace file target must not be a symlink:')
    await expect(removeProjectMcpServer(project, 'secret')).rejects.toThrow(
      'Workspace file target must not be a symlink:',
    )

    expect(await readFile(outsideMcp, 'utf8')).toContain('secret-command')
  })

  it('rejects project MCP approval settings files that are symlinks outside the workspace', async () => {
    const { root } = await setupClaudeHome()
    const project = join(root, 'project')
    const outside = join(root, 'outside')
    await mkdir(join(project, '.kode'), { recursive: true })
    await mkdir(outside, { recursive: true })
    const outsideSettings = join(outside, 'settings.local.json')
    await writeFile(outsideSettings, JSON.stringify({
      enabledMcpjsonServers: ['secret'],
    }))
    await writeFile(join(project, '.kode.mcp.json'), JSON.stringify({
      mcpServers: {
        'project-server': { command: 'node', args: ['server.mjs'] },
      },
    }))
    await symlink(outsideSettings, join(project, '.kode/settings.local.json'))

    await expect(setProjectMcpServerApproval(project, 'project-server', true)).rejects.toThrow(
      'Workspace file target must not be a symlink:',
    )
    expect(await readFile(outsideSettings, 'utf8')).toContain('secret')
  })

  it('adds, updates, and removes scheduled tasks', async () => {
    const { home } = await setupClaudeHome()
    await writeFile(join(home, 'scheduled_tasks.json'), JSON.stringify({
      tasks: [{ id: 'task-1', prompt: 'old prompt', extra: 'kept' }],
    }))

    const updated = await addOrUpdateScheduledTask({
      id: 'task-1',
      name: 'Daily check',
      schedule: '0 9 * * *',
      prompt: 'new prompt',
      enabled: false,
    })
    expect(updated).toMatchObject([{
      id: 'task-1',
      name: 'Daily check',
      schedule: '0 9 * * *',
      prompt: 'new prompt',
      enabled: false,
    }])

    const raw = JSON.parse(await readFile(join(home, 'scheduled_tasks.json'), 'utf8'))
    expect(raw.tasks[0]).toMatchObject({
      id: 'task-1',
      extra: 'kept',
      createdAt: expect.any(Number),
    })

    await addOrUpdateScheduledTask({
      prompt: 'created prompt',
      enabled: true,
    })
    const withCreated = JSON.parse(await readFile(join(home, 'scheduled_tasks.json'), 'utf8'))
    expect(withCreated.tasks).toHaveLength(2)
    expect(withCreated.tasks[1].id).toEqual(expect.any(String))

    const afterRemove = await removeScheduledTask('task-1')
    expect(afterRemove.some(task => task.id === 'task-1')).toBe(false)
  })

  it('rejects removing a missing scheduled task', async () => {
    const { home } = await setupClaudeHome()
    await writeFile(join(home, 'scheduled_tasks.json'), JSON.stringify({
      tasks: [{ id: 'task-1', prompt: 'old prompt' }],
    }))

    await expect(removeScheduledTask('missing-task')).rejects.toThrow(
      'Scheduled task not found: missing-task',
    )
  })

  it('pauses and resumes scheduled tasks without rewriting the full task payload', async () => {
    const { home } = await setupClaudeHome()
    await writeFile(join(home, 'scheduled_tasks.json'), JSON.stringify({
      tasks: [{
        id: 'task-1',
        name: 'Daily check',
        schedule: '0 9 * * *',
        prompt: 'inspect',
        enabled: true,
        extra: 'kept',
      }],
    }))

    const paused = await pauseScheduledTask('task-1')
    expect(paused).toMatchObject([{ id: 'task-1', enabled: false }])

    let raw = JSON.parse(await readFile(join(home, 'scheduled_tasks.json'), 'utf8'))
    expect(raw.tasks[0]).toMatchObject({
      id: 'task-1',
      enabled: false,
      extra: 'kept',
    })

    const resumed = await resumeScheduledTask('task-1')
    expect(resumed).toMatchObject([{ id: 'task-1', enabled: true }])

    raw = JSON.parse(await readFile(join(home, 'scheduled_tasks.json'), 'utf8'))
    expect(raw.tasks[0]).toMatchObject({
      id: 'task-1',
      enabled: true,
      extra: 'kept',
    })
  })

  it('rejects updating a missing scheduled task id', async () => {
    const { home } = await setupClaudeHome()
    await writeFile(join(home, 'scheduled_tasks.json'), JSON.stringify({
      tasks: [{ id: 'task-1', prompt: 'old prompt' }],
    }))

    await expect(addOrUpdateScheduledTask({
      id: 'missing-task',
      prompt: 'new prompt',
      enabled: false,
    })).rejects.toThrow('Scheduled task not found: missing-task')
    const raw = JSON.parse(await readFile(join(home, 'scheduled_tasks.json'), 'utf8'))
    expect(raw.tasks).toEqual([{ id: 'task-1', prompt: 'old prompt' }])
  })

  it('fires due global scheduled tasks and writes lastFiredAt', async () => {
    const { home } = await setupClaudeHome()
    const createdAt = new Date(2026, 0, 1, 0, 0).getTime()
    const firedAt = new Date(2026, 0, 1, 0, 1).getTime()
    await writeFile(join(home, 'scheduled_tasks.json'), JSON.stringify({
      tasks: [{
        id: 'global-task',
        name: 'Global task',
        schedule: '1 0 * * *',
        prompt: 'run globally',
        enabled: true,
        createdAt,
      }],
    }))

    const fired = await fireDueScheduledTasks(firedAt)
    const raw = JSON.parse(await readFile(join(home, 'scheduled_tasks.json'), 'utf8'))

    expect(fired).toMatchObject([{
      id: 'global-task',
      prompt: 'run globally',
      lastFiredAt: firedAt,
    }])
    expect(raw.tasks[0]).toMatchObject({
      id: 'global-task',
      lastFiredAt: firedAt,
      createdAt,
    })
    expect(await fireDueScheduledTasks(firedAt)).toEqual([])
  })
})
