import { describe, expect, it } from 'vitest'
import { runtimeErrorPresentation } from '../renderer/src/runtimeErrorPresentation.ts'

describe('runtime error presentation', () => {
  it('keeps Claude runtime errors out of terminal output state', () => {
    expect(runtimeErrorPresentation('desktop runtime smoke failure')).toEqual({
      error: 'desktop runtime smoke failure',
      terminalOutput: undefined,
      terminalStatus: undefined,
    })
  })
})
