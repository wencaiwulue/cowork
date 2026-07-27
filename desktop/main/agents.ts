import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { claudeHomeDir, listProjectMcpServers, loadClaudeDesktopConfig } from './config'
import { runClaudeCliCommand } from './cliCommand'
import { assertWorkspaceFileTarget } from './workspaceDirectory'
import type {
  AgentDiagnostics,
  AgentInfo,
  AgentLaunchInput,
  AgentListResult,
  AgentSaveInput,
  AgentSource,
  AgentTaskOutputInput,
  AgentTaskResumeInput,
  AgentTaskStopInput,
  TeamCreateInput,
  TeamDeleteInput,
  TeamInfo,
  TeamMemberInfo,
  TeamMessageInput,
  TeamRemoveMemberInput,
  TeamShutdownInput,
} from './ipc'

const builtInAgents: AgentInfo[] = [
  {
    agentType: 'general-purpose',
    source: 'built-in',
    whenToUse: 'General-purpose agent for researching, editing, and testing code.',
    editable: false,
  },
  {
    agentType: 'code-reviewer',
    source: 'built-in',
    whenToUse: 'Reviews code changes for correctness, bugs, security issues, and best practices.',
    editable: false,
  },
  {
    agentType: 'test-writer',
    source: 'built-in',
    whenToUse: 'Writes comprehensive tests for existing code, covering edge cases and error paths.',
    editable: false,
  },
  {
    agentType: 'bug-finder',
    source: 'built-in',
    whenToUse: 'Systematically finds and fixes bugs in the codebase including logic errors and edge cases.',
    editable: false,
  },
  {
    agentType: 'refactor',
    source: 'built-in',
    whenToUse: 'Refactors code to improve clarity, reduce duplication, and follow best practices without changing behavior.',
    editable: false,
  },
  {
    agentType: 'document-writer',
    source: 'built-in',
    whenToUse: 'Creates and updates technical documentation, READMEs, API docs, and inline comments.',
    editable: false,
  },
  {
    agentType: 'browser-agent',
    source: 'built-in',
    whenToUse: 'Automates browser interactions for web testing, scraping, and UI verification.',
    editable: false,
  },
  {
    agentType: 'computer-agent',
    source: 'built-in',
    whenToUse: 'Performs desktop automation tasks including mouse, keyboard, screenshots, and clipboard operations.',
    editable: false,
  },
  {
    agentType: 'statusline-setup',
    source: 'built-in',
    whenToUse: 'Sets up statusline configuration.',
    editable: false,
  },
  {
    agentType: 'claude-code-guide',
    source: 'built-in',
    whenToUse: 'Guides users through Claude Code workflows.',
    editable: false,
  },
]

export async function listAgents(cwd: string): Promise<AgentListResult> {
  if (!cwd) {
    const userAgents = await loadAgentsFromDir(userAgentsDir(), 'user')
    const allAgents = [
      ...builtInAgents,
      ...userAgents,
    ]
    return {
      activeAgents: activeAgentsFromList(allAgents),
      allAgents,
    }
  }

  const cliAgents = await loadAgentsFromCli(cwd)
  if (cliAgents) return cliAgents

  const [userAgents, projectAgents] = await Promise.all([
    loadAgentsFromDir(userAgentsDir(), 'user'),
    loadProjectAgentsFromDir(cwd),
  ])
  const allAgents = [
    ...builtInAgents,
    ...userAgents,
    ...projectAgents,
  ]
  return {
    activeAgents: activeAgentsFromList(allAgents),
    allAgents,
  }
}

export async function getAgent(
  cwd: string,
  agentType: string,
  source?: AgentSource,
): Promise<AgentInfo> {
  const result = await listAgents(cwd)
  const agent = result.allAgents.find(item =>
    item.agentType === agentType && (!source || item.source === source),
  )
  if (!agent) throw new Error(`Agent not found: ${agentType}`)
  if (agent.source === 'user' || agent.source === 'project') {
    return enrichEditableAgent(cwd, agent)
  }
  return agent
}

