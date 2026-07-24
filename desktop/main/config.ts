import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { desktopStorePath, loadDesktopStore, saveDesktopStore } from './store'
import { nextCronRunAt, parseCronExpression } from './workspaceTasks'
import { assertWorkspaceFileTarget } from './workspaceDirectory'
import type {
  ClaudeDesktopConfig,
  DesktopProxySettings,
  InstalledSkillInfo,
  McpServerInput,
  McpServerInfo,
  ScheduledTaskInfo,
  ScheduledTaskInput,
  SkillSaveInput,
} from './ipc'

const secretKeyPattern = /(token|secret|password|authorization|auth|api[_-]?key|key)$/i

export function claudeHomeDir(env = runtimeEnv()): string {
  return env.CLAUDE_CODE_DESKTOP_CLAUDE_HOME || join(homedir(), '.claude')
}

function runtimeEnv(): NodeJS.ProcessEnv {
  return Function('return process.env')() as NodeJS.ProcessEnv
}

function readJsonFile(path: string): unknown {
  const raw = readFileSync(path, 'utf8')
  return JSON.parse(raw)
}

async function readJsonFileAsync(path: string): Promise<unknown> {
  const raw = await readFile(path, 'utf8')
  return JSON.parse(raw)
}

function tryReadJson(path: string): unknown | undefined {
  try {
    return readJsonFile(path)
  } catch {
    return undefined
  }
}

function maskString(value: string): string {
  if (value.length <= 8) return '[redacted]'
  return `${value.slice(0, 3)}...[redacted]...${value.slice(-3)}`
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()]) {
      if (secretKeyPattern.test(key)) {
        url.searchParams.set(key, '[redacted]')
      }
    }
    if (url.password) url.password = '[redacted]'
    return url.toString()
  } catch {
    return value
  }
}

export function redactSecrets(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    if (secretKeyPattern.test(key)) return maskString(value)
    return /^https?:\/\//.test(value) ? redactUrl(value) : value
  }
  if (Array.isArray(value)) return value.map(item => redactSecrets(item, key))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redactSecrets(entryValue, entryKey),
      ]),
    )
  }
  return value
}

function settingsEnv(settings: unknown): Record<string, string> {
  if (!settings || typeof settings !== 'object') return {}
  const env = (settings as { env?: unknown }).env
  if (!env || typeof env !== 'object') return {}
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
    if (typeof value === 'string') result[key] = value
  }
  return result
}

export function loadClaudeRuntimeEnv(env = process.env): Record<string, string> {
  const settings = tryReadJson(join(claudeHomeDir(env), 'settings.json'))
  return settingsEnv(settings)
}

export function loadDesktopProxySettingsSync(
  env = runtimeEnv(),
): DesktopProxySettings | undefined {
  try {
    const parsed = JSON.parse(readFileSync(desktopStorePath(env), 'utf8')) as {
      config?: { proxy?: DesktopProxySettings }
    }
    return normalizeProxy(parsed.config?.proxy)
  } catch {
    return undefined
  }
}

export function applyDesktopRuntimeEnv(
  baseEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const settingsEnv = loadClaudeRuntimeEnv(baseEnv)
  const proxy = loadDesktopProxySettingsSync(baseEnv)
  const next: NodeJS.ProcessEnv = {
    ...baseEnv,
    ...settingsEnv,
  }
  if (proxy?.enabled && proxy.url) {
    next.HTTP_PROXY = proxy.url
    next.HTTPS_PROXY = proxy.url
    next.ALL_PROXY = proxy.url
    next.http_proxy = proxy.url
    next.https_proxy = proxy.url
    next.all_proxy = proxy.url
  }
  return next
}

function normalizeProxy(proxy: unknown): DesktopProxySettings | undefined {
  if (!proxy || typeof proxy !== 'object') return undefined
  const value = proxy as DesktopProxySettings
  if (typeof value.url !== 'string') return { enabled: false, url: '' }
  return {
    enabled: Boolean(value.enabled),
    url: value.url,
  }
}

export function validateProxySettings(proxy: DesktopProxySettings): DesktopProxySettings {
  const url = proxy.url.trim()
  if (!proxy.enabled) return { enabled: false, url }
  if (!/^(socks5|socks4|http|https):\/\//.test(url)) {
    throw new Error('Proxy URL must start with socks5://, socks4://, http://, or https://')
  }
  return { enabled: true, url }
}

