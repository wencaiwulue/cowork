import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('VERSION_CHANGELOG string guards', () => {
  it('guards macro changelog values before trimming them', () => {
    const logoSource = readFileSync(
      join(process.cwd(), 'src/utils/logoV2Utils.ts'),
      'utf8',
    )
    const releaseNotesSource = readFileSync(
      join(process.cwd(), 'src/utils/releaseNotes.ts'),
      'utf8',
    )
    const globalSource = readFileSync(
      join(process.cwd(), 'src/global.d.ts'),
      'utf8',
    )

    expect(globalSource).toContain('VERSION_CHANGELOG: string | unknown[]')
    expect(logoSource).toContain(
      "if (typeof changelog === 'string' && changelog)",
    )
    expect(releaseNotesSource.match(/typeof changelog === 'string'/g)).toHaveLength(
      2,
    )
  })
})
