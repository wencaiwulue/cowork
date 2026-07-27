import { describe, expect, it } from 'vitest'
import { buildPRTrailers } from '../../src/utils/attributionTrailer'

describe('attribution trailer stub shape', () => {
  it('exports the PR trailer builder expected by attribution', () => {
    const trailers = buildPRTrailers(
      {
        version: 1,
        summary: {
          claudePercent: 0,
          claudeChars: 0,
          humanChars: 0,
          surfaces: [],
        },
        files: {},
        surfaceBreakdown: {},
        excludedGenerated: [],
        sessions: [],
      },
      undefined,
    )

    expect(trailers).toEqual([])
  })
})
