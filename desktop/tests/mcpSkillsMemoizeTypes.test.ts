import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('mcp skills memoization types', () => {
  it('passes a cache key and size to memoizeWithLRU', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/skills/mcpSkills.ts'),
      'utf8',
    )

    expect(source).toContain("String((_client as { name?: unknown })?.name ?? 'default')")
    expect(source).toContain('10,')
  })
})
