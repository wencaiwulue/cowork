import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('conversation recovery type guards', () => {
  it('narrows resumed user messages and live session records before access', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/conversationRecovery.ts'),
      'utf8',
    )

    expect(source).toContain('function isNormalizedUserMessage(')
    expect(source).toContain('message: NormalizedUserMessage')
    expect(source).toContain('function isSkippableLiveSession(')
    expect(source).toContain('session: unknown')
  })
})
