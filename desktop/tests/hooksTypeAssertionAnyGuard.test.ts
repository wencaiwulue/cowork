import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('hook output type assertion', () => {
  it('guards the SDK equality assertion when generated SDK types are any stubs', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/types/hooks.ts'),
      'utf8',
    )

    expect(source).toContain('type IsAny<T> = 0 extends (1 & T) ? true : false')
    expect(source).toContain('type _assertSDKTypesMatch = Assert<')
    expect(source).toContain('IsAny<HookJSONOutput> extends true')
  })
})
