import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('queryHelpers progress message normalization', () => {
  it('uses the generic Message overload for progress payload messages', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/queryHelpers.ts'),
      'utf8',
    )

    expect(source).toContain(
      'normalizeMessages([message.data.message] as Message[])',
    )
    expect(source).toContain("case 'user':")
  })
})
