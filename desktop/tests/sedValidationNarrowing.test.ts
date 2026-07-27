import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('sed validation union narrowing', () => {
  it('uses an explicit false check before reading parse errors', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/tools/BashTool/sedValidation.ts'),
      'utf8',
    )

    expect(source).toContain('if (parseResult.success === false)')
  })
})
