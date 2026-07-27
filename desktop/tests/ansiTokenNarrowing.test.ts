import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ANSI token narrowing', () => {
  it('reads char values only after narrowing token type', () => {
    const sliceSource = readFileSync(
      join(process.cwd(), 'src/utils/sliceAnsi.ts'),
      'utf8',
    )
    const highlightingSource = readFileSync(
      join(process.cwd(), 'src/utils/textHighlighting.ts'),
      'utf8',
    )

    expect(sliceSource).not.toContain('const t = token as any')
    expect(sliceSource).toContain("token.type === 'char'")
    expect(sliceSource).toContain('activeCodes.push(token)')
    expect(highlightingSource).toContain("} else if (token.type === 'char') {")
    expect(highlightingSource).toContain('this.stringPos += token.code.length')
  })
})
