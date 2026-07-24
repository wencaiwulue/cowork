import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('first party event logger batch processor types', () => {
  it('passes exporter and batch config in the single current SDK options object', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/services/analytics/firstPartyEventLogger.ts'),
      'utf8',
    )

    expect(source).toContain(
      'new BatchLogRecordProcessor({',
    )
    expect(source).toContain('exporter: eventLoggingExporter,')
    expect(source).not.toContain(
      'new BatchLogRecordProcessor(eventLoggingExporter,',
    )
  })
})
