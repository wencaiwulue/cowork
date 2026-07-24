import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('marketplace declared entries typing', () => {
  it('narrows settings marketplace entries before returning declared marketplaces', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/plugins/marketplaceManager.ts'),
      'utf8',
    )

    expect(source).toContain('function isDeclaredMarketplace(')
    expect(source).toContain('function getDeclaredMarketplaceEntries(')
    expect(source).toContain(
      '...getDeclaredMarketplaceEntries(getAddDirExtraMarketplaces())',
    )
    expect(source).toContain(
      '...getDeclaredMarketplaceEntries(getInitialSettings().extraKnownMarketplaces)',
    )
  })
})
