import { lstat, readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { parse as parseYaml } from 'yaml'
import type { Command } from '../../types/command.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

type WorkflowFile = {
  filePath: string
  baseDir: string
  frontmatter: FrontmatterData
  content: string
  source: 'userSettings' | 'projectSettings'
}

type FrontmatterData = {
  'allowed-tools'?: string | string[] | null
  description?: string | null
  'argument-hint'?: string | null
  arguments?: string | string[] | null
  [key: string]: unknown
}

type ParsedWorkflowMarkdown = {
  frontmatter: FrontmatterData
  content: string
}

export function createWorkflowCommand(file: WorkflowFile): Command | undefined {
  const name = workflowCommandName(file)
  if (!name) return undefined
  const description =
    typeof file.frontmatter.description === 'string' && file.frontmatter.description.trim()
      ? file.frontmatter.description.trim()
      : workflowDescription(file.content)
  const argumentHint =
    typeof file.frontmatter['argument-hint'] === 'string'
      ? file.frontmatter['argument-hint'].trim() || undefined
      : undefined
  const argumentNames = parseArgumentNames(file.frontmatter.arguments as string | string[] | undefined)
  const allowedTools = workflowAllowedTools(file.frontmatter['allowed-tools'])

  return {
    type: 'prompt',
    name,
    description,
    argumentHint,
    argNames: argumentNames.length > 0 ? argumentNames : undefined,
    allowedTools,
    contentLength: file.content.length,
    progressMessage: 'running',
    source: file.source,
    loadedFrom: 'commands_DEPRECATED',
    kind: 'workflow',
    async getPromptForCommand(args: string): Promise<ContentBlockParam[]> {
      return [{
        type: 'text',
        text: substituteArguments(file.content, args, true, argumentNames),
      }]
    },
  }
}

export async function getWorkflowCommands(cwd: string): Promise<Command[]> {
  const files = [
    ...await listWorkflowFiles('projectSettings', join(cwd, '.claude', 'workflows')),
    ...await listWorkflowFiles('userSettings', join(getClaudeConfigHomeDir(), 'workflows')),
  ]
  return files
    .sort(compareWorkflowFiles)
    .map(createWorkflowCommand)
    .filter((command): command is Command => command !== undefined)
    .filter(uniqueWorkflowCommandName)
}

async function listWorkflowFiles(
  source: WorkflowFile['source'],
  workflowsDir: string,
): Promise<WorkflowFile[]> {
  try {
    const info = await lstat(workflowsDir)
    if (!info.isDirectory() || info.isSymbolicLink()) return []
  } catch {
    return []
  }
  const files = await collectMarkdownFiles(workflowsDir)
  return Promise.all(files.map(async filePath => {
    const raw = await readFile(filePath, 'utf8')
    const parsed = parseWorkflowFrontmatter(raw)
    return {
      filePath,
      baseDir: workflowsDir,
      frontmatter: parsed.frontmatter,
      content: parsed.content,
      source,
    }
  }))
}

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)---\s*\n?/

function parseWorkflowFrontmatter(markdown: string): ParsedWorkflowMarkdown {
  const match = markdown.match(FRONTMATTER_REGEX)
  if (!match) {
    return {
      frontmatter: {},
      content: markdown,
    }
  }
  const content = markdown.slice(match[0].length)
  try {
    const parsed = parseYaml(match[1] || '') as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        frontmatter: parsed as FrontmatterData,
        content,
      }
    }
  } catch {
    return {
      frontmatter: {},
      content,
    }
  }
  return {
    frontmatter: {},
    content,
  }
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

function workflowCommandName(file: WorkflowFile): string | undefined {
  const fileName = basename(file.filePath)
  const fileDirectory = dirname(file.filePath)
  const commandBaseName = fileName.replace(/\.md$/i, '')
  const namespace = relative(file.baseDir, fileDirectory)
    .split(sep)
    .map(segment => segment.trim())
    .filter(Boolean)
  const segments = [...namespace, commandBaseName]
  if (segments.length === 0 || segments.some(segment => !isSafeCommandSegment(segment))) {
    return undefined
  }
  return segments.join(':')
}

function isSafeCommandSegment(segment: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(segment)
}

function workflowDescription(content: string): string {
  const heading = content
    .split('\n')
    .map(line => /^#\s+(.+)$/.exec(line)?.[1]?.trim())
    .find(Boolean)
  if (heading) return heading
  const firstLine = content
    .split('\n')
    .map(line => line.trim())
    .find(Boolean)
  return firstLine || 'Workflow'
}

function workflowAllowedTools(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((tool): tool is string => typeof tool === 'string')
  if (typeof value !== 'string') return []
  return value.split(',').map(tool => tool.trim()).filter(Boolean)
}

function parseArgumentNames(argumentNames: string | string[] | null | undefined): string[] {
  const isValidName = (name: string): boolean =>
    typeof name === 'string' && name.trim() !== '' && !/^\d+$/.test(name)
  if (Array.isArray(argumentNames)) return argumentNames.filter(isValidName)
  if (typeof argumentNames === 'string') return argumentNames.split(/\s+/).filter(isValidName)
  return []
}

function substituteArguments(
  content: string,
  args: string | undefined,
  appendIfNoPlaceholder: boolean,
  argumentNames: string[],
): string {
  if (args === undefined || args === null) return content
  const parsedArgs = args.split(/\s+/).filter(Boolean)
  const originalContent = content

  for (let i = 0; i < argumentNames.length; i++) {
    const name = argumentNames[i]
    if (!name) continue
    content = content.replace(new RegExp(`\\$${name}(?![\\[\\w])`, 'g'), parsedArgs[i] ?? '')
  }
  content = content.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, indexStr: string) => {
    const index = Number.parseInt(indexStr, 10)
    return parsedArgs[index] ?? ''
  })
  content = content.replace(/\$(\d+)(?!\w)/g, (_, indexStr: string) => {
    const index = Number.parseInt(indexStr, 10)
    return parsedArgs[index] ?? ''
  })
  content = content.replaceAll('$ARGUMENTS', args)
  if (content === originalContent && appendIfNoPlaceholder && args) {
    return `${content}\n\nARGUMENTS: ${args}`
  }
  return content
}

function compareWorkflowFiles(a: WorkflowFile, b: WorkflowFile): number {
  const sourceComparison = sourceRank(a.source) - sourceRank(b.source)
  if (sourceComparison !== 0) return sourceComparison
  return workflowSortName(a).localeCompare(workflowSortName(b))
}

function workflowSortName(file: WorkflowFile): string {
  return workflowCommandName(file) ?? ''
}

function sourceRank(source: WorkflowFile['source']): number {
  if (source === 'projectSettings') return 0
  return 1
}

function uniqueWorkflowCommandName(
  command: Command,
  index: number,
  commands: Command[],
): boolean {
  return commands.findIndex(candidate => candidate.name === command.name) === index
}
