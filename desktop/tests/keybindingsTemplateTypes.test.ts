import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('keybindings template types', () => {
  it('narrows binding entries before copying actions into the template', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/keybindings/template.ts'),
      'utf8',
    )

    expect(source).toContain(
      'const bindings = block.bindings as Record<string, string | null>',
    )
    expect(source).toContain('Object.entries(bindings)')
    expect(source).not.toContain('Object.entries(block.bindings)')
  })
})
