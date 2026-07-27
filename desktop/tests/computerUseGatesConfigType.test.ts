import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('computer use gates config type', () => {
  it('keeps coordinateMode outside the boolean sub-gate record type', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/computerUse/gates.ts'),
      'utf8',
    )

    expect(source).toContain('type ChicagoBooleanGate =')
    expect(source).toContain(
      'type ChicagoSubGates = Record<ChicagoBooleanGate, boolean>',
    )
    expect(source).toContain('type ChicagoConfig = ChicagoSubGates & {')
    expect(source).not.toContain('type ChicagoConfig = CuSubGates & {')
  })
})