export async function saveAgent(
  cwd: string,
  input: AgentSaveInput,
): Promise<AgentInfo> {
  const source = input.source
  if (source !== 'user' && source !== 'project') {
    throw new Error('Only user and project agents can be saved from the desktop GUI')
  }
  const dir = source === 'user' ? userAgentsDir() : await ensureProjectAgentsDir(cwd)
  await mkdir(dir, { recursive: true })
  const agentType = sanitizeAgentType(input.agentType)
  const unsafeFilePath = join(dir, `${agentType}.md`)
  const filePath = source === 'project'
    ? await assertWorkspaceFileTarget(cwd, unsafeFilePath, { forWrite: true })
    : unsafeFilePath
  const frontmatter = [
    '---',
    `name: ${agentType}`,
    `description: ${quoteFrontmatter(input.whenToUse)}`,
    input.model ? `model: ${input.model}` : undefined,
    input.permissionMode ? `permissionMode: ${input.permissionMode}` : undefined,
    input.background ? 'background: true' : undefined,
    input.memory ? `memory: ${input.memory}` : undefined,
    input.isolation ? `isolation: ${input.isolation}` : undefined,
    input.tools?.length ? `tools: ${input.tools.join(', ')}` : undefined,
    input.disallowedTools?.length
      ? `disallowedTools: ${input.disallowedTools.join(', ')}`
      : undefined,
    input.skills?.length ? `skills: ${input.skills.join(', ')}` : undefined,
    input.requiredMcpServers?.length
      ? `requiredMcpServers: ${input.requiredMcpServers.join(', ')}`
      : undefined,
    '---',
    '',
  ].filter((line): line is string => line !== undefined)
  await writeFile(filePath, `${frontmatter.join('\n')}${input.prompt.trim()}\n`)
  return {
    ...(parseAgentMarkdown(filePath, dir, await readFile(filePath, 'utf8'), source) ??
      {
        agentType,
        source,
        whenToUse: input.whenToUse,
        editable: true,
        path: filePath,
      }),
  }
}

export async function deleteAgent(
  cwd: string,
  agentType: string,
  source: AgentSource,
): Promise<void> {
  if (source !== 'user' && source !== 'project') {
    throw new Error('Only user and project agents can be deleted from the desktop GUI')
  }
  const dir = source === 'user' ? userAgentsDir() : await ensureProjectAgentsDir(cwd)
  const unsafeFilePath = join(dir, `${sanitizeAgentType(agentType)}.md`)
  const filePath = source === 'project'
    ? await assertWorkspaceFileTarget(cwd, unsafeFilePath, { forWrite: true })
    : unsafeFilePath
  if (!await pathExists(filePath)) {
    throw new Error(`Agent not found: ${sanitizeAgentType(agentType)}`)
  }
  await rm(filePath, { force: true })
}

export async function diagnoseAgent(
  cwd: string,
  agentType: string,
): Promise<AgentDiagnostics> {
  const agent = await getAgent(cwd, agentType)
  const [desktopConfig, projectMcpServers] = await Promise.all([
    loadClaudeDesktopConfig(),
    listProjectMcpServers(cwd),
  ])
  const configuredMcpServers = [
    ...desktopConfig.mcpServers.map(server => server.name),
    ...projectMcpServers.map(server => server.name),
  ]
  const configuredSkills = desktopConfig.skills.map(skill => skill.name)
  const requiredMcpServers = agent.requiredMcpServers ?? []
  const requiredSkills = agent.skills ?? []
  const missingMcpServers = (agent.requiredMcpServers ?? []).filter(required =>
    !configuredMcpServers.some(name =>
      name.toLowerCase().includes(required.toLowerCase()),
    ),
  )
  const missingSkills = requiredSkills.filter(skill =>
    !configuredSkills.some(installed => installed === skill),
  )
  const warnings: string[] = []
  if (agent.source === 'built-in') warnings.push('Built-in agents are read-only.')
  if (agent.source === 'plugin') warnings.push('Plugin agents are read-only.')
  if (agent.source === 'local') warnings.push('Local agents are read-only from this GUI.')
  if (agent.isolation === 'remote' && process.env.USER_TYPE !== 'ant') {
    warnings.push('Remote isolation is gated by the CLI runtime and may be unavailable.')
  }
  const readiness = [
    {
      label: 'MCP servers',
      ok: missingMcpServers.length === 0,
      detail: requiredMcpServers.length
        ? requiredMcpServers.join(', ')
        : 'No required MCP servers declared.',
    },
    {
      label: 'Skills',
      ok: missingSkills.length === 0,
      detail: requiredSkills.length
        ? requiredSkills.join(', ')
        : 'No required skills declared.',
    },
    {
      label: 'Tools',
      ok: true,
      detail: [
        agent.tools?.length ? `Allowed: ${agent.tools.join(', ')}` : 'Allowed: runtime default',
        agent.disallowedTools?.length ? `Disallowed: ${agent.disallowedTools.join(', ')}` : 'Disallowed: none',
      ].join(' · '),
    },
    {
      label: 'Hooks',
      ok: true,
      detail: agent.hasHooks
        ? 'Agent declares hooks; runtime will register them when launched.'
        : 'No agent hooks declared.',
    },
    {
      label: 'Memory',
      ok: true,
      detail: agent.memory
        ? `Agent memory scope: ${agent.memory}.`
        : 'No agent memory scope declared.',
    },
    {
      label: 'Isolation',
      ok: !(agent.isolation === 'remote' && process.env.USER_TYPE !== 'ant'),
      detail: agent.isolation
        ? `Requested isolation: ${agent.isolation}.`
        : 'No isolation requested.',
    },
  ]
  return {
    agentType,
    ok: missingMcpServers.length === 0 && missingSkills.length === 0,
    configuredMcpServers,
    configuredSkills,
    requiredMcpServers,
    requiredSkills,
    missingMcpServers,
    missingSkills,
    tools: agent.tools,
    disallowedTools: agent.disallowedTools,
    hasHooks: Boolean(agent.hasHooks),
    memory: agent.memory,
    isolation: agent.isolation,
    readiness,
    warnings,
  }
}

