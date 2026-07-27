import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('subscription notification types', () => {
  it('keeps the extracted startup notification callback context typed', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/hooks/notifs/useCanSwitchToExistingSubscription.tsx'),
      'utf8',
    )

    expect(source).toContain(
      "import type { Notification } from '../../context/notifications.js'",
    )
    expect(source).toContain('async function _temp2(): Promise<Notification | null>')
  })
})
