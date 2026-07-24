import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('passes dialog types', () => {
  it('keeps pass count predicate typed as PassStatus', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/Passes/Passes.tsx'),
      'utf8',
    )

    expect(source).toContain(
      'count(passStatuses, (p: PassStatus) => p.isAvailable)',
    )
  })
})