export async function listTeams(cwd?: string): Promise<TeamInfo[]> {
  const root = teamsDir(cwd)
  let entries: Array<{ name: string; isDirectory(): boolean }>
  try {
    if (cwd) await assertWorkspaceFileTarget(cwd, root)
    entries = await readdir(root, { withFileTypes: true, encoding: 'utf8' })
  } catch (cause) {
    if (cwd && !isNotFoundError(cause)) throw cause
    return []
  }
  const teams = await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
    const configPath = join(root, entry.name, 'config.json')
    try {
      if (cwd) await assertWorkspaceFileTarget(cwd, configPath)
      const raw = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
      const members = Array.isArray(raw.members)
        ? raw.members.filter(isRecord).map(member => ({
            agentId: stringValue(member.agentId) ?? stringValue(member.id) ?? '',
            name: stringValue(member.name) ?? stringValue(member.agentName) ?? 'unknown',
            color: stringValue(member.color),
            mode: stringValue(member.mode),
            status: stringValue(member.status),
          }))
        : []
      return {
        name: stringValue(raw.name) ?? entry.name,
        description: stringValue(raw.description),
        backend: stringValue(raw.backend) ?? stringValue(raw.backendType),
        mode: stringValue(raw.mode),
        status: stringValue(raw.status),
        active: booleanValue(raw.active),
        path: configPath,
        members,
      }
    } catch (cause) {
      if (cwd && !isNotFoundError(cause) && isWorkspaceBoundaryError(cause)) {
        throw cause
      }
      return {
        name: entry.name,
        path: configPath,
        members: [],
      }
    }
  }))
  return teams.sort((a, b) => a.name.localeCompare(b.name))
}

export async function listTeamMembers(
  teamName: string,
  cwd?: string,
): Promise<TeamInfo['members']> {
  const teams = await listTeams(cwd)
  const team = teams.find(item => item.name === teamName)
  if (!team) throw new Error(`Team not found: ${teamName}`)
  return team.members
}

export async function createTeam(
  input: TeamCreateInput,
  cwd?: string,
): Promise<TeamInfo> {
  const name = sanitizeTeamName(input.teamName)
  const existing = await readTeamConfig(name, cwd)
  const team: TeamInfo = {
    name,
    description: input.description ?? existing?.description,
    backend: existing?.backend ?? 'desktop',
    mode: existing?.mode ?? 'manual',
    status: existing?.status ?? 'configured',
    active: existing?.active ?? true,
    members: existing?.members ?? [],
  }
  if (input.agentType) {
    team.members = upsertMember(team.members, {
      agentId: `${input.agentType}@${name}`,
      name: input.agentType,
      mode: 'lead',
      status: 'configured',
    })
  }
  await writeTeamConfig(team, cwd)
  return {
    ...team,
    path: teamConfigPath(name, cwd),
  }
}

