import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('first party event logging exporter types', () => {
  it('narrows core metadata through unknown before treating it as event metadata', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/services/analytics/firstPartyEventLoggingExporter.ts',
      ),
      'utf8',
    )

    expect(source).toMatch(
      /attributes\.core_metadata\s+as\s+unknown\s+as\s+[\s|]*EventMetadata[\s|]*undefined/,
    )
    expect(source).not.toContain(
      'attributes.core_metadata as EventMetadata | undefined',
    )
  })
})
