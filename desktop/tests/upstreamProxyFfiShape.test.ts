import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('upstream proxy Bun FFI type boundary', () => {
  it('uses a local minimal FFI shape instead of the local bun:ffi shim type', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/upstreamproxy/upstreamproxy.ts'),
      'utf8',
    )

    expect(source).toContain('type BunFfi =')
    expect(source).toContain("require('bun:ffi') as BunFfi")
    expect(source).not.toContain("typeof import('bun:ffi')")
  })
})
