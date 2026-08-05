import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DesktopProxySettings, DesktopSession } from './ipc'

export type DesktopStore = {
  sessions: DesktopSession[]
  activeSessionId?: string
  config?: {
    proxy?: DesktopProxySettings
  }
}

const emptyStore: DesktopStore = { sessions: [] }

export function desktopStorePath(
  env = Function('return process.env')() as NodeJS.ProcessEnv,
): string {
  return env.CLAUDE_CODE_DESKTOP_STORE_PATH ||
    join(homedir(), '.kode', 'desktop-sessions.json')
}

export async function loadDesktopStore(): Promise<DesktopStore> {
  try {
    const raw = await readFile(desktopStorePath(), 'utf8')
    const parsed = JSON.parse(raw) as DesktopStore
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : []
    return {
      sessions,
      activeSessionId:
        typeof parsed.activeSessionId === 'string' &&
        sessions.some(session => session.id === parsed.activeSessionId)
          ? parsed.activeSessionId
          : undefined,
      config:
        parsed.config && typeof parsed.config === 'object'
          ? parsed.config
          : undefined,
    }
  } catch {
    return emptyStore
  }
}

export async function saveDesktopStore(store: DesktopStore): Promise<void> {
  const storePath = desktopStorePath()
  await mkdir(dirname(storePath), { recursive: true })
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`)
}
