import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('memory shape telemetry exports', () => {
  it('exports the recall and write telemetry functions used behind feature gates', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/memdir/memoryShapeTelemetry.ts'),
      'utf8',
    )

    expect(source).toContain('export function logMemoryRecallShape(')
    expect(source).toContain('export function logMemoryWriteShape(')
  })
})
