import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('overlay context types', () => {
  it('defaults overlay registration to enabled', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/context/overlayContext.tsx'),
      'utf8',
    )

    expect(source).toContain(
      'export function useRegisterOverlay(id: string, t0 = true): void',
    )
  })
})
