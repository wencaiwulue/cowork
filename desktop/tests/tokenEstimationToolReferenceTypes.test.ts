import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('token estimation tool reference types', () => {
  it('routes tool result content through a helper that handles tool references', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/services/tokenEstimation.ts'),
      'utf8',
    )

    expect(source).toContain(
      'function roughTokenCountEstimationForToolResultContent(',
    )
    expect(source).toContain(
      'return roughTokenCountEstimationForToolResultContent(block.content)',
    )
  })
})
