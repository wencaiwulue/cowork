import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('processSlashCommand normalized user guard', () => {
  it('guards normalized user messages before creating progress messages', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/processUserInput/processSlashCommand.tsx'),
      'utf8',
    )

    expect(source).toContain('function isNormalizedUserMessage(')
    expect(source).toContain('Array.isArray(message.message.content)')
    expect(source).toContain('if (isNormalizedUserMessage(normalizedMsg))')
  })
})
