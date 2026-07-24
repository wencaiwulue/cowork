import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildAgentLaunchPrompt,
  buildAgentTaskOutputPrompt,
  buildAgentTaskResumePrompt,
  buildAgentTaskStopPrompt,
  buildTeamCreatePrompt,
  buildTeamDeletePrompt,
  buildTeamMessagePrompt,
  buildTeamShutdownPrompt,
  createTeam,
  deleteTeam,
  deleteAgent,
  diagnoseAgent,
  removeTeamMember,
  upsertTeamMember,
  listAgents,
  listTeamMembers,
  listTeams,
  normalizeCliAgentList,
  saveAgent,
} from '../main/agents'

const originalClaudeHome = process.env.CLAUDE_CODE_DESKTOP_CLAUDE_HOME
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
const originalDisableAgentCli = process.env.CLAUDE_CODE_DESKTOP_DISABLE_AGENT_CLI

afterEach(() => {
  if (originalClaudeHome === undefined) {
    delete process.env.CLAUDE_CODE_DESKTOP_CLAUDE_HOME
  } else {
    process.env.CLAUDE_CODE_DESKTOP_CLAUDE_HOME = originalClaudeHome
  }
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  if (originalDisableAgentCli === undefined) {
    delete process.env.CLAUDE_CODE_DESKTOP_DISABLE_AGENT_CLI
  } else {
    process.env.CLAUDE_CODE_DESKTOP_DISABLE_AGENT_CLI = originalDisableAgentCli
  }
})

async function setupAgentWorkspace() {
  const root = join(tmpdir(), `claude-desktop-agents-${randomUUID()}`)
  const home = join(root, '.claude-home')
  const cwd = join(root, 'project')
  await mkdir(home, { recursive: true })
  await mkdir(cwd, { recursive: true })
  process.env.CLAUDE_CODE_DESKTOP_CLAUDE_HOME = home
  process.env.CLAUDE_CONFIG_DIR = home
  process.env.CLAUDE_CODE_DESKTOP_DISABLE_AGENT_CLI = '1'
  return { root, home, cwd }
}

