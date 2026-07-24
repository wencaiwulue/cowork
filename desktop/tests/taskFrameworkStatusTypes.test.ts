import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('task framework status typing', () => {
  it('narrows concrete task statuses at terminal status checks', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/task/framework.ts'),
      'utf8',
    )

    expect(source.match(/isTerminalTaskStatus\([^)]* as TaskStatus\)/g)).toHaveLength(
      2,
    )
  })
})
