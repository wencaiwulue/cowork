import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('markdown renderer types', () => {
  it('passes table keys through React attributes instead of MarkdownTable props', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/Markdown.tsx'),
      'utf8',
    )

    expect(source).toContain('React.createElement(MarkdownTable')
  })
})
