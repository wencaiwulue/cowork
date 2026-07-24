import { describe, expect, it } from 'vitest'
import { applyComposerMenuValue } from '../renderer/src/composerMenu.ts'

describe('composer menu insertion', () => {
  it('replaces the active trigger using the latest input value', () => {
    const result = applyComposerMenuValue({
      input: '@play and keep this',
      cursor: 5,
      value: '@mcp:playwright',
    })

    expect(result).toEqual({
      input: '@mcp:playwright and keep this',
      cursor: '@mcp:playwright '.length,
    })
  })

  it('falls back to the latest input end when the stored cursor is stale', () => {
    const result = applyComposerMenuValue({
      input: 'prefix @existing-skill',
      cursor: 0,
      value: '@skill:existing-skill',
    })

    expect(result).toEqual({
      input: 'prefix @skill:existing-skill ',
      cursor: 'prefix @skill:existing-skill '.length,
    })
  })
})