function mcpServersFromConfig(
  mcpConfig: unknown,
  sourcePath: string,
  settings?: unknown,
): McpServerInfo[] {
  if (!mcpConfig || typeof mcpConfig !== 'object') return []
  const servers = (mcpConfig as { mcpServers?: unknown }).mcpServers
  if (!servers || typeof servers !== 'object') return []
  const disabledServers = stringArray(ensureRecord(settings).disabledMcpServers)
  return Object.entries(servers as Record<string, Record<string, unknown>>).map(
    ([name, server]) => ({
      name,
      type: typeof server.type === 'string' ? server.type : undefined,
      command: typeof server.command === 'string' ? server.command : undefined,
      args: Array.isArray(server.args) ? server.args.map(String) : undefined,
      url: typeof server.url === 'string' ? String(redactSecrets(server.url, 'url')) : undefined,
      sourcePath,
      enabled: !disabledServers.includes(name),
      raw: redactSecrets(server),
    }),
  )
}

function scheduledTasksFromConfig(scheduledTasks: unknown): ScheduledTaskInfo[] {
  if (!scheduledTasks || typeof scheduledTasks !== 'object') return []
  const tasks = (scheduledTasks as { tasks?: unknown }).tasks
  if (!Array.isArray(tasks)) return []
  return tasks
    .filter(task => task && typeof task === 'object')
    .map((task, index) => {
      const value = task as Record<string, unknown>
      const id = typeof value.id === 'string' && value.id.trim()
        ? value.id
        : `task-${index + 1}`
      const prompt =
        typeof value.prompt === 'string'
          ? value.prompt
          : typeof value.message === 'string'
            ? value.message
            : ''
      return {
        id,
        name: typeof value.name === 'string' ? value.name : undefined,
        schedule: typeof value.schedule === 'string' ? value.schedule : undefined,
        prompt,
        enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
        createdAt: typeof value.createdAt === 'number' ? value.createdAt : undefined,
        lastFiredAt: typeof value.lastFiredAt === 'number' ? value.lastFiredAt : undefined,
        nextRunAt:
          typeof value.schedule === 'string' && parseCronExpression(value.schedule)
            ? nextCronRunAt(
                value.schedule,
                typeof value.lastFiredAt === 'number'
                  ? value.lastFiredAt
                  : typeof value.createdAt === 'number'
                    ? value.createdAt
                    : Date.now(),
              )
            : undefined,
        raw: redactSecrets(value),
      }
    })
}

async function listSkills(home: string): Promise<InstalledSkillInfo[]> {
  return listSkillsFromDir(join(home, 'skills'))
}

function skillDescription(raw: string): string | undefined {
  return raw
    .split('\n')
    .find(line => line.toLowerCase().startsWith('description:'))
    ?.replace(/^description:\s*/i, '')
    .trim()
}

