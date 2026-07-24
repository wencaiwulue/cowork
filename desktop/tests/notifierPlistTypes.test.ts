import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('notifier plist types', () => {
  it('narrows parsed plist values before reading object keys', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/services/notifier.ts'),
      'utf8',
    )

    expect(source).toContain('function isRecord(')
    expect(source).toContain('if (!isRecord(parsed)) {')
    expect(source).not.toContain(
      'const parsed: Record<string, unknown> = plist.parse',
    )
  })
})
