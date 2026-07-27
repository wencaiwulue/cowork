import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('remote review type narrowing', () => {
  it('uses an explicit false eligibility branch before reading errors', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/commands/review/reviewRemote.ts'),
      'utf8',
    )

    expect(source).toContain('eligibility.eligible === false')
  })
})
