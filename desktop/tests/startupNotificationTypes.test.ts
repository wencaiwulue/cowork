import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('startup notification types', () => {
  it('keeps install message notification helpers typed', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/hooks/notifs/useInstallMessages.tsx'),
      'utf8',
    )

    expect(source).toContain(
      "import type { Notification } from '../../context/notifications.js'",
    )
    expect(source).toContain('async function _temp2(): Promise<Notification[]>')
    expect(source).toContain('function _temp(message, index): Notification')
    expect(source).toContain('let priority: Notification[\'priority\'] = "low"')
  })

  it('keeps npm deprecation notification helper typed', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/hooks/notifs/useNpmDeprecationNotification.tsx'),
      'utf8',
    )

    expect(source).toContain(
      "import type { Notification } from '../../context/notifications.js'",
    )
    expect(source).toContain('async function _temp(): Promise<Notification | null>')
  })

  it('keeps chrome extension notification helper typed', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/hooks/useChromeExtensionNotification.tsx'),
      'utf8',
    )

    expect(source).toContain(
      "import type { Notification } from '../context/notifications.js'",
    )
    expect(source).toContain('async function _temp(): Promise<Notification | null>')
  })
})
