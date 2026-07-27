import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('loadPluginCommands metadata typing', () => {
  it('types normalized command metadata independently of the manifest schema', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/plugins/loadPluginCommands.ts'),
      'utf8',
    )

    expect(source).toContain(
      'commandsMetadata: Record<string, CommandMetadata> | undefined',
    )
    expect(source).not.toContain("PluginManifest['commandsMetadata']")
  })
})
