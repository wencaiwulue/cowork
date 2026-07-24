import { lstat, realpath } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

export async function assertWorkspaceDirectory(cwd: string): Promise<string> {
  let info
  try {
    info = await lstat(cwd)
  } catch {
    throw new Error(`Workspace folder does not exist: ${cwd}`)
  }

  if (info.isSymbolicLink()) {
    throw new Error(`Workspace folder must not be a symlink: ${cwd}`)
  }

  if (!info.isDirectory()) {
    throw new Error(`Workspace path is not a folder: ${cwd}`)
  }

  return cwd
}

export async function assertWorkspaceFileTarget(
  cwd: string,
  target: string,
  options: { forWrite?: boolean } = {},
): Promise<string> {
  const root = resolve(cwd)
  const resolved = resolve(target)
  assertLexicallyInside(root, resolved)

  const realRoot = await realpath(cwd)
  try {
    const info = await lstat(resolved)
    if (info.isSymbolicLink()) {
      throw new Error(`Workspace file target must not be a symlink: ${target}`)
    }
    assertRealInside(realRoot, await realpath(resolved))
    return resolved
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' || !options.forWrite) {
      throw cause
    }
    assertRealInside(realRoot, await realpath(dirname(resolved)))
    return resolved
  }
}

function assertLexicallyInside(root: string, target: string): void {
  const rel = relative(root, target)
  if (isOutsideRelativePath(rel)) {
    throw new Error('Workspace file target is outside the workspace')
  }
}

function assertRealInside(realRoot: string, realTarget: string): void {
  const rel = relative(realRoot, realTarget)
  if (isOutsideRelativePath(rel)) {
    throw new Error('Workspace file target is outside the workspace')
  }
}

function isOutsideRelativePath(rel: string): boolean {
  return rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')
}
