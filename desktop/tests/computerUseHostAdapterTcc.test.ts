import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('computer use host adapter TCC checks', () => {
  it('uses the TCC method names declared by the Swift loader', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/computerUse/hostAdapter.ts'),
      'utf8',
    )

    expect(source).toContain('hasAccessibilityPermission')
    expect(source).toContain('hasScreenCapturePermission')
    expect(source).not.toContain('checkAccessibility')
    expect(source).not.toContain('checkScreenRecording')
  })
})
