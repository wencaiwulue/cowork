import { lstat, readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { claudeHomeDir } from './config'
import { assertWorkspaceFileTarget } from './workspaceDirectory'
import type { CustomCommandInfo } from './ipc'

type CommandScope = CustomCommandInfo['scope']
type CommandKind = CustomCommandInfo['kind']

export async function listCustomCommands(
  cwd: string,
  home = claudeHomeDir(),
): Promise<CustomCommandInfo[]> {
  const [project, user, projectWorkflows, userWorkflows] = await Promise.all([
    listCommandsFromRoot('project', undefined, cwd, join(cwd, '.kode', 'commands')),
    listCommandsFromRoot('user', undefined, home, join(home, 'commands')),
    listCommandsFromRoot('project', 'workflow', cwd, join(cwd, '.kode', 'workflows')),
    listCommandsFromRoot('user', 'workflow', home, join(home, 'workflows')),
  ])
  return [...project, ...user, ...projectWorkflows, ...userWorkflows]
    .sort((a, b) =>
      scopeRank(a.scope) - scopeRank(b.scope) ||
      kindRank(a.kind) - kindRank(b.kind) ||
      a.name.localeCompare(b.name),
    )
    .filter(uniqueExecutableCommand)
}

async function listCommandsFromRoot(
  scope: CommandScope,
  kind: CommandKind,
  boundaryRoot: string,
  commandsDir: string,
): Promise<CustomCommandInfo[]> {
  try {
    await assertWorkspaceFileTarget(boundaryRoot, commandsDir)
    const info = await lstat(commandsDir)
    if (!info.isDirectory() || info.isSymbolicLink()) return []
  } catch {
    return []
  }

  const files = await collectMarkdownFiles(commandsDir)
  const commands = await Promise.all(
    files.map(async file => {
      const relativePath = relative(commandsDir, file)
      const name = commandName(scope, kind, relativePath)
      if (!name) return undefined
      const contents = await readFile(file, 'utf8').catch(() => '')
      return {
        name,
        scope,
        ...(kind ? { kind } : {}),
        path: file,
        description: commandDescription(contents),
      }
    }),
  )
  return commands.filter(command => command !== undefined)
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    const info = await lstat(path).catch(() => undefined)
    if (!info || info.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(path))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(path)
    }
  }
  return files
}

function commandName(
  scope: CommandScope,
  kind: CommandKind,
  relativePath: string,
): string | undefined {
  const withoutExtension = relativePath.replace(/\.md$/i, '')
  const segments = withoutExtension
    .split(sep)
    .map(segment => segment.trim())
    .filter(Boolean)
  if (segments.length === 0 || segments.some(segment => !isSafeCommandSegment(segment))) {
    return undefined
  }
  const commandName = segments.join(':')
  return kind === 'workflow' ? commandName : `${scope}:${commandName}`
}

function isSafeCommandSegment(segment: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(segment)
}

function commandDescription(contents: string): string | undefined {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(contents)
  if (frontmatter) {
    const description = frontmatter[1]
      ?.split('\n')
      .map(line => /^description:\s*(.*)$/.exec(line)?.[1]?.trim())
      .find(Boolean)
    if (description) return unquote(description)
  }
  const heading = contents
    .split('\n')
    .map(line => /^#\s+(.+)$/.exec(line)?.[1]?.trim())
    .find(Boolean)
  return heading ? unquote(heading) : undefined
}

function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, '')
}

function scopeRank(scope: CommandScope): number {
  return scope === 'project' ? 0 : 1
}

function kindRank(kind: CommandKind): number {
  return kind === 'workflow' ? 1 : 0
}

function uniqueExecutableCommand(
  command: CustomCommandInfo,
  index: number,
  commands: CustomCommandInfo[],
): boolean {
  if (command.kind !== 'workflow') return true
  return commands.findIndex(candidate =>
    candidate.kind === 'workflow' && candidate.name === command.name
  ) === index
}
