import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('telemetry log processor options', () => {
  it('constructs BatchLogRecordProcessor with an options object', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/telemetry/instrumentation.ts'),
      'utf8',
    )

    expect(source.match(/new BatchLogRecordProcessor\(\{/g)).toHaveLength(2)
    expect(source).toContain('exporter: logExporter')
    expect(source).toContain('exporter,')
    expect(source).not.toContain('new BatchLogRecordProcessor(logExporter,')
    expect(source).not.toContain('new BatchLogRecordProcessor(exporter,')
  })
})
