import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('coordinator worker agent exports', () => {
  it('exports the coordinator agent list function used by built-in agents', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/coordinator/workerAgent.ts'),
      'utf8',
    )

    expect(source).toContain('export function getCoordinatorAgents()')
    expect(source).toContain('return []')
  })
})
