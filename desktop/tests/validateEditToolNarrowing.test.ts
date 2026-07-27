import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('validateEditTool validation result narrowing', () => {
  it('uses an explicit false branch before reading validation errors', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/settings/validateEditTool.ts'),
      'utf8',
    )

    expect(source).toContain('if (afterValidation.isValid === false)')
    expect(source).toContain('afterValidation.error')
    expect(source).toContain('afterValidation.fullSchema')
  })
})
