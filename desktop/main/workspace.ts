import { constants } from 'node:fs'
import { access, lstat, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { WorkspaceEntry } from './ipc'

const MAX_TREE_DEPTH = 4
const MAX_CHILDREN = 120
export const MAX_EDITABLE_FILE_BYTES = 1024 * 1024
const IGNORED_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.DS_Store',
])

function safeResolve(root: string, target: string): string {
  if (isAbsolute(target)) {
    throw new Error('Workspace file path must be relative')
  }
  const resolved = resolve(root, target)
  const rel = relative(root, resolved)
  if (rel.startsWith('..') || rel === '..') {
    throw new Error('Path is outside the workspace')
  }
  return resolved
}

function assertInsideWorkspace(root: string, target: string): void {
  const rel = relative(root, target)
  if (rel.startsWith('..') || rel === '..' || resolve(root, rel) !== target) {
    throw new Error('Path is outside the workspace')
  }
}

async function safeReadTarget(root: string, target: string): Promise<string> {
  const resolved = safeResolve(root, target)
  const [realRoot, realTarget] = await Promise.all([
    realpath(root),
    realpath(resolved),
  ])
  assertInsideWorkspace(realRoot, realTarget)
  return realTarget
}

async function safeWriteTarget(root: string, target: string): Promise<string> {
  const resolved = safeResolve(root, target)
  const realRoot = await realpath(root)
  try {
    await access(resolved, constants.F_OK)
    const realTarget = await realpath(resolved)
    assertInsideWorkspace(realRoot, realTarget)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    const realParent = await realpath(dirname(resolved))
    assertInsideWorkspace(realRoot, realParent)
  }
  return resolved
}

async function entryFor(
  root: string,
  path: string,
  depth: number,
): Promise<WorkspaceEntry | undefined> {
  const info = await lstat(path)
  if (info.isSymbolicLink()) return undefined
  const name = path.split('/').pop() || path
  const relativePath = relative(root, path)

  if (!info.isDirectory()) {
    return { name, path: relativePath, type: 'file' }
  }

  const entry: WorkspaceEntry = {
    name,
    path: relativePath,
    type: 'directory',
    children: [],
  }
  if (depth >= MAX_TREE_DEPTH) return entry

  const children = (await readdir(path))
    .filter(child => !IGNORED_NAMES.has(child))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_CHILDREN)

  entry.children = (await Promise.all(
    children.map(child => entryFor(root, join(path, child), depth + 1)),
  )).filter((child): child is WorkspaceEntry => Boolean(child))
  return entry
}

export async function readWorkspaceTree(cwd: string): Promise<WorkspaceEntry[]> {
  const root = await entryFor(cwd, cwd, 0)
  return root.children ?? []
}

export async function readWorkspaceFile(
  cwd: string,
  path: string,
): Promise<string> {
  const resolved = await safeReadTarget(cwd, path)
  const info = await stat(resolved)
  if (info.size > MAX_EDITABLE_FILE_BYTES) {
    throw new Error(
      `File is too large to open in the desktop editor (${info.size} bytes, limit ${MAX_EDITABLE_FILE_BYTES} bytes)`,
    )
  }
  const contents = await readFile(resolved)
  if (contents.includes(0)) {
    throw new Error('Binary files cannot be opened in the desktop editor')
  }
  return contents.toString('utf8')
}

export async function saveWorkspaceFile(
  cwd: string,
  path: string,
  contents: string,
): Promise<void> {
  const bytes = Buffer.byteLength(contents, 'utf8')
  if (bytes > MAX_EDITABLE_FILE_BYTES) {
    throw new Error(
      `File is too large to save from the desktop editor (${bytes} bytes, limit ${MAX_EDITABLE_FILE_BYTES} bytes)`,
    )
  }
  await writeFile(await safeWriteTarget(cwd, path), contents)
}
