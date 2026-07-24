import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('console OAuth flow type narrowing', () => {
  it('uses an explicit false org validation branch before reading the message', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/ConsoleOAuthFlow.tsx'),
      'utf8',
    )

    expect(source).toContain('orgResult.valid === false')
  })
})
