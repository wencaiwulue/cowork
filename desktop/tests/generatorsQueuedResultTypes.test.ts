import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('generators queued result typing', () => {
  it('uses a discriminated queued generator result for yielded values', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/generators.ts'),
      'utf8',
    )

    expect(source).toContain('done: false')
    expect(source).toContain('done: true')
    expect(source).toContain('result.done')
    expect(source).toContain('value: result.value')
  })
})
