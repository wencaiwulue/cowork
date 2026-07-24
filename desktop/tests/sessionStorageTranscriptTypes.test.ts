import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('sessionStorage transcript typing', () => {
  it('stamps transcript timestamps and narrows compact boundaries locally', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/sessionStorage.ts'),
      'utf8',
    )

    expect(source).toContain('type TranscriptCompactBoundaryMessage =')
    expect(source).toContain('function isTranscriptCompactBoundaryMessage(')
    expect(source).toContain(
      'timestamp: message.timestamp ?? new Date().toISOString()',
    )
    expect(source).toContain('uuid: message.uuid ?? (randomUUID() as UUID)')
    expect(source).toContain(
      'parentUuid: isCompactBoundary ? null : effectiveParentUuid',
    )
    expect(source).toContain('if (isTranscriptCompactBoundaryMessage(entry))')
  })
})
