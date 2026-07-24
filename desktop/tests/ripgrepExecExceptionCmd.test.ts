import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ripgrep embedded ExecFileException shape', () => {
  it('sets cmd on manually-created spawn errors', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/ripgrep.ts'),
      'utf8',
    )

    expect(source).toContain("const cmd = [rgPath, ...fullArgs].join(' ')")
    expect(source.match(/error\.cmd = cmd/g)).toHaveLength(2)
  })
})
