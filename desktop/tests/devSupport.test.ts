import { describe, expect, test } from 'vitest'

describe('desktop dev launcher support', () => {
  test('builds the Electron launch from the resolved package executable', async () => {
    const electronPath = '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
    const support = await import('../scripts/devSupport.mjs')

    expect(support.buildElectronLaunch(electronPath, 'desktop/dist/main/main.js')).toEqual({
      command: electronPath,
      args: ['desktop/dist/main/main.js'],
    })
  })

  test('treats quick non-zero Electron exits as failed dev startup', async () => {
    const support = await import('../scripts/devSupport.mjs')

    expect(support.isFailedElectronStartup(499, 500, 1, null)).toBe(true)
    expect(support.isFailedElectronStartup(499, 500, null, 'SIGTERM')).toBe(true)
    expect(support.isFailedElectronStartup(500, 500, 1, null)).toBe(false)
  })

  test('treats quick zero Electron exits as an existing instance handoff', async () => {
    const support = await import('../scripts/devSupport.mjs')

    expect(support.isExistingInstanceHandoff(499, 500, 0, null)).toBe(true)
    expect(support.isExistingInstanceHandoff(499, 500, null, null)).toBe(false)
    expect(support.isExistingInstanceHandoff(500, 500, 0, null)).toBe(false)
  })
})