async function listSkillsFromDir(skillsDir: string): Promise<InstalledSkillInfo[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>
  try {
    entries = await readdir(skillsDir, {
      withFileTypes: true,
      encoding: 'utf8',
    })
  } catch {
    return []
  }
  const skills: InstalledSkillInfo[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillPath = join(skillsDir, entry.name)
    const skillFile = join(skillPath, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    const raw = await readFile(skillFile, 'utf8').catch(() => '')
    const description = skillDescription(raw)
    skills.push({
      name: entry.name,
      path: skillPath,
      description,
    })
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

function pluginEnabledState(
  id: string,
  scope: string | undefined,
  settings: unknown,
  localSettings: unknown,
): boolean | undefined {
  const enabledPlugins = ensureRecord(
    scope === 'local'
      ? ensureRecord(localSettings).enabledPlugins
      : ensureRecord(settings).enabledPlugins,
  )
  const enabled = enabledPlugins[id]
  return typeof enabled === 'boolean' ? enabled : undefined
}

function installedPlugins(
  raw: unknown,
  settings?: unknown,
  localSettings?: unknown,
): ClaudeDesktopConfig['plugins'] {
  if (!raw || typeof raw !== 'object') return []
  const plugins = (raw as { plugins?: unknown }).plugins
  if (!plugins || typeof plugins !== 'object') return []
  return Object.entries(plugins as Record<string, Array<Record<string, unknown>>>)
    .flatMap(([id, installs]) =>
      (Array.isArray(installs) ? installs : []).map(install => {
        const scope = typeof install.scope === 'string' ? install.scope : undefined
        return {
          id,
          scope,
          version: typeof install.version === 'string' ? install.version : undefined,
          installPath:
            typeof install.installPath === 'string' ? install.installPath : undefined,
          installedAt:
            typeof install.installedAt === 'string' ? install.installedAt : undefined,
          enabled: pluginEnabledState(id, scope, settings, localSettings),
        }
      }),
    )
}

export async function loadClaudeDesktopConfig(): Promise<ClaudeDesktopConfig> {
  const home = claudeHomeDir()
  const settingsPath = join(home, 'settings.json')
  const localSettingsPath = join(home, 'settings.local.json')
  const mcpPath = join(home, '.mcp.json')
  const scheduledTasksPath = join(home, 'scheduled_tasks.json')
  const pluginsPath = join(home, 'plugins/installed_plugins.json')
  const [settings, localSettings, mcpConfig, scheduledTasks, pluginsRaw, skills, store] =
    await Promise.all([
      readJsonFileAsync(settingsPath).catch(() => undefined),
      readJsonFileAsync(localSettingsPath).catch(() => undefined),
      readJsonFileAsync(mcpPath).catch(() => undefined),
      readJsonFileAsync(scheduledTasksPath).catch(() => undefined),
      readJsonFileAsync(pluginsPath).catch(() => undefined),
      listSkills(home),
      loadDesktopStore(),
    ])

  return {
    claudeHome: home,
    settingsPath,
    settingsExists: settings !== undefined,
    settings: redactSecrets(settings),
    localSettingsPath,
    localSettingsExists: localSettings !== undefined,
    localSettings: redactSecrets(localSettings),
    proxy: store.config?.proxy ?? { enabled: false, url: '' },
    runtimeCapabilities: {
      remoteIsolation: process.env.USER_TYPE === 'ant',
      worktreeIsolation: true,
    },
    mcpServers: mcpServersFromConfig(mcpConfig, mcpPath, settings),
    skills,
    scheduledTasks: scheduledTasksFromConfig(scheduledTasks),
    plugins: installedPlugins(pluginsRaw, settings, localSettings),
  }
}

export async function saveDesktopProxySettings(
  proxy: DesktopProxySettings,
): Promise<DesktopProxySettings> {
  const normalized = validateProxySettings(proxy)
  const store = await loadDesktopStore()
  await saveDesktopStore({
    ...store,
    config: {
      ...store.config,
      proxy: normalized,
    },
  })
  return normalized
}

function projectClaudeDir(cwd: string): string {
  return join(cwd, '.claude')
}

export async function listProjectSkills(cwd: string): Promise<InstalledSkillInfo[]> {
  try {
    const skillsDir = await assertWorkspaceFileTarget(cwd, join(projectClaudeDir(cwd), 'skills'))
    return listSkillsFromDir(skillsDir)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw cause
  }
}

async function readSkillAtPath(
  skillName: string,
  skillPath: string,
  skillFile: string,
): Promise<InstalledSkillInfo> {
  const contents = await readFile(skillFile, 'utf8')
  return {
    name: skillName,
    path: skillPath,
    description: skillDescription(contents),
    contents,
  }
}

async function installLocalSkillIntoRoot(
  sourceDir: string,
  root: string,
): Promise<InstalledSkillInfo> {
  const { name, sourcePath } = await validateLocalSkillSource(sourceDir)
  const destination = join(root, 'skills', name)
  if (existsSync(destination)) {
    throw new Error(`Skill already exists: ${name}`)
  }
  await mkdir(join(root, 'skills'), { recursive: true })
  await cp(sourcePath, destination, { recursive: true, errorOnExist: true, force: false })
  return { name, path: destination }
}

async function validateLocalSkillSource(
  sourceDir: string,
): Promise<{ name: string; sourcePath: string }> {
  const info = await stat(sourceDir)
  if (!info.isDirectory()) throw new Error('Skill source must be a directory')
  const skillFile = join(sourceDir, 'SKILL.md')
  if (!existsSync(skillFile)) {
    throw new Error('Skill source must contain SKILL.md')
  }
  const name = basename(sourceDir)
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error('Skill directory name may only contain letters, numbers, dots, underscores, and dashes')
  }
  return { name, sourcePath: sourceDir }
}

async function ensureProjectSkillsDir(cwd: string): Promise<string> {
  const claudeDir = projectClaudeDir(cwd)
  await assertWorkspaceFileTarget(cwd, claudeDir, { forWrite: true })
  await mkdir(claudeDir, { recursive: true })
  const skillsDir = join(claudeDir, 'skills')
  await assertWorkspaceFileTarget(cwd, skillsDir, { forWrite: true })
  await mkdir(skillsDir, { recursive: true })
  return skillsDir
}

function validateSkillName(name: string): string {
  const trimmed = name.trim()
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error('Skill name may only contain letters, numbers, dots, underscores, and dashes')
  }
  return trimmed
}

function validateSkillContents(contents: string): string {
  if (!contents.trim()) throw new Error('Skill contents must not be empty')
  return contents
}

async function saveSkillIntoRoot(
  root: string,
  input: SkillSaveInput,
): Promise<InstalledSkillInfo> {
  const skillName = validateSkillName(input.name)
  const contents = validateSkillContents(input.contents)
  const skillPath = join(root, 'skills', skillName)
  await mkdir(skillPath, { recursive: true })
  const skillFile = join(skillPath, 'SKILL.md')
  await writeFile(skillFile, contents)
  return readSkillAtPath(skillName, skillPath, skillFile)
}

async function removeSkillFromRoot(
  root: string,
  name: string,
): Promise<InstalledSkillInfo[]> {
  const skillName = validateSkillName(name)
  const skillPath = join(root, 'skills', skillName)
  if (!existsSync(skillPath)) {
    throw new Error(`Skill not found: ${skillName}`)
  }
  await rm(skillPath, { recursive: true, force: true })
  return listSkills(root)
}

export async function installLocalSkill(sourceDir: string): Promise<InstalledSkillInfo> {
  return installLocalSkillIntoRoot(sourceDir, claudeHomeDir())
}

export async function removeLocalSkill(name: string): Promise<InstalledSkillInfo[]> {
  return removeSkillFromRoot(claudeHomeDir(), name)
}

export async function saveLocalSkill(input: SkillSaveInput): Promise<InstalledSkillInfo> {
  return saveSkillIntoRoot(claudeHomeDir(), input)
}

export async function readLocalSkill(name: string): Promise<InstalledSkillInfo> {
  const skillName = validateSkillName(name)
  const skillPath = join(claudeHomeDir(), 'skills', skillName)
  return readSkillAtPath(skillName, skillPath, join(skillPath, 'SKILL.md'))
}

export async function installProjectSkill(
  cwd: string,
  sourceDir: string,
): Promise<InstalledSkillInfo> {
  const { name, sourcePath } = await validateLocalSkillSource(sourceDir)
  const skillsDir = await ensureProjectSkillsDir(cwd)
  const destination = await assertWorkspaceFileTarget(cwd, join(skillsDir, name), {
    forWrite: true,
  })
  if (existsSync(destination)) {
    throw new Error(`Skill already exists: ${name}`)
  }
  await cp(sourcePath, destination, { recursive: true, errorOnExist: true, force: false })
  return { name, path: destination }
}

export async function removeProjectSkill(
  cwd: string,
  name: string,
): Promise<InstalledSkillInfo[]> {
  const skillName = validateSkillName(name)
  const skillsRoot = join(projectClaudeDir(cwd), 'skills')
  try {
    await assertWorkspaceFileTarget(cwd, skillsRoot)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Skill not found: ${skillName}`)
    }
    throw cause
  }
  const target = join(skillsRoot, skillName)
  const safeTarget = await assertWorkspaceFileTarget(cwd, target, { forWrite: true })
  if (!existsSync(safeTarget)) {
    throw new Error(`Skill not found: ${skillName}`)
  }
  await rm(safeTarget, {
    recursive: true,
    force: true,
  })
  return listProjectSkills(cwd)
}

export async function saveProjectSkill(
  cwd: string,
  input: SkillSaveInput,
): Promise<InstalledSkillInfo> {
  const skillName = validateSkillName(input.name)
  const contents = validateSkillContents(input.contents)
  const skillsDir = await ensureProjectSkillsDir(cwd)
  const skillPath = await assertWorkspaceFileTarget(cwd, join(skillsDir, skillName), {
    forWrite: true,
  })
  await mkdir(skillPath, { recursive: true })
  const skillFile = await assertWorkspaceFileTarget(cwd, join(skillPath, 'SKILL.md'), {
    forWrite: true,
  })
  await writeFile(skillFile, contents)
  return readSkillAtPath(skillName, skillPath, skillFile)
}

export async function readProjectSkill(
  cwd: string,
  name: string,
): Promise<InstalledSkillInfo> {
  const skillName = validateSkillName(name)
  const skillsDir = await assertWorkspaceFileTarget(cwd, join(projectClaudeDir(cwd), 'skills'))
  const unsafeSkillPath = join(skillsDir, skillName)
  const skillPath = await assertWorkspaceFileTarget(cwd, unsafeSkillPath)
  const skillFile = await assertWorkspaceFileTarget(cwd, join(skillPath, 'SKILL.md'))
  return readSkillAtPath(skillName, skillPath, skillFile)
}

function mcpPath(): string {
  return join(claudeHomeDir(), '.mcp.json')
}

function projectMcpPath(cwd: string): string {
  return join(cwd, '.mcp.json')
}

function projectLocalSettingsPath(cwd: string): string {
  return join(cwd, '.claude/settings.local.json')
}

function scheduledTasksPath(): string {
  return join(claudeHomeDir(), 'scheduled_tasks.json')
}

function ensureRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

function mcpServerRecord(input: McpServerInput, existing?: unknown): Record<string, unknown> {
  if (input.mode === 'stdio') {
    return {
      command: input.command,
      args: input.args ?? [],
    }
  }
  const existingRecord = ensureRecord(existing)
  const url = input.url?.trim() || (
    typeof existingRecord.url === 'string' ? existingRecord.url : undefined
  )
  if (!url) {
    throw new Error('Remote MCP server URL is required')
  }
  return {
    type: input.type,
    url,
  }
}

function hasOwnKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

async function assertMcpServerExists(path: string, name: string): Promise<void> {
  const current = ensureRecord(await readJsonFileAsync(path).catch(() => ({})))
  const servers = ensureRecord(current.mcpServers)
  if (!hasOwnKey(servers, name)) {
    throw new Error(`MCP server not found: ${name}`)
  }
}

async function addOrUpdateMcpServerAtPath(
  root: string,
  path: string,
  input: McpServerInput,
): Promise<McpServerInfo[]> {
  const current = ensureRecord(await readJsonFileAsync(path).catch(() => ({})))
  const servers = ensureRecord(current.mcpServers)
  servers[input.name] = mcpServerRecord(input, servers[input.name])
  current.mcpServers = servers
  await mkdir(root, { recursive: true })
  await writeFile(path, `${JSON.stringify(current, null, 2)}\n`)
  return mcpServersFromConfig(current, path)
}

async function removeMcpServerAtPath(
  root: string,
  path: string,
  name: string,
): Promise<McpServerInfo[]> {
  const current = ensureRecord(await readJsonFileAsync(path).catch(() => ({})))
  const servers = ensureRecord(current.mcpServers)
  if (!hasOwnKey(servers, name)) {
    throw new Error(`MCP server not found: ${name}`)
  }
  delete servers[name]
  current.mcpServers = servers
  await mkdir(root, { recursive: true })
  await writeFile(path, `${JSON.stringify(current, null, 2)}\n`)
  return mcpServersFromConfig(current, path)
}

export async function listProjectMcpServers(cwd: string): Promise<McpServerInfo[]> {
  const path = projectMcpPath(cwd)
  try {
    const safePath = await assertWorkspaceFileTarget(cwd, path)
    const [mcpConfig, localSettings] = await Promise.all([
      readJsonFileAsync(safePath).catch(() => undefined),
      readOptionalProjectLocalSettings(cwd),
    ])
    return withProjectMcpApprovalStatus(
      mcpServersFromConfig(mcpConfig, path),
      localSettings,
    )
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return mcpServersFromConfig(undefined, path)
    }
    throw cause
  }
}

export async function addOrUpdateMcpServer(input: McpServerInput): Promise<McpServerInfo[]> {
  const home = claudeHomeDir()
  const settings = await readJsonFileAsync(join(home, 'settings.json')).catch(() => undefined)
  return withUserMcpEnabledStatus(
    await addOrUpdateMcpServerAtPath(home, mcpPath(), input),
    settings,
  )
}

export async function removeMcpServer(name: string): Promise<McpServerInfo[]> {
  const home = claudeHomeDir()
  const settingsPath = join(home, 'settings.json')
  await assertMcpServerExists(mcpPath(), name)
  const settings = ensureRecord(await readJsonFileAsync(settingsPath).catch(() => ({})))
  const disabledServers = stringArray(settings.disabledMcpServers)
  if (disabledServers.includes(name)) {
    settings.disabledMcpServers = disabledServers.filter(item => item !== name)
    await mkdir(home, { recursive: true })
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  }
  return withUserMcpEnabledStatus(
    await removeMcpServerAtPath(home, mcpPath(), name),
    settings,
  )
}

export async function setMcpServerEnabled(
  name: string,
  enabled: boolean,
): Promise<McpServerInfo[]> {
  const home = claudeHomeDir()
  const settingsPath = join(home, 'settings.json')
  await assertMcpServerExists(mcpPath(), name)
  const settings = ensureRecord(await readJsonFileAsync(settingsPath).catch(() => ({})))
  const disabledServers = stringArray(settings.disabledMcpServers)
  settings.disabledMcpServers = enabled
    ? disabledServers.filter(item => item !== name)
    : uniqueStrings([...disabledServers, name])
  await mkdir(home, { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  return mcpServersFromConfig(
    await readJsonFileAsync(mcpPath()).catch(() => undefined),
    mcpPath(),
    settings,
  )
}

export async function addOrUpdateProjectMcpServer(
  cwd: string,
  input: McpServerInput,
): Promise<McpServerInfo[]> {
  const path = projectMcpPath(cwd)
  return addOrUpdateMcpServerAtPath(
    cwd,
    await assertWorkspaceFileTarget(cwd, path, { forWrite: true }),
    input,
  )
}

export async function removeProjectMcpServer(
  cwd: string,
  name: string,
): Promise<McpServerInfo[]> {
  const path = projectMcpPath(cwd)
  const safeMcpPath = await assertWorkspaceFileTarget(cwd, path, { forWrite: true })
  await assertMcpServerExists(safeMcpPath, name)
  const settingsPath = projectLocalSettingsPath(cwd)
  const settings = ensureRecord(await readProjectLocalSettings(cwd).catch(() => ({})))
  const enabled = stringArray(settings.enabledMcpjsonServers)
  const disabled = stringArray(settings.disabledMcpjsonServers)
  const nextEnabled = enabled.filter(item => item !== name)
  const nextDisabled = disabled.filter(item => item !== name)
  if (nextEnabled.length !== enabled.length || nextDisabled.length !== disabled.length) {
    settings.enabledMcpjsonServers = nextEnabled
    settings.disabledMcpjsonServers = nextDisabled
    await mkdir(join(cwd, '.claude'), { recursive: true })
    const safeSettingsPath = await assertWorkspaceFileTarget(cwd, settingsPath, { forWrite: true })
    await writeFile(safeSettingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  }
  return removeMcpServerAtPath(
    cwd,
    safeMcpPath,
    name,
  )
}

export async function setProjectMcpServerApproval(
  cwd: string,
  name: string,
  approved: boolean,
): Promise<McpServerInfo[]> {
  const mcpPath = projectMcpPath(cwd)
  await assertMcpServerExists(await assertWorkspaceFileTarget(cwd, mcpPath), name)
  const settingsPath = projectLocalSettingsPath(cwd)
  const settings = ensureRecord(await readProjectLocalSettings(cwd).catch(() => ({})))
  const enabled = stringArray(settings.enabledMcpjsonServers)
  const disabled = stringArray(settings.disabledMcpjsonServers)

  if (approved) {
    settings.enabledMcpjsonServers = uniqueStrings([...enabled, name])
    settings.disabledMcpjsonServers = disabled.filter(item => item !== name)
  } else {
    settings.disabledMcpjsonServers = uniqueStrings([...disabled, name])
    settings.enabledMcpjsonServers = enabled.filter(item => item !== name)
  }

  await mkdir(join(cwd, '.claude'), { recursive: true })
  const safePath = await assertWorkspaceFileTarget(cwd, settingsPath, { forWrite: true })
  await writeFile(safePath, `${JSON.stringify(settings, null, 2)}\n`)
  return listProjectMcpServers(cwd)
}

async function readProjectLocalSettings(cwd: string): Promise<unknown> {
  const safePath = await assertWorkspaceFileTarget(cwd, projectLocalSettingsPath(cwd))
  return readJsonFileAsync(safePath)
}

async function readOptionalProjectLocalSettings(cwd: string): Promise<unknown | undefined> {
  try {
    return await readProjectLocalSettings(cwd)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
}

function withProjectMcpApprovalStatus(
  servers: McpServerInfo[],
  localSettings: unknown,
): McpServerInfo[] {
  const settings = ensureRecord(localSettings)
  const enabled = stringArray(settings.enabledMcpjsonServers)
  const disabled = stringArray(settings.disabledMcpjsonServers)
  const enableAll = settings.enableAllProjectMcpServers === true
  return servers.map(server => ({
    ...server,
    approvalStatus: projectMcpApprovalStatus(server.name, enabled, disabled, enableAll),
  }))
}

function withUserMcpEnabledStatus(
  servers: McpServerInfo[],
  settings: unknown,
): McpServerInfo[] {
  const disabledServers = stringArray(ensureRecord(settings).disabledMcpServers)
  return servers.map(server => ({
    ...server,
    enabled: !disabledServers.includes(server.name),
  }))
}

function projectMcpApprovalStatus(
  name: string,
  enabled: string[],
  disabled: string[],
  enableAll: boolean,
): McpServerInfo['approvalStatus'] {
  const normalized = normalizeMcpName(name)
  if (disabled.some(item => normalizeMcpName(item) === normalized)) return 'rejected'
  if (enableAll || enabled.some(item => normalizeMcpName(item) === normalized)) return 'approved'
  return 'pending'
}

function normalizeMcpName(name: string): string {
  return name.toLowerCase()
}

function validateMcpServerName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('MCP server name must not be empty')
  if (/[\/\\]/.test(trimmed)) throw new Error('MCP server name must not contain path separators')
  return trimmed
}

function findMcpServer(servers: McpServerInfo[], name: string): McpServerInfo {
  const normalized = normalizeMcpName(name)
  const server = servers.find(item => normalizeMcpName(item.name) === normalized)
  if (!server) throw new Error(`MCP server not found: ${name}`)
  return server
}

export async function readMcpServer(name: string): Promise<McpServerInfo> {
  const serverName = validateMcpServerName(name)
  const home = claudeHomeDir()
  const settings = await readJsonFileAsync(join(home, 'settings.json')).catch(() => undefined)
  return findMcpServer(
    withUserMcpEnabledStatus(
      mcpServersFromConfig(
        await readJsonFileAsync(mcpPath()).catch(() => undefined),
        mcpPath(),
        settings,
      ),
      settings,
    ),
    serverName,
  )
}

export async function readProjectMcpServer(
  cwd: string,
  name: string,
): Promise<McpServerInfo> {
  const serverName = validateMcpServerName(name)
  return findMcpServer(await listProjectMcpServers(cwd), serverName)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function normalizeScheduledTask(input: ScheduledTaskInput, existing?: unknown): Record<string, unknown> {
  const base = ensureRecord(existing)
  return {
    ...base,
    id: input.id?.trim() || (typeof base.id === 'string' && base.id.trim() ? base.id : randomUUID()),
    name: input.name?.trim() || undefined,
    schedule: input.schedule?.trim() || undefined,
    prompt: input.prompt.trim(),
    enabled: input.enabled,
    createdAt: typeof base.createdAt === 'number' ? base.createdAt : Date.now(),
    ...(typeof base.lastFiredAt === 'number' ? { lastFiredAt: base.lastFiredAt } : {}),
  }
}

export async function addOrUpdateScheduledTask(
  input: ScheduledTaskInput,
): Promise<ScheduledTaskInfo[]> {
  const home = claudeHomeDir()
  const path = scheduledTasksPath()
  const current = ensureRecord(await readJsonFileAsync(path).catch(() => ({})))
  const tasks = Array.isArray(current.tasks) ? [...current.tasks] : []
  const taskId = input.id?.trim()
  const index = taskId
    ? tasks.findIndex(task => (
        Boolean(task) &&
        typeof task === 'object' &&
        (task as { id?: unknown }).id === taskId
      ))
    : -1
  if (taskId && index < 0) {
    throw new Error(`Scheduled task not found: ${taskId}`)
  }
  const existing = index >= 0 ? tasks[index] : undefined
  const nextTask = normalizeScheduledTask(input, existing)
  if (index >= 0) tasks[index] = nextTask
  else tasks.push(nextTask)
  current.tasks = tasks
  await mkdir(home, { recursive: true })
  await writeFile(path, `${JSON.stringify(current, null, 2)}\n`)
  return scheduledTasksFromConfig(current)
}

export async function removeScheduledTask(taskId: string): Promise<ScheduledTaskInfo[]> {
  const home = claudeHomeDir()
  const path = scheduledTasksPath()
  const current = ensureRecord(await readJsonFileAsync(path).catch(() => ({})))
  const tasks = Array.isArray(current.tasks) ? current.tasks : []
  const remaining = tasks.filter(task => !(
    Boolean(task) &&
    typeof task === 'object' &&
    (task as { id?: unknown }).id === taskId
  ))
  if (remaining.length === tasks.length) {
    throw new Error(`Scheduled task not found: ${taskId}`)
  }
  current.tasks = remaining
  await mkdir(home, { recursive: true })
  await writeFile(path, `${JSON.stringify(current, null, 2)}\n`)
  return scheduledTasksFromConfig(current)
}

async function setScheduledTaskEnabled(
  taskId: string,
  enabled: boolean,
): Promise<ScheduledTaskInfo[]> {
  const home = claudeHomeDir()
  const path = scheduledTasksPath()
  const current = ensureRecord(await readJsonFileAsync(path).catch(() => ({})))
  const tasks = Array.isArray(current.tasks) ? [...current.tasks] : []
  const index = tasks.findIndex(task => (
    Boolean(task) &&
    typeof task === 'object' &&
    (task as { id?: unknown }).id === taskId
  ))
  if (index < 0) {
    throw new Error(`Scheduled task not found: ${taskId}`)
  }
  const existing = ensureRecord(tasks[index])
  tasks[index] = { ...existing, enabled }
  current.tasks = tasks
  await mkdir(home, { recursive: true })
  await writeFile(path, `${JSON.stringify(current, null, 2)}\n`)
  return scheduledTasksFromConfig(current)
}

export function pauseScheduledTask(taskId: string): Promise<ScheduledTaskInfo[]> {
  return setScheduledTaskEnabled(taskId, false)
}

export function resumeScheduledTask(taskId: string): Promise<ScheduledTaskInfo[]> {
  return setScheduledTaskEnabled(taskId, true)
}

export async function writeScheduledTasks(tasks: unknown[]): Promise<void> {
  const home = claudeHomeDir()
  await mkdir(home, { recursive: true })
  await writeFile(
    scheduledTasksPath(),
    `${JSON.stringify({ tasks }, null, 2)}\n`,
  )
}

export async function fireDueScheduledTasks(now = Date.now()): Promise<ScheduledTaskInfo[]> {
  const home = claudeHomeDir()
  const path = scheduledTasksPath()
  const current = ensureRecord(await readJsonFileAsync(path).catch(() => ({})))
  const tasks = Array.isArray(current.tasks) ? [...current.tasks] : []
  const fired: ScheduledTaskInfo[] = []
  let changed = false

  current.tasks = tasks.map(task => {
    const value = ensureRecord(task)
    const schedule = typeof value.schedule === 'string' ? value.schedule : undefined
    const prompt = typeof value.prompt === 'string' ? value.prompt : undefined
    const enabled = typeof value.enabled === 'boolean' ? value.enabled : true
    const anchor =
      typeof value.lastFiredAt === 'number'
        ? value.lastFiredAt
        : typeof value.createdAt === 'number'
          ? value.createdAt
          : now
    const nextRunAt =
      schedule && prompt && enabled && parseCronExpression(schedule)
        ? nextCronRunAt(schedule, anchor)
        : undefined
    if (!nextRunAt || nextRunAt > now || !prompt) {
      return value
    }
    const id = typeof value.id === 'string' && value.id ? value.id : randomUUID()
    const next = {
      ...value,
      id,
      lastFiredAt: now,
      createdAt: typeof value.createdAt === 'number' ? value.createdAt : now,
    }
    changed = true
    fired.push({
      id,
      name: typeof value.name === 'string' ? value.name : undefined,
      schedule,
      prompt,
      enabled,
      createdAt: next.createdAt,
      lastFiredAt: now,
      raw: redactSecrets(next),
    })
    return next
  })

  if (changed) {
    await mkdir(home, { recursive: true })
    await writeFile(path, `${JSON.stringify(current, null, 2)}\n`)
  }
  return fired
}