export async function upsertTeamMember(
  input: Pick<AgentLaunchInput, 'teamName' | 'name' | 'agentType' | 'mode'>,
  cwd?: string,
): Promise<TeamInfo> {
  const name = sanitizeTeamName(input.teamName ?? '')
  const team = await createTeam({ teamName: name }, cwd)
  const memberName = sanitizeTeamMemberName(input.name ?? input.agentType ?? 'teammate')
  const member: TeamMemberInfo = {
    agentId: `${memberName}@${name}`,
    name: memberName,
    mode: input.mode,
    status: 'starting',
  }
  const updated = {
    ...team,
    members: upsertMember(team.members, member),
  }
  await writeTeamConfig(updated, cwd)
  return updated
}

export async function removeTeamMember(
  input: TeamRemoveMemberInput,
  cwd?: string,
): Promise<TeamInfo> {
  const teamName = sanitizeTeamName(input.teamName)
  const memberName = sanitizeTeamMemberName(input.memberName)
  const team = await readTeamConfig(teamName, cwd)
  if (!team) throw new Error(`Team not found: ${teamName}`)
  const members = team.members.filter(member =>
    member.name !== memberName && member.agentId !== `${memberName}@${teamName}`,
  )
  if (members.length === team.members.length) {
    throw new Error(`Team member not found: ${memberName}`)
  }
  const updated = {
    ...team,
    members,
  }
  await writeTeamConfig(updated, cwd)
  return {
    ...updated,
    path: teamConfigPath(teamName, cwd),
  }
}

export async function deleteTeam(
  input: TeamDeleteInput,
  cwd?: string,
): Promise<void> {
  const name = sanitizeTeamName(input.teamName ?? '')
  const target = teamDir(name, cwd)
  if (cwd) {
    try {
      await assertWorkspaceFileTarget(cwd, target, { forWrite: true })
    } catch (cause) {
      if (isNotFoundError(cause)) {
        throw new Error(`Team not found: ${name}`)
      }
      throw cause
    }
  }
  if (!await pathExists(target)) {
    throw new Error(`Team not found: ${name}`)
  }
  await rm(target, { recursive: true, force: true })
}

export function buildAgentLaunchPrompt(input: {
  agentType: string
  description: string
  prompt: string
  model?: string
  runInBackground?: boolean
  isolation?: 'worktree' | 'remote'
  name?: string
  teamName?: string
  mode?: string
}): string {
  const args = {
    description: input.description,
    prompt: input.prompt,
    subagent_type: input.agentType,
    ...(input.model ? { model: input.model } : {}),
    ...(input.runInBackground !== undefined
      ? { run_in_background: input.runInBackground }
      : {}),
    ...(input.isolation ? { isolation: input.isolation } : {}),
    ...(input.name ? { name: input.name } : {}),
    ...(input.teamName ? { team_name: input.teamName } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
  }
  return [
    'Use the Agent tool exactly once with this JSON input.',
    'Do not perform the delegated work in the main session unless the Agent tool is unavailable.',
    '',
    '```json',
    JSON.stringify(args, null, 2),
    '```',
  ].join('\n')
}

export function buildAgentTaskStopPrompt(input: AgentTaskStopInput): string {
  return toolPrompt('TaskStop', {
    task_id: input.taskId,
  }, [
    'Stop only this background task. Do not stop the desktop session.',
  ])
}

export function buildAgentTaskOutputPrompt(input: AgentTaskOutputInput): string {
  return toolPrompt('TaskOutput', {
    task_id: input.taskId,
    block: input.block ?? false,
    timeout: input.timeoutMs ?? 0,
  }, [
    'Return the task status and available output to the main session.',
    'If the tool is unavailable, Read the task output file only when the task has one.',
  ])
}

export function buildAgentTaskResumePrompt(input: AgentTaskResumeInput): string {
  return toolPrompt('SendMessage', {
    to: input.taskId,
    message: input.prompt,
  }, [
    'Use this to continue or resume the selected agent task.',
    'Do not perform the resumed work in the main session.',
  ])
}

export function buildTeamCreatePrompt(input: TeamCreateInput): string {
  return toolPrompt('TeamCreate', {
    team_name: input.teamName,
    ...(input.description ? { description: input.description } : {}),
    ...(input.agentType ? { agent_type: input.agentType } : {}),
  })
}

export function buildTeamMessagePrompt(input: TeamMessageInput): string {
  return toolPrompt('SendMessage', {
    to: input.to,
    message: input.message,
  }, [
    `Send this message within team "${input.teamName}".`,
    'Do not answer the message yourself in the leader session.',
  ])
}

export function buildTeamShutdownPrompt(input: TeamShutdownInput): string {
  return toolPrompt('SendMessage', {
    to: input.to,
    message: {
      type: 'shutdown_request',
      reason: input.reason ?? `Desktop GUI requested shutdown for ${input.to}.`,
    },
  }, [
    `Request a graceful shutdown for "${input.to}" in team "${input.teamName}".`,
    'Do not delete the team until shutdown approvals have been processed.',
  ])
}

export function buildTeamDeletePrompt(input: TeamDeleteInput): string {
  return toolPrompt('TeamDelete', {}, [
    input.teamName
      ? `Clean up the current team; the desktop selected "${input.teamName}".`
      : 'Clean up the current team.',
    'If active teammates remain, report the active members instead of forcing cleanup.',
  ])
}

function activeAgentsFromList(allAgents: AgentInfo[]): AgentInfo[] {
  const order: AgentSource[] = [
    'built-in',
    'plugin',
    'user',
    'project',
    'local',
    'flag',
    'managed',
  ]
  const active = new Map<string, AgentInfo>()
  for (const source of order) {
    for (const agent of allAgents) {
      if (agent.source === source) active.set(agent.agentType, agent)
    }
  }
  return [...active.values()]
}

function toolPrompt(
  toolName: string,
  input: Record<string, unknown>,
  notes: string[] = [],
): string {
  return [
    `Use the ${toolName} tool exactly once with this JSON input.`,
    'Do not perform the requested tool side effect manually unless the tool is unavailable.',
    ...notes,
    '',
    '```json',
    JSON.stringify(input, null, 2),
    '```',
  ].join('\n')
}

async function loadAgentsFromDir(dir: string, source: AgentSource): Promise<AgentInfo[]> {
  let entries: Array<{ name: string; isFile(): boolean }>
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return []
  }
  const agents = await Promise.all(entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(async entry => {
      const filePath = join(dir, entry.name)
      return parseAgentMarkdown(filePath, dir, await readFile(filePath, 'utf8'), source)
  }))
  return agents.filter((agent): agent is AgentInfo => Boolean(agent))
}

