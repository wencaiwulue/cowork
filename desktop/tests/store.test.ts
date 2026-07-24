import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  desktopStorePath,
  loadDesktopStore,
  saveDesktopStore,
} from '../main/store'
import type { DesktopSession } from '../main/ipc'

const originalStorePath = process.env.CLAUDE_CODE_DESKTOP_STORE_PATH

afterEach(() => {
  if (originalStorePath === undefined) {
    delete process.env.CLAUDE_CODE_DESKTOP_STORE_PATH
  } else {
    process.env.CLAUDE_CODE_DESKTOP_STORE_PATH = originalStorePath
  }
})

function session(id: string): DesktopSession {
  return {
    id,
    title: 'project',
    cwd: '/tmp/project',
    createdAt: 1,
    updatedAt: 2,
    status: 'stopped',
    activity: 'idle',
    messages: [],
    layout: {
      sidebarWidth: 280,
      workspaceRatio: 0.5,
      activePane: 'files',
    },
  }
}

describe('desktop store', () => {
  it('uses an override path for tests and smoke runs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'claude-desktop-store-'))
    process.env.CLAUDE_CODE_DESKTOP_STORE_PATH = join(dir, 'sessions.json')

    await saveDesktopStore({
      sessions: [session('session-1')],
      activeSessionId: 'session-1',
      config: {
        proxy: { enabled: true, url: 'socks5://127.0.0.1:7890' },
      },
    })

    expect(desktopStorePath()).toBe(join(dir, 'sessions.json'))
    expect(await loadDesktopStore()).toMatchObject({
      sessions: [{ id: 'session-1' }],
      activeSessionId: 'session-1',
      config: {
        proxy: { enabled: true, url: 'socks5://127.0.0.1:7890' },
      },
    })
    expect(await readFile(join(dir, 'sessions.json'), 'utf8')).toContain(
      'session-1',
    )
  })
})
