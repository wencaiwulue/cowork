import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('permission decision debug info types', () => {
  it('keeps subcommand result entries typed for the React compiler output', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/components/permissions/PermissionDecisionDebugInfo.tsx',
      ),
      'utf8',
    )

    expect(source).toContain('PermissionResult')
    expect(source).toContain(
      '.map((t2: [string, PermissionResult]) => {',
    )
  })
})
