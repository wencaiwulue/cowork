import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('bash permission union narrowing', () => {
  it('uses explicit false checks for discriminated union results', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/tools/BashTool/bashPermissions.ts'),
      'utf8',
    )

    expect(source).toContain('if (sem.ok === false)')
    expect(source).toContain('if (parseResult.success === false)')
  })
})
