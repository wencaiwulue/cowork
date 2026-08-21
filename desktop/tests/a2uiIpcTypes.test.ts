/**
 * Static source-analysis assertions for A2UI Phase 2 IPC additions.
 *
 * Design doc reference: docs/design/2026-08-21-a2ui-integration.md §6.1
 *
 * These tests mirror the style of desktop/tests/ipc.test.ts — they read source
 * files as strings and assert presence of expected identifiers.  They provide
 * a fast, dependency-free signal that all the integration seams are wired.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { desktopChannels, validateIpcArgs } from '../main/ipc'

const cwd = process.cwd()
const ipcSource = readFileSync(join(cwd, 'desktop/main/ipc.ts'), 'utf8')

describe('A2UI Phase 2 IPC channels', () => {
  it('desktopChannels array contains sessions:submitA2uiAction', () => {
    expect(desktopChannels).toContain('sessions:submitA2uiAction')
  })

  it('desktopChannels array contains sessions:reportA2uiError', () => {
    expect(desktopChannels).toContain('sessions:reportA2uiError')
  })

  it('validateIpcArgs switch contains case for sessions:submitA2uiAction', () => {
    expect(ipcSource).toContain("case 'sessions:submitA2uiAction':")
  })

  it('validateIpcArgs switch contains case for sessions:reportA2uiError', () => {
    expect(ipcSource).toContain("case 'sessions:reportA2uiError':")
  })

  it('validateIpcArgs accepts sessions:submitA2uiAction with sessionId + payload', () => {
    const result = validateIpcArgs('sessions:submitA2uiAction', [
      'session-abc',
      {
        toolUseId: 'tool-123',
        action: {
          name: 'click',
          surfaceId: 'surface-1',
          sourceComponentId: 'btn-root',
          timestamp: new Date().toISOString(),
          context: {},
        },
      },
    ])
    expect(result[0]).toBe('session-abc')
    expect(result[1]).toBeDefined()
  })

  it('validateIpcArgs accepts sessions:reportA2uiError with sessionId + payload', () => {
    const result = validateIpcArgs('sessions:reportA2uiError', [
      'session-abc',
      {
        toolUseId: 'tool-123',
        error: {
          code: 'RENDER_ERROR',
          surfaceId: 'surface-1',
          message: 'something went wrong',
        },
      },
    ])
    expect(result[0]).toBe('session-abc')
    expect(result[1]).toBeDefined()
  })

  it('validateIpcArgs rejects sessions:submitA2uiAction with wrong arity', () => {
    expect(() => validateIpcArgs('sessions:submitA2uiAction', ['session-abc'])).toThrow(
      'sessions:submitA2uiAction expected 2 argument(s), got 1',
    )
  })

  it('validateIpcArgs rejects sessions:reportA2uiError with wrong arity', () => {
    expect(() => validateIpcArgs('sessions:reportA2uiError', [])).toThrow(
      'sessions:reportA2uiError expected 2 argument(s), got 0',
    )
  })
})

describe('A2UI Phase 2 DesktopMessage type fields', () => {
  it('DesktopMessage type definition contains a2uiMessages field', () => {
    expect(ipcSource).toContain('a2uiMessages?:')
  })

  it('DesktopMessage type definition contains a2uiToolUseId field', () => {
    expect(ipcSource).toContain('a2uiToolUseId?:')
  })

  it('DesktopMessage type definition contains a2uiSource field', () => {
    expect(ipcSource).toContain("a2uiSource?:")
  })
})

describe('A2UI Phase 2 payload types', () => {
  it('A2uiSubmitActionInput type is exported from ipc.ts', () => {
    expect(ipcSource).toContain('export type A2uiSubmitActionInput =')
  })

  it('A2uiReportErrorInput type is exported from ipc.ts', () => {
    expect(ipcSource).toContain('export type A2uiReportErrorInput =')
  })
})
