import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function defaultDesktopWorkspace(home = homedir()): string {
  return join(home, '.kode', 'desktop-workspace')
}

export async function ensureDefaultDesktopWorkspace(home = homedir()): Promise<string> {
  const workspace = defaultDesktopWorkspace(home)
  await mkdir(workspace, { recursive: true })
  return workspace
}
