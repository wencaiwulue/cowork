import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('groupToolUses normalized user guard', () => {
  it('checks user messages have array content before grouping tool results', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/groupToolUses.ts'),
      'utf8',
    )

    expect(source).toContain('function isNormalizedUserMessage(')
    expect(source).toContain('Array.isArray(msg.message.content)')
    expect(source).toContain('if (isNormalizedUserMessage(msg))')
    expect(source).not.toContain("if (msg.type === 'user') {")
  })
})
