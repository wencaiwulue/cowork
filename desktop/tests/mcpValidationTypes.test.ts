import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('mcp entrypoint validation types', () => {
  it('narrows tool validation failures with an explicit false discriminant', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/entrypoints/mcp.ts'),
      'utf8',
    )

    expect(source).toContain('if (validationResult?.result === false) {')
    expect(source).not.toContain('if (validationResult && !validationResult.result) {')
  })
})
