import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultDesktopWorkspace, ensureDefaultDesktopWorkspace } from '../main/defaultWorkspace'

describe('default desktop workspace', () => {
  it('uses a dedicated Claude desktop workspace instead of the whole home folder', async () => {
    const home = await mkdtemp(join(tmpdir(), 'desktop-home-'))
    try {
      expect(defaultDesktopWorkspace(home)).toBe(join(home, '.kode', 'desktop-workspace'))
      expect(defaultDesktopWorkspace(home)).not.toBe(home)

      const workspace = await ensureDefaultDesktopWorkspace(home)
      expect(workspace).toBe(join(home, '.kode', 'desktop-workspace'))
      expect(existsSync(workspace)).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
