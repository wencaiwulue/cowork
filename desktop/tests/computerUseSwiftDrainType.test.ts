import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('computer use Swift drain type', () => {
  it('declares the private run loop drain hook used by drainRunLoop', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/computerUse/swiftLoader.ts'),
      'utf8',
    )

    expect(source).toContain('_drainMainRunLoop(): void')
  })
})
