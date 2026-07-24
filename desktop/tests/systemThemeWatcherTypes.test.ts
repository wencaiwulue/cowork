import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('system theme watcher types', () => {
  it('keeps the watcher compatible with ThemeProvider two-argument calls', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/systemThemeWatcher.ts'),
      'utf8',
    )

    expect(source).toContain('_querier: unknown')
    expect(source).toContain('_callback: (theme: SystemTheme) => void')
  })
})
