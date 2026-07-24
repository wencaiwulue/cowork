import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('send message result union narrowing', () => {
  it('uses an explicit false branch before reading bridge send errors', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/tools/SendMessageTool/SendMessageTool.ts'),
      'utf8',
    )

    expect(source).toContain('if (result.ok === false)')
  })
})