describe('desktop agent service', () => {
  it('normalizes the CLI agents JSON catalog into renderer-safe sources', () => {
    const listed = normalizeCliAgentList(JSON.stringify({
      activeAgents: [{
        agentType: 'reviewer',
        source: 'projectSettings',
        whenToUse: 'Review code.',
        active: true,
        tools: ['Read'],
        requiredMcpServers: ['playwright'],
        model: 'sonnet',
        baseDir: '/repo/.claude/agents',
        filename: 'reviewer',
      }, {
        agentType: 'plugin-helper',
        source: 'plugin',
        whenToUse: 'Use plugin.',
        active: true,
        hasHooks: true,
      }],
      allAgents: [{
        agentType: 'reviewer',
        source: 'projectSettings',
        whenToUse: 'Review code.',
        active: true,
        tools: ['Read'],
        requiredMcpServers: ['playwright'],
        model: 'sonnet',
        baseDir: '/repo/.claude/agents',
        filename: 'reviewer',
      }, {
        agentType: 'reviewer',
        source: 'userSettings',
        whenToUse: 'Older reviewer.',
        active: false,
        overriddenBy: 'projectSettings',
      }, {
        agentType: 'local-only',
        source: 'localSettings',
        whenToUse: 'Local override.',
        active: false,
      }],
      failedFiles: [{ path: '/bad.md', error: 'missing description' }],
    }))

    expect(listed?.activeAgents).toMatchObject([
      {
        agentType: 'reviewer',
        source: 'project',
        editable: true,
        tools: ['Read'],
        requiredMcpServers: ['playwright'],
        model: 'sonnet',
        path: '/repo/.claude/agents/reviewer.md',
      },
      {
        agentType: 'plugin-helper',
        source: 'plugin',
        editable: false,
        hasHooks: true,
      },
    ])
    expect(listed?.allAgents.find(agent => agent.agentType === 'local-only'))
      .toMatchObject({ source: 'local', editable: false })
    expect(listed?.failedFiles).toEqual([
      { path: '/bad.md', error: 'missing description' },
    ])
  })

  it('preserves CLI agent failed files even when no agents are returned', () => {
    const listed = normalizeCliAgentList(JSON.stringify({
      activeAgents: [],
      allAgents: [],
      failedFiles: [{ path: '/broken.md', error: 'missing frontmatter' }],
    }))

    expect(listed).toEqual({
      activeAgents: [],
      allAgents: [],
      failedFiles: [{ path: '/broken.md', error: 'missing frontmatter' }],
    })
  })

  it('lists built-in and user agents without a project cwd', async () => {
    const { home } = await setupAgentWorkspace()
    await mkdir(join(home, 'agents'), { recursive: true })
    await writeFile(join(home, 'agents', 'user-helper.md'), [
      '---',
      'name: user-helper',
      'description: "Use without a project."',
      '---',
      '',
      'Help from user config.',
      '',
    ].join('\n'))

    const listed = await listAgents('')

    expect(listed.allAgents).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentType: 'general-purpose', source: 'built-in' }),
      expect.objectContaining({ agentType: 'user-helper', source: 'user', editable: true }),
    ]))
    expect(listed.allAgents.some(agent => agent.source === 'project')).toBe(false)
  })

  it('saves, lists, diagnoses, and deletes editable project agents', async () => {
    const { cwd } = await setupAgentWorkspace()
    await writeFile(join(cwd, '.mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { command: 'npx', args: ['@playwright/mcp'] },
      },
    }))

    const saved = await saveAgent(cwd, {
      source: 'project',
      agentType: 'reviewer',
      whenToUse: 'Use for code review.',
      prompt: 'Review carefully.',
      tools: ['Read', 'Grep'],
      skills: ['missing-skill'],
      requiredMcpServers: ['playwright', 'browser'],
      model: 'sonnet',
      memory: 'user',
      disallowedTools: ['Bash'],
      background: true,
      isolation: 'worktree',
    })

    expect(saved).toMatchObject({
      agentType: 'reviewer',
      source: 'project',
      editable: true,
      tools: ['Read', 'Grep'],
      requiredMcpServers: ['playwright', 'browser'],
      model: 'sonnet',
      disallowedTools: ['Bash'],
      memory: 'user',
      background: true,
      isolation: 'worktree',
      prompt: 'Review carefully.',
    })
    expect(await readFile(join(cwd, '.claude/agents/reviewer.md'), 'utf8'))
      .toContain('description: "Use for code review."')

    const listed = await listAgents(cwd)
    expect(listed.activeAgents.some(agent => agent.agentType === 'reviewer')).toBe(true)

    const diagnostics = await diagnoseAgent(cwd, 'reviewer')
    expect(diagnostics).toMatchObject({
      agentType: 'reviewer',
      ok: false,
      configuredMcpServers: ['playwright'],
      requiredMcpServers: ['playwright', 'browser'],
      requiredSkills: ['missing-skill'],
      missingMcpServers: ['browser'],
      missingSkills: ['missing-skill'],
      tools: ['Read', 'Grep'],
      disallowedTools: ['Bash'],
      memory: 'user',
      isolation: 'worktree',
      hasHooks: false,
    })
    expect(diagnostics.readiness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'MCP servers',
        ok: false,
        detail: 'playwright, browser',
      }),
      expect.objectContaining({
        label: 'Tools',
        ok: true,
        detail: 'Allowed: Read, Grep · Disallowed: Bash',
      }),
      expect.objectContaining({
        label: 'Memory',
        ok: true,
        detail: 'Agent memory scope: user.',
      }),
      expect.objectContaining({
        label: 'Isolation',
        ok: true,
        detail: 'Requested isolation: worktree.',
      }),
    ]))

    await deleteAgent(cwd, 'reviewer', 'project')
    const afterDelete = await listAgents(cwd)
    expect(afterDelete.activeAgents.some(agent => agent.agentType === 'reviewer')).toBe(false)
  })

  it('rejects deleting missing editable agents', async () => {
    const { cwd } = await setupAgentWorkspace()

    await expect(deleteAgent(cwd, 'missing-user-agent', 'user')).rejects.toThrow(
      'Agent not found: missing-user-agent',
    )
    await expect(deleteAgent(cwd, 'missing-project-agent', 'project')).rejects.toThrow(
      'Agent not found: missing-project-agent',
    )
    await expect(readFile(join(cwd, '.claude/agents/missing-project-agent.md'), 'utf8'))
      .rejects
      .toThrow()
  })

  it('rejects project agent save and delete through symlinked workspace agent directories', async () => {
    const { root, cwd } = await setupAgentWorkspace()
    const outside = join(root, 'outside-agents')
    await mkdir(join(cwd, '.claude'), { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'reviewer.md'), [
      '---',
      'name: reviewer',
      'description: outside',
      '---',
      '',
      'outside',
      '',
    ].join('\n'))
    await symlink(outside, join(cwd, '.claude/agents'))

    await expect(listAgents(cwd)).rejects.toThrow(
      'Workspace file target must not be a symlink:',
    )
    await expect(diagnoseAgent(cwd, 'reviewer')).rejects.toThrow(
      'Workspace file target must not be a symlink:',
    )
    await expect(saveAgent(cwd, {
      source: 'project',
      agentType: 'reviewer',
      whenToUse: 'Use for code review.',
      prompt: 'Review carefully.',
    })).rejects.toThrow('Workspace file target must not be a symlink:')
    await expect(deleteAgent(cwd, 'reviewer', 'project')).rejects.toThrow(
      'Workspace file target must not be a symlink:',
    )
    await expect(readFile(join(outside, 'reviewer.md'), 'utf8'))
      .resolves
      .toContain('outside')
  })

  it('reads team files and builds runtime-bound tool prompts', async () => {
    const { home } = await setupAgentWorkspace()
    await mkdir(join(home, 'teams/frontend'), { recursive: true })
    await writeFile(join(home, 'teams/frontend/config.json'), JSON.stringify({
      name: 'frontend',
      description: 'UI work',
      backend: 'local',
      mode: 'parallel',
      status: 'running',
      active: true,
      members: [{
        agentId: 'alice@frontend',
        name: 'alice',
        color: 'blue',
        mode: 'plan',
        status: 'active',
      }],
    }))

    expect(await listTeams()).toMatchObject([{
      name: 'frontend',
      description: 'UI work',
      backend: 'local',
      mode: 'parallel',
      status: 'running',
      active: true,
      members: [{
        agentId: 'alice@frontend',
        name: 'alice',
        color: 'blue',
        mode: 'plan',
        status: 'active',
      }],
    }])
    expect(await listTeamMembers('frontend')).toMatchObject([
      { agentId: 'alice@frontend', name: 'alice', color: 'blue', mode: 'plan', status: 'active' },
    ])

    expect(buildAgentLaunchPrompt({
      agentType: 'reviewer',
      description: 'review',
      prompt: 'inspect diff',
      runInBackground: true,
    })).toContain('"subagent_type": "reviewer"')
    const teammatePrompt = buildAgentLaunchPrompt({
      agentType: 'reviewer',
      description: 'spawn teammate',
      prompt: 'inspect ui',
      runInBackground: true,
      name: 'bob',
      teamName: 'frontend',
      mode: 'plan',
    })
    expect(teammatePrompt).toContain('"team_name": "frontend"')
    expect(teammatePrompt).toContain('"name": "bob"')
    expect(teammatePrompt).toContain('"mode": "plan"')
    expect(buildAgentTaskStopPrompt({ taskId: 'agent-123' }))
      .toContain('"task_id": "agent-123"')
    expect(buildAgentTaskOutputPrompt({
      taskId: 'agent-123',
      block: false,
      timeoutMs: 0,
    })).toContain('Use the TaskOutput tool exactly once')
    expect(buildAgentTaskResumePrompt({
      taskId: 'agent-123',
      prompt: 'continue',
    })).toContain('Use the SendMessage tool exactly once')
    expect(buildTeamCreatePrompt({
      teamName: 'frontend',
      description: 'UI work',
      agentType: 'planner',
    })).toContain('Use the TeamCreate tool exactly once')
    expect(buildTeamMessagePrompt({
      teamName: 'frontend',
      to: 'alice',
      message: 'status?',
    })).toContain('Use the SendMessage tool exactly once')
    expect(buildTeamShutdownPrompt({
      teamName: 'frontend',
      to: 'alice',
      reason: 'done',
    })).toContain('"type": "shutdown_request"')
    expect(buildTeamDeletePrompt({ teamName: 'frontend' }))
      .toContain('Use the TeamDelete tool exactly once')
  })

  it('creates, updates, adds members to, removes members from, and deletes local desktop team records', async () => {
    const { home } = await setupAgentWorkspace()

    let team = await createTeam({
      teamName: 'frontend',
      description: 'UI work',
      agentType: 'planner',
    })

    expect(team).toMatchObject({
      name: 'frontend',
      description: 'UI work',
      backend: 'desktop',
      mode: 'manual',
      status: 'configured',
      active: true,
      members: [{
        agentId: 'planner@frontend',
        name: 'planner',
        mode: 'lead',
        status: 'configured',
      }],
    })
    expect(await readFile(join(home, 'teams/frontend/config.json'), 'utf8'))
      .toContain('"backend": "desktop"')

    team = await upsertTeamMember({
      teamName: 'frontend',
      name: 'alice',
      agentType: 'reviewer',
      mode: 'plan',
    })
    expect(team.members).toMatchObject([
      { agentId: 'planner@frontend', name: 'planner', mode: 'lead' },
      { agentId: 'alice@frontend', name: 'alice', mode: 'plan', status: 'starting' },
    ])

    team = await createTeam({
      teamName: 'frontend',
      description: 'Updated UI work',
      agentType: 'planner',
    })
    expect(team).toMatchObject({
      name: 'frontend',
      description: 'Updated UI work',
      members: [
        { agentId: 'planner@frontend', name: 'planner', mode: 'lead' },
        { agentId: 'alice@frontend', name: 'alice', mode: 'plan' },
      ],
    })
    expect(await listTeams()).toHaveLength(1)
    expect(await listTeamMembers('frontend')).toHaveLength(2)

    team = await removeTeamMember({
      teamName: 'frontend',
      memberName: 'alice',
    })
    expect(team.members).toMatchObject([
      { agentId: 'planner@frontend', name: 'planner', mode: 'lead' },
    ])
    expect(await readFile(join(home, 'teams/frontend/config.json'), 'utf8'))
      .not.toContain('"name": "alice"')

    await deleteTeam({ teamName: 'frontend' })
    expect(await listTeams()).toEqual([])
  })

  it('rejects deleting missing local and project team records', async () => {
    const { cwd } = await setupAgentWorkspace()

    await expect(deleteTeam({ teamName: 'missing-team' })).rejects.toThrow(
      'Team not found: missing-team',
    )
    await expect(deleteTeam({ teamName: 'missing-team' }, cwd)).rejects.toThrow(
      'Team not found: missing-team',
    )
    await expect(readFile(join(cwd, '.claude/teams/missing-team/config.json'), 'utf8'))
      .rejects
      .toThrow()
  })

  it('rejects local team member removal when the member is not present', async () => {
    const { home } = await setupAgentWorkspace()

    await createTeam({
      teamName: 'frontend',
      description: 'UI work',
      agentType: 'planner',
    })

    await expect(removeTeamMember({
      teamName: 'frontend',
      memberName: 'alice',
    })).rejects.toThrow('Team member not found: alice')

    expect(await readFile(join(home, 'teams/frontend/config.json'), 'utf8'))
      .toContain('"name": "planner"')
  })

  it('keeps desktop team records isolated per workspace when cwd is provided', async () => {
    const { root, cwd } = await setupAgentWorkspace()
    const otherCwd = join(root, 'other-project')
    await mkdir(otherCwd, { recursive: true })

    await createTeam({
      teamName: 'frontend',
      description: 'Workspace A',
      agentType: 'planner',
    }, cwd)
    await upsertTeamMember({
      teamName: 'frontend',
      name: 'alice',
      agentType: 'reviewer',
      mode: 'plan',
    }, cwd)

    expect(await listTeams(otherCwd)).toEqual([])

    await createTeam({
      teamName: 'frontend',
      description: 'Workspace B',
      agentType: 'builder',
    }, otherCwd)

    expect(await listTeams(cwd)).toMatchObject([{
      name: 'frontend',
      description: 'Workspace A',
      members: [
        { agentId: 'planner@frontend', name: 'planner' },
        { agentId: 'alice@frontend', name: 'alice' },
      ],
    }])
    expect(await listTeams(otherCwd)).toMatchObject([{
      name: 'frontend',
      description: 'Workspace B',
      members: [
        { agentId: 'builder@frontend', name: 'builder' },
      ],
    }])
    expect(await listTeamMembers('frontend', cwd)).toHaveLength(2)

    await deleteTeam({ teamName: 'frontend' }, cwd)
    expect(await listTeams(cwd)).toEqual([])
    expect(await listTeams(otherCwd)).toHaveLength(1)
    await expect(readFile(join(cwd, '.claude/teams/frontend/config.json'), 'utf8'))
      .rejects.toThrow()
    expect(await readFile(join(otherCwd, '.claude/teams/frontend/config.json'), 'utf8'))
      .toContain('Workspace B')
  })

  it('rejects project team listing through symlinked workspace team directories', async () => {
    const { root, cwd } = await setupAgentWorkspace()
    const outsideTeams = join(root, 'outside-teams')
    await mkdir(join(outsideTeams, 'frontend'), { recursive: true })
    await writeFile(
      join(outsideTeams, 'frontend/config.json'),
      JSON.stringify({ name: 'frontend', members: [] }),
    )
    await mkdir(join(cwd, '.claude'), { recursive: true })
    await symlink(outsideTeams, join(cwd, '.claude/teams'))

    await expect(listTeams(cwd)).rejects.toThrow(
      'Workspace file target must not be a symlink',
    )
  })

  it('rejects local team names that escape the teams directory', async () => {
    await setupAgentWorkspace()

    await expect(createTeam({ teamName: '../outside' })).rejects.toThrow(
      'teamName must not contain path separators',
    )
    await expect(upsertTeamMember({
      teamName: 'frontend/escape',
      name: 'alice',
    })).rejects.toThrow('teamName must not contain path separators')
    await expect(deleteTeam({ teamName: '..\\outside' })).rejects.toThrow(
      'teamName must not contain path separators',
    )
  })
})
