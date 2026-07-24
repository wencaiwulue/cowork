import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('execFileNoThrowPortable execa interop', () => {
  it('uses the command-string sync API for shell command strings', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/execFileNoThrowPortable.ts'),
      'utf8',
    )

    expect(source).toContain(
      "import { type SyncOptions as ExecaSyncOptions, execaCommandSync } from 'execa'",
    )
    expect(source).toContain("stdio?: ExecaSyncOptions['stdio']")
    expect(source).toContain('execaCommandSync(command, {')
    expect(source).toContain("typeof result.stdout !== 'string'")
    expect(source).not.toContain('execaSync(command, {')
  })
})
