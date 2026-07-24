import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Bun stringWidth signature', () => {
  it('calls Bun.stringWidth with the supported single string argument', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/ink/stringWidth.ts'),
      'utf8',
    )

    expect(source).toContain('str => bunStringWidth(str)')
    expect(source).not.toContain('bunStringWidth(str,')
  })
})
