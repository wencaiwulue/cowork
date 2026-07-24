import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('analyzeContext system context typing', () => {
  it('narrows system context entries to strings before token counting', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/analyzeContext.ts'),
      'utf8',
    )

    expect(source).toContain('(entry): entry is [string, string] =>')
    expect(source).toContain("typeof entry[1] === 'string'")
    expect(source).toContain('entry[1].length > 0')
  })
})