async function loadProjectAgentsFromDir(cwd: string): Promise<AgentInfo[]> {
  try {
    const dir = await assertWorkspaceFileTarget(cwd, projectAgentsDir(cwd))
    return loadAgentsFromDir(dir, 'project')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw cause
  }
}

async function loadAgentsFromCli(cwd: string): Promise<AgentListResult | undefined> {
  if (process.env.CLAUDE_CODE_DESKTOP_DISABLE_AGENT_CLI === '1') return undefined
  const result = await runClaudeCliCommand(cwd, ['agents', '--json'], 15_000)
  if (!result.ok) return undefined
  return normalizeCliAgentList(result.output)
}

export function normalizeCliAgentList(raw: string): AgentListResult | undefined {
  const parsed = parseCliAgentsJson(raw)
  if (!isRecord(parsed)) return undefined
  const allAgents = arrayValue(parsed.allAgents).map(normalizeCliAgent).filter(isAgentInfo)
  const activeAgents = arrayValue(parsed.activeAgents).map(normalizeCliAgent).filter(isAgentInfo)
  const failedFiles = arrayValue(parsed.failedFiles).map(normalizeFailedFile).filter(isFailedFile)
  if (allAgents.length === 0 && activeAgents.length === 0 && failedFiles.length === 0) return undefined
  return {
    activeAgents: activeAgents.length ? activeAgents : activeAgentsFromList(allAgents),
    allAgents: allAgents.length ? allAgents : activeAgents,
    failedFiles,
  }
}

function parseCliAgentsJson(raw: string): unknown {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) return undefined
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return undefined
  }
}

function normalizeCliAgent(value: unknown): AgentInfo | undefined {
  if (!isRecord(value)) return undefined
  const agentType = stringValue(value.agentType)
  const whenToUse = stringValue(value.whenToUse)
  const source = mapCliAgentSource(stringValue(value.source))
  if (!agentType || !whenToUse || !source) return undefined
  return {
    agentType,
    source,
    whenToUse,
    editable: source === 'user' || source === 'project',
    path: pathFromCliAgent(value),
    baseDir: stringValue(value.baseDir),
    tools: listValue(value.tools),
    disallowedTools: listValue(value.disallowedTools),
    skills: listValue(value.skills),
    requiredMcpServers: listValue(value.requiredMcpServers),
    model: stringValue(value.model),
    permissionMode: stringValue(value.permissionMode),
    memory: stringValue(value.memory),
    isolation: stringValue(value.isolation) as AgentInfo['isolation'],
    background: booleanValue(value.background),
    hasHooks: booleanValue(value.hasHooks),
  }
}

