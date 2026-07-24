import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('cliHighlight highlight.js interop', () => {
  it('uses the highlight.js API type and runtime default fallback', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/cliHighlight.ts'),
      'utf8',
    )

    expect(source).toContain("import type { HLJSApi } from 'highlight.js'")
    expect(source).toContain("let loadedGetLanguage: HLJSApi['getLanguage']")
    expect(source).toContain(
      'const highlightJs = highlightJsModule.default ?? highlightJsModule',
    )
  })
})
