import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('mcpbHandler runtime interop', () => {
  it('loads mcpb runtime through a default-aware helper', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/plugins/mcpbHandler.ts'),
      'utf8',
    )

    expect(source).toContain('type McpbRuntime =')
    expect(source).toContain('async function loadMcpbRuntime()')
    expect(source).toContain('mod.default ? mod.default : mod')
    expect(source).toContain('mcpb.getMcpConfigForManifest({')
    expect(source).not.toContain(
      'const { getMcpConfigForManifest } = await import',
    )
  })
})
