import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('plugin hook count types', () => {
  it('narrows hook config values before reducing matcher groups', () => {
    const managePlugins = readFileSync(
      join(process.cwd(), 'src/hooks/useManagePlugins.ts'),
      'utf8',
    )
    const refresh = readFileSync(
      join(process.cwd(), 'src/utils/plugins/refresh.ts'),
      'utf8',
    )

    expect(managePlugins).toContain(
      'const { enabled, disabled, errors } = (await loadAllPlugins()) as PluginLoadResult',
    )
    expect(managePlugins).not.toContain('count(enabled as any[]')

    for (const source of [managePlugins, refresh]) {
      expect(source).toContain('type PluginHookMatcherGroups = Array<')
      expect(source).toContain(
        "NonNullable<LoadedPlugin['hooksConfig']>[keyof NonNullable<",
      )
      expect(source).toContain(
        'const matcherGroups = Object.values(p.hooksConfig) as PluginHookMatcherGroups',
      )
      expect(source).not.toContain('Object.values(p.hooksConfig).reduce(')
    }
  })
})
