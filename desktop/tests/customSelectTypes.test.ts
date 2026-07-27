import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('custom select type narrowing', () => {
  it('keeps memoized label width callback typed as returning numbers', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/CustomSelect/select.tsx'),
      'utf8',
    )

    expect(source).toContain(
      'let t19: (data: (typeof optionData)[number]) => number',
    )
  })
})
