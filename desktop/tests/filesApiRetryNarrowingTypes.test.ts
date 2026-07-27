import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('files api retry result narrowing', () => {
  it('uses a literal true comparison before reading failure-only fields', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/services/api/filesApi.ts'),
      'utf8',
    )

    expect(source).toContain('if (result.done === true) {')
    expect(source).not.toContain('if (result.done) {')
  })
})
