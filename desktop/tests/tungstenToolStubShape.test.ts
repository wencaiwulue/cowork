import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('tungsten tool stub shape', () => {
  it('includes required tool definition hooks while remaining disabled', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/tools/TungstenTool/TungstenTool.ts'),
      'utf8',
    )

    expect(source).toContain('isEnabled()')
    expect(source).toContain('return false')
    expect(source).toContain('mapToolResultToToolResultBlockParam')
    expect(source).toContain('renderToolUseMessage')
  })
})