function mapCliAgentSource(source: string | undefined): AgentSource | undefined {
  switch (source) {
    case 'built-in':
      return 'built-in'
    case 'userSettings':
      return 'user'
    case 'projectSettings':
      return 'project'
    case 'localSettings':
      return 'local'
    case 'policySettings':
      return 'managed'
    case 'flagSettings':
      return 'flag'
    case 'plugin':
      return 'plugin'
    default:
      return undefined
  }
}

function pathFromCliAgent(value: Record<string, unknown>): string | undefined {
  const baseDir = stringValue(value.baseDir)
  const filename = stringValue(value.filename)
  if (!baseDir || !filename) return undefined
  return join(baseDir, `${filename}.md`)
}

function normalizeFailedFile(value: unknown): { path: string; error: string } | undefined {
  if (!isRecord(value)) return undefined
  const path = stringValue(value.path)
  const error = stringValue(value.error)
  return path && error ? { path, error } : undefined
}

function isFailedFile(
  value: { path: string; error: string } | undefined,
): value is { path: string; error: string } {
  return Boolean(value)
}

function isAgentInfo(value: AgentInfo | undefined): value is AgentInfo {
  return Boolean(value)
}

async function enrichEditableAgent(cwd: string, agent: AgentInfo): Promise<AgentInfo> {
  const local = agent.source === 'user'
    ? await loadAgentsFromDir(userAgentsDir(), agent.source)
    : await loadProjectAgentsFromDir(cwd)
  return local.find(item => item.agentType === agent.agentType) ?? agent
}

function parseAgentMarkdown(
  filePath: string,
  baseDir: string,
  raw: string,
  source: AgentSource,
): AgentInfo | null {
  const { frontmatter, body } = splitFrontmatter(raw)
  const agentType = stringValue(frontmatter.name) ?? basename(filePath, '.md')
  const whenToUse = stringValue(frontmatter.description)
  if (!agentType || !whenToUse) return null
  return {
    agentType,
    source,
    whenToUse,
    path: filePath,
    baseDir,
    editable: source === 'user' || source === 'project',
    tools: listValue(frontmatter.tools),
    disallowedTools: listValue(frontmatter.disallowedTools),
    skills: listValue(frontmatter.skills),
    requiredMcpServers: listValue(frontmatter.requiredMcpServers),
    model: stringValue(frontmatter.model),
    permissionMode: stringValue(frontmatter.permissionMode),
    memory: stringValue(frontmatter.memory),
    isolation: stringValue(frontmatter.isolation) as AgentInfo['isolation'],
    background: booleanValue(frontmatter.background),
    hasHooks: frontmatter.hooks !== undefined,
    prompt: body.trim(),
  }
}

function splitFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>
  body: string
} {
  if (!raw.startsWith('---\n')) return { frontmatter: {}, body: raw }
  const end = raw.indexOf('\n---', 4)
  if (end < 0) return { frontmatter: {}, body: raw }
  const frontmatterRaw = raw.slice(4, end)
  const body = raw.slice(end + 4).replace(/^\n/, '')
  const frontmatter: Record<string, unknown> = {}
  for (const line of frontmatterRaw.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1]!
    let value = match[2]!.trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    frontmatter[key] = value
  }
  return { frontmatter, body }
}

function userAgentsDir(): string {
  return join(claudeHomeDir(), 'agents')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (cause) {
    if (isNotFoundError(cause)) return false
    throw cause
  }
}

function projectAgentsDir(cwd: string): string {
  return join(cwd, '.claude', 'agents')
}

async function ensureProjectAgentsDir(cwd: string): Promise<string> {
  const claudeDir = join(cwd, '.claude')
  await assertWorkspaceFileTarget(cwd, claudeDir, { forWrite: true })
  await mkdir(claudeDir, { recursive: true })
  const agentsDir = projectAgentsDir(cwd)
  await assertWorkspaceFileTarget(cwd, agentsDir, { forWrite: true })
  await mkdir(agentsDir, { recursive: true })
  return agentsDir
}

