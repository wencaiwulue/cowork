import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('bootstrap schema types', () => {
  it('uses the current zod record signature for client data', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/services/api/bootstrap.ts'),
      'utf8',
    )

    expect(source).toContain('client_data: z.record(z.string(), z.unknown())')
    expect(source).not.toContain('client_data: z.record(z.unknown())')
  })
})
