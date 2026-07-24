import { describe, expect, it } from 'vitest'
import {
  recordSmokeDesktopEvent,
  recordSmokeIpcCall,
  type SmokeEventApp,
} from '../main/smokeEvents'

describe('recordSmokeDesktopEvent', () => {
  it('records bounded main-process desktop events only during smoke runs', () => {
    const app = {} as SmokeEventApp

    recordSmokeDesktopEvent(app, { type: 'ignored' }, false)
    expect(app.__claudeDesktopSmokeEvents).toBeUndefined()

    for (let index = 0; index < 505; index += 1) {
      recordSmokeDesktopEvent(app, { type: 'event', index }, true)
    }

    expect(app.__claudeDesktopSmokeEvents).toHaveLength(500)
    expect(app.__claudeDesktopSmokeEvents?.[0]).toEqual({ type: 'event', index: 5 })
    expect(app.__claudeDesktopSmokeEvents?.at(-1)).toEqual({ type: 'event', index: 504 })
  })
})

describe('recordSmokeIpcCall', () => {
  it('records bounded IPC counts and summarized args only during smoke runs', () => {
    const app = {} as SmokeEventApp

    recordSmokeIpcCall(app, 'sessions:send', ['ignored'], false)
    expect(app.__claudeDesktopSmokeIpcCalls).toBeUndefined()
    expect(app.__claudeDesktopSmokeIpcArgs).toBeUndefined()

    for (let index = 0; index < 30; index += 1) {
      recordSmokeIpcCall(
        app,
        'sessions:send',
        [`session-${index}`, 'x'.repeat(260), { nested: ['ok', index] }],
        true,
      )
    }

    expect(app.__claudeDesktopSmokeIpcCalls?.['sessions:send']).toBe(30)
    expect(app.__claudeDesktopSmokeIpcArgs?.['sessions:send']).toHaveLength(25)
    expect(app.__claudeDesktopSmokeIpcArgs?.['sessions:send']?.[0]).toEqual([
      'session-5',
      `${'x'.repeat(220)}...`,
      { nested: ['ok', 5] },
    ])
    expect(app.__claudeDesktopSmokeIpcArgs?.['sessions:send']?.at(-1)).toEqual([
      'session-29',
      `${'x'.repeat(220)}...`,
      { nested: ['ok', 29] },
    ])
  })
})
