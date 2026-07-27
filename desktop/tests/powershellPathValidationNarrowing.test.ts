import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('powershell path validation union narrowing', () => {
  it('uses an explicit false check before reading safety failure details', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/tools/PowerShellTool/pathValidation.ts'),
      'utf8',
    )

    expect(source).toContain('if (safetyCheck.safe === false)')
  })
})
