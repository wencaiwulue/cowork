import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('claude code hint recommendation types', () => {
  it('narrows failed plugin install results with an explicit false discriminant', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/hooks/useClaudeCodeHintRecommendation.tsx'),
      'utf8',
    )

    expect(source).toContain('if (result.success === false) {')
    expect(source).not.toContain('if (!result.success) {')
  })
})