function teamsDir(cwd?: string): string {
  if (cwd) return join(cwd, '.claude', 'teams')
  const env = Function('return process.env')() as NodeJS.ProcessEnv
  return join(env.CLAUDE_CONFIG_DIR ?? claudeHomeDir(env), 'teams')
}

function teamDir(teamName: string, cwd?: string): string {
  return join(teamsDir(cwd), teamName)
}

function teamConfigPath(teamName: string, cwd?: string): string {
  return join(teamDir(teamName, cwd), 'config.json')
}

async function readTeamConfig(
  teamName: string,
  cwd?: string,
): Promise<TeamInfo | undefined> {
  try {
    const configPath = teamConfigPath(teamName, cwd)
    if (cwd) await assertWorkspaceFileTarget(cwd, configPath)
    const raw = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
    const members = Array.isArray(raw.members)
      ? raw.members.filter(isRecord).map(member => ({
          agentId: stringValue(member.agentId) ?? stringValue(member.id) ?? '',
          name: stringValue(member.name) ?? stringValue(member.agentName) ?? 'unknown',
          color: stringValue(member.color),
          mode: stringValue(member.mode),
          status: stringValue(member.status),
        }))
      : []
    return {
      name: stringValue(raw.name) ?? teamName,
      description: stringValue(raw.description),
      backend: stringValue(raw.backend) ?? stringValue(raw.backendType),
      mode: stringValue(raw.mode),
      status: stringValue(raw.status),
      active: booleanValue(raw.active),
      path: configPath,
      members,
    }
  } catch {
    return undefined
  }
}

async function writeTeamConfig(team: TeamInfo, cwd?: string): Promise<void> {
  const name = sanitizeTeamName(team.name)
  const root = await ensureTeamsDir(cwd)
  const dir = join(root, name)
  const configPath = join(dir, 'config.json')
  if (cwd) await assertWorkspaceFileTarget(cwd, dir, { forWrite: true })
  await mkdir(dir, { recursive: true })
  if (cwd) await assertWorkspaceFileTarget(cwd, configPath, { forWrite: true })
  await writeFile(configPath, `${JSON.stringify({
    name,
    description: team.description,
    backend: team.backend ?? 'desktop',
    mode: team.mode ?? 'manual',
    status: team.status ?? 'configured',
    active: team.active ?? true,
    members: team.members,
  }, null, 2)}\n`)
}

async function ensureTeamsDir(cwd?: string): Promise<string> {
  const root = teamsDir(cwd)
  if (!cwd) {
    await mkdir(root, { recursive: true })
    return root
  }
  const claudeDir = join(cwd, '.claude')
  await assertWorkspaceFileTarget(cwd, claudeDir, { forWrite: true })
  await mkdir(claudeDir, { recursive: true })
  await assertWorkspaceFileTarget(cwd, root, { forWrite: true })
  await mkdir(root, { recursive: true })
  return root
}

function isNotFoundError(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException).code === 'ENOENT'
}

function isWorkspaceBoundaryError(cause: unknown): boolean {
  return cause instanceof Error &&
    (
      cause.message.includes('Workspace file target') ||
      cause.message.includes('outside the workspace')
    )
}

function upsertMember(
  members: TeamMemberInfo[],
  member: TeamMemberInfo,
): TeamMemberInfo[] {
  const existingIndex = members.findIndex(item => item.agentId === member.agentId)
  if (existingIndex < 0) return [...members, member]
  return members.map((item, index) => index === existingIndex ? { ...item, ...member } : item)
}

function sanitizeAgentType(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('agentType must not be empty')
  if (/[\/\\]/.test(trimmed)) throw new Error('agentType must not contain path separators')
  return trimmed
}

function sanitizeTeamName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('teamName must not be empty')
  if (/[\/\\]/.test(trimmed)) throw new Error('teamName must not contain path separators')
  return trimmed
}

function sanitizeTeamMemberName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('team member name must not be empty')
  if (/[\/\\]/.test(trimmed)) throw new Error('team member name must not contain path separators')
  return trimmed
}

function quoteFrontmatter(value: string): string {
  return JSON.stringify(value.trim())
}

function listValue(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value !== 'string') return undefined
  const items = value.split(',').map(item => item.trim()).filter(Boolean)
  return items.length ? items : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
