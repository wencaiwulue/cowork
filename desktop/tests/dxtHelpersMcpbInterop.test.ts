import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('DXT helpers mcpb interop', () => {
  it('loads the mcpb manifest schema through a runtime interop helper', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/dxt/helpers.ts'),
      'utf8',
    )

    expect(source).toContain('type McpbRuntime =')
    expect(source).toContain('async function loadMcpbRuntime()')
    expect(source).toContain('mcpb.vAny.McpbManifestSchema')
  })
})
